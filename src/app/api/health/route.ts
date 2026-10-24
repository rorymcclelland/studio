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
    console.error("[health] database check failed", err);
    return Response.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
