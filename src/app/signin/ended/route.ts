import { connection, NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, userForSessionToken } from "@/lib/auth/session-store";

// Sprint 6 review: requireMember() sends a visitor here when their cs_session
// cookie signs no one in (signed out elsewhere, expired, or revoked). A page
// can't set cookies, so this route clears it, then sends them where someone
// with no cookie goes: the welcome page if they asked for /, else sign-in.
// It clears only a cookie that really is dead, so a link from another site
// can't sign anyone out.
export async function GET(request: NextRequest) {
  await connection();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token !== undefined && (await userForSessionToken(token))) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }
  const to = request.nextUrl.searchParams.get("to") === "welcome" ? "/welcome" : "/signin";
  const response = NextResponse.redirect(new URL(to, request.url), 303);
  response.headers.set("cache-control", "no-store");
  if (token !== undefined) response.cookies.delete(SESSION_COOKIE);
  return response;
}
