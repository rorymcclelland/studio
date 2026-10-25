import { connection } from "next/server";
import { getSql } from "@/lib/db/client";

// Keep-awake and health check (S1-1 #6). Vercel cron calls this daily so the
// free Supabase project never reaches a week without activity.
export async function GET() {
  await connection();
  const started = Date.now();
  try {
    await getSql()`select 1`;
    const ms = Date.now() - started;
    console.log(`[health] database ok in ${ms}ms`);
    return Response.json({ ok: true, database: "ok", ms });
  } catch (err) {
    console.error("[health] database check failed", { target: describeDatabaseUrl(process.env.DATABASE_URL) }, err);
    return Response.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}

/**
 * The non-secret parts of the connection string (host, port, user, database),
 * so a failed check says where it tried to connect. Never the password.
 */
function describeDatabaseUrl(url: string | undefined): string {
  if (!url) return "DATABASE_URL not set";
  try {
    const u = new URL(url);
    return `${u.username || "(no user)"}@${u.hostname}:${u.port || "(default port)"}${u.pathname}; password ${u.password ? "present" : "missing"}`;
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
}
