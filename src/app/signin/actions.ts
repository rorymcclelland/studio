"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSql } from "@/lib/db/client";
import { authMode, isEmailAllowed } from "@/lib/env";
import { DEV_COOKIE, encodeDevSession } from "@/lib/auth/dev-session";
import { supabaseServer } from "@/lib/auth/supabase";

export type SignInState = { message: string; tone: "info" | "error" } | null;

const emailSchema = z.email("Enter a valid email address.").max(254);

// Same reply whether or not the email is allowed, so the form does not
// reveal who has access (S1-3 #5: unlisted emails get no link and no session).
const SENT = "If this email has access, a sign-in link is on its way. Check your inbox.";

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { message: parsed.error.issues[0].message, tone: "error" };
  const email = parsed.data.toLowerCase();

  if (!isEmailAllowed(email)) return { message: SENT, tone: "info" };

  if (authMode() === "dev") {
    const sql = getSql();
    const [u] = await sql`
      insert into auth.users (email) values (${email})
      on conflict (email) do update set email = excluded.email
      returning id`;
    (await cookies()).set(DEV_COOKIE, encodeDevSession(u.id, email), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    redirect("/");
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error && error.status !== 422 && error.status !== 400) {
    return { message: "Couldn't send the link just now. Try again in a minute.", tone: "error" };
  }
  return { message: SENT, tone: "info" };
}

export async function signOut(): Promise<void> {
  if (authMode() === "dev") {
    (await cookies()).delete(DEV_COOKIE);
  } else {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/signin");
}
