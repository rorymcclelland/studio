import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db/scoped";
import { endSessionToken, SESSION_COOKIE, SESSION_SECONDS, userForSessionToken, type CurrentUser } from "./session-store";

export type { CurrentUser };
export type CurrentMember = CurrentUser & { userId: string; workspaceId: string };

// One lookup per request and token, however many components ask.
const userForToken = cache(userForSessionToken);

/** The signed-in user with access (allow-listed or invited), or null. The only session read in the app. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForToken(token ?? null);
}

/** The signed-in member and their workspace; redirects to sign-in otherwise. */
export async function requireMember(): Promise<CurrentMember> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const workspaceId = await asUser(user.id, async (tx) => {
    const [r] = await tx`select public.ensure_workspace() as id`;
    return r.id as string;
  });
  return { ...user, userId: user.id, workspaceId };
}

/**
 * Secure everywhere except plain local http (next dev or next start on
 * localhost), where a Secure cookie would never be sent back.
 */
async function secureCookie(): Promise<boolean> {
  if (process.env.VERCEL) return true;
  return (await headers()).get("x-forwarded-proto") === "https";
}

/** Sets the session cookie (server actions only): httpOnly, SameSite=Lax, path /, 30 days. */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: await secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

/** Sign-out (server actions only): ends the session in the database and clears the cookie. */
export async function endCurrentSession(): Promise<void> {
  const store = await cookies();
  await endSessionToken(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
}
