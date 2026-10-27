import "server-only";
import { z } from "zod";
import { asAnon } from "@/lib/db/scoped";
import { isEmailAllowed } from "@/lib/env";
import { getMailer, type Mailer } from "@/lib/email/mailer";
import { createSession, hasAccess } from "./session-store";
import { signInEmail } from "./sign-in-email";
import { hashToken, isTokenShaped, newToken } from "./tokens";
import { findOrCreateUser } from "./users";

// N-3: sign in by email. Anyone allow-listed, or invited and not revoked,
// asks for a link; it works once, for 15 minutes, and only when they press
// Continue on the page it opens (a POST), so link scanners can't use it up.

export const SIGN_IN_MINUTES = 15;

/** What the sign-in page always says once an address passes validation, whether or not anything was sent. */
export const SIGN_IN_REPLY = "If that address has access, we've sent a sign-in link. It works once, for 15 minutes.";

const MAX_EMAIL = 254;
const emailShape = z.email();

/**
 * Validates an address before anything else happens. Refuses control
 * characters (so no header injection such as "a@b.c\nBcc: x@y.z") and
 * anything over 254 characters.
 */
export function parseSignInEmail(raw: unknown): { email: string } | { error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { error: "Enter your email address." };
  if (value.length > MAX_EMAIL) return { error: `An email address can be at most ${MAX_EMAIL} characters.` };
  if (/[\u0000-\u001f\u007f]/.test(value) || !emailShape.safeParse(value).success) {
    return { error: "Enter a valid email address." };
  }
  return { email: value.toLowerCase() };
}

/**
 * The address sign-in links point at. Production uses its own domain and
 * previews their deployment address, never the request's Host header, so a
 * forged Host can't make Studio email someone a link to another site.
 * APP_URL overrides both; locally the request's own address is used.
 */
export function linkOrigin(h: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, "");
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

/**
 * Records and sends a sign-in link when the address has access and the
 * limits allow (3 per address per hour, 30 an hour in all). Returns whether
 * a link was sent; the caller shows SIGN_IN_REPLY either way.
 */
export async function requestSignInLink(email: string, origin: string, mailer: Mailer = getMailer()): Promise<boolean> {
  const token = newToken();
  const [r] = await asAnon((tx) => tx`
    select public.request_sign_in(${email}, ${hashToken(token)}, ${isEmailAllowed(email)}) as ok`);
  if (r?.ok !== true) return false;
  await mailer.send(signInEmail(email, `${origin}/signin/link/${token}`, SIGN_IN_MINUTES));
  return true;
}

/**
 * Uses a sign-in link and starts a session. Null when the link is unknown,
 * used, expired, or its address has lost access since it was sent.
 */
export async function redeemSignInLink(token: string): Promise<{ userId: string; email: string; token: string; expiresAt: Date } | null> {
  if (!isTokenShaped(token)) return null;
  const [r] = await asAnon((tx) => tx`select public.use_sign_in(${hashToken(token)}) as email`);
  const email = r?.email as string | null | undefined;
  if (!email) return null;
  const userId = await findOrCreateUser(email);
  if (!(await hasAccess(userId, email))) return null;
  const session = await createSession(userId);
  return { userId, email, ...session };
}
