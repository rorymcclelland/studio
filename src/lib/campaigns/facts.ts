// U10-2: one loader per request for a campaign's overview and stage pages.
// It reads what the one-page campaign read (the campaign and its brief, the
// sign-off, the persona review and test plan, the creative, the gallery's
// compliance, the launch pack's plan, the launch eligibility and the
// launches) and, only while a launch is live or ended, what the Performance
// page reads for its alerts and latest day. Every read goes through asUser()
// (rule 7): another workspace's, a missing or a malformed id gives null.
//
// The stage facts are worked out from these reads, never with a query of
// their own, so the stage bar and the overview's cards cost nothing extra. The
// reads are kept per request (React's cache()), so a stage page that shows a
// section reuses what the bar read.
import "server-only";
import { cache } from "react";
import { getSignoffState, type SignoffState } from "@/lib/approvals/repo";
import { getCampaign, type CampaignDetail } from "@/lib/brief/repo";
import { galleryCompliance, type GalleryCompliance } from "@/lib/compliance/compute";
import { getCreative, type CreativeView } from "@/lib/creative/gallery";
import { planPack, type PackPlan, type PackRefusal } from "@/lib/creative/pack";
import { listAlerts, type AlertView } from "@/lib/performance/alerts-store";
import { performanceFor, type PerformanceView } from "@/lib/performance/dashboard";
import { launchEligibility, launchesFor, type LaunchEligibility, type LaunchView } from "@/lib/performance/launch";
import { getReviews, type Reviews } from "@/lib/strategy/reviews";
import type { CampaignFacts } from "./stages";

const RUNNING = new Set(["queued", "running"]);

export type CampaignData = {
  facts: CampaignFacts;
  campaign: CampaignDetail;
  signoff: SignoffState | null;
  reviews: Reviews;
  creative: CreativeView | null;
  /** The gallery's compliance pills and summary; null before there are signed-off ads, or when it couldn't be worked out. */
  compliance: GalleryCompliance | null;
  /** The launch pack's plan (or why there is none); null when it couldn't be made. */
  plan: PackPlan | PackRefusal | null;
  /** What would launch now, or why nothing can; null when it couldn't be worked out. */
  eligibility: LaunchEligibility | { refused: string } | null;
  launches: LaunchView[];
  /** The Performance page's view and alerts, read only while a launch is live or ended. */
  performance: { view: PerformanceView; alerts: AlertView[] } | null;
};

function logged<T>(what: string, err: unknown): T | null {
  console.error(`[campaign] ${what}`, err instanceof Error ? err.message : String(err));
  return null;
}

/** Everything the campaign's overview and stage pages read, once per request; null for a campaign the user can't see. */
export const loadCampaign = cache(async (userId: string, campaignId: string): Promise<CampaignData | null> => {
  const campaign = await getCampaign(userId, campaignId);
  if (!campaign) return null;
  const [signoff, reviews, creative, launchList] = await Promise.all([
    getSignoffState(userId, campaignId),
    getReviews(userId, campaignId),
    getCreative(userId, campaignId),
    launchesFor(userId, campaignId),
  ]);
  const launches = launchList ?? [];
  const hasAds = !!creative && creative.signedOff && creative.variants.length > 0;

  const [compliance, plan] = await Promise.all([
    hasAds ? galleryCompliance(userId, creative).catch((err: unknown) => logged<GalleryCompliance>("the gallery's compliance couldn't be worked out", err)) : Promise.resolve(null),
    creative ? planPack(userId, campaignId, creative).catch((err: unknown) => logged<PackPlan>("the launch pack couldn't be planned", err)) : Promise.resolve(null),
  ]);
  const eligibility = plan
    ? await launchEligibility(userId, campaignId, { plan }).catch((err: unknown) => logged<LaunchEligibility>("the launch eligibility couldn't be worked out", err))
    : null;

  const shown = launches.some((l) => l.status === "live" || l.status === "ended");
  const performance = shown ? await performanceOf(userId, campaignId) : null;

  const version = creative?.version ?? null;
  const pills = compliance?.pills ?? {};
  const toDecide = (creative?.variants ?? []).filter((v) => v.picked && v.briefVersion === version && pills[v.id]?.tone === "review").length;

  const facts: CampaignFacts = {
    campaignId: campaign.id,
    status: signoff?.status ?? campaign.status,
    currentVersion: campaign.currentVersion,
    approvedVersion: signoff?.approvedVersion ?? null,
    briefRun: campaign.run?.status ?? null,
    signoffOpen: signoff?.open?.version ?? null,
    versions: campaign.versions.length,
    audience: {
      personas: reviews.review?.data.personas.length ?? 0,
      testPlan: !!reviews.plan,
      running: reviews.runs.some((r) => RUNNING.has(r.status)),
    },
    creative: {
      ads: creative?.variants.length ?? 0,
      picked: creative?.variants.filter((v) => v.picked).length ?? 0,
      running: !!creative?.makeCreative.runningRunId,
      discarded: (creative?.discarded.length ?? 0) + (creative?.discardedSets.length ?? 0),
      runs: creative?.runs.length ?? 0,
      costPence: creative?.totalCostPence ?? 0,
    },
    toDecide,
    launchable: eligibility && !("refused" in eligibility) ? eligibility.ads.length : 0,
    launches: launches.map((l) => ({ status: l.status, simDay: l.simDay, days: l.days })),
    performance: performance
      ? {
          unseenAlerts: performance.alerts.filter((a) => !a.seenAt).length,
          belowThreshold: belowThreshold(performance.view),
        }
      : null,
  };
  return { facts, campaign, signoff, reviews, creative, compliance, plan, eligibility, launches, performance };
});

/** The Performance page's reads, kept per request so the page and the stage bar share them. */
export const performanceReads = cache(async (userId: string, campaignId: string) => {
  const [view, alerts] = await Promise.all([performanceFor(userId, campaignId), listAlerts(userId, campaignId)]);
  return { view, alerts };
});

async function performanceOf(userId: string, campaignId: string): Promise<CampaignData["performance"]> {
  try {
    const { view, alerts } = await performanceReads(userId, campaignId);
    return view && alerts ? { view, alerts } : null;
  } catch (err) {
    return logged("the performance couldn't be read", err);
  }
}

/** The gallery numbers of the ads below the threshold on the latest simulated day. */
function belowThreshold(view: PerformanceView): number[] {
  const numbers = new Map(view.ads.map((a) => [a.variantId, a.adNumber]));
  return (view.latest?.ads ?? []).filter((a) => a.status === "below_threshold").map((a) => numbers.get(a.variantId) ?? 0);
}

/** A campaign's stage facts (src/lib/campaigns/stages.ts), or null for a malformed, missing or another workspace's id. */
export async function campaignFacts(userId: string, campaignId: string): Promise<CampaignFacts | null> {
  return (await loadCampaign(userId, campaignId))?.facts ?? null;
}
