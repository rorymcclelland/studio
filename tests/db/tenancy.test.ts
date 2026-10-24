// S1-3 test cases 1-4, 6 and 7: tenancy and row-level security.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getSql, closeSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { createMember, createUser, truncateAll } from "../helpers/db";

async function insertRun(userId: string, workspaceId: string) {
  return asUser(userId, async (tx) => {
    const [r] = await tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
      values (${workspaceId}, 'tagline', 1, ${tx.json({ brandName: "Fernhollow" })}, ${userId})
      returning id`;
    return r.id as string;
  });
}

describe("tenancy and row-level security", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("S1-3 #1: a member reads their own workspace's runs", async () => {
    const a = await createMember();
    await insertRun(a.userId, a.workspaceId);
    const rows = await asUser(a.userId, (tx) => tx`select id from public.agent_runs`);
    expect(rows).toHaveLength(1);
  });

  it("S1-3 #2: a member of workspace A sees none of workspace B's rows", async () => {
    const a = await createMember();
    const b = await createMember();
    const runId = await insertRun(b.userId, b.workspaceId);
    await asUser(b.userId, async (tx) => {
      await tx`insert into public.approvals (run_id, workspace_id, question, options, expires_at)
               values (${runId}, ${b.workspaceId}, 'Pick one', ${tx.json(["x"])}, now() + interval '1 day')`;
    });
    for (const table of ["agent_runs", "approvals", "agent_steps", "usage_ledger", "workspaces"]) {
      const rows = await asUser(a.userId, (tx) => tx.unsafe(`select 1 from public.${table}`));
      // A sees only its own workspace row, never B's.
      expect(rows.length, table).toBe(table === "workspaces" ? 1 : 0);
    }
    const [ws] = await asUser(a.userId, (tx) => tx`select id from public.workspaces`);
    expect(ws.id).toBe(a.workspaceId);
  });

  it("S1-3 #3: inserting a run into another workspace is denied", async () => {
    const a = await createMember();
    const b = await createMember();
    await expect(insertRun(a.userId, b.workspaceId)).rejects.toThrow(/row-level security/);
  });

  it("S1-3 #3b: updating another workspace's run changes nothing", async () => {
    const a = await createMember();
    const b = await createMember();
    const runId = await insertRun(b.userId, b.workspaceId);
    const res = await asUser(a.userId, (tx) =>
      tx`update public.agent_runs set status = 'completed' where id = ${runId}`);
    expect(res.count).toBe(0);
  });

  it("S1-3 #4: the anonymous role reads zero rows from every table", async () => {
    const a = await createMember();
    await insertRun(a.userId, a.workspaceId);
    for (const table of ["workspaces", "workspace_members", "profiles", "agent_runs",
      "agent_steps", "approvals", "usage_ledger"]) {
      const result = await asAnon((tx) => tx.unsafe(`select 1 from public.${table}`)).catch(
        (e: Error) => e,
      );
      // Either no privilege at all or no rows: both mean nothing leaks.
      if (result instanceof Error) expect(result.message).toMatch(/permission denied/);
      else expect(result.length, table).toBe(0);
    }
  });

  it("S1-3 #4b: the anonymous role cannot create a workspace", async () => {
    await expect(asAnon((tx) => tx`select public.ensure_workspace()`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("S1-3 #6: first sign-in creates exactly one workspace and one owner membership", async () => {
    const userId = await createUser();
    const ids = await Promise.all(
      [1, 2, 3].map(() =>
        asUser(userId, async (tx) => (await tx`select public.ensure_workspace() as id`)[0].id),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    const sql = getSql();
    const [{ n }] = await sql`select count(*)::int as n from public.workspaces where created_by = ${userId}`;
    expect(n).toBe(1);
    const members = await sql`select role from public.workspace_members where user_id = ${userId}`;
    expect(members).toEqual([{ role: "owner" }]);
  });

  it("S1-3 #7: migrations create no users (seed data lives only in seed.sql)", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), "utf8").toLowerCase();
      expect(text, file).not.toMatch(/insert\s+into\s+auth\.users/);
    }
  });
});
