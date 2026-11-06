// P9-1: launch a simulated campaign. A signed-off campaign's picked ads that
// the launch pack holds a file for (the pack's own rule, from planPack, so
// the two can't disagree) launch into a simulation with a daily budget, a
// length, a start date and one KPI threshold. Nothing real is spent or
// published, but a person approves it in the inbox first (rule 3, Q1), and
// once decided its terms never change (the launches_guard trigger).
//
// Every read and write goes through asUser() (rule 7): another workspace's
// campaign, launch or request is the same refusal as one that isn't there.
import { randomInt } from "node:crypto";
import { asUser, type Tx } from "@/lib/db/scoped";
import type { Member } from "@/lib/agents/runs";
import { KPI_METRICS } from "@/lib/brief/schema";
import { getCreative, type CreativeView } from "@/lib/creative/gallery";
import { NOT_SIGNED_OFF_PACK, planPack, type PackLang, type PackPlan, type PackRefusal } from "@/lib/creative/pack";
import type { SizeId } from "@/lib/creative/render/sizes";
import {
  launchDefaults,
  LAUNCH_AD_NOT_FOUND,
  LAUNCH_ADS_CHANGED,
  LAUNCH_ADS_CHANGED_SINCE_ASKED,
  LAUNCH_ALREADY_ASKED,
  LAUNCH_ALREADY_LIVE,
  LAUNCH_BRIEF_NOT_SIGNED_OFF,
  LAUNCH_CAMPAIGN_NOT_FOUND,
  LAUNCH_DAYS_TO_DECIDE,
  LAUNCH_EXPIRED,
  LAUNCH_NOT_LIVE,
  LAUNCH_NOT_VALID,
  LAUNCH_QUESTION,
  LAUNCH_REQUEST_NOT_OPEN,
  NO_ELIGIBLE_ADS,
  NOT_SIGNED_OFF_LAUNCH,
  REFUSAL_NEEDS_REASON,
  validateLaunchInput,
  type KpiMetric,
  type LaunchRequest,
  type LaunchSettings,
} from "./launch-rules";

export * from "./launch-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;

export class LaunchError extends Error {
  problems?: string[];
  constructor(message: string, problems?: string[]) {
    super(message);
    this.name = "LaunchError";
    if (problems) this.problems = problems;
  }
}

/** One ad as a launch holds it: the sizes and languages the pack has a file for, which launch together. */
export type LaunchAd = { variantId: string; sizes: SizeId[]; langs: PackLang[] };
/** An ad as people see it: its gallery number and headline too. */
export type LaunchAdView = LaunchAd & { adNumber: number; headline: string };

export type LaunchEligibility = {
  campaignId: string;
  briefKpi: KpiMetric | null;
  defaults: LaunchSettings;
  /** The picked ads with at least one file in the pack, in the pack's order. */
  ads: LaunchAdView[];
  /** The picked ads with no file in the pack, each with the pack's reasons. */
  leftOut: { variantId: string; adNumber: number; headline: string; reason: string; reasons: string[] }[];
  canAsk: boolean;
  reason: string | null;
};

export type LaunchStatus = "awaiting_approval" | "live" | "ended" | "refused";

export type LaunchView = {
  id: string;
  campaignId: string;
  status: LaunchStatus;
  ads: LaunchAd[];
  dailyBudgetPence: number;
  days: number;
  startsOn: string;
  kpiMeasure: string;
  kpiValue: number;
  seed: string;
  approvalId: string;
  createdBy: string;
  createdAt: Date;
  approvedAt: Date | null;
  endedBy: string | null;
  endedByName: string | null;
  endedAt: Date | null;
  expiresAt: Date;
  decision: {
    status: "pending" | "approved" | "rejected" | "expired";
    reason: string | null;
    decidedBy: string | null;
    decidedByName: string | null;
    decidedAt: Date | null;
  };
};

const distinct = <T>(xs: T[]): T[] => [...new Set(xs)];
const isKpiMetric = (k: unknown): k is KpiMetric => typeof k === "string" && (KPI_METRICS as readonly string[]).includes(k);

/**
 * Closes launch requests left open past their date, as stale sign-offs are:
 * the approval expires and the launch is refused with the reason. Runs
 * whenever launches or the inbox are read, so there is no scheduled job.
 */
export async function expireStaleLaunches(tx: Tx): Promise<void> {
  const expired = await tx`
    update public.approvals set status = 'expired', reason = ${LAUNCH_EXPIRED}, decided_at = now()
    where kind = 'launch' and status = 'pending' and expires_at <= now()
    returning id`;
  if (expired.length === 0) return;
  await tx`update public.launches set status = 'refused' where approval_id = any(${expired.map((e) => e.id as string)}::uuid[]) and status = 'awaiting_approval'`;
}

/**
 * Which of a campaign's ads can launch, built on the launch pack's plan: null
 * when the campaign isn't the user's (a 404), a refusal when the brief isn't
 * signed off, or the eligibility. Pass the pack's plan when it is already made.
 */
export async function launchEligibility(
  userId: string,
  campaignId: string,
  opts: { plan?: PackPlan | PackRefusal | null } = {},
): Promise<LaunchEligibility | { refused: string } | null> {
  if (!UUID.test(campaignId)) return null;
  const plan = opts.plan !== undefined ? opts.plan : await planPack(userId, campaignId);
  if (!plan) return null;
  if ("refused" in plan && plan.refused === NOT_SIGNED_OFF_PACK) return { refused: NOT_SIGNED_OFF_LAUNCH };
  const state = await asUser(userId, async (tx) => {
    await expireStaleLaunches(tx);
    const [c] = await tx`
      select bv.brief -> 'kpi' ->> 'metric' as kpi
      from public.campaigns c
      left join public.brief_versions bv on bv.campaign_id = c.id and bv.version = c.approved_version
      where c.id = ${campaignId}`;
    if (!c) return null;
    const open = await tx`select status from public.launches where campaign_id = ${campaignId} and status in ('awaiting_approval', 'live')`;
    return { kpi: c.kpi as unknown, statuses: open.map((r) => r.status as string) };
  });
  if (!state) return null;
  const briefKpi = isKpiMetric(state.kpi) ? state.kpi : null;

  // Nothing picked counts as no eligible ads, not a refusal.
  const { ads, leftOut } = "refused" in plan ? { ads: [], leftOut: [] } : adsOf(plan);
  const reason = state.statuses.includes("live")
    ? LAUNCH_ALREADY_LIVE
    : state.statuses.includes("awaiting_approval")
      ? LAUNCH_ALREADY_ASKED
      : ads.length === 0
        ? NO_ELIGIBLE_ADS
        : null;
  return { campaignId, briefKpi, defaults: launchDefaults(briefKpi), ads, leftOut, canAsk: reason === null, reason };
}

/** The pack's plan as launch ads: an ad is in when the pack has a file for it, otherwise left out with the pack's reasons. */
function adsOf(plan: PackPlan): Pick<LaunchEligibility, "ads" | "leftOut"> {
  const order = distinct(plan.items.map((i) => i.adId));
  const byId = new Map(plan.ads.map((a) => [a.id, a]));
  const ads = order.map((id): LaunchAdView => {
    const items = plan.items.filter((i) => i.adId === id);
    const a = byId.get(id);
    return { variantId: id, adNumber: a?.number ?? items[0].adNumber, headline: a?.headline ?? items[0].words.headline, sizes: distinct(items.map((i) => i.size)), langs: distinct(items.map((i) => i.lang)) };
  });
  const inPack = new Set(order);
  const leftOut = plan.ads
    .filter((a) => !inPack.has(a.id))
    .map((a) => {
      const reasons = distinct(plan.leftOut.filter((l) => l.adId === a.id).map((l) => l.reason));
      const list = reasons.length ? reasons : ["The launch pack holds no file for this ad."];
      return { variantId: a.id, adNumber: a.number, headline: a.headline, reason: list[0], reasons: list };
    });
  return { ads, leftOut };
}

const sameAds = (x: LaunchAd[], y: LaunchAd[]) =>
  x.length === y.length &&
  x.every((a, i) => a.variantId === y[i].variantId && a.sizes.join() === y[i].sizes.join() && a.langs.join() === y[i].langs.join());

const asLaunchAd = (a: LaunchAdView): LaunchAd => ({ variantId: a.variantId, sizes: a.sizes, langs: a.langs });

/** The settings only, from whatever the request carried (sizes, languages and anything else it says are ignored). */
function settingsOf(request: LaunchRequest): LaunchSettings {
  const r = (request ?? {}) as Partial<LaunchRequest>;
  const value = typeof r.kpiValue === "number" && Number.isFinite(r.kpiValue) ? Math.round(r.kpiValue * 100) / 100 : r.kpiValue;
  return { dailyBudgetPence: r.dailyBudgetPence as number, days: r.days as number, startsOn: r.startsOn as string, kpiMeasure: r.kpiMeasure as string, kpiValue: value as number };
}

/**
 * Asks for a launch: the approval (open for 14 days) and the launch waiting
 * for it. The ads, their sizes and languages are the server's eligibility,
 * never the request's; the request only has to name exactly those ads.
 */
export async function requestLaunch(member: Member, campaignId: string, request: LaunchRequest): Promise<{ launchId: string; approvalId: string }> {
  if (!UUID.test(campaignId)) throw new LaunchError(LAUNCH_CAMPAIGN_NOT_FOUND);
  const e = await launchEligibility(member.userId, campaignId);
  if (!e) throw new LaunchError(LAUNCH_CAMPAIGN_NOT_FOUND);
  if ("refused" in e) throw new LaunchError(e.refused);
  const settings = settingsOf(request);
  const problems = validateLaunchInput(settings);
  if (problems.length) throw new LaunchError(LAUNCH_NOT_VALID, problems);

  const raw: unknown = (request as Partial<LaunchRequest> | null)?.variantIds;
  const ids = Array.isArray(raw) ? (raw as unknown[]) : null;
  if (!ids || ids.some((id) => typeof id !== "string")) throw new LaunchError(LAUNCH_AD_NOT_FOUND);
  const eligible = new Set(e.ads.map((a) => a.variantId));
  const left = new Map(e.leftOut.map((l) => [l.variantId, l]));
  // Anything that isn't a picked ad of this campaign (malformed, another campaign's or workspace's, unpicked): like a 404.
  if (ids.some((id) => !eligible.has(id as string) && !left.has(id as string))) throw new LaunchError(LAUNCH_AD_NOT_FOUND);
  const leftOut = ids.map((id) => left.get(id as string)).find((l) => l);
  if (leftOut) throw new LaunchError(`Ad ${leftOut.adNumber} can't launch: ${leftOut.reason}`);
  if (e.ads.length === 0) throw new LaunchError(NO_ELIGIBLE_ADS);
  const asked = new Set(ids as string[]);
  if (asked.size !== eligible.size || [...eligible].some((id) => !asked.has(id))) throw new LaunchError(LAUNCH_ADS_CHANGED);

  const ads = e.ads.map(asLaunchAd);
  const seed = String(randomInt(1, 2 ** 47));
  try {
    return await asUser(member.userId, async (tx) => {
      // One request at a time per campaign: a second click waits here, then sees the first.
      const [c] = await tx`select status from public.campaigns where id = ${campaignId} for update`;
      if (!c) throw new LaunchError(LAUNCH_CAMPAIGN_NOT_FOUND);
      if (c.status !== "approved") throw new LaunchError(NOT_SIGNED_OFF_LAUNCH);
      await expireStaleLaunches(tx);
      const open = await tx`select status from public.launches where campaign_id = ${campaignId} and status in ('awaiting_approval', 'live')`;
      if (open.some((r) => r.status === "live")) throw new LaunchError(LAUNCH_ALREADY_LIVE);
      if (open.length) throw new LaunchError(LAUNCH_ALREADY_ASKED);
      const [a] = await tx`
        insert into public.approvals (workspace_id, kind, campaign_id, question, options, expires_at)
        values (${member.workspaceId}, 'launch', ${campaignId}, ${LAUNCH_QUESTION}, '[]'::jsonb, now() + ${`${LAUNCH_DAYS_TO_DECIDE} days`}::interval)
        returning id`;
      const [l] = await tx`
        insert into public.launches (workspace_id, campaign_id, ads, daily_budget_pence, days, starts_on, kpi_measure, kpi_value, seed, status, approval_id, created_by)
        values (${member.workspaceId}, ${campaignId}, ${tx.json(ads as never)}, ${settings.dailyBudgetPence}, ${settings.days}, ${settings.startsOn},
                ${settings.kpiMeasure}, ${settings.kpiValue}, ${seed}, 'awaiting_approval', ${a.id}, ${member.userId})
        returning id`;
      return { launchId: l.id as string, approvalId: a.id as string };
    });
  } catch (err) {
    // The database's own line, should two requests slip past the lock.
    const x = err as { code?: string; constraint_name?: string };
    if (x.code === "23505" && x.constraint_name === "launches_one_live") throw new LaunchError(LAUNCH_ALREADY_LIVE);
    if (x.code === "23505" && (x.constraint_name === "launches_one_open" || x.constraint_name === "approvals_one_open_launch")) throw new LaunchError(LAUNCH_ALREADY_ASKED);
    throw err;
  }
}

/**
 * Approves or refuses a launch request. Approving re-checks the campaign: the
 * brief must still be signed off and the ads that can launch still exactly the
 * launch's, or the request stays open with the reason. Refusing needs a reason
 * (trimmed, at most 500 characters, kept as plain text).
 */
export async function decideLaunch(
  member: Member,
  approvalId: string,
  decision: "approved" | "refused",
  reason?: string,
): Promise<{ campaignId: string; launchId: string; status: "live" | "refused" }> {
  const note = typeof reason === "string" ? reason.trim().slice(0, REASON_MAX).trim() : "";
  if (decision === "refused" && !note) throw new LaunchError(REFUSAL_NEEDS_REASON);
  if ((decision !== "approved" && decision !== "refused") || !UUID.test(approvalId)) throw new LaunchError(LAUNCH_REQUEST_NOT_OPEN);

  const [found] = await asUser(member.userId, async (tx) => {
    await expireStaleLaunches(tx);
    return tx`
      select a.campaign_id, l.id as launch_id, l.ads from public.approvals a
      join public.launches l on l.approval_id = a.id
      where a.id = ${approvalId} and a.kind = 'launch' and a.status = 'pending' and a.expires_at > now() and l.status = 'awaiting_approval'`;
  });
  if (!found) throw new LaunchError(LAUNCH_REQUEST_NOT_OPEN);
  const campaignId = found.campaign_id as string;

  if (decision === "approved") {
    const e = await launchEligibility(member.userId, campaignId);
    if (!e) throw new LaunchError(LAUNCH_REQUEST_NOT_OPEN);
    if ("refused" in e) throw new LaunchError(LAUNCH_BRIEF_NOT_SIGNED_OFF);
    if (!sameAds(e.ads.map(asLaunchAd), found.ads as LaunchAd[])) throw new LaunchError(LAUNCH_ADS_CHANGED_SINCE_ASKED);
  }

  return asUser(member.userId, async (tx) => {
    const [still] = await tx`
      select l.id as launch_id from public.approvals a
      join public.launches l on l.approval_id = a.id
      where a.id = ${approvalId} and a.kind = 'launch' and a.status = 'pending' and a.expires_at > now() and l.status = 'awaiting_approval'
      for update of a, l`;
    if (!still) throw new LaunchError(LAUNCH_REQUEST_NOT_OPEN);
    const launchId = still.launch_id as string;
    if (decision === "approved") {
      const [c] = await tx`select status from public.campaigns where id = ${campaignId}`;
      if (!c || c.status !== "approved") throw new LaunchError(LAUNCH_BRIEF_NOT_SIGNED_OFF);
      await tx`update public.approvals set status = 'approved', decided_by = ${member.userId}, decided_at = now() where id = ${approvalId}`;
      await tx`update public.launches set status = 'live', approved_at = now() where id = ${launchId}`;
      return { campaignId, launchId, status: "live" as const };
    }
    await tx`update public.approvals set status = 'rejected', reason = ${note}, decided_by = ${member.userId}, decided_at = now() where id = ${approvalId}`;
    await tx`update public.launches set status = 'refused' where id = ${launchId}`;
    return { campaignId, launchId, status: "refused" as const };
  });
}

/** Ends a live launch early, recording who and when. Anything else, or another workspace's, has no live launch to end. */
export async function endLaunch(member: Member, launchId: string): Promise<void> {
  if (!UUID.test(launchId)) throw new LaunchError(LAUNCH_NOT_LIVE);
  const rows = await asUser(member.userId, (tx) => tx`
    update public.launches set status = 'ended', ended_by = ${member.userId}, ended_at = now()
    where id = ${launchId} and status = 'live'
    returning id`);
  if (rows.length === 0) throw new LaunchError(LAUNCH_NOT_LIVE);
}

/** A campaign's launches, newest first, each with its decision; null when the campaign isn't the user's (a 404). */
export async function launchesFor(userId: string, campaignId: string): Promise<LaunchView[] | null> {
  if (!UUID.test(campaignId)) return null;
  return asUser(userId, async (tx) => {
    await expireStaleLaunches(tx);
    const [c] = await tx`select id from public.campaigns where id = ${campaignId}`;
    if (!c) return null;
    const rows = await tx`
      select l.id, l.campaign_id, l.status, l.ads, l.daily_budget_pence, l.days, to_char(l.starts_on, 'YYYY-MM-DD') as starts_on,
        l.kpi_measure, l.kpi_value::text as kpi_value, l.seed::text as seed, l.approval_id, l.created_by, l.created_at, l.approved_at,
        l.decided_by_name, l.ended_by, l.ended_by_name, l.ended_at,
        a.status as decision_status, a.reason, a.decided_by, a.decided_at, a.expires_at
      from public.launches l join public.approvals a on a.id = l.approval_id
      where l.campaign_id = ${campaignId}
      order by l.created_at desc, l.id desc
      limit 50`;
    return rows.map(
      (r): LaunchView => ({
        id: r.id,
        campaignId: r.campaign_id,
        status: r.status,
        ads: r.ads as LaunchAd[],
        dailyBudgetPence: r.daily_budget_pence,
        days: r.days,
        startsOn: r.starts_on,
        kpiMeasure: r.kpi_measure,
        kpiValue: Number(r.kpi_value),
        seed: r.seed,
        approvalId: r.approval_id,
        createdBy: r.created_by,
        createdAt: r.created_at,
        approvedAt: r.approved_at ?? null,
        endedBy: r.ended_by ?? null,
        endedByName: r.ended_by_name ?? null,
        endedAt: r.ended_at ?? null,
        expiresAt: r.expires_at,
        decision: {
          status: r.decision_status,
          reason: r.reason ?? null,
          decidedBy: r.decided_by ?? null,
          decidedByName: r.decided_by_name ?? null,
          decidedAt: r.decided_at ?? null,
        },
      }),
    );
  });
}

/** Each launched ad with its gallery number and headline, from the campaign's creative (number 0 for an ad no longer in the gallery). */
export function describeLaunchAds(view: CreativeView | null, ads: LaunchAd[]): LaunchAdView[] {
  const variants = view?.variants ?? [];
  return ads.map((a) => {
    const i = variants.findIndex((v) => v.id === a.variantId);
    return { ...a, adNumber: i + 1, headline: i >= 0 ? variants[i].words.headline.split("­").join("") : "" };
  });
}

/** describeLaunchAds, loading the campaign's creative first. */
export async function launchAdsFor(userId: string, campaignId: string, ads: LaunchAd[]): Promise<LaunchAdView[]> {
  return describeLaunchAds(await getCreative(userId, campaignId), ads);
}
