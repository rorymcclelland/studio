// Review finding 4 (rule 1): costs from the mock models (usage_ledger rows with
// provider 'mock') are marked simulated wherever pence are shown, and the cap
// arithmetic doesn't change.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getRun, listChildRuns, listRuns } from "@/lib/agents/runs";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { simulatedSpendToday, spendPosition } from "@/lib/models/generate";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

async function run(m: Member, input: Record<string, unknown> = {}) {
  const [r] = await asUser(m.userId, (tx) => tx`
    insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
    values (${m.workspaceId}, 'tagline', 1, ${tx.json(input as never)}, ${m.userId}) returning id`);
  return r.id as string;
}
async function step(m: Member, runId: string, seq: number, provider: string) {
  const [s] = await asUser(m.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, provider, model)
    values (${runId}, ${m.workspaceId}, ${seq}, 'Call', 'model', 'succeeded', ${provider}, 'x') returning id`);
  return s.id as string;
}
const charge = (m: Member, runId: string | null, stepId: string | null, provider: string, pence: number) =>
  asUser(m.userId, (tx) => tx`
    insert into public.usage_ledger (workspace_id, run_id, step_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
    values (${m.workspaceId}, ${runId}, ${stepId}, 'tagline', ${provider}, 'x', 0, 0, ${pence})`);

describe("review finding 4: simulated costs", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("run lists, run pages and child runs carry the simulated part of their cost", async () => {
    const m = await createMember();
    const mock = await run(m);
    const mixed = await run(m);
    const real = await run(m);
    const child = await run(m, { parentRunId: mock });
    const s1 = await step(m, mock, 1, "mock");
    const s2 = await step(m, mixed, 1, "mock");
    const s3 = await step(m, mixed, 2, "anthropic");
    await charge(m, mock, s1, "mock", 3);
    await charge(m, mixed, s2, "mock", 2);
    await charge(m, mixed, s3, "anthropic", 5);
    await charge(m, real, null, "anthropic", 4);
    await charge(m, child, null, "mock", 1.5);

    const listed = Object.fromEntries((await listRuns(m.userId)).map((r) => [r.id, r]));
    expect(Number(listed[mock].cost_pence)).toBeCloseTo(3, 6);
    expect(Number(listed[mock].simulated_pence)).toBeCloseTo(3, 6);
    expect(Number(listed[mixed].cost_pence)).toBeCloseTo(7, 6);
    expect(Number(listed[mixed].simulated_pence)).toBeCloseTo(2, 6);
    expect(Number(listed[real].simulated_pence)).toBe(0);

    const detail = (await getRun(m.userId, mixed))!;
    expect(Number(detail.simulated_pence)).toBeCloseTo(2, 6);
    const bySeq = Object.fromEntries(detail.steps.map((s) => [s.seq, s]));
    expect(Number(bySeq[1].simulated_pence)).toBeCloseTo(2, 6);
    expect(Number(bySeq[2].simulated_pence)).toBe(0);

    const [c] = await listChildRuns(m.userId, mock);
    expect(Number(c.simulated_pence)).toBeCloseTo(1.5, 6);
  });

  it("the meter's simulated figure: the owner sees the app's, a guest their workspace's; the cap counts both kinds alike", async () => {
    process.env.OWNER_EMAIL = "owner-sim@example.test";
    try {
      const guest = await createMember();
      const other = await createMember();
      await charge(guest, null, null, "mock", 4);
      await charge(guest, null, null, "anthropic", 1);
      await charge(other, null, null, "mock", 6);
      // Yesterday's simulated spend doesn't count today.
      await getSql()`insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence, created_at)
        values (${guest.workspaceId}, 'tagline', 'mock', 'x', 0, 0, 9, now() - interval '2 days')`;
      expect(await simulatedSpendToday(guest.userId, guest.workspaceId)).toMatchObject({ workspace: 4, total: 10 });
      // Cap arithmetic is unchanged: simulated pence count like any other.
      expect((await spendPosition(guest.userId, guest.workspaceId)).workspace).toBeCloseTo(5, 6);
      // Another workspace's simulated figure isn't readable by naming it.
      expect((await simulatedSpendToday(guest.userId, other.workspaceId)).workspace).toBe(0);
    } finally {
      delete process.env.OWNER_EMAIL;
    }
  });
});
