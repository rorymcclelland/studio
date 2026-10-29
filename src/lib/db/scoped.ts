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

// Errors that mean the connection itself failed, not the statement: the
// client's own codes, socket errors, SQLSTATE class 08 (connection exception)
// and 57P01 to 57P03 (the server shut the session down).
const CONNECTION_ERRORS = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "57P01",
  "57P02",
  "57P03",
]);

export function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && (CONNECTION_ERRORS.has(code) || code.startsWith("08"));
}

/**
 * The transaction behind asUser() and asAnon() (decision 0016). If the
 * connection fails before `fn` has started (typically a pooled connection that
 * died while the instance was suspended), it is retried once on a fresh
 * connection: nothing of the caller's has run, so that is safe. Once `fn` has
 * started, a failure is never retried, since it may have written (or committed)
 * already; the caller gets a clean error.
 */
async function inTransaction<T>(claims: string, role: "authenticated" | "anon", fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let started = false;
    try {
      return (await getSql().begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx.unsafe(`set local role ${role}`);
        started = true;
        return fn(tx);
      })) as T;
    } catch (e) {
      if (started || attempt > 1 || !isConnectionError(e)) throw e;
    } finally {
      keepInstanceUntilIdle();
    }
  }
}
