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

// Sprint 6 review: a cs_session cookie that no session matches (signed out
// elsewhere, expired or revoked) is cleared, not kept alive. A page can't set
// cookies, so it sends the visitor to this route, which clears it. The proxy
// tells us which page was asked for (src/proxy.ts repeats both names).
const SESSION_ENDED_PATH = "/signin/ended";
const PATH_HEADER = "x-studio-path";

/**
 * The signed-in member and their workspace. Otherwise redirects as if there
 * were no cookie: to sign-in, or, from /, to the welcome page; a cookie that
 * no longer signs anyone in is cleared on the way.
 */
export const requireMember = cache(requireMemberUncached);

// Cutover day (29 Oct): one workspace check per request, not one transaction
// per component that asks (layout, page and sections all call requireMember).
async function requireMemberUncached(): Promise<CurrentMember> {
  const user = await getCurrentUser();
  if (!user) {
    if ((await cookies()).has(SESSION_COOKIE)) {
      const from = (await headers()).get(PATH_HEADER);
      redirect(from === "/" ? `${SESSION_ENDED_PATH}?to=welcome` : SESSION_ENDED_PATH);
    }
    redirect("/signin");
  }
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
