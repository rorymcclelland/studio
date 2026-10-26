// F-3 test cases 2 to 4 (server side): invite links and the per-workspace cap.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { checkInvite, createInvite, InviteError, listInvites, revokeInvite, redeemInvite } from "@/lib/auth/invites";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { CapExceededError, generate } from "@/lib/models/generate";
import { createUser, truncateAll } from "../helpers/db";

const OWNER = "owner@example.test";
let owner: { userId: string; email: string; workspaceId: string };
let guest: { userId: string; email: string; workspaceId: string };

async function member(email: string) {
  const userId = await createUser(email);
  const workspaceId = await asUser(userId, async (tx) => (await tx`select public.ensure_workspace() as id`)[0].id as string);
  return { userId, email, workspaceId };
}
const tokenOf = (path: string) => path.replace("/invite/", "");
const call = (m: { userId: string; workspaceId: string }) => generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: "Brand name: x" });
const invited = (userId: string, email: string) => asUser(userId, async (tx) => (await tx`select public.is_invited(${email}) as ok`)[0].ok);

describe("F-3 invites", () => {
  beforeAll(async () => {
    process.env.OWNER_EMAIL = OWNER;
    await truncateAll();
    owner = await member(OWNER);
    guest = await member("guest@example.test");
  });
  afterEach(() => {
    delete process.env.WORKSPACE_DAILY_CAP_PENCE;
  });
  afterAll(async () => {
    delete process.env.OWNER_EMAIL;
    await closeSql();
  });

  it("the owner creates an invite; the link works once, then says it has expired", async () => {
    const { path } = await createInvite(owner, "  Interviewer@Example.TEST ", "Hiring manager at a fictional agency");
    expect(path).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(path);
    expect(await checkInvite(token)).toBe("interviewer@example.test");
    const person = await member("interviewer@example.test");
    expect(await invited(person.userId, person.email)).toBe(false);
    expect(await redeemInvite(token, person.userId)).toBe(true);
    expect(await invited(person.userId, person.email)).toBe(true);
    expect(await checkInvite(token)).toBeNull();
    expect(await redeemInvite(token, person.userId)).toBe(false);
    const [row] = await getSql()`select token_hash from public.invites where email = 'interviewer@example.test'`;
    expect(row.token_hash).not.toContain(token); // only the hash is stored
  });

  it("an expired, revoked or made-up link doesn't work; revoking a used invite removes access", async () => {
    const a = await createInvite(owner, "late@example.test");
    await getSql()`update public.invites set expires_at = now() - interval '1 minute' where email = 'late@example.test'`;
    expect(await checkInvite(tokenOf(a.path))).toBeNull();
    const b = await createInvite(owner, "revoked@example.test");
    await revokeInvite(owner, b.id);
    expect(await checkInvite(tokenOf(b.path))).toBeNull();
    expect(await checkInvite("not-a-real-token-at-all-0123456789")).toBeNull();
    expect(await checkInvite("'; drop table invites; --")).toBeNull();
    const c = await createInvite(owner, "used@example.test");
    const p = await member("used@example.test");
    await redeemInvite(tokenOf(c.path), p.userId);
    await revokeInvite(owner, c.id);
    expect(await invited(p.userId, p.email)).toBe(false);
    // Revoking one invite revokes the person: an older used invite for the same email stops counting too.
    const d1 = await createInvite(owner, "twice@example.test");
    const p2 = await member("twice@example.test");
    await redeemInvite(tokenOf(d1.path), p2.userId);
    const d2 = await createInvite(owner, "twice@example.test");
    await redeemInvite(tokenOf(d2.path), p2.userId);
    expect(await revokeInvite(owner, d2.id)).toBe("twice@example.test");
    expect(await invited(p2.userId, p2.email)).toBe(false);
    process.env.ALLOWED_EMAILS = "listed@example.test";
    await expect(createInvite(owner, "listed@example.test")).rejects.toThrow(/allow-list already/);
    delete process.env.ALLOWED_EMAILS;
    const states = Object.fromEntries((await listInvites(owner)).map((i) => [i.email, i.state]));
    expect(states).toMatchObject({ "late@example.test": "expired", "revoked@example.test": "revoked", "used@example.test": "revoked", "interviewer@example.test": "used" });
  });

  it("no one but the owner can create, list or revoke invites, or see the owner's", async () => {
    await expect(createInvite(guest, "x@example.test")).rejects.toThrow(InviteError);
    await expect(listInvites(guest)).rejects.toThrow(InviteError);
    expect(await asUser(guest.userId, (tx) => tx`select id from public.invites`)).toHaveLength(0);
    await expect(createInvite(owner, "not an email")).rejects.toThrow(/valid email/);
  });

  it("a non-owner workspace stops at its own daily limit; the owner's doesn't (review 12)", async () => {
    process.env.WORKSPACE_DAILY_CAP_PENCE = "50";
    const before = process.env.DAILY_CAP_PENCE;
    process.env.DAILY_CAP_PENCE = "200";
    try {
      for (const m of [guest, owner]) {
        await asUser(m.userId, (tx) => tx`
          insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
          values (${m.workspaceId}, 'tagline', 'mock', 'mock-model', 0, 0, 49.99)`);
      }
      const err = await call(guest).catch((e) => e);
      expect(err).toBeInstanceOf(CapExceededError);
      expect(err.message).toContain("today's limit for this workspace is reached");
      // The owner's workspace is over 50p too, but the owner may use the whole daily cap.
      await expect(call(owner)).resolves.toMatchObject({ provider: "mock" });
    } finally {
      process.env.DAILY_CAP_PENCE = before;
      await getSql()`delete from public.usage_ledger`;
    }
  });

  it("guests can't spend the owner's reserve (review 6)", async () => {
    process.env.WORKSPACE_DAILY_CAP_PENCE = "100";
    const before = process.env.DAILY_CAP_PENCE;
    process.env.DAILY_CAP_PENCE = "100";
    try {
      await asUser(guest.userId, (tx) => tx`
        insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
        values (${guest.workspaceId}, 'tagline', 'mock', 'mock-model', 0, 0, 49.99)`);
      const err = await call(guest).catch((e) => e);
      expect(err).toBeInstanceOf(CapExceededError);
      expect(err.scope).toBe("app");
      await expect(call(owner)).resolves.toMatchObject({ provider: "mock" });
    } finally {
      process.env.DAILY_CAP_PENCE = before;
      await getSql()`delete from public.usage_ledger`;
    }
  });
});
