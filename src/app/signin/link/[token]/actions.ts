"use server";

import { redirect } from "next/navigation";
import { setSessionCookie } from "@/lib/auth/session";
import { redeemSignInLink } from "@/lib/auth/sign-in";

// N-3: the link is used only when the person presses Continue (a POST), so
// link previews and email scanners that open it can't use it up. It works
// once, for 15 minutes; then a session starts.
export async function continueSignIn(token: string): Promise<void> {
  const signedIn = await redeemSignInLink(token);
  if (!signedIn) redirect("/signin?link=expired");
  await setSessionCookie(signedIn.token);
  redirect("/");
}
