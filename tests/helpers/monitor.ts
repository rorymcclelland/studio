// P9-4's shared fixtures and independent readings. Pure: no database, no
// model, nothing from src/lib/performance/alerts.ts or ask-rules.ts (the code
// under test), so the unit tests, the flows, the browser test and the evals
// all check the monitor against the same arithmetic, written out here from
// the refinement's words:
//
// - Learning (P9-3, Q4): an ad's first two days, or until its impressions to
//   date (including the day) reach 2,000.
// - An ad's KPI on a day is over its last three simulated days (from
//   max(1, day - 2) to the day), as a ratio of sums.
// - Below threshold: two simulated days in a row whose KPI misses the
//   threshold, neither of them learning.
// - Tiring: a three-day click-through rate 25% or more below the ad's best
//   three-day rate so far, where only windows after learning count (a window
//   counts when the ad is not learning on its first day, so the first is days
//   3 to 5 at the earliest).
import { FERNHOLLOW } from "@/lib/demo/briefs";
import type { LaunchAd, LaunchAdView } from "@/lib/performance/launch";
import { simulateDays, type SimLaunch, type SimRow } from "@/lib/performance/simulate";

export const SOCIAL_SIZES = ["1080x1080", "1080x1350", "1080x1920", "1200x628"] as LaunchAd["sizes"];

// ---------------------------------------------------------------- the demo launch
//
// Four Fernhollow ads at £50 a day for 30 days from 6 November 2026, seed 7, as
// the demo runs it. With these ad ids the simulator (P9-2) makes ad 1 a fast
// tirer and the other three slow: ad 1's three-day click-through rate is
// 0.90% over days 3 to 5 (its best after learning), 0.73% over days 6 to 8
// (19% below) and 0.65% over days 7 to 9 (27% below), so its Tiring alert is
// on simulated day 9, not earlier. The three slow ads never fall 25% below
// their best within 30 days. These figures were read from the simulator on
// 6 November 2026 (HEAD 9719d2c); if its tuning changes, re-read them with
// referenceTiring below and change DEMO_TIRING.

export const DEMO_IDS = [
  "a1111111-1111-4111-8111-111111111111",
  "a2222222-2222-4222-8222-222222222222",
  "a3333333-3333-4333-8333-333333333333",
  "a4444444-4444-4444-8444-444444444444",
] as const;

export const DEMO_HEADLINES = ["Made for the long way round", "Mended, not replaced", "Dry on the high ground", "Built for wet weekends"];

export const DEMO_ADS: LaunchAd[] = DEMO_IDS.map((variantId) => ({ variantId, sizes: SOCIAL_SIZES, langs: ["en-GB"] }));

/** The launch's ads as the Performance view and the monitor name them: Ad 1 to Ad 4, with their headlines. */
export const DEMO_VIEWS: LaunchAdView[] = DEMO_ADS.map((a, i) => ({ ...a, adNumber: i + 1, headline: DEMO_HEADLINES[i] }));

const DEMO_PRICES = FERNHOLLOW.products.map((p) => p.pricePence).sort((x, y) => x - y);

export function demoLaunch(over: Partial<SimLaunch> = {}): SimLaunch {
  return { seed: "7", startsOn: "2026-11-06", days: 30, dailyBudgetPence: 5000, ads: DEMO_ADS, orderValuesPence: DEMO_PRICES, ...over };
}

/** The demo launch's rows for days 1 to `through`, as the clock would store them. */
export function demoRows(through = 30, launch: SimLaunch = demoLaunch()): SimRow[] {
  return simulateDays(launch, 1, through, []);
}

/** Ad 1 tires on simulated day 9 (see above). */
export const DEMO_TIRING = { variantId: DEMO_IDS[0], day: 9, current: { from: 7, to: 9 }, best: { from: 3, to: 5 } } as const;

// ---------------------------------------------------------------- the independent readings

type Sums = { impressions: number; clicks: number; conversions: number; spendPence: number; revenuePence: number };

export function sums(rows: SimRow[], variantId: string | null, from: number, to: number): Sums {
  const s: Sums = { impressions: 0, clicks: 0, conversions: 0, spendPence: 0, revenuePence: 0 };
  for (const r of rows) {
    if ((variantId !== null && r.variantId !== variantId) || r.day < from || r.day > to) continue;
    s.impressions += r.impressions;
    s.clicks += r.clicks;
    s.conversions += r.conversions;
    s.spendPence += r.spendPence;
    s.revenuePence += r.revenuePence;
  }
  return s;
}

/** The click-through rate in per cent over days from..to (0 with no impressions). */
export function ctrOver(rows: SimRow[], variantId: string, from: number, to: number): number {
  const s = sums(rows, variantId, from, to);
  return s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
}

/** Whether the ad is learning on `day`: its first two days, or under 2,000 impressions to date. */
export function isLearning(rows: SimRow[], variantId: string, day: number): boolean {
  return day <= 2 || sums(rows, variantId, 1, day).impressions < 2000;
}

export type Measure = "ctr" | "conversion_rate" | "cpa" | "roas";

/** The KPI over days from..to in the threshold's units, or null when it can't be judged (it then never meets). */
export function kpiOver(rows: SimRow[], variantId: string, measure: Measure, from: number, to: number): number | null {
  const s = sums(rows, variantId, from, to);
  switch (measure) {
    case "ctr":
      return s.impressions > 0 ? (s.clicks / s.impressions) * 100 : null;
    case "conversion_rate":
      return s.clicks > 0 ? (s.conversions / s.clicks) * 100 : null;
    case "cpa":
      return s.conversions > 0 ? s.spendPence / 100 / s.conversions : null;
    case "roas":
      return s.spendPence > 0 ? s.revenuePence / s.spendPence : null;
  }
}

export function meets(threshold: { measure: Measure; value: number }, value: number | null): boolean {
  if (value === null) return false;
  return threshold.measure === "cpa" ? value <= threshold.value : value >= threshold.value;
}

/** The first day (up to `through`) an ad's Below threshold alert is due, or null. */
export function referenceBelow(rows: SimRow[], variantId: string, threshold: { measure: Measure; value: number }, through: number): number | null {
  const misses = (day: number) => !isLearning(rows, variantId, day) && !meets(threshold, kpiOver(rows, variantId, threshold.measure, Math.max(1, day - 2), day));
  for (let day = 2; day <= through; day++) if (misses(day - 1) && misses(day)) return day;
  return null;
}

export type Window = { from: number; to: number; ctr: number };

/** The first day (up to `through`) an ad's Tiring alert is due, with the two windows behind it, or null. */
export function referenceTiring(rows: SimRow[], variantId: string, through: number): { day: number; current: Window; best: Window; dropPercent: number } | null {
  let best: Window | null = null;
  for (let day = 3; day <= through; day++) {
    const from = day - 2;
    if (isLearning(rows, variantId, from)) continue;
    const s = sums(rows, variantId, from, day);
    const current: Window = { from, to: day, ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0 };
    if (!best || current.ctr > best.ctr) best = current;
    const drop = best.ctr > 0 ? (best.ctr - current.ctr) / best.ctr : 0;
    if (drop >= 0.25 - 1e-9) return { day, current, best, dropPercent: drop * 100 };
  }
  return null;
}

/** "0.65%": a rate as the Performance view shows it. */
export const percentShown = (v: number) => `${v.toFixed(2)}%`;

/**
 * A seed for `ads` whose month has an ad tiring between `earliest` and
 * `latest`, with no ad tiring before `earliest`, worked out with the pure
 * simulator. Variant ids are made by the database, so the browser test and
 * the flows find their seed once the ads exist.
 */
export function seedWithTiring(
  base: Omit<SimLaunch, "seed">,
  earliest: number,
  latest: number,
  tries = 2000,
): { seed: string; variantId: string; day: number; rows: SimRow[] } {
  for (let n = 1; n <= tries; n++) {
    const launch = { ...base, seed: String(n) };
    const rows = simulateDays(launch, 1, base.days, []);
    const due = base.ads.map((a) => ({ variantId: a.variantId, t: referenceTiring(rows, a.variantId, base.days) }));
    const first = due.filter((d) => d.t).sort((x, y) => x.t!.day - y.t!.day)[0];
    if (first && first.t!.day >= earliest && first.t!.day <= latest) return { seed: launch.seed, variantId: first.variantId, day: first.t!.day, rows };
  }
  throw new Error(`No seed in 1..${tries} has an ad tiring between days ${earliest} and ${latest}`);
}

/** The demo's question (P9-4 #4), which the mock plans and answers offline. */
export const MOCK_CPA_QUESTION = "Which ad had the lowest cost per acquisition last week?";
