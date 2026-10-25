// F-4 test cases 2 to 5: one run path for every agent.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { mockBehaviour } from "@/lib/models/mock";
import { AGENTS } from "@/lib/agents/registry";
import { createRun, getRun, listRuns, runTitle } from "@/lib/agents/runs";
import { executeRun, WORKFLOWS } from "@/lib/agents/workflows";
import type { StepTools } from "@/lib/agents/workflow";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

/** Steps run inline; each step id may run once, as on Inngest after a retry (memoised). */
function memoTools(decide: (approvalId: string) => Promise<boolean>): StepTools & { calls: string[] } {
  const done = new Map<string, unknown>();
  const calls: string[] = [];
  return {
    calls,
    run: async (id, fn) => {
      calls.push(id);
      if (done.has(id)) return done.get(id) as never;
      const v = await fn();
      done.set(id, v);
      return v;
    },
    waitForEvent: async (_id, opts) => {
      const approvalId = /approvalId == "([^"]+)"/.exec(opts.if)![1];
      return (await decide(approvalId)) ? { data: { approvalId } } : null;
    },
  };
}

describe("F-4 any agent", () => {
  let m: Member;
  beforeEach(async () => {
    await truncateAll();
    mockBehaviour.reset();
    m = await createMember();
  });
  afterAll(closeSql);

  it("#2 a run for an agent with no workflow fails with a clear error and is not left queued", async () => {
    const [r] = await asUser(m.userId, (tx) => tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
      values (${m.workspaceId}, 'nonesuch', 1, '{}', ${m.userId}) returning id`);
    const status = await executeRun("nonesuch", { runId: r.id, workspaceId: m.workspaceId, userId: m.userId }, memoTools(async () => false));
    expect(status).toBe("failed");
    const run = await getRun(m.userId, r.id);
    expect(run!.status).toBe("failed");
    expect(run!.error).toBe('No workflow for agent "nonesuch".');
    // Prototype keys are not workflows either.
    expect(await executeRun("constructor", { runId: r.id, workspaceId: m.workspaceId, userId: m.userId }, memoTools(async () => false))).toBe("failed");
  });

  it("#3 runs appear in the list under their label; a caller's label wins over the agent's own", async () => {
    await createRun(m, "tagline", { brandName: "Fernhollow" }, async () => {});
    await createRun(m, "tagline", { brandName: "Quillmoor" }, async () => {}, { label: "Quillmoor Money: taglines" });
    const runs = await listRuns(m.userId);
    expect(runs.map((r) => runTitle(r))).toEqual(["Quillmoor Money: taglines", "Fernhollow"]);
    expect(runTitle({ label: null, agent: "tagline", input: {} }, "Tagline agent")).toBe("Tagline agent");
  });

  it("#4 every registered agent has a workflow, and the registry drives the tagline workflow end to end", async () => {
    for (const key of Object.keys(AGENTS)) expect(WORKFLOWS[key], `workflow for ${key}`).toBeTypeOf("function");
    mockBehaviour.next({ text: JSON.stringify({ taglines: ["One line", "Two line", "Three line"] }), inputTokens: 5, outputTokens: 5 });
    const runId = await createRun(m, "tagline", { brandName: "Fernhollow" }, async () => {});
    const tools = memoTools(async (approvalId) => {
      await asUser(m.userId, (tx) => tx`update public.approvals set status = 'approved', choice = 0, decided_at = now() where id = ${approvalId}`);
      return true;
    });
    expect(await executeRun("tagline", { runId, workspaceId: m.workspaceId, userId: m.userId }, tools)).toBe("completed");
  });

  it("#5 replaying a workflow after a retry does not duplicate step rows", async () => {
    mockBehaviour.next({ text: JSON.stringify({ taglines: ["One line", "Two line", "Three line"] }), inputTokens: 5, outputTokens: 5 });
    const runId = await createRun(m, "tagline", { brandName: "Fernhollow" }, async () => {});
    const ctx = { runId, workspaceId: m.workspaceId, userId: m.userId };
    let first = true;
    const tools = memoTools(async (approvalId) => {
      if (first) {
        first = false;
        return false; // the first pass times out of the wait, as if the function were replayed
      }
      await asUser(m.userId, (tx) => tx`update public.approvals set status = 'approved', choice = 0, decided_at = now() where id = ${approvalId}`);
      return true;
    });
    await executeRun("tagline", ctx, tools).catch(() => {});
    const [{ n }] = await asUser(m.userId, (tx) => tx`select count(*)::int as n from public.agent_steps where run_id = ${runId}`);
    const [{ a }] = await asUser(m.userId, (tx) => tx`select count(*)::int as a from public.approvals where run_id = ${runId}`);
    expect(n).toBe(2);
    expect(a).toBe(1);
  });

  it("a run can name a brand only in its own workspace", async () => {
    const other = await createMember();
    const [brand] = await asUser(other.userId, (tx) => tx`
      insert into public.brands (workspace_id, name, slug, created_by) values (${other.workspaceId}, 'Other', 'other', ${other.userId}) returning id`);
    await expect(createRun(m, "tagline", { brandName: "x" }, async () => {}, { brandId: brand.id as string })).rejects.toThrow();
  });
});
