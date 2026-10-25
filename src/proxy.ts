import { createServerClient } from "@supabase/ssr";
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

// Refreshes the Supabase session cookie once per navigation, so server
// components always see a valid session. Skipped in local dev auth mode.
export async function proxy(request: NextRequest) {
  if (request.method === "GET" && malformedRecordPath(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL("/_record-not-found", request.url));
  }
  if (process.env.AUTH_MODE === "dev" || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.next();
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    },
  );
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/inngest|api/health|fonts/).*)"],
};
