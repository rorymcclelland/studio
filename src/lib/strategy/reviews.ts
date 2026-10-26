import { createRun, type Member, type SendEvent } from "@/lib/agents/runs";
import type { PersonaOutput } from "@/lib/agents/persona";
import type { TestPlanOutput } from "@/lib/agents/testplan";
import { CampaignError } from "@/lib/brief/repo";
import { asUser } from "@/lib/db/scoped";

// S4-2 and S4-4: starting persona reviews and test plans, and reading them back.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PersonaReview = {
  personas: (PersonaOutput["personas"][number] & { segment: { id: string | null; title: string; facts: string } })[];
  averages: { relevance: number; clarity: number; credibility: number; brandFit: number };
  overall: number;
  synthetic: true;
  simulatedData: boolean;
};

export type TestPlan = {
  hypotheses: (TestPlanOutput["hypotheses"][number] & { insight: string | null; audience: { segmentRef: string; title: string | null } | null })[];
  note: string;
};

async function campaignFor(member: Member, campaignId: string) {
  if (!UUID.test(campaignId)) throw new CampaignError("That campaign isn't in your workspace.");
  const [c] = await asUser(member.userId, (tx) => tx`
    select c.id, c.brand_id, c.current_version, b.name from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`);
  if (!c) throw new CampaignError("That campaign isn't in your workspace.");
  if (c.current_version === 0) throw new CampaignError("There is no brief yet.");
  return c;
}

export async function startPersonaReview(member: Member, campaignId: string, send: SendEvent, version?: number): Promise<string> {
  const c = await campaignFor(member, campaignId);
  const v = version ?? c.current_version;
  return createRun(member, "persona", { campaignId, version: v }, send, { brandId: c.brand_id, label: `${c.name}: persona review (v${v})` });
}

export async function startTestPlan(member: Member, campaignId: string, send: SendEvent, version?: number): Promise<string> {
  const c = await campaignFor(member, campaignId);
  const v = version ?? c.current_version;
  return createRun(member, "testPlan", { campaignId, version: v }, send, { brandId: c.brand_id, label: `${c.name}: test plan (v${v})` });
}

/** Q4: at sign-off, a persona review and a test plan for that version, unless one exists or is on its way. */
export async function runReviewsForSignoff(member: Member, campaignId: string, version: number, send: SendEvent): Promise<void> {
  const [have] = await asUser(member.userId, (tx) => tx`
    select
      exists (select 1 from public.persona_reviews where campaign_id = ${campaignId} and brief_version = ${version})
        or exists (select 1 from public.agent_runs where agent = 'persona' and status in ('queued', 'running')
                     and input ->> 'campaignId' = ${campaignId} and (input ->> 'version')::int = ${version}) as persona,
      exists (select 1 from public.test_plans where campaign_id = ${campaignId} and brief_version = ${version})
        or exists (select 1 from public.agent_runs where agent = 'testPlan' and status in ('queued', 'running')
                     and input ->> 'campaignId' = ${campaignId} and (input ->> 'version')::int = ${version}) as plan`);
  if (!have.persona) await startPersonaReview(member, campaignId, send, version);
  if (!have.plan) await startTestPlan(member, campaignId, send, version);
}

export type Reviews = {
  review: { version: number; createdAt: Date; runId: string; data: PersonaReview } | null;
  plan: { version: number; createdAt: Date; runId: string; data: TestPlan } | null;
  /** Persona and test plan runs in flight or failed for the current version. */
  runs: { agent: "persona" | "testPlan"; runId: string; status: string; error: string | null; version: number }[];
};

/** The latest persona review and test plan for a campaign, whichever version they were for (the page marks older ones). */
export async function getReviews(userId: string, campaignId: string): Promise<Reviews> {
  if (!UUID.test(campaignId)) return { review: null, plan: null, runs: [] };
  return asUser(userId, async (tx) => {
    const [r] = await tx`select brief_version, created_at, run_id, review from public.persona_reviews where campaign_id = ${campaignId} order by brief_version desc, created_at desc limit 1`;
    const [p] = await tx`select brief_version, created_at, run_id, plan from public.test_plans where campaign_id = ${campaignId} order by brief_version desc, created_at desc limit 1`;
    const runs = await tx`
      select distinct on (agent) agent, id, status, error, (input ->> 'version')::int as version from public.agent_runs
      where agent in ('persona', 'testPlan') and input ->> 'campaignId' = ${campaignId}
      order by agent, created_at desc`;
    return {
      review: r ? { version: r.brief_version, createdAt: r.created_at, runId: r.run_id, data: r.review as PersonaReview } : null,
      plan: p ? { version: p.brief_version, createdAt: p.created_at, runId: p.run_id, data: p.plan as TestPlan } : null,
      runs: runs.filter((x) => x.status !== "completed").map((x) => ({ agent: x.agent, runId: x.id, status: x.status, error: x.error, version: x.version })),
    };
  });
}
