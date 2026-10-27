"use server";

import { redirect } from "next/navigation";
import { acceptInviteToken } from "@/lib/auth/invites";
import { setSessionCookie } from "@/lib/auth/session";

// F-3 and N-2: the invite is used only when the person presses Continue (a
// POST), so link previews and email scanners that open the link can't use it
// up (review finding 3). Accepting it finds or creates the user, redeems the
// invite and starts Studio's own session; no provider and no email.
export async function acceptInvite(token: string): Promise<void> {
  const accepted = await acceptInviteToken(token);
  if (!accepted) redirect("/signin?invite=expired");
  await setSessionCookie(accepted.token);
  redirect("/");
}
