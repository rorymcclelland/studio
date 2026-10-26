import { asUser } from "@/lib/db/scoped";
import { getAgent } from "./registry";

export class StartRunError extends Error {}
export class ApprovalError extends Error {}

export type Member = { userId: string; workspaceId: string };
export type SendEvent = (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RUN_REQUESTED = "agent/run.requested";
export const APPROVAL_DECIDED = "agent/approval.decided";

/**
 * Validates input, records a queued run and hands it to the workflow service.
 * If the hand-off fails the run is marked failed, so nothing is left queued
 * with no workflow behind it (S1-5 #5).
 */
export async function createRun(
  member: Member,
  agentKey: string,
  rawInput: unknown,
  send: SendEvent,
  opts: { label?: string; brandId?: string | null } = {},
): Promise<string> {
  const agent = getAgent(agentKey);
  if (!agent) throw new StartRunError(`Unknown agent "${agentKey}".`);
  const parsed = (agent.start ?? agent.input).safeParse(rawInput);
  if (!parsed.success) throw new StartRunError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const label = (opts.label ?? (agent.start ? agent.name : agent.label(parsed.data))).slice(0, 200);
  return queueRun(member, agent.key, agent.version, parsed.data, label, opts.brandId ?? null, send);
}

/**
 * S5-4: a run of a workflow that is not a model agent of its own (Make
 * creative, which runs the Imagery and Copy agents and then composes ads in
 * code). The caller has validated the input. Recorded and handed off exactly
 * like an agent's run, so it has a trail, a status and a cost.
 */
export async function createWorkflowRun(
  member: Member,
  key: string,
  version: number,
  input: Record<string, unknown>,
  send: SendEvent,
  opts: { label: string; brandId?: string | null },
): Promise<string> {
  return queueRun(member, key, version, input, opts.label.slice(0, 200), opts.brandId ?? null, send);
}

async function queueRun(
  member: Member,
  key: string,
  version: number,
  input: unknown,
  label: string,
  brandId: string | null,
  send: SendEvent,
): Promise<string> {
  const [row] = await asUser(member.userId, (tx) => tx`
    insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by, label, brand_id)
    values (${member.workspaceId}, ${key}, ${version}, ${tx.json(input as never)}, ${member.userId},
            ${label}, ${brandId})
    returning id`);
  const runId = row.id as string;

  try {
    await send({ name: RUN_REQUESTED, data: { runId, workspaceId: member.workspaceId, userId: member.userId, agent: key } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await asUser(member.userId, (tx) => tx`
      update public.agent_runs set status = 'failed', completed_at = now(),
        error = ${`Couldn't reach the workflow service, so the run never started (${detail}).`}
      where id = ${runId}`);
    throw new StartRunError("Couldn't reach the workflow service. Nothing was started; try again shortly.");
  }
  return runId;
}

export type RunDetail = {
  id: string;
  agent: string;
  agent_version: number;
  label: string | null;
  brand_id: string | null;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  /** Total cost from the usage ledger, the same source the daily cap uses. */
  cost_pence: string;
  steps: {
    id: string;
    seq: number;
    name: string;
    kind: string;
    status: string;
    input: unknown;
    output: unknown;
    raw_output: string | null;
    provider: string | null;
    model: string | null;
    attempts: number;
    attempt_log: { attempt: number; raw: string; truncated: boolean; problems: string[] }[];
    input_tokens: number;
    output_tokens: number;
    cost_pence: string;
    duration_ms: number | null;
    error: string | null;
    started_at: Date;
    finished_at: Date | null;
  }[];
  approvals: {
    id: string;
    status: string;
    question: string;
    options: string[];
    choice: number | null;
    reason: string | null;
    decided_at: Date | null;
    expires_at: Date;
  }[];
};

/** A run with its trail, or null if it does not exist in the user's workspace. */
export async function getRun(userId: string, runId: string): Promise<RunDetail | null> {
  if (!UUID.test(runId)) return null;
  return asUser(userId, async (tx) => {
    const [run] = await tx`
      select r.*, coalesce((select sum(l.cost_pence) from public.usage_ledger l where l.run_id = r.id), 0)::text as cost_pence
      from public.agent_runs r where r.id = ${runId}`;
    if (!run) return null;
    const steps = await tx`select * from public.agent_steps where run_id = ${runId} order by seq`;
    const approvals = await tx`select * from public.approvals where run_id = ${runId} order by created_at`;
    return { ...run, steps, approvals } as unknown as RunDetail;
  });
}

export type RunSummary = {
  id: string;
  agent: string;
  label: string | null;
  status: string;
  input: Record<string, unknown>;
  created_at: Date;
  cost_pence: string;
};

export async function listRuns(userId: string, limit = 50, brandId?: string): Promise<RunSummary[]> {
  if (brandId !== undefined && !UUID.test(brandId)) return [];
  return asUser(userId, (tx) => tx`
    select r.id, r.agent, r.label, r.status, r.input, r.created_at,
      coalesce((select sum(l.cost_pence) from public.usage_ledger l where l.run_id = r.id), 0)::text as cost_pence
    from public.agent_runs r
    where ${brandId === undefined ? tx`true` : tx`r.brand_id = ${brandId}`}
    order by r.created_at desc
    limit ${limit}`) as unknown as Promise<RunSummary[]>;
}

export type Decision =
  | { decision: "approved"; choice: number; reason?: string }
  | { decision: "rejected"; reason?: string };

/** What a run is called in lists: its label, else its agent's name. */
export function runTitle(run: { label: string | null; agent: string; input: Record<string, unknown> }, agentName?: string): string {
  return run.label || (typeof run.input.brandName === "string" ? run.input.brandName : "") || agentName || run.agent;
}

/**
 * Records a decision and wakes the waiting workflow. The update and the event
 * share a transaction: if the event cannot be sent the decision is rolled
 * back, so the approval stays open and can be retried.
 */
export async function decideApproval(
  userId: string,
  approvalId: string,
  d: Decision,
  send: SendEvent,
): Promise<void> {
  if (!UUID.test(approvalId)) throw new ApprovalError("This approval is no longer open.");
  const reason = d.reason?.trim().slice(0, 500) || null;
  await asUser(userId, async (tx) => {
    const [a] = await tx`
      select id, run_id, options from public.approvals
      where id = ${approvalId} and status = 'pending' and expires_at > now()
      for update`;
    if (!a) throw new ApprovalError("This approval is no longer open.");
    let choice: number | null = null;
    if (d.decision === "approved") {
      const options = a.options as unknown[];
      if (!Number.isInteger(d.choice) || d.choice < 0 || d.choice >= options.length) {
        throw new ApprovalError("Choose one of the options.");
      }
      choice = d.choice;
    }
    await tx`
      update public.approvals set status = ${d.decision}, choice = ${choice}, reason = ${reason},
        decided_by = ${userId}, decided_at = now()
      where id = ${approvalId}`;
    await send({ name: APPROVAL_DECIDED, data: { approvalId, runId: a.run_id } });
  });
}
