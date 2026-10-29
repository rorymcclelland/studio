// Before an e2e run: forget the sign-in links earlier runs asked for on this
// local database, so running the suite several times in an hour doesn't hit
// the limit of 3 links per address per hour (N-3 #4, tested in
// tests/auth/sign-in-links.test.ts). Only test addresses, only on localhost,
// as the demo-brands setup already reads the same DATABASE_URL.
import postgres from "postgres";

export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[e2e] DATABASE_URL is not set, so earlier sign-in links still count against the hourly limit.");
    return;
  }
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from auth.sign_in_tokens where email like '%@example.test'`;
  } finally {
    await sql.end();
  }
}
