import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/auth/supabase";

// Magic-link landing: swap the one-time code for a session, then go home.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.redirect(new URL("/signin?link=expired", request.url));
}
