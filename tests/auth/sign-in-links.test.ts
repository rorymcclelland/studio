// N-3 test cases 1 to 6: sign in by email (library and database halves; the
// pages, Continue and the console mailer route are in tests/e2e/sign-in.spec.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acceptInviteToken, createInvite, revokeInvite } from "@/lib/auth/invites";
import { userForSessionToken } from "@/lib/auth/session-store";
import { linkOrigin, parseSignInEmail, redeemSignInLink, requestSignInLink, SIGN_IN_REPLY } from "@/lib/auth/sign-in";
import { hashToken } from "@/lib/auth/tokens";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { clearOutbox, consoleMailer, lastSignInLink, sentTo } from "@/lib/email/console";
import type { Mailer } from "@/lib/email/mailer";
import { createUser, truncateAll } from "../helpers/db";

const OWNER = "owner@example.test";
const LISTED = "listed@example.test";
const ORIGIN = "http://localhost:3000";
let owner: { userId: string; email: string };
const mailer = consoleMailer();

const inviteToken = (path: string) => path.replace("/invite/", "");
const linkToken = (link: string) => link.split("/signin/link/")[1];
const workspaceOf = (userId: string) => asUser(userId, async (tx) => (await tx`select public.ensure_workspace() as id`)[0].id as string);

async function invitedGuest(email: string) {
  const inv = await createInvite(owner, email);
  const accepted = (await acceptInviteToken(inviteToken(inv.path)))!;
  return { ...accepted, inviteId: inv.id };
}

describe("N-3 sign in by email", () => {
  beforeAll(async () => {
    process.env.OWNER_EMAIL = OWNER;
    process.env.ALLOWED_EMAILS = `${OWNER},${LISTED}`;
    await truncateAll();
    owner = { userId: await createUser(OWNER), email: OWNER };
  });
  beforeEach(async () => {
    await getSql()`delete from auth.sign_in_tokens`;
    clearOutbox();
  });
  afterAll(async () => {
    delete process.env.OWNER_EMAIL;
    delete process.env.ALLOWED_EMAILS;
    await closeSql();
  });

  it("the reply never says whether an address has access", () => {
    expect(SIGN_IN_REPLY).toBe("If that address has access, we've sent a sign-in link. It works once, for 15 minutes.");
  });

  it("#1: an allow-listed email gets a link; it signs in once; a second use, or use after 15 minutes, gets nothing", async () => {
    expect(await requestSignInLink(LISTED, ORIGIN, mailer)).toBe(true);
    const sent = lastSignInLink(LISTED)!;
    expect(sent.count).toBe(1);
    expect(sent.link).toMatch(/^http:\/\/localhost:3000\/signin\/link\/[A-Za-z0-9_-]{43}$/);
    const token = linkToken(sent.link);
    const [row] = await getSql()`select email, created_at, expires_at, used_at from auth.sign_in_tokens where token_hash = ${hashToken(token)}`;
    expect(row.email).toBe(LISTED);
    expect(row.used_at).toBeNull();
    expect(new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()).toBe(15 * 60 * 1000);
    expect(JSON.stringify(await getSql()`select * from auth.sign_in_tokens`)).not.toContain(token);

    const signedIn = (await redeemSignInLink(token))!;
    expect(signedIn.email).toBe(LISTED);
    expect(await userForSessionToken(signedIn.token)).toEqual({ id: signedIn.userId, email: LISTED });
    // Works once.
    expect(await redeemSignInLink(token)).toBeNull();

    // After 15 minutes: refused, and no session starts.
    await requestSignInLink(LISTED, ORIGIN, mailer);
    const late = linkToken(lastSignInLink(LISTED)!.link);
    await getSql()`update auth.sign_in_tokens set created_at = now() - interval '16 minutes', expires_at = now() - interval '1 minute' where token_hash = ${hashToken(late)}`;
    const before = (await getSql()`select count(*)::int as n from auth.sessions`)[0].n;
    expect(await redeemSignInLink(late)).toBeNull();
    expect((await getSql()`select count(*)::int as n from auth.sessions`)[0].n).toBe(before);
  });

  it("#1: the owner (allow-listed, existing user) signs in to the same user each time", async () => {
    await requestSignInLink(OWNER, ORIGIN, mailer);
    const a = (await redeemSignInLink(linkToken(lastSignInLink(OWNER)!.link)))!;
    await requestSignInLink(OWNER, ORIGIN, mailer);
    const b = (await redeemSignInLink(linkToken(lastSignInLink(OWNER)!.link)))!;
    expect(a.userId).toBe(owner.userId);
    expect(b.userId).toBe(owner.userId);
  });

  it("#2: an invited, unrevoked person gets a link and lands in their own workspace", async () => {
    const guest = await invitedGuest("invited-by-email@example.test");
    const ws = await workspaceOf(guest.userId);
    expect(await requestSignInLink(guest.email, ORIGIN, mailer)).toBe(true);
    const signedIn = (await redeemSignInLink(linkToken(lastSignInLink(guest.email)!.link)))!;
    expect(signedIn.userId).toBe(guest.userId);
    expect(await workspaceOf(signedIn.userId)).toBe(ws);
    expect(ws).not.toBe(await workspaceOf(owner.userId));
    const [{ n }] = await getSql()`select count(*)::int as n from public.workspace_members where user_id = ${guest.userId}`;
    expect(n).toBe(1);
  });

  it("#3: an unknown, revoked or not-yet-accepted email gets nothing recorded and nothing sent", async () => {
    const revoked = await invitedGuest("revoked-by-email@example.test");
    await revokeInvite(owner, revoked.inviteId);
    await createInvite(owner, "not-accepted@example.test");
    for (const email of ["nobody@example.test", revoked.email, "not-accepted@example.test"]) {
      expect(await requestSignInLink(email, ORIGIN, mailer), email).toBe(false);
      expect(sentTo(email), email).toEqual([]);
    }
    expect((await getSql()`select count(*)::int as n from auth.sign_in_tokens`)[0].n).toBe(0);
  });

  it("#3: a link sent before someone lost access doesn't sign them in", async () => {
    const guest = await invitedGuest("lost-access@example.test");
    await requestSignInLink(guest.email, ORIGIN, mailer);
    const token = linkToken(lastSignInLink(guest.email)!.link);
    await revokeInvite(owner, guest.inviteId);
    expect(await redeemSignInLink(token)).toBeNull();

    // Taken off the allow-list between asking and using: no session either.
    process.env.ALLOWED_EMAILS = `${OWNER},${LISTED},soon-gone@example.test`;
    await requestSignInLink("soon-gone@example.test", ORIGIN, mailer);
    const t2 = linkToken(lastSignInLink("soon-gone@example.test")!.link);
    process.env.ALLOWED_EMAILS = `${OWNER},${LISTED}`;
    expect(await redeemSignInLink(t2)).toBeNull();
  });

  it("#4: a fourth request within an hour for one address sends nothing; an hour later it works again", async () => {
    for (let i = 0; i < 3; i++) expect(await requestSignInLink(LISTED, ORIGIN, mailer)).toBe(true);
    expect(await requestSignInLink(LISTED, ORIGIN, mailer)).toBe(false);
    expect(sentTo(LISTED)).toHaveLength(3);
    // Another address isn't held up by this one.
    expect(await requestSignInLink(OWNER, ORIGIN, mailer)).toBe(true);
    await getSql()`update auth.sign_in_tokens set created_at = now() - interval '61 minutes' where email = ${LISTED}`;
    expect(await requestSignInLink(LISTED, ORIGIN, mailer)).toBe(true);
  });

  it("#4: thirty links an hour in all, across addresses; the thirty-first sends nothing", async () => {
    await getSql()`
      insert into auth.sign_in_tokens (token_hash, email, expires_at)
      select encode(sha256(('filler-' || g)::bytea), 'hex'), 'filler-' || g || '@example.test', now() + interval '15 minutes'
      from generate_series(1, 30) g`;
    expect(await requestSignInLink(LISTED, ORIGIN, mailer)).toBe(false);
    expect(sentTo(LISTED)).toEqual([]);
  });

  it("#4: concurrent requests can't get past the limit together", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => requestSignInLink(LISTED, ORIGIN, mailer)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(sentTo(LISTED)).toHaveLength(3);
  });

  it("#6 hostile: header injection and over-long addresses are refused by validation", () => {
    expect(parseSignInEmail("a@b.c\nBcc: x@y.z")).toEqual({ error: "Enter a valid email address." });
    expect(parseSignInEmail("a@b.c\r\nBcc: x@y.z")).toEqual({ error: "Enter a valid email address." });
    expect(parseSignInEmail("a@b.c%0aBcc:x@y.z")).toEqual({ error: "Enter a valid email address." });
    expect(parseSignInEmail("a\u0000@b.c")).toEqual({ error: "Enter a valid email address." });
    expect(parseSignInEmail(`${"a".repeat(288)}@example.test`)).toEqual({ error: "An email address can be at most 254 characters." });
    expect(parseSignInEmail("not an email")).toEqual({ error: "Enter a valid email address." });
    expect(parseSignInEmail("")).toEqual({ error: "Enter your email address." });
    expect(parseSignInEmail(null)).toEqual({ error: "Enter your email address." });
    expect(parseSignInEmail("  Rory@Example.TEST ")).toEqual({ email: "rory@example.test" });
  });

  it("#6 hostile: the database refuses an over-long address or SQL in it, even if the app's check were skipped", async () => {
    const ask = (email: string) => asAnon(async (tx) => (await tx`select public.request_sign_in(${email}, ${hashToken(email)}, true) as ok`)[0].ok);
    expect(await ask(`${"a".repeat(300)}@example.test`)).toBe(false);
    expect(await ask("no-at-sign")).toBe(false);
    await expect(ask("x'); delete from auth.sign_in_tokens; --@example.test")).resolves.toBeTypeOf("boolean");
    // A token that isn't token-shaped never reaches the database.
    expect(await redeemSignInLink("'; update auth.sign_in_tokens set used_at = null; --")).toBeNull();
    expect(await redeemSignInLink("A".repeat(10 * 1024))).toBeNull();
  });

  it("a provider error reaches the caller (the sign-in page logs it and keeps the same reply)", async () => {
    const failing: Mailer = { kind: "resend", send: async () => { throw new Error("Resend refused the email (HTTP 500)."); } };
    await expect(requestSignInLink(LISTED, ORIGIN, failing)).rejects.toThrow(/HTTP 500/);
  });

  it("links point at the configured address on Vercel, never a forged Host header", () => {
    const forged = new Headers({ host: "evil.example", "x-forwarded-proto": "https" });
    expect(linkOrigin(forged, { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "studio.example.test" })).toBe("https://studio.example.test");
    expect(linkOrigin(forged, { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "studio-abc.vercel.app" })).toBe("https://studio-abc.vercel.app");
    expect(linkOrigin(forged, { APP_URL: "https://studio.example.test/" })).toBe("https://studio.example.test");
    expect(linkOrigin(new Headers({ host: "localhost:3100", "x-forwarded-proto": "http" }), {})).toBe("http://localhost:3100");
  });
});
