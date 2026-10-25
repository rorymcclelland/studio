// S2-6 test cases 1 to 3: run cost from the usage ledger; Sprint 1 indexes and policies.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { getRun, listRuns } from "@/lib/agents/runs";
import { createMember, truncateAll } from "../helpers/db";

async function runWithLedger(userId: string, workspaceId: string, costs: number[]) {
  return asUser(userId, async (tx) => {
    const [r] = await tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
      values (${workspaceId}, 'tagline', 1, ${tx.json({ brandName: "Fernhollow" })}, ${userId})
      returning id`;
    for (const c of costs) {
      await tx`insert into public.usage_ledger (workspace_id, run_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
               values (${workspaceId}, ${r.id}, 'tagline', 'mock', 'mock-model', 10, 10, ${c})`;
    }
    return r.id as string;
  });
}

describe("S2-6 housekeeping", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("S2-6 #1: a run's cost is the sum of its ledger rows, on the list and the run", async () => {
    const m = await createMember();
    const id = await runWithLedger(m.userId, m.workspaceId, [0.0032, 1.25]);
    const [row] = await listRuns(m.userId);
    expect(Number(row.cost_pence)).toBeCloseTo(1.2532, 4);
    const run = await getRun(m.userId, id);
    expect(Number(run!.cost_pence)).toBeCloseTo(1.2532, 4);
  });

  it("S2-6 #2: a run with no ledger rows costs 0", async () => {
    const m = await createMember();
    const id = await runWithLedger(m.userId, m.workspaceId, []);
    const [row] = await listRuns(m.userId);
    expect(Number(row.cost_pence)).toBe(0);
    expect(Number((await getRun(m.userId, id))!.cost_pence)).toBe(0);
  });

  it("S2-6 #3: every foreign key has a covering index", async () => {
    const sql = getSql();
    const missing = await sql`
      select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
        )`;
    expect(missing.map((m) => `${m.tbl}.${m.conname}`)).toEqual([]);
  });

  it("S2-6 #3b: no policy calls auth.uid() once per row", async () => {
    const sql = getSql();
    const rows = await sql`
      select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies where schemaname = 'public'`;
    const perRow = rows.filter((r) => /auth\.uid\(\)/.test(r.expr) && !/\(\s*select\s+auth\.uid\(\)/i.test(r.expr.replace(/\s+AS\s+uid/gi, "")));
    expect(perRow.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([]);
  });
});
