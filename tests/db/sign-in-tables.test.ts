// N-2 #7 and N-3 (database): auth.sessions and auth.sign_in_tokens are granted
// to no one, and each function is executable only by the roles that need it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { createUser, truncateAll } from "../helpers/db";

let userId: string;

describe("N-2 and N-3 tables and grants", () => {
  beforeAll(async () => {
    await truncateAll();
    userId = await createUser("grants@example.test");
    await getSql()`select public.start_session(${userId}, ${"a".repeat(64)}, now() + interval '1 day')`;
    await getSql()`insert into auth.sign_in_tokens (token_hash, email, expires_at) values (${"b".repeat(64)}, 'grants@example.test', now() + interval '15 minutes')`;
  });
  afterAll(async () => {
    await getSql()`delete from auth.sign_in_tokens`;
    await closeSql();
  });

  for (const table of ["auth.sessions", "auth.sign_in_tokens"]) {
    it(`anon and authenticated can't read, add, change or remove ${table}`, async () => {
      const as = [(fn: Parameters<typeof asAnon>[0]) => asAnon(fn), (fn: Parameters<typeof asAnon>[0]) => asUser(userId, fn)];
      for (const run of as) {
        await expect(run((tx) => tx.unsafe(`select * from ${table}`))).rejects.toThrow(/permission denied/);
        await expect(run((tx) => tx.unsafe(`delete from ${table}`))).rejects.toThrow(/permission denied/);
        await expect(run((tx) => tx.unsafe(`update ${table} set expires_at = now()`))).rejects.toThrow(/permission denied/);
      }
      await expect(asAnon((tx) => tx.unsafe(`insert into auth.sessions (user_id, token_hash, expires_at) values ('${userId}', '${"c".repeat(64)}', now() + interval '1 day')`))).rejects.toThrow(/permission denied/);
      const [{ n }] = await getSql().unsafe(`select count(*)::int as n from ${table}`);
      expect(n).toBe(1);
    });
  }

  it("execute grants: anon may look up, end and use sign-ins; only the app's own connection may start a session", async () => {
    const rows = await getSql()`
      select p.proname as fn, r.rolname as role, has_function_privilege(r.oid, p.oid, 'execute') as ok
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      cross join pg_roles r
      where ns.nspname = 'public' and r.rolname in ('anon', 'authenticated')
        and p.proname in ('start_session', 'lookup_session', 'end_session', 'end_sessions_for_email', 'request_sign_in', 'use_sign_in')`;
    const grants = Object.fromEntries(
      ["start_session", "lookup_session", "end_session", "end_sessions_for_email", "request_sign_in", "use_sign_in"].map((fn) => [
        fn,
        rows.filter((r) => r.fn === fn && r.ok).map((r) => r.role).sort(),
      ]),
    );
    expect(grants).toEqual({
      start_session: [],
      lookup_session: ["anon", "authenticated"],
      end_session: ["anon", "authenticated"],
      end_sessions_for_email: ["authenticated"],
      request_sign_in: ["anon"],
      use_sign_in: ["anon"],
    });
    await expect(asAnon((tx) => tx`select public.start_session(${userId}, ${"d".repeat(64)}, now() + interval '1 day')`)).rejects.toThrow(/permission denied/);
    await expect(asUser(userId, (tx) => tx`select public.start_session(${userId}, ${"d".repeat(64)}, now() + interval '1 day')`)).rejects.toThrow(/permission denied/);
  });

  it("every function is security definer with an empty search_path", async () => {
    const rows = await getSql()`
      select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('start_session', 'lookup_session', 'end_session', 'end_sessions_for_email', 'request_sign_in', 'use_sign_in')`;
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.proconfig, r.proname).toEqual(['search_path=""']);
    }
  });

  it("a session is removed with its user; a hash must be 64 characters", async () => {
    const other = await createUser("gone@example.test");
    await getSql()`select public.start_session(${other}, ${"e".repeat(64)}, now() + interval '1 day')`;
    await getSql()`delete from auth.users where id = ${other}`;
    expect((await getSql()`select 1 from auth.sessions where user_id = ${other}`).length).toBe(0);
    await expect(getSql()`select public.start_session(${userId}, 'short', now() + interval '1 day')`).rejects.toThrow(/check constraint/);
  });
});
