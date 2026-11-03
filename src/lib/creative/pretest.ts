import { pretestAgent, PRETEST_SCALES, SCALE_NAMES, SYNTHETIC_PANEL, type PretestOutput, type PretestScale } from "@/lib/agents/pretest";
import { createRun, type Member, type SendEvent } from "@/lib/agents/runs";
import { asUser, type Tx } from "@/lib/db/scoped";
import { pretestEstimate, type Estimate } from "./costs";
import { adEtag, type KitSnapshot } from "./variants";

// C8-4: Pre-test picked ads, and the panel's scores beside each picked ad and
// in the launch pack. The click is the person's choice, with the cost shown on
// the button first (rule 3, as Translate); the run goes through generate()
// and the daily cap (rule 5) and is traced like every agent run (rule 4). It
// writes scores only: nothing is published, replaced or ranked.
//
// Scores are kept with the ad's key (its ETag: picture, words, layout and
// kit). A redraw, new words or a new picture make a new ad based on the old
// one, and a layout switch changes the key, so the scores found through the
// ad's history show "Out of date: pre-test again" until it is pre-tested again.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { PRETEST_SCALES, SCALE_NAMES, SYNTHETIC_PANEL };

export class PretestError extends Error {}

export const OUT_OF_DATE = "Out of date: pre-test again";
export const PRETEST_BUSY = "A pre-test is already running for this campaign. It takes a few seconds an ad.";
export const NOTHING_PICKED_PRETEST = "Pick ads first: the panel scores the picked ads.";
export const NO_PANEL =
  "The brief's personas haven't reviewed the signed-off version yet, so there is no panel. The persona review runs at sign-off; run it again from the brief.";
export const NOT_SIGNED_OFF_PRETEST = "Sign off the brief first: the panel scores ads made from a signed-off brief.";
export const ALL_PRETESTED = "Every picked ad has the panel's scores.";

/** One persona of the panel, as the persona review wrote them (synthetic, rule 1). */
export type PanelPersona = { key: string; name: string; about: string; wants: string; segment: string };

/** The panel for a brief version: the personas of its latest persona review. */
export type Panel = { personaRunId: string; personas: PanelPersona[] };

/** What is stored in pretest_scores.panel: each persona's scores and reasons, with the label. */
export type StoredPanel = {
  label: typeof SYNTHETIC_PANEL;
  personas: { key: string; name: string; segment: string; average: number; scores: PretestOutput["personas"][number]["scores"] }[];
};

/** An ad's panel scores, for the gallery and the pack; null when it was never pre-tested. */
export type PretestView = {
  /** current: for this ad as it is now. stale: for an earlier version of it (a redraw, new words, a new picture or another layout). */
  state: "current" | "stale";
  label: typeof SYNTHETIC_PANEL;
  /** "Out of date: pre-test again" when stale. */
  note: string | null;
  average: number;
  personas: StoredPanel["personas"];
  /** Scored by the mock model (rule 1: labelled simulated). */
  simulated: boolean;
  runId: string;
  createdAt: Date;
};

/** The personas of the latest persona review for a brief version, or null if it has none. */
export async function panelFor(tx: Tx, campaignId: string, version: number): Promise<Panel | null> {
  const [r] = await tx`
    select run_id, review from public.persona_reviews
    where campaign_id = ${campaignId} and brief_version = ${version}
    order by created_at desc limit 1`;
  if (!r) return null;
  const review = r.review as { personas?: { key: string; name: string; about: string; wants: string; segment?: { title?: string } }[] };
  const personas = (review.personas ?? []).slice(0, 4).map((p) => ({
    key: String(p.key).slice(0, 8),
    name: String(p.name).slice(0, 20),
    about: String(p.about ?? "").slice(0, 200),
    wants: String(p.wants ?? "").slice(0, 200),
    segment: String(p.segment?.title ?? "A segment").slice(0, 200),
  }));
  return personas.length ? { personaRunId: r.run_id as string, personas } : null;
}

/** Each ad's key as it is now (its ETag: picture, words, layout and kit), by ad id. */
export async function adKeys(tx: Tx, variantIds: string[]): Promise<Map<string, string>> {
  if (variantIds.length === 0) return new Map();
  const rows = await tx`
    select v.id, v.layout, v.kit, v.copy_set_id, a.sha256, a.simulated
    from public.ad_variants v join public.assets a on a.id = v.image_asset_id
    where v.id = any(${variantIds}::uuid[])`;
  return new Map(
    rows.map((r) => [
      r.id as string,
      adEtag({ imageSha256: r.sha256 as string, copySetId: r.copy_set_id as string, layout: r.layout as string, kit: r.kit as KitSnapshot, simulated: r.simulated === true }),
    ]),
  );
}

/**
 * The panel's latest scores for each ad: its own, or, if it has none, the
 * latest of the ads it was made from (based_on), shown as out of date. An
 * ad's own scores are current only while its key is unchanged.
 */
export async function pretestViews(tx: Tx, variantIds: string[]): Promise<Map<string, PretestView>> {
  const out = new Map<string, PretestView>();
  if (variantIds.length === 0) return out;
  const keys = await adKeys(tx, variantIds);
  const rows = await tx`
    with recursive chain (start_id, id, based_on, depth) as (
      select v.id, v.id, v.based_on, 0 from public.ad_variants v where v.id = any(${variantIds}::uuid[])
      union all
      select c.start_id, p.id, p.based_on, c.depth + 1
      from chain c join public.ad_variants p on p.id = c.based_on
      where c.depth < 50
    )
    select distinct on (c.start_id) c.start_id, c.depth, s.ad_key, s.panel, s.average, s.simulated, s.run_id, s.created_at
    from chain c join public.pretest_scores s on s.variant_id = c.id
    order by c.start_id, c.depth, s.created_at desc, s.id`;
  for (const r of rows) {
    const current = Number(r.depth) === 0 && r.ad_key === keys.get(r.start_id as string);
    const panel = r.panel as StoredPanel;
    out.set(r.start_id as string, {
      state: current ? "current" : "stale",
      label: SYNTHETIC_PANEL,
      note: current ? null : OUT_OF_DATE,
      average: Number(r.average),
      personas: panel.personas,
      simulated: r.simulated === true,
      runId: r.run_id as string,
      createdAt: r.created_at as Date,
    });
  }
  return out;
}

/** What Pre-test picked ads would do: the picked ads still to score, the panel, the cost, or why not. */
export type PretestPlan = {
  brandId: string | null;
  brandName: string;
  variantIds: string[];
  picked: number;
  panel: Panel | null;
  estimate: Estimate;
  refusal: string | null;
};

export async function pretestPlan(tx: Tx, campaignId: string): Promise<PretestPlan> {
  const [c] = await tx`
    select c.brand_id, c.status, c.approved_version, b.name from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
  if (!c) throw new PretestError("That campaign isn't in your workspace.");
  const base = { brandId: c.brand_id as string, brandName: c.name as string };
  if (c.status !== "approved" || !c.approved_version) {
    return { ...base, variantIds: [], picked: 0, panel: null, estimate: pretestEstimate(0), refusal: NOT_SIGNED_OFF_PRETEST };
  }
  const version = c.approved_version as number;
  const ads = await tx`
    select v.id from public.ad_variants v
    join public.assets a on a.id = v.image_asset_id
    join public.copy_sets s on s.id = v.copy_set_id
    where v.campaign_id = ${campaignId} and v.brief_version = ${version} and v.picked_at is not null
      and v.discarded_at is null and a.discarded_at is null and s.discarded_at is null
    order by v.created_at, v.id`;
  const ids = ads.map((a) => a.id as string);
  const views = await pretestViews(tx, ids);
  const todo = ids.filter((id) => views.get(id)?.state !== "current");
  const panel = await panelFor(tx, campaignId, version);
  const refusal = ids.length === 0 ? NOTHING_PICKED_PRETEST : !panel ? NO_PANEL : todo.length === 0 ? ALL_PRETESTED : null;
  return { ...base, variantIds: todo, picked: ids.length, panel, estimate: pretestEstimate(refusal ? 0 : todo.length), refusal };
}

/** The Pre-test picked ads button: the ads it would score, its cost, a run in progress, or why not. */
export type PretestBar = { todo: number; picked: number; estimate: string; reason: string | null; runningRunId: string | null; personas: string[] };

export async function pretestBar(tx: Tx, campaignId: string): Promise<PretestBar> {
  const plan = await pretestPlan(tx, campaignId);
  const [running] = await tx`
    select id from public.agent_runs
    where agent = 'pretest' and status in ('queued', 'running') and input ->> 'campaignId' = ${campaignId}
    order by created_at desc limit 1`;
  return {
    todo: plan.refusal ? 0 : plan.variantIds.length,
    picked: plan.picked,
    estimate: plan.estimate.label,
    reason: plan.refusal,
    runningRunId: (running?.id as string | undefined) ?? null,
    personas: plan.panel?.personas.map((p) => p.name) ?? [],
  };
}

/**
 * Starts Pre-test picked ads: one run for the picked ads that have no current
 * scores. Refused with the reason (PretestError) for a draft, with nothing
 * picked, with no panel, when every picked ad is scored, or while a pre-test
 * runs for the campaign.
 */
export async function startPretest(member: Member, campaignId: string, send: SendEvent): Promise<string> {
  if (!UUID.test(campaignId)) throw new PretestError("That campaign isn't in your workspace.");
  const { plan, busy } = await asUser(member.userId, async (tx) => {
    const plan = await pretestPlan(tx, campaignId);
    const [b] = await tx`
      select count(*)::int as n from public.agent_runs
      where agent = 'pretest' and status in ('queued', 'running') and input ->> 'campaignId' = ${campaignId}`;
    return { plan, busy: b.n > 0 };
  });
  if (plan.refusal) throw new PretestError(plan.refusal);
  if (busy) throw new PretestError(PRETEST_BUSY);
  const n = plan.variantIds.length;
  return createRun(member, pretestAgent.key, { campaignId, variantIds: plan.variantIds }, send, {
    brandId: plan.brandId,
    label: `${plan.brandName}: pre-test ${n} picked ${n === 1 ? "ad" : "ads"}`,
  });
}

/** One persona's average over the four scales, to one decimal place. */
export function personaAverage(scores: Record<PretestScale, { score: number }>): number {
  return Math.round((10 * PRETEST_SCALES.reduce((n, s) => n + scores[s].score, 0)) / PRETEST_SCALES.length) / 10;
}
