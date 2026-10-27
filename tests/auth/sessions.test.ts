// N-2 test cases 1 to 7: Studio's own sessions and invites (the database and
// library halves; the cookie and pages are covered by tests/e2e/sign-in.spec.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acceptInviteToken, createInvite, newSignInLink, revokeInvite } from "@/lib/auth/invites";
import { createSession, endSessionToken, SESSION_COOKIE, userForSessionToken } from "@/lib/auth/session-store";
import { hashToken } from "@/lib/auth/tokens";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createUser, truncateAll } from "../helpers/db";

const OWNER = "owner@example.test";
let owner: { userId: string; email: string };

const tokenOf = (path: string) => path.replace("/invite/", "");
const workspaceOf = (userId: string) => asUser(userId, async (tx) => (await tx`select public.ensure_workspace() as id`)[0].id as string);
const sessionsOf = async (userId: string) =>
  (await getSql()`select count(*)::int as n from auth.sessions where user_id = ${userId}`)[0].n as number;

describe("N-2 own sessions", () => {
  beforeAll(async () => {
    process.env.OWNER_EMAIL = OWNER;
    process.env.ALLOWED_EMAILS = OWNER;
    await truncateAll();
    owner = { userId: await createUser(OWNER), email: OWNER };
    await workspaceOf(owner.userId);
  });
  beforeEach(async () => {
    await getSql()`delete from auth.sign_in_tokens`;
  });
  afterAll(async () => {
    delete process.env.OWNER_EMAIL;
    delete process.env.ALLOWED_EMAILS;
    await closeSql();
  });

  it("the cookie is called cs_session", () => {
    expect(SESSION_COOKIE).toBe("cs_session");
  });

  it("#1: accepting an invite creates the user and starts a session on an empty workspace; only the token's hash is stored", async () => {
    const email = "new-guest@example.test";
    const { path } = await createInvite(owner, email);
    expect((await getSql()`select id from auth.users where email = ${email}`).length).toBe(0);

    const accepted = await acceptInviteToken(tokenOf(path));
    expect(accepted).not.toBeNull();
    const [u] = await getSql()`select id from auth.users where email = ${email}`;
    expect(accepted!.userId).toBe(u.id);
    expect(accepted!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(await userForSessionToken(accepted!.token)).toEqual({ id: u.id, email });
    const ws = await workspaceOf(u.id);
    expect(await asUser(u.id, (tx) => tx`select id from public.brands where workspace_id = ${ws}`)).toHaveLength(0);

    // Only the hash: no column of the session row holds the token itself.
    const rows = await getSql()`select * from auth.sessions where user_id = ${u.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(accepted!.token));
    expect(JSON.stringify(rows)).not.toContain(accepted!.token);
    // 30 days.
    const days = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    // The invite is used: the same link starts no second session.
    expect(await acceptInviteToken(tokenOf(path))).toBeNull();
    expect(await sessionsOf(u.id)).toBe(1);
  });

  it("#2: a new sign-in link (F-18a) for an existing invitee signs in the same user, to the same workspace, with no second workspace", async () => {
    const email = "returning-guest@example.test";
    const first = await createInvite(owner, email);
    const a = (await acceptInviteToken(tokenOf(first.path)))!;
    const wsBefore = await workspaceOf(a.userId);

    const again = await newSignInLink(owner, first.id);
    const b = (await acceptInviteToken(tokenOf(again.path)))!;
    expect(b.userId).toBe(a.userId);
    expect(b.token).not.toBe(a.token);
    expect(await workspaceOf(b.userId)).toBe(wsBefore);
    const [{ n }] = await getSql()`select count(*)::int as n from public.workspace_members where user_id = ${a.userId}`;
    expect(n).toBe(1);
    expect((await getSql()`select count(*)::int as n from auth.users where email = ${email}`)[0].n).toBe(1);
    // Both browsers stay signed in.
    expect(await userForSessionToken(a.token)).not.toBeNull();
    expect(await userForSessionToken(b.token)).not.toBeNull();
  });

  it("#3: a tampered, unknown, expired or ended session cookie is treated as signed out", async () => {
    const { token } = await createSession(owner.userId);
    expect(await userForSessionToken(token)).toEqual({ id: owner.userId, email: OWNER });

    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await userForSessionToken(flipped)).toBeNull();
    expect(await userForSessionToken("x".repeat(43))).toBeNull();
    expect(await userForSessionToken(undefined)).toBeNull();
    expect(await userForSessionToken("")).toBeNull();

    const expired = await createSession(owner.userId);
    await getSql()`update auth.sessions set expires_at = now() - interval '1 second' where token_hash = ${hashToken(expired.token)}`;
    expect(await userForSessionToken(expired.token)).toBeNull();

    const ended = await createSession(owner.userId);
    await endSessionToken(ended.token);
    expect(await userForSessionToken(ended.token)).toBeNull();
  });

  it("#4: sign-out ends the session; the same cookie no longer works, even replayed", async () => {
    const { token } = await createSession(owner.userId);
    const other = await createSession(owner.userId);
    await endSessionToken(token);
    expect((await getSql()`select 1 from auth.sessions where token_hash = ${hashToken(token)}`).length).toBe(0);
    for (let i = 0; i < 3; i++) expect(await userForSessionToken(token)).toBeNull();
    // Signing out one browser leaves the person's other sessions alone.
    expect(await userForSessionToken(other.token)).not.toBeNull();
    // Ending it again, or ending nonsense, is harmless.
    await expect(endSessionToken(token)).resolves.toBeUndefined();
    await expect(endSessionToken("'; delete from auth.sessions; --")).resolves.toBeUndefined();
    expect(await userForSessionToken(other.token)).not.toBeNull();
  });

  it("#5: revoking a person ends their open sessions and unused sign-in links, and their next request is signed out", async () => {
    const email = "revoke-me@example.test";
    const inv = await createInvite(owner, email);
    const a = (await acceptInviteToken(tokenOf(inv.path)))!;
    const b = await createSession(a.userId);
    await getSql()`insert into auth.sign_in_tokens (token_hash, email, expires_at) values (${hashToken("pending-link")}, ${email}, now() + interval '15 minutes')`;
    expect(await sessionsOf(a.userId)).toBe(2);

    await revokeInvite(owner, inv.id);
    expect(await sessionsOf(a.userId)).toBe(0);
    expect(await userForSessionToken(a.token)).toBeNull();
    expect(await userForSessionToken(b.token)).toBeNull();
    const [t] = await getSql()`select used_at from auth.sign_in_tokens where token_hash = ${hashToken("pending-link")}`;
    expect(t.used_at).not.toBeNull();
  });

  it("#5: only the person who invited an address can end its sessions, and only once it has no access", async () => {
    const email = "still-has-access@example.test";
    const inv = await createInvite(owner, email);
    const guest = (await acceptInviteToken(tokenOf(inv.path)))!;
    const end = (as: string, target: string) => asUser(as, async (tx) => (await tx`select public.end_sessions_for_email(${target}) as n`)[0].n as number);
    // The owner can't sign out someone who still has access, and no guest can sign out anyone.
    expect(await end(owner.userId, email)).toBe(0);
    const ownerSession = await createSession(owner.userId);
    expect(await end(guest.userId, OWNER)).toBe(0);
    expect(await end(guest.userId, email)).toBe(0);
    expect(await userForSessionToken(guest.token)).not.toBeNull();
    expect(await userForSessionToken(ownerSession.token)).not.toBeNull();
  });

  it("#6: a session past its expiry is refused; one used after a day is extended to 30 days from then", async () => {
    const used = await createSession(owner.userId);
    const h = hashToken(used.token);
    // Last seen two days ago, three days left: using it now extends it.
    await getSql()`update auth.sessions set last_seen_at = now() - interval '2 days', expires_at = now() + interval '3 days' where token_hash = ${h}`;
    expect(await userForSessionToken(used.token)).not.toBeNull();
    const [after] = await getSql()`select last_seen_at, expires_at from auth.sessions where token_hash = ${h}`;
    expect((new Date(after.expires_at).getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9);
    expect(Date.now() - new Date(after.last_seen_at).getTime()).toBeLessThan(60_000);

    // Used again within the day: left as it is.
    await getSql()`update auth.sessions set last_seen_at = now() - interval '2 hours', expires_at = now() + interval '5 days' where token_hash = ${h}`;
    expect(await userForSessionToken(used.token)).not.toBeNull();
    const [same] = await getSql()`select expires_at from auth.sessions where token_hash = ${h}`;
    expect((new Date(same.expires_at).getTime() - Date.now()) / 86_400_000).toBeLessThan(5.01);

    // Past its expiry, even if last seen long ago: refused, not extended.
    await getSql()`update auth.sessions set last_seen_at = now() - interval '40 days', expires_at = now() - interval '1 minute' where token_hash = ${h}`;
    expect(await userForSessionToken(used.token)).toBeNull();
    const [still] = await getSql()`select expires_at from auth.sessions where token_hash = ${h}`;
    expect(new Date(still.expires_at).getTime()).toBeLessThan(Date.now());
  });

  it("#7 hostile: a cookie holding SQL, a 10 KB value, or another user's stored hash gets no session", async () => {
    const victim = await createSession(owner.userId);
    const [row] = await getSql()`select token_hash from auth.sessions where token_hash = ${hashToken(victim.token)}`;
    for (const value of [
      "'; drop table auth.sessions; --",
      "' or 1=1 --",
      "A".repeat(10 * 1024),
      row.token_hash as string, // someone who read the hash can't use it as a token
      (row.token_hash as string).slice(0, 43),
      `${victim.token}\u0000`,
      ` ${victim.token}`,
    ]) {
      expect(await userForSessionToken(value), value.slice(0, 40)).toBeNull();
    }
    // The table survived, and the real session still works.
    expect(await userForSessionToken(victim.token)).not.toBeNull();
  });

  it("allow-list: taking someone off ALLOWED_EMAILS signs them out on their next request", async () => {
    const listed = "listed-then-not@example.test";
    const userId = await createUser(listed);
    const { token } = await createSession(userId);
    process.env.ALLOWED_EMAILS = `${OWNER},${listed}`;
    expect(await userForSessionToken(token)).toEqual({ id: userId, email: listed });
    process.env.ALLOWED_EMAILS = OWNER;
    expect(await userForSessionToken(token)).toBeNull();
  });
});
