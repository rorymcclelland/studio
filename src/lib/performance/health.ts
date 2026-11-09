// P9-3: the healthy spend share, as pure code. No database, no model, no
// clock: the same facts always give the same answer, so the Performance page,
// Studio's home line and the monitor (P9-4) all agree.
//
// An ad's spend on a day is healthy when the ad still passes compliance
// (worked out again today by the caller) and its KPI over its last three
// simulated days meets the launch's threshold. An ad's first two days, or its
// first 2,000 impressions, are learning: that spend is shown on its own and
// left out of both sides of the share (Q4).
import { formatPrice } from "@/lib/format";
import { HEALTHY_WHEN, type KpiMeasure } from "./launch-rules";
import type { SimRow } from "./simulate";

export const LEARNING = { days: 2, impressions: 2000 } as const;
export const KPI_WINDOW_DAYS = 3;

export type AdStatus = "healthy" | "below_threshold" | "not_compliant" | "learning";

export const STATUS_NAMES: Record<AdStatus, string> = {
  healthy: "Healthy",
  below_threshold: "Below threshold",
  not_compliant: "Not compliant",
  learning: "Learning",
};

export const NOT_ENOUGH_DATA = "Not enough data yet";

/** Shown on the page in one line, so nobody mistakes the share for a platform's metric. */
export const HEALTHY_DEFINITION =
  "Healthy spend is simulated spend on ads that still pass compliance and whose KPI over their last three simulated days meets the launch's threshold; learning spend (an ad's first two days or first 2,000 impressions) is left out of the share.";

/** An ad's compliance as worked out today: the reason is null when it is compliant. */
export type AdComplianceToday = { compliant: boolean; reason: string | null };

export type HealthThreshold = { measure: KpiMeasure; value: number };

export type HealthInput = {
  /** The launch's threshold: rates in per cent, cost per acquisition in simulated pounds, return on ad spend a ratio. */
  threshold: HealthThreshold;
  /** The launch's ads, in launch order (the output follows it). */
  ads: { variantId: string; compliance: AdComplianceToday }[];
  /** The launch's stored rows, in any order. Rows of other ads, and rows after the day judged, are ignored. */
  rows: SimRow[];
};

export type AdKpi = { measure: KpiMeasure; value: number; shown: string; from: number; to: number };

export type AdHealth = {
  variantId: string;
  /** That day's spend. */
  spendPence: number;
  /** Days 1 to the day. */
  spendToDatePence: number;
  impressionsToDate: number;
  kpi: AdKpi;
  meets: boolean;
  learning: boolean;
  compliant: boolean;
  reason: string | null;
  status: AdStatus;
};

export type DayHealth = {
  day: number;
  date: string;
  events: string[];
  healthyPence: number;
  learningPence: number;
  totalPence: number;
  /** healthy ÷ (total − learning); null when every pound is learning. */
  share: number | null;
  shareShown: string;
  ads: AdHealth[];
};

/** "84%", or "Not enough data yet". */
export function shareText(share: number | null): string {
  return share === null ? NOT_ENOUGH_DATA : `${Math.round(share * 100)}%`;
}

/** "Healthy spend share across 2 live campaigns: 84% (simulated)". */
export function homeLine(campaigns: number, share: number | null): string {
  return `Healthy spend share across ${campaigns} live ${campaigns === 1 ? "campaign" : "campaigns"}: ${shareText(share)} (simulated)`;
}

/** The share of what isn't learning, or null when nothing is left to judge. */
export function shareOf(healthyPence: number, learningPence: number, totalPence: number): number | null {
  const judged = totalPence - learningPence;
  return judged > 0 ? healthyPence / judged : null;
}

type Sums = { impressions: number; clicks: number; conversions: number; spendPence: number; revenuePence: number };

function sum(rows: SimRow[]): Sums {
  const s: Sums = { impressions: 0, clicks: 0, conversions: 0, spendPence: 0, revenuePence: 0 };
  for (const r of rows) {
    s.impressions += r.impressions;
    s.clicks += r.clicks;
    s.conversions += r.conversions;
    s.spendPence += r.spendPence;
    s.revenuePence += r.revenuePence;
  }
  return s;
}

const percent = (v: number) => `${v.toFixed(2)}%`;

/** The KPI over a window, as a ratio of sums, with how it reads and whether it can be judged at all. */
function kpiOf(measure: KpiMeasure, s: Sums): { value: number; shown: string; judgeable: boolean } {
  switch (measure) {
    case "ctr": {
      const value = s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
      return { value, shown: percent(value), judgeable: s.impressions > 0 };
    }
    case "conversion_rate":
      if (s.clicks === 0) return { value: 0, shown: "No clicks", judgeable: false };
      return { value: (s.conversions / s.clicks) * 100, shown: percent((s.conversions / s.clicks) * 100), judgeable: true };
    case "cpa":
      // No conversions is infinitely bad: it never meets a threshold.
      if (s.conversions === 0) return { value: Number.POSITIVE_INFINITY, shown: "No conversions", judgeable: false };
      return { value: s.spendPence / 100 / s.conversions, shown: formatPrice(Math.round(s.spendPence / s.conversions)), judgeable: true };
    case "roas": {
      const value = s.spendPence > 0 ? s.revenuePence / s.spendPence : 0;
      return { value, shown: `${value.toFixed(2)}×`, judgeable: s.spendPence > 0 };
    }
  }
}

/** At full precision: a value exactly at the threshold meets it. */
function meetsThreshold(threshold: HealthThreshold, value: number): boolean {
  return HEALTHY_WHEN[threshold.measure] === "at or below" ? value <= threshold.value : value >= threshold.value;
}

function statusOf(compliant: boolean, learning: boolean, meets: boolean): AdStatus {
  // The chosen precedence: a non-compliant ad's spend is unhealthy even while it learns.
  if (!compliant) return "not_compliant";
  if (learning) return "learning";
  return meets ? "healthy" : "below_threshold";
}

/** One simulated day's health, or null when no launched ad has a row that day. */
export function dayHealth(input: HealthInput, day: number): DayHealth | null {
  if (!Number.isInteger(day) || day < 1) return null;
  const byAd = new Map<string, SimRow[]>();
  for (const a of input.ads) byAd.set(a.variantId, []);
  for (const r of input.rows) if (r.day <= day) byAd.get(r.variantId)?.push(r);

  const from = Math.max(1, day - (KPI_WINDOW_DAYS - 1));
  const ads: AdHealth[] = [];
  let first: SimRow | null = null;
  for (const { variantId, compliance } of input.ads) {
    const mine = byAd.get(variantId)!;
    const today = mine.find((r) => r.day === day);
    if (!today) continue;
    first ??= today;
    const toDate = sum(mine);
    const kpi = kpiOf(input.threshold.measure, sum(mine.filter((r) => r.day >= from)));
    const meets = kpi.judgeable && meetsThreshold(input.threshold, kpi.value);
    const learning = day <= LEARNING.days || toDate.impressions < LEARNING.impressions;
    ads.push({
      variantId,
      spendPence: today.spendPence,
      spendToDatePence: toDate.spendPence,
      impressionsToDate: toDate.impressions,
      kpi: { measure: input.threshold.measure, value: kpi.value, shown: kpi.shown, from, to: day },
      meets,
      learning,
      compliant: compliance.compliant,
      reason: compliance.compliant ? null : compliance.reason,
      status: statusOf(compliance.compliant, learning, meets),
    });
  }
  if (!first) return null;

  let healthyPence = 0;
  let learningPence = 0;
  let totalPence = 0;
  for (const a of ads) {
    totalPence += a.spendPence;
    if (a.status === "healthy") healthyPence += a.spendPence;
    if (a.status === "learning") learningPence += a.spendPence;
  }
  const share = shareOf(healthyPence, learningPence, totalPence);
  return { day, date: first.date, events: [...first.events], healthyPence, learningPence, totalPence, share, shareShown: shareText(share), ads };
}

/** Days 1 to `through` that have rows, each exactly as dayHealth gives it. Every day is judged with the compliance given (today's). */
export function healthSeries(input: HealthInput, through: number): DayHealth[] {
  const out: DayHealth[] = [];
  for (let day = 1; day <= through; day++) {
    const d = dayHealth(input, day);
    if (d) out.push(d);
  }
  return out;
}

/**
 * U10-4: the day an ad recovered from its Below threshold alert, worked out
 * from the stored simulated days, never stored. N is the first day such that
 * days N - 1 and N are both after the alert's day, both in `series`, and on
 * both the ad has a row, isn't learning and meets the threshold; N is the
 * second of the two. Only a Below threshold alert recovers: null for Tiring
 * and Not compliant, and null when the series has no such pair yet.
 */
export function recoveredOn(series: DayHealth[], alert: { variantId: string; kind: string; day: number }): number | null {
  if (alert.kind !== "below_threshold") return null;
  const good = new Set<number>();
  for (const d of series) {
    if (d.day <= alert.day) continue;
    const ad = d.ads.find((a) => a.variantId === alert.variantId);
    if (ad && !ad.learning && ad.meets) good.add(d.day);
  }
  const days = [...good].sort((x, y) => x - y);
  for (const day of days) if (good.has(day - 1)) return day;
  return null;
}
