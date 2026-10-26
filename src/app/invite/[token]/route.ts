import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_COOKIE, encodeDevSession } from "@/lib/auth/dev-session";
import { checkInvite, redeemInvite } from "@/lib/auth/invites";
import { supabaseServer } from "@/lib/auth/supabase";
import { getSql } from "@/lib/db/client";
import { authMode } from "@/lib/env";

// F-3: opening an invite link signs the person in once, then goes home.
// Supabase's admin API (server side; SUPABASE_SECRET_KEY stays in Vercel)
// creates the user if needed and mints a one-time sign-in, which is verified
// here, so no email is sent.
export async function GET(request: NextRequest, ctx: RouteContext<"/invite/[token]">) {
  const { token } = await ctx.params;
  const expired = NextResponse.redirect(new URL("/signin?invite=expired", request.url));
  const email = await checkInvite(token);
  if (!email) return expired;

  if (authMode() === "dev") {
    const [u] = await getSql()`
      insert into auth.users (email) values (${email})
      on conflict (email) do update set email = excluded.email returning id`;
    if (!(await redeemInvite(token, u.id))) return expired;
    (await cookies()).set(DEV_COOKIE, encodeDevSession(u.id, email), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    return NextResponse.redirect(new URL("/", request.url));
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    console.error("[invite] SUPABASE_SECRET_KEY is not set");
    return NextResponse.redirect(new URL("/signin?invite=unavailable", request.url));
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && !/already|exists|registered/i.test(created.error.message)) {
    console.error("[invite] couldn't create the user", created.error.message);
    return NextResponse.redirect(new URL("/signin?invite=unavailable", request.url));
  }
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    console.error("[invite] couldn't make a sign-in", link.error?.message);
    return NextResponse.redirect(new URL("/signin?invite=unavailable", request.url));
  }
  const supabase = await supabaseServer();
  const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  const userId = verified.data.user?.id;
  if (verified.error || !userId) {
    console.error("[invite] couldn't verify the sign-in", verified.error?.message);
    return NextResponse.redirect(new URL("/signin?invite=unavailable", request.url));
  }
  if (!(await redeemInvite(token, userId))) {
    await supabase.auth.signOut();
    return expired;
  }
  return NextResponse.redirect(new URL("/", request.url));
}
