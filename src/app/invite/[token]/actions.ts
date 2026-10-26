"use server";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_COOKIE, encodeDevSession } from "@/lib/auth/dev-session";
import { checkInvite, redeemInvite } from "@/lib/auth/invites";
import { supabaseServer } from "@/lib/auth/supabase";
import { getSql } from "@/lib/db/client";
import { authMode } from "@/lib/env";

// F-3: the invite is used only when the person presses Continue (a POST), so
// link previews and email scanners that open the link can't use it up
// (review finding 3). Supabase's admin API (server side; SUPABASE_SECRET_KEY
// stays in Vercel) creates the user if needed and mints a one-time sign-in,
// verified here, so no email is sent.
export async function acceptInvite(token: string): Promise<void> {
  const email = await checkInvite(token);
  if (!email) redirect("/signin?invite=expired");

  if (authMode() === "dev") {
    const [u] = await getSql()`
      insert into auth.users (email) values (${email})
      on conflict (email) do update set email = excluded.email returning id`;
    if (!(await redeemInvite(token, u.id))) redirect("/signin?invite=expired");
    (await cookies()).set(DEV_COOKIE, encodeDevSession(u.id, email), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    redirect("/");
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    console.error("[invite] SUPABASE_SECRET_KEY is not set");
    redirect("/signin?invite=unavailable");
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && !/already|exists|registered/i.test(created.error.message)) {
    console.error("[invite] couldn't create the user", created.error.message);
    redirect("/signin?invite=unavailable");
  }
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    console.error("[invite] couldn't make a sign-in", link.error?.message);
    redirect("/signin?invite=unavailable");
  }
  const supabase = await supabaseServer();
  const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  const userId = verified.data.user?.id;
  if (verified.error || !userId) {
    console.error("[invite] couldn't verify the sign-in", verified.error?.message);
    redirect("/signin?invite=unavailable");
  }
  if (!(await redeemInvite(token, userId))) {
    // Someone used the link a moment earlier: sign this browser out only (review 15).
    await supabase.auth.signOut({ scope: "local" });
    redirect("/signin?invite=expired");
  }
  redirect("/");
}
