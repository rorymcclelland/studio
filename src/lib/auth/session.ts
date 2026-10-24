import "server-only";
import { cookies } from "next/headers";
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
    if (!s || !isEmailAllowed(s.email)) return null;
    return { id: s.userId, email: s.email };
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : null;
  if (!claims?.sub || !isEmailAllowed(email)) return null;
  return { id: claims.sub, email: email! };
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
