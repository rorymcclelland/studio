import { connection, type NextRequest } from "next/server";
import { lastSignInLink } from "@/lib/email/console";
import { mailerKind } from "@/lib/email/mailer";

// N-3, for the e2e tests: the newest sign-in link the console mailer "sent"
// to an address, and how many it has sent there, so a test can sign in by
// email the way a person does. Only off Vercel (local work and CI) and only
// with the console mailer; everywhere else, including previews, it is not
// found, so no one can read another person's link from a deployment.
export async function GET(request: NextRequest) {
  await connection();
  if (process.env.VERCEL || process.env.VERCEL_ENV || mailerKind() !== "console") {
    return new Response("Not found", { status: 404 });
  }
  const email = (request.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  const found = lastSignInLink(email);
  return Response.json(found ?? { link: null, count: 0 }, { headers: { "cache-control": "no-store" } });
}
