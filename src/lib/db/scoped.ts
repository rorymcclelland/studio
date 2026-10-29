import type postgres from "postgres";
import { getSql, keepInstanceUntilIdle } from "./client";

export type Tx = postgres.TransactionSql;

/**
 * Runs `fn` in a transaction as the given user, with row-level security in
 * force: the `authenticated` role, with the user's id in `request.jwt.claims`
 * for `auth.uid()` (see the baseline migration). Every read and write in the
 * app goes through here (rule 7), so a bug in app code cannot reach another
 * workspace's rows.
 */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id");
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return inTransaction(claims, "authenticated", fn);
}

/** Runs `fn` as the anonymous role, for tests and health checks. */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction('{"role":"anon"}', "anon", fn);
}

// Errors that mean the connection itself failed, not the statement.
// A connection that was open and has died (the client's own codes, a reset,
// SQLSTATE class 08, 57P01 to 57P03: the server shut the session down). Any
// other idle connection in the pool may be just as dead, so these are retried
// up to the pool's size.
const DEAD_CONNECTION_ERRORS = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "EPIPE",
  "57P01",
  "57P02",
  "57P03",
]);
// A new connection that could not be made (timeout, DNS, routing, refused). A
// second try may catch a brief blip, but more would only multiply the wait.
const CONNECT_ERRORS = new Set([
  "CONNECT_TIMEOUT",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function isConnectionError(e: unknown): boolean {
  const code = errorCode(e);
  return code !== undefined && (DEAD_CONNECTION_ERRORS.has(code) || CONNECT_ERRORS.has(code) || code.startsWith("08"));
}

/** How many attempts a connection error allows in all (decision 0016). */
export function attemptsFor(e: unknown, poolMax: number): number {
  if (!isConnectionError(e)) return 1;
  return CONNECT_ERRORS.has(errorCode(e)!) ? 2 : poolMax + 1;
}

/**
 * The transaction behind asUser() and asAnon() (decision 0016). If the
 * connection fails before `fn` has started (typically a pooled connection that
 * died while the instance was suspended), it is retried on another connection:
 * nothing of the caller's has run, so that is safe. A dead connection is
 * retried up to the pool's size (every idle one may be dead), a failed connect
 * once. Once `fn` has started, a failure is never retried, since it may have
 * written (or committed) already; the caller gets a clean error.
 */
async function inTransaction<T>(claims: string, role: "authenticated" | "anon", fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let started = false;
    const sql = getSql();
    try {
      return (await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx.unsafe(`set local role ${role}`);
        started = true;
        return fn(tx);
      })) as T;
    } catch (e) {
      if (started || attempt >= attemptsFor(e, sql.options.max)) throw e;
    } finally {
      keepInstanceUntilIdle();
    }
  }
}
