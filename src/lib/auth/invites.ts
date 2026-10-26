import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { asAnon, asUser } from "@/lib/db/scoped";
import { allowedEmails, isOwnerEmail } from "@/lib/env";

// F-3: invite links Rory sends himself. A link carries a random token; only
// its SHA-256 is stored. It works once, for 7 days, until revoked.

export const INVITE_DAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InviteError extends Error {}

export const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

export type Invite = {
  id: string;
  email: string;
  note: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  state: "open" | "used" | "expired" | "revoked";
};

function requireOwner(email: string) {
  if (!isOwnerEmail(email)) throw new InviteError("Only the owner can invite people.");
}

/** Creates an invite and returns the one-time link path (the token is shown once and never stored). */
export async function createInvite(owner: { userId: string; email: string }, rawEmail: string, note?: string): Promise<{ id: string; path: string }> {
  requireOwner(owner.email);
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new InviteError("Enter a valid email address.");
  if (isOwnerEmail(email)) throw new InviteError("That's your own email.");
  // An allow-listed address already signs in directly; an invite link for it would let whoever holds the link into that account (review 13).
  if (allowedEmails().includes(email)) throw new InviteError("That address is on the allow-list already, so it doesn't need an invite.");
  const token = randomBytes(32).toString("base64url");
  const [r] = await asUser(owner.userId, (tx) => tx`
    insert into public.invites (email, token_hash, note, created_by, expires_at)
    values (${email}, ${hashToken(token)}, ${note?.trim().slice(0, 200) || null}, ${owner.userId}, now() + ${`${INVITE_DAYS} days`}::interval)
    returning id`);
  return { id: r.id as string, path: `/invite/${token}` };
}

export async function listInvites(owner: { userId: string; email: string }): Promise<Invite[]> {
  requireOwner(owner.email);
  const rows = await asUser(owner.userId, (tx) => tx`
    select id, email, note, created_at, expires_at, used_at, revoked_at from public.invites order by created_at desc limit 200`);
  return rows.map((r) => ({
    id: r.id, email: r.email, note: r.note, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at, revokedAt: r.revoked_at,
    state: r.revoked_at ? "revoked" : r.used_at ? "used" : new Date(r.expires_at) <= new Date() ? "expired" : "open",
  }));
}

/**
 * Revokes a person: every invite for that invite's email, so open links stop
 * working and whoever used one can no longer sign in (review 1: one person
 * may have had several invites).
 */
export async function revokeInvite(owner: { userId: string; email: string }, inviteId: string): Promise<string> {
  requireOwner(owner.email);
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) throw new InviteError("That invite doesn't exist.");
  return asUser(owner.userId, async (tx) => {
    const [i] = await tx`select email from public.invites where id = ${inviteId}`;
    if (!i) throw new InviteError("That invite doesn't exist.");
    const rows = await tx`update public.invites set revoked_at = now() where email = ${i.email} and revoked_at is null returning id`;
    if (rows.length === 0) throw new InviteError("That person's access is already revoked.");
    return i.email as string;
  });
}

/** The email an invite token is good for, or null (used, expired, revoked or unknown). */
export async function checkInvite(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [r] = await asAnon((tx) => tx`select public.check_invite(${hashToken(token)}) as email`);
  return (r?.email as string | null) ?? null;
}

/** Marks the invite used by the user it signed in. False if someone used it in the meantime. */
export async function redeemInvite(token: string, userId: string): Promise<boolean> {
  const [r] = await asAnon((tx) => tx`select public.use_invite(${hashToken(token)}, ${userId}) as ok`);
  return r?.ok === true;
}

/**
 * F-18a: a fresh one-time link for someone who has already used an invite, so
 * they can sign back in (Supabase's own email only reaches team members).
 * Accepting it signs in their existing account and workspace. A revoked person
 * gets no new link; invite them again to restore access.
 */
export async function newSignInLink(owner: { userId: string; email: string }, inviteId: string): Promise<{ id: string; path: string; email: string }> {
  requireOwner(owner.email);
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) throw new InviteError("That invite doesn't exist.");
  const [i] = await asUser(owner.userId, (tx) => tx`
    select email, used_at, revoked_at,
      exists (select 1 from public.invites o where o.email = invites.email and o.revoked_at is not null) as person_revoked
    from public.invites where id = ${inviteId}`);
  if (!i) throw new InviteError("That invite doesn't exist.");
  if (i.revoked_at || i.person_revoked) throw new InviteError("That person's access is revoked. Invite them again to restore it.");
  if (!i.used_at) throw new InviteError("That invite hasn't been used yet, so the original link still works.");
  const made = await createInvite(owner, i.email as string, "New sign-in link");
  return { ...made, email: i.email as string };
}
