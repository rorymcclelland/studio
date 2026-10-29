"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { endCurrentSession } from "@/lib/auth/session";
import { linkOrigin, parseSignInEmail, requestSignInLink, SIGN_IN_REPLY } from "@/lib/auth/sign-in";
import { scrubEmails } from "@/lib/email/resend";

export type SignInState = { message: string; tone: "info" | "error" } | null;

/**
 * N-3: asks for a sign-in link. A valid address always gets the same reply,
 * straight away: the access check, the limits and the email all run after
 * the response (after()), so neither the words nor the timing say who has
 * access (S1-3 #5).
 */
export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = parseSignInEmail(form.get("email"));
  if ("error" in parsed) return { message: parsed.error, tone: "error" };
  const origin = linkOrigin(await headers());
  // Step logs (never the address), so a link that doesn't arrive can be traced
  // in Vercel's runtime logs (cutover day, 29 Oct).
  console.info("[signIn] link asked for");
  after(async () => {
    try {
      console.info("[signIn] background step started");
      const sent = await requestSignInLink(parsed.email, origin);
      console.info(`[signIn] background step finished: ${sent ? "link recorded and handed to the mailer" : "no link (no access or over a limit)"}`);
    } catch (err) {
      // Logged without the address (any error, not only the mailer's, is scrubbed); the reply stays the same.
      console.error("[signIn] couldn't send a sign-in link", scrubEmails(err instanceof Error ? err.message : String(err)));
    }
  });
  return { message: SIGN_IN_REPLY, tone: "info" };
}

export async function signOut(): Promise<void> {
  await endCurrentSession();
  redirect("/signin");
}
