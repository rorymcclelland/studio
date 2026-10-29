import type postgres from "postgres";
import { getSql } from "./client";

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
  const sql = getSql();
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  })) as T;
}

/** Runs `fn` as the anonymous role, for tests and health checks. */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = getSql();
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
    await tx.unsafe("set local role anon");
    return fn(tx);
  })) as T;
}
