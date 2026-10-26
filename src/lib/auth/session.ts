import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db/scoped";
import { authMode, isEmailAllowed } from "@/lib/env";
import { decodeDevSession, DEV_COOKIE } from "./dev-session";
import { supabaseServer } from "./supabase";

export type CurrentUser = { id: string; email: string };
export type CurrentMember = CurrentUser & { userId: string; workspaceId: string };

/** The signed-in, allow-listed user, or null. The only session read in the app. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (authMode() === "dev") {
    const s = decodeDevSession((await cookies()).get(DEV_COOKIE)?.value);
    if (!s || !(await allowed(s.userId, s.email))) return null;
    return { id: s.userId, email: s.email };
  }
  // The Supabase client reads the clock (Date.now) while checking the session.
  // Under Cache Components that must happen at request time, not while
  // prerendering, so mark this as request-time work first.
  await connection();
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : null;
  if (!claims?.sub || !email || !(await allowed(claims.sub, email))) return null;
  return { id: claims.sub, email };
}

/** On the allow-list (ALLOWED_EMAILS), or invited and not revoked (F-3). */
async function allowed(userId: string, email: string): Promise<boolean> {
  if (isEmailAllowed(email)) return true;
  return asUser(userId, async (tx) => {
    const [r] = await tx`select public.is_invited(${email}) as ok`;
    return r.ok === true;
  });
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
