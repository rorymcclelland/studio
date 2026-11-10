import type postgres from "postgres";
import { asUser, type Tx } from "@/lib/db/scoped";
import { campaignName, type CampaignRef } from "@/lib/home/needs";
import { getAgent } from "./registry";
import { RUNS_PAGE_SIZE, type RunFilterKey, type RunFilters } from "./run-list";

export class StartRunError extends Error {}
export class ApprovalError extends Error {}

export type Member = { userId: string; workspaceId: string };
export type SendEvent = (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;

/**
 * Runs inside the transaction that records the run, before the insert: it
 * may refuse (throw) and nothing is recorded. With takeRunLock first, a check
 * such as "is one already running?" and the insert are one step, so two
 * clicks at once start one paid run, not two (Sprint 8 review fix 4).
 */
export type RunGuard = (tx: Tx) => Promise<void>;

/** A lock held until the run's transaction ends, keyed by what may have one run at a time ("pretest:<campaign id>"). */
export async function takeRunLock(tx: Tx, key: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${runLockName(key)}, 0))`;
}

export const runLockName = (key: string) => `studio:run:${key}`;

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
  opts: { label?: string; brandId?: string | null; guard?: RunGuard } = {},
): Promise<string> {
  const agent = getAgent(agentKey);
  if (!agent) throw new StartRunError(`Unknown agent "${agentKey}".`);
  const parsed = (agent.start ?? agent.input).safeParse(rawInput);
  if (!parsed.success) throw new StartRunError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const label = (opts.label ?? (agent.start ? agent.name : agent.label(parsed.data))).slice(0, 200);
  return queueRun(member, agent.key, agent.version, parsed.data, label, opts.brandId ?? null, send, opts.guard);
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
  opts: { label: string; brandId?: string | null; guard?: RunGuard },
): Promise<string> {
  return queueRun(member, key, version, input, opts.label.slice(0, 200), opts.brandId ?? null, send, opts.guard);
}

async function queueRun(
  member: Member,
  key: string,
  version: number,
  input: unknown,
  label: string,
  brandId: string | null,
  send: SendEvent,
  guard?: RunGuard,
): Promise<string> {
  const [row] = await asUser(member.userId, async (tx) => {
    if (guard) await guard(tx);
    return tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by, label, brand_id)
      values (${member.workspaceId}, ${key}, ${version}, ${tx.json(input as never)}, ${member.userId},
              ${label}, ${brandId})
      returning id`;
  });
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
  /** The part of it from the mock models (rule 1: shown as simulated). */
  simulated_pence: string;
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
    /** The step's simulated part, from its ledger rows. */
    simulated_pence: string;
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
export type ChildRun = { id: string; agent: string; status: string; cost_pence: string; simulated_pence: string };

/** Runs started inside another run (Make creative's Imagery and Copy runs, input.parentRunId), oldest first, with their costs. */
export async function listChildRuns(userId: string, runId: string): Promise<ChildRun[]> {
  if (!UUID.test(runId)) return [];
  const rows = await asUser(userId, (tx) => tx`
    select r.id, r.agent, r.status,
      coalesce((select sum(l.cost_pence) from public.usage_ledger l where l.run_id = r.id), 0)::text as cost_pence,
      coalesce((select sum(l.cost_pence) filter (where l.provider = 'mock') from public.usage_ledger l where l.run_id = r.id), 0)::text as simulated_pence
    from public.agent_runs r where r.input ->> 'parentRunId' = ${runId} order by r.created_at`);
  return rows as unknown as ChildRun[];
}

export async function getRun(userId: string, runId: string): Promise<RunDetail | null> {
  if (!UUID.test(runId)) return null;
  return asUser(userId, async (tx) => {
    const [run] = await tx`
      select r.*, coalesce((select sum(l.cost_pence) from public.usage_ledger l where l.run_id = r.id), 0)::text as cost_pence,
        coalesce((select sum(l.cost_pence) filter (where l.provider = 'mock') from public.usage_ledger l where l.run_id = r.id), 0)::text as simulated_pence
      from public.agent_runs r where r.id = ${runId}`;
    if (!run) return null;
    const steps = await tx`
      select s.*, coalesce((select sum(l.cost_pence) from public.usage_ledger l where l.step_id = s.id and l.provider = 'mock'), 0)::text as simulated_pence
      from public.agent_steps s where s.run_id = ${runId} order by s.seq`;
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
  /** The part of it from the mock models (rule 1: shown as simulated). */
  simulated_pence: string;
  /**
   * U10-5: the campaign the run's input names (campaignId, else a question's
   * launch), named by campaignName(); null when it names none, or an id that
   * isn't a campaign in the reader's workspace (rule 7).
   */
  campaign: CampaignRef | null;
};

/** The id pattern Postgres's uuid accepts here, so a malformed id in a run's input is never cast. */
const UUID_SQL = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

/** The runs a list shows, with their costs and the campaign each names, newest first (created_at, then id). */
async function selectRuns(tx: Tx, where: postgres.Fragment, limit: number): Promise<RunSummary[]> {
  const rows = await tx`
    select r.id, r.agent, r.label, r.status, r.input, r.created_at,
      coalesce((select sum(l.cost_pence) from public.usage_ledger l where l.run_id = r.id), 0)::text as cost_pence,
      coalesce((select sum(l.cost_pence) filter (where l.provider = 'mock') from public.usage_ledger l where l.run_id = r.id), 0)::text as simulated_pence,
      c.id as campaign_id, c.objective as campaign_objective, v.brief ->> 'title' as campaign_title
    from public.agent_runs r
    left join lateral (
      select coalesce(
        case when r.input ->> 'campaignId' ~ ${UUID_SQL} then (r.input ->> 'campaignId')::uuid end,
        -- D-4: Suggest lines (the Tagline agent) names its campaign inside the input's campaign.
        case when r.input #>> '{campaign,campaignId}' ~ ${UUID_SQL} then (r.input #>> '{campaign,campaignId}')::uuid end,
        case when r.input ->> 'questionId' ~ ${UUID_SQL} then (
          select ql.campaign_id from public.performance_questions q join public.launches ql on ql.id = q.launch_id
          where q.id = (r.input ->> 'questionId')::uuid
        ) end
      ) as id
    ) named on true
    left join public.campaigns c on c.id = named.id
    left join public.brief_versions v on v.campaign_id = c.id and v.version = c.current_version
    where ${where}
    order by r.created_at desc, r.id desc
    limit ${limit}`;
  return rows.map(({ campaign_id, campaign_objective, campaign_title, ...r }) => ({
    ...(r as unknown as Omit<RunSummary, "campaign">),
    campaign: campaign_id ? { id: campaign_id as string, name: campaignName({ title: campaign_title as string | null, objective: campaign_objective as string }) } : null,
  }));
}

export async function listRuns(userId: string, limit = 50, brandId?: string): Promise<RunSummary[]> {
  if (brandId !== undefined && !UUID.test(brandId)) return [];
  return asUser(userId, (tx) => selectRuns(tx, brandId === undefined ? tx`true` : tx`r.brand_id = ${brandId}`, limit));
}

/** U10-8: a page of the runs list. `older` is the cursor for the next page (the last run's id), or null. */
export type RunsPage = { runs: RunSummary[]; older: string | null; ignored: RunFilterKey[] };

/**
 * U10-8: a page of runs, filtered by campaign, agent and status, after the run `before` (a cursor: the last run
 * shown, by created_at then id). Everything is read through asUser() (rule 7): a campaign that isn't the reader's
 * is not applied and is reported in `ignored`; a cursor that isn't one of the reader's runs gives the first page.
 */
export async function listRunsPage(userId: string, query: { filters: RunFilters; before: string | null }, pageSize = RUNS_PAGE_SIZE): Promise<RunsPage> {
  const { agent, status } = query.filters;
  const campaignId = query.filters.campaign !== null && UUID.test(query.filters.campaign) ? query.filters.campaign.toLowerCase() : null;
  const beforeId = query.before !== null && UUID.test(query.before) ? query.before.toLowerCase() : null;
  const size = Math.max(1, Math.floor(pageSize));
  return asUser(userId, async (tx) => {
    const ignored: RunFilterKey[] = [];
    let campaign: string | null = null;
    if (query.filters.campaign !== null) {
      const [c] = campaignId ? await tx`select id from public.campaigns where id = ${campaignId}` : [];
      if (c) campaign = c.id as string;
      else ignored.push("campaign");
    }
    const [cursor] = beforeId ? await tx`select id from public.agent_runs where id = ${beforeId}` : [];
    const conditions = [
      campaign ? tx`c.id = ${campaign}` : null,
      agent !== null ? tx`r.agent = ${agent}` : null,
      status !== null ? tx`r.status::text = ${status}` : null,
      cursor ? tx`(r.created_at, r.id) < (select b.created_at, b.id from public.agent_runs b where b.id = ${cursor.id as string})` : null,
    ].filter((c) => c !== null);
    const where = conditions.reduce((acc, c) => tx`${acc} and ${c}`, tx`true`);
    const rows = await selectRuns(tx, where, size + 1);
    const runs = rows.slice(0, size);
    return { runs, older: rows.length > size ? runs[runs.length - 1].id : null, ignored };
  });
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
      where id = ${approvalId} and kind = 'run_choice' and status = 'pending' and expires_at > now()
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
