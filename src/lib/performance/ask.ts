// P9-4: Ask about this campaign. A person types a question (plain text, up to
// 300 characters); a run of the Monitor plans a query (a closed schema), code
// runs it over the campaign's own simulated rows, and the Monitor words an
// answer that code checks figure by figure (monitor-workflow.ts).
//
// Every read and write goes through asUser() (rule 7): another workspace's
// campaign, launch or question is the same refusal as one that isn't there.
// Both model steps go through runModelStep and generate() (rules 4 and 5), and
// at the cap nothing is stored or started.
import { randomUUID } from "node:crypto";
import { createRun, type Member, type SendEvent } from "@/lib/agents/runs";
import { askEstimate, type Estimate } from "@/lib/creative/costs";
import { asUser, type Tx } from "@/lib/db/scoped";
import { spendPosition } from "@/lib/models/generate";
import { CANNOT_ANSWER, QUESTION_MAX, resultFrom, type AnswerablePlan, type Plan, type QueryResult } from "./ask-rules";
import { launchAdsFor, type LaunchAd } from "./launch";
import type { SimRow } from "./simulate";

export class AskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskError";
  }
}

export const ASK_EMPTY = "Type a question about this campaign.";
export const ASK_TOO_LONG = "Keep the question to 300 characters or fewer.";
export const ASK_NOT_FOUND = "That campaign isn't in your workspace.";
export const ASK_NO_RESULTS = "There are no simulated results to ask about yet.";
export const ASK_AT_CAP = "Daily AI cap reached: questions can be asked again tomorrow.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The launch the Performance view shows (live, else the newest ended), with the campaign's brand; null when the campaign isn't the user's. */
async function shownLaunch(tx: Tx, campaignId: string) {
  const [c] = await tx`
    select c.id, b.id as brand_id, b.name as brand_name,
      (select json_build_object('id', l.id, 'simDay', l.sim_day) from public.launches l
        where l.campaign_id = c.id and l.status in ('live', 'ended')
        order by (l.status = 'live') desc, l.created_at desc, l.id desc limit 1) as launch
    from public.campaigns c join public.brands b on b.id = c.brand_id
    where c.id = ${campaignId}`;
  if (!c) return null;
  return { brandId: c.brand_id as string, brandName: c.brand_name as string, launch: (c.launch as { id: string; simDay: number } | null) ?? null };
}

export type AskPanel = { estimate: Estimate; atCap: boolean; reason: string | null; maxLength: number };

/**
 * Whether a question could take the member past the cap: checked against its
 * worst case (both calls repaired at full output), as costs.ts keeps it for
 * any check against the cap, so a question that starts can always finish.
 */
async function atCapFor(member: Member, pence: number): Promise<boolean> {
  const p = await spendPosition(member.userId, member.workspaceId);
  const spent = p.scope === "workspace" ? p.workspace : p.total;
  return spent + pence > p.limit;
}

/** What the Ask box shows: the cost, and why it can't ask (at the cap, or nothing to ask about yet). Null for a 404. */
export async function askPanel(member: Member, campaignId: string): Promise<AskPanel | null> {
  if (typeof campaignId !== "string" || !UUID.test(campaignId)) return null;
  const shown = await asUser(member.userId, (tx) => shownLaunch(tx, campaignId));
  if (!shown) return null;
  const estimate = askEstimate();
  const atCap = await atCapFor(member, estimate.worstPence);
  const noResults = !shown.launch || shown.launch.simDay === 0;
  return { estimate, atCap, reason: noResults ? ASK_NO_RESULTS : atCap ? ASK_AT_CAP : null, maxLength: QUESTION_MAX };
}

/**
 * Stores the question and starts its run. Refused, storing and starting
 * nothing: another workspace's campaign, an empty or too long question, no
 * simulated results yet, or the daily cap reached.
 */
export async function askQuestion(member: Member, campaignId: string, question: string, send: SendEvent): Promise<{ questionId: string; runId: string }> {
  if (typeof campaignId !== "string" || !UUID.test(campaignId)) throw new AskError(ASK_NOT_FOUND);
  const shown = await asUser(member.userId, (tx) => shownLaunch(tx, campaignId));
  if (!shown) throw new AskError(ASK_NOT_FOUND);
  const text = typeof question === "string" ? question.trim() : "";
  if (text.length === 0) throw new AskError(ASK_EMPTY);
  if (text.length > QUESTION_MAX) throw new AskError(ASK_TOO_LONG);
  const launch = shown.launch;
  if (!launch || launch.simDay === 0) throw new AskError(ASK_NO_RESULTS);
  if (await atCapFor(member, askEstimate().worstPence)) throw new AskError(ASK_AT_CAP);

  const questionId = randomUUID();
  // The question is stored in the run's own transaction, so a run never names a question that isn't there, and a question is never left without its run.
  const runId = await createRun(member, "monitorPlan", { questionId }, send, {
    label: `${shown.brandName}: ask about this campaign`,
    brandId: shown.brandId,
    guard: async (tx) => {
      await tx`
        insert into public.performance_questions (id, workspace_id, launch_id, question, created_by)
        values (${questionId}, ${member.workspaceId}, ${launch.id}, ${text}, ${member.userId})`;
    },
  });
  // The workflow sets it too, if it gets there first.
  await asUser(member.userId, (tx) => tx`
    update public.performance_questions set run_id = ${runId}
    where id = ${questionId} and run_id is null and answer is null and refused is null`);
  return { questionId, runId };
}

function toRow(r: Record<string, unknown>): SimRow {
  return {
    variantId: r.variant_id as string,
    day: r.day as number,
    date: r.date as string,
    impressions: r.impressions as number,
    clicks: r.clicks as number,
    conversions: r.conversions as number,
    spendPence: r.spend_pence as number,
    revenuePence: r.revenue_pence as number,
    events: r.events as string[],
  };
}

/**
 * Runs a plan over one launch's own stored rows (through asUser()), with the
 * launch's ads by their gallery numbers and its latest simulated day. Null
 * when the launch is malformed, missing or another workspace's.
 */
export async function runPlan(userId: string, launchId: string, plan: AnswerablePlan): Promise<QueryResult | null> {
  if (typeof launchId !== "string" || !UUID.test(launchId)) return null;
  const read = await asUser(userId, async (tx) => {
    const [l] = await tx`select campaign_id, ads, sim_day from public.launches where id = ${launchId}`;
    if (!l) return null;
    const rows = await tx`
      select variant_id, day, to_char(date, 'YYYY-MM-DD') as date, impressions, clicks, conversions, spend_pence, revenue_pence, events
      from public.sim_daily where launch_id = ${launchId} order by day, variant_id`;
    return { campaignId: l.campaign_id as string, ads: l.ads as LaunchAd[], simDay: l.sim_day as number, rows: rows.map(toRow) };
  });
  if (!read) return null;
  const views = await launchAdsFor(userId, read.campaignId, read.ads);
  return resultFrom(plan, read.rows, views, read.simDay);
}

export type QuestionStatus = "pending" | "answered" | "cannot_answer" | "refused";

export type QuestionView = {
  id: string;
  launchId: string;
  question: string;
  askedBy: string;
  askedByName: string | null;
  askedAt: Date;
  status: QuestionStatus;
  plan: Plan | null;
  answer: string | null;
  result: QueryResult | null;
  refused: string | null;
  runId: string | null;
};

export function questionStatus(answer: string | null, refused: string | null): QuestionStatus {
  if (answer === CANNOT_ANSWER) return "cannot_answer";
  if (answer !== null) return "answered";
  if (refused !== null) return "refused";
  return "pending";
}

/** A campaign's questions, newest first; null when the campaign is malformed, missing or another workspace's (a 404). */
export async function questionsFor(userId: string, campaignId: string): Promise<QuestionView[] | null> {
  if (typeof campaignId !== "string" || !UUID.test(campaignId)) return null;
  return asUser(userId, async (tx) => {
    const [c] = await tx`select id from public.campaigns where id = ${campaignId}`;
    if (!c) return null;
    const rows = await tx`
      select q.id, q.launch_id, q.question, q.created_by, public.member_email(q.created_by) as asked_by_name, q.created_at,
        q.plan, q.answer, q.result, q.refused, q.run_id
      from public.performance_questions q join public.launches l on l.id = q.launch_id
      where l.campaign_id = ${campaignId}
      order by q.created_at desc, q.id desc
      limit 50`;
    return rows.map(
      (r): QuestionView => ({
        id: r.id as string,
        launchId: r.launch_id as string,
        question: r.question as string,
        askedBy: r.created_by as string,
        askedByName: (r.asked_by_name as string | null) ?? null,
        askedAt: r.created_at as Date,
        status: questionStatus((r.answer as string | null) ?? null, (r.refused as string | null) ?? null),
        plan: (r.plan as Plan | null) ?? null,
        answer: (r.answer as string | null) ?? null,
        result: (r.result as QueryResult | null) ?? null,
        refused: (r.refused as string | null) ?? null,
        runId: (r.run_id as string | null) ?? null,
      }),
    );
  });
}
