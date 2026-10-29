import postgres from "postgres";
import { waitUntil } from "@vercel/functions";

// One pool per server instance. On Vercel, DATABASE_URL is Neon's pooled
// connection (PgBouncer in transaction mode), so prepared statements are switched off.
//
// Connections must not outlive the moment they were last used by much
// (decision 0016). A Fluid compute instance is suspended between requests and
// Neon's compute scales to zero after 5 idle minutes, so a connection kept idle
// across a suspension may be dead when the instance wakes. Idle connections
// close after IDLE_TIMEOUT_S, and keepInstanceUntilIdle() asks Vercel to keep
// the instance running until they have; none lives longer than MAX_LIFETIME_S.
export const IDLE_TIMEOUT_S = 5;
export const MAX_LIFETIME_S = 5 * 60;
export const CONNECT_TIMEOUT_S = 10;

declare global {
  var __csSql: postgres.Sql | undefined;
}

export function getSql(): postgres.Sql {
  if (!globalThis.__csSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__csSql = postgres(url, {
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: IDLE_TIMEOUT_S,
      max_lifetime: MAX_LIFETIME_S,
      connect_timeout: CONNECT_TIMEOUT_S,
      onnotice: () => {},
    });
  }
  keepInstanceUntilIdle();
  return globalThis.__csSql;
}

/**
 * Runs one or more statements on the app's own connection (no role, no RLS:
 * only for the security-definer calls that need it) and starts the idle wait
 * once they have settled, so a slow connect can't outlast it.
 */
export async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  try {
    return await fn(getSql());
  } finally {
    keepInstanceUntilIdle();
  }
}

export async function closeSql(): Promise<void> {
  if (globalThis.__csSql) {
    await globalThis.__csSql.end({ timeout: 5 });
    globalThis.__csSql = undefined;
  }
}

let idleTimer: ReturnType<typeof setTimeout> | undefined;
let releaseIdleWait: (() => void) | undefined;

/**
 * Keeps the Vercel instance running until the pool's idle connections have
 * closed: the same idea as `attachDatabasePool` in `@vercel/functions`, which
 * only recognises pg, mysql2, MariaDB, MongoDB, Redis and Cassandra pools, not
 * postgres.js. Each use restarts the wait, so one promise is pending at a time.
 * Outside a Vercel request (locally, in tests, in scripts) `waitUntil` does
 * nothing.
 */
export function keepInstanceUntilIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  releaseIdleWait?.();
  const done = new Promise<void>((resolve) => {
    releaseIdleWait = resolve;
  });
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    releaseIdleWait?.();
    releaseIdleWait = undefined;
  }, (IDLE_TIMEOUT_S + 1) * 1000);
  idleTimer.unref?.();
  waitUntil(done);
}
