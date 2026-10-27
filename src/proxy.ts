import { NextResponse, type NextRequest } from "next/server";

// F-12: a record page whose id can't be an id is a real 404. The page itself
// can't set the status, because the app shell streams (and commits to 200)
// before the page runs; rewriting to a path no route matches makes Next.js
// answer with its not-found page and a 404 status.
const RECORD_PAGE = /^\/(brands|runs|campaigns)\/([^/]+)(\/edit)?\/?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function malformedRecordPath(pathname: string): boolean {
  const m = RECORD_PAGE.exec(pathname);
  if (!m) return false;
  try {
    return !UUID.test(decodeURIComponent(m[2]));
  } catch {
    return true; // not even valid percent-encoding
  }
}

// N-2: Studio's own session cookie (src/lib/auth/session-store.ts). Proxy
// runs apart from the app's modules, so the name is repeated here.
const SESSION_COOKIE = "cs_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

/** A session cookie is present (whether it is valid is checked by the page). */
export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.has(SESSION_COOKIE);
}

export function proxy(request: NextRequest) {
  if (request.method === "GET" && malformedRecordPath(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL("/_record-not-found", request.url));
  }
  // F-3: someone with no session sees the public page at /, not a sign-in redirect.
  if (request.method === "GET" && request.nextUrl.pathname === "/" && !hasSessionCookie(request)) {
    return NextResponse.rewrite(new URL("/welcome", request.url));
  }
  const response = NextResponse.next();
  // The database extends a session used after a day (public.lookup_session);
  // this keeps the cookie alive alongside it. GET only, so it never races the
  // sign-out action's own Set-Cookie. A cookie the database no longer knows
  // stays useless: the page still treats it as signed out.
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (request.method === "GET" && session && /^[A-Za-z0-9_-]{43}$/.test(session)) {
    response.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/inngest|api/health|fonts/).*)"],
};
