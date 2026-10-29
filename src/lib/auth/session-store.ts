import "server-only";
import { withSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { isEmailAllowed } from "@/lib/env";
import { hashToken, isTokenShaped, newToken } from "./tokens";

// N-2: Studio's own sessions. The cookie holds a random token; the database
// holds only its hash (auth.sessions, reached through security-definer
// functions). These are the database halves; session.ts adds the cookie.

export const SESSION_COOKIE = "cs_session";
export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export type CurrentUser = { id: string; email: string };

/** Starts a session for a user who has just used an invite or a sign-in link. The token goes in the cookie; only its hash is stored. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id");
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  // start_session is granted to no app role, so it runs on the app's own connection.
  await withSql((sql) => sql`select public.start_session(${userId}, ${hashToken(token)}, ${expiresAt})`);
  return { token, expiresAt };
}

/**
 * The user a session token signs in, or null: unknown, tampered, ended or
 * expired tokens get nothing, and so does anyone who no longer has access
 * (taken off the allow-list, or revoked), on their very next request.
 */
export async function userForSessionToken(token: string | undefined | null): Promise<CurrentUser | null> {
  if (!isTokenShaped(token)) return null;
  const [s] = await asAnon((tx) => tx`select user_id, email from public.lookup_session(${hashToken(token)})`);
  if (!s?.user_id || !s.email) return null;
  const user = { id: s.user_id as string, email: s.email as string };
  return (await hasAccess(user.id, user.email)) ? user : null;
}

/** On the allow-list (ALLOWED_EMAILS), or invited and not revoked (F-3). */
export async function hasAccess(userId: string, email: string): Promise<boolean> {
  if (isEmailAllowed(email)) return true;
  return asUser(userId, async (tx) => {
    const [r] = await tx`select public.is_invited(${email}) as ok`;
    return r.ok === true;
  });
}

/** Ends a session (sign-out): the same token never works again, even replayed. */
export async function endSessionToken(token: string | undefined | null): Promise<void> {
  if (!isTokenShaped(token)) return;
  await asAnon((tx) => tx`select public.end_session(${hashToken(token)})`);
}
