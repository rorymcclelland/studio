// P9-3: the Performance view's data and Studio's home line. Stored facts only:
// the launch, its simulated daily rows and compliance worked out again today,
// judged by health.ts. No model is called (rule 5), and every read goes
// through asUser() (rule 7): another workspace's campaign is the same null as
// one that isn't there, and nothing about another workspace's ad is told.
import { complianceFor, fileCompliance, type AdCompliance } from "@/lib/compliance/compute";
import { getCreative } from "@/lib/creative/gallery";
import { asUser, type Tx } from "@/lib/db/scoped";
import { clockLabel } from "./clock-rules";
import { dayHealth, healthSeries, homeLine, shareOf, type AdComplianceToday, type DayHealth, type HealthInput } from "./health";
import { describeLaunchAds, isKpiMeasure, launchesFor, type LaunchAd, type LaunchAdView, type LaunchView } from "./launch";
import type { SimRow } from "./simulate";

export const COMPLIANCE_GONE = "Its picture or words have been discarded, so its compliance can't be worked out.";
export const COMPLIANCE_NOT_DRAWN = "A launched size or language can no longer be drawn, so it can't be checked.";
export const NOT_LAUNCHED = "This campaign has no live or ended simulated launch yet.";
export const TREND_NOTE = "Every day is judged with today's compliance.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One launched ad today: compliant only when every launched language and size passes or was accepted (the pack's rule). */
function judgeToday(compliance: AdCompliance | undefined, ad: LaunchAd): AdComplianceToday {
  if (!compliance) return { compliant: false, reason: COMPLIANCE_GONE };
  for (const lang of ad.langs) {
    for (const size of ad.sizes) {
      const file = fileCompliance(compliance, lang, size);
      if (!file) return { compliant: false, reason: COMPLIANCE_NOT_DRAWN };
      if (file.leftOut) return { compliant: false, reason: file.leftOut };
    }
  }
  return { compliant: true, reason: null };
}

/** Each launched ad's compliance, worked out again now against the kit as it is today. One entry per ad asked about. */
export async function complianceToday(userId: string, ads: LaunchAd[]): Promise<Map<string, AdComplianceToday>> {
  const all = await complianceFor(
    userId,
    ads.map((a) => a.variantId),
  );
  return new Map(ads.map((a) => [a.variantId, judgeToday(all.get(a.variantId), a)]));
}

/** Stored rows of the given launches, by launch id, as the simulator's rows. */
async function storedRows(tx: Tx, launchIds: string[]): Promise<Map<string, SimRow[]>> {
  const out = new Map<string, SimRow[]>(launchIds.map((id) => [id, []]));
  if (launchIds.length === 0) return out;
  const rows = await tx`
    select launch_id, variant_id, day, to_char(date, 'YYYY-MM-DD') as date, impressions, clicks, conversions, spend_pence, revenue_pence, events
    from public.sim_daily where launch_id = any(${launchIds}::uuid[])
    order by launch_id, day, variant_id`;
  for (const r of rows) {
    out.get(r.launch_id as string)?.push({
      variantId: r.variant_id as string,
      day: r.day as number,
      date: r.date as string,
      impressions: r.impressions as number,
      clicks: r.clicks as number,
      conversions: r.conversions as number,
      spendPence: r.spend_pence as number,
      revenuePence: r.revenue_pence as number,
      events: r.events as string[],
    });
  }
  return out;
}

type Judged = { ads: LaunchAd[]; kpiMeasure: string; kpiValue: number };

function healthInput(launch: Judged, compliance: Map<string, AdComplianceToday>, rows: SimRow[]): HealthInput {
  if (!isKpiMeasure(launch.kpiMeasure)) throw new Error(`A launch has an unknown KPI measure: ${launch.kpiMeasure}`);
  return {
    threshold: { measure: launch.kpiMeasure, value: launch.kpiValue },
    ads: launch.ads.map((a) => ({ variantId: a.variantId, compliance: compliance.get(a.variantId) ?? { compliant: false, reason: COMPLIANCE_GONE } })),
    rows,
  };
}

export type PerformanceAd = LaunchAdView & {
  /** The gallery's picture of the ad, or null when it is no longer in the gallery. */
  thumb: string | null;
  compliance: AdComplianceToday;
};

export type PerformanceView = {
  campaignId: string;
  /** The signed-off brief's title, else the objective. */
  title: string;
  brand: { id: string; name: string };
  /** The live launch, else the newest ended one; null when there is neither. */
  launch: LaunchView | null;
  simDay: number;
  days: number;
  clock: string;
  ads: PerformanceAd[];
  /** The latest simulated day's health; null before the first day. */
  latest: DayHealth | null;
  series: DayHealth[];
};

/** A campaign's Performance view, or null when the id is malformed, missing or another workspace's (a 404). */
export async function performanceFor(userId: string, campaignId: string): Promise<PerformanceView | null> {
  if (!UUID.test(campaignId)) return null;
  const launches = await launchesFor(userId, campaignId);
  if (!launches) return null;
  const [c] = await asUser(
    userId,
    (tx) => tx`
      select c.objective, b.id as brand_id, b.name as brand_name,
        (select v.brief ->> 'title' from public.brief_versions v where v.campaign_id = c.id and v.version = c.approved_version) as title
      from public.campaigns c join public.brands b on b.id = c.brand_id
      where c.id = ${campaignId}`,
  );
  if (!c) return null;
  const base = { campaignId, title: (c.title as string | null) || (c.objective as string), brand: { id: c.brand_id as string, name: c.brand_name as string } };

  const launch = launches.find((l) => l.status === "live") ?? launches.find((l) => l.status === "ended") ?? null;
  if (!launch) return { ...base, launch: null, simDay: 0, days: 0, clock: "", ads: [], latest: null, series: [] };

  const [compliance, rows, creative] = await Promise.all([
    complianceToday(userId, launch.ads),
    asUser(userId, (tx) => storedRows(tx, [launch.id])),
    getCreative(userId, campaignId),
  ]);
  const input = healthInput(launch, compliance, rows.get(launch.id) ?? []);
  const variants = new Map((creative?.variants ?? []).map((v) => [v.id, v]));
  const ads = describeLaunchAds(creative, launch.ads).map((a): PerformanceAd => {
    const v = variants.get(a.variantId);
    return { ...a, thumb: v ? `${v.src}?layout=${v.layout}` : null, compliance: compliance.get(a.variantId)! };
  });
  return {
    ...base,
    launch,
    simDay: launch.simDay,
    days: launch.days,
    clock: clockLabel(launch.simDay, launch.days),
    ads,
    latest: launch.simDay > 0 ? dayHealth(input, launch.simDay) : null,
    series: healthSeries(input, launch.simDay),
  };
}

export type HomeHealth = {
  campaigns: number;
  healthyPence: number;
  learningPence: number;
  totalPence: number;
  share: number | null;
  line: string;
};

/**
 * The home line: every live launch in the user's workspace, each judged at its
 * own latest simulated day with today's compliance, pooled by spend (not an
 * average of shares). Null when nothing is live.
 */
export async function homeHealth(userId: string): Promise<HomeHealth | null> {
  const { live, rows } = await asUser(userId, async (tx) => {
    const live = await tx`select id, ads, kpi_measure, kpi_value::text as kpi_value, sim_day from public.launches where status = 'live' order by created_at, id`;
    return { live, rows: await storedRows(tx, live.map((l) => l.id as string)) };
  });
  if (live.length === 0) return null;

  const launches = live.map((l) => ({ id: l.id as string, ads: l.ads as LaunchAd[], kpiMeasure: l.kpi_measure as string, kpiValue: Number(l.kpi_value), simDay: l.sim_day as number }));
  // One compliance read for every launched ad; each launch then judges its own sizes and languages.
  const all = await complianceFor(
    userId,
    launches.flatMap((l) => l.ads.map((a) => a.variantId)),
  );
  let healthyPence = 0;
  let learningPence = 0;
  let totalPence = 0;
  for (const l of launches) {
    if (l.simDay === 0) continue;
    const compliance = new Map(l.ads.map((a) => [a.variantId, judgeToday(all.get(a.variantId), a)]));
    const d = dayHealth(healthInput(l, compliance, rows.get(l.id) ?? []), l.simDay);
    if (!d) continue;
    healthyPence += d.healthyPence;
    learningPence += d.learningPence;
    totalPence += d.totalPence;
  }
  const share = shareOf(healthyPence, learningPence, totalPence);
  return { campaigns: launches.length, healthyPence, learningPence, totalPence, share, line: homeLine(launches.length, share) };
}
