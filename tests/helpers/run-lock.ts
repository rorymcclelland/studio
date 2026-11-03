import { runLockName } from "@/lib/agents/runs";
import { getSql } from "@/lib/db/client";

/**
 * Sprint 8 review fix 4: starts a run while another start is part-way through
 * its own transaction, which holds the run's lock (`lockKey`, as
 * takeRunLock) and has inserted its queued run but not yet committed it. The
 * start must wait for that transaction and then see the run, so two clicks
 * start one paid run. Without the lock it would see no run and start a second.
 * Returns how the start ended and whether it waited for the other one.
 */
export async function startWhileAnotherStarts<T>(
  lockKey: string,
  other: { workspaceId: string; userId: string; agent: string; input: Record<string, unknown> },
  start: () => Promise<T>,
): Promise<{ result: PromiseSettledResult<T>; waited: boolean; otherRunId: string }> {
  let settled = false;
  let pending: Promise<PromiseSettledResult<T>> | null = null;
  let waited = false;
  let otherRunId = "";
  await getSql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${runLockName(lockKey)}, 0))`;
    const [r] = await tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by, label)
      values (${other.workspaceId}, ${other.agent}, 1, ${tx.json(other.input as never)}, ${other.userId}, 'the other click')
      returning id`;
    otherRunId = r.id as string;
    pending = start().then(
      (value) => ((settled = true), { status: "fulfilled" as const, value }),
      (reason: unknown) => ((settled = true), { status: "rejected" as const, reason }),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    waited = !settled;
  });
  return { result: await pending!, waited, otherRunId };
}
