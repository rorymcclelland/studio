// P9-4: the monitor's alerts, as pure code. No database, no model, no clock:
// the clock (clock.ts) runs this inside its own transaction after each
// simulated step and stores what it returns. An alert only tells: it never
// takes an action of any kind (rule 3). Swaps and budget moves are Sprint 10's.
//
// Three kinds, each raised at most once per ad in a launch, on its first day:
// - Below threshold: two simulated days in a row whose three-day KPI misses
//   the launch's threshold, neither of them learning (health.ts's KPI and
//   learning, so the Performance view's statuses and the alerts agree).
// - Tiring: the ad's three-day click-through rate is 25% or more below its
//   best three-day rate so far, counting only windows after learning.
// - Not compliant: the ad no longer passes compliance, as worked out on the
//   clock's step.
import { formatThreshold, MEASURE_NAMES, thresholdPhrase, type KpiMeasure } from "./launch-rules";
import { dayHealth, LEARNING, type AdKpi, type HealthInput } from "./health";
import type { SimRow } from "./simulate";

export const ALERT_KINDS = ["below_threshold", "tiring", "not_compliant"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_NAMES: Record<AlertKind, string> = {
  below_threshold: "Below threshold",
  tiring: "Tiring",
  not_compliant: "Not compliant",
};

/** How far below its best three-day click-through rate an ad is tiring. */
export const TIRING_DROP = 0.25;

export const NO_ALERTS = "No alerts yet (simulated).";

/** Studio's home: "1 unseen alert on live campaigns (simulated)". */
export function alertsLine(n: number): string {
  return `${n} unseen ${n === 1 ? "alert" : "alerts"} on live campaigns (simulated)`;
}

/** A KPI over days from..to. value is null when the window can't be judged (no conversions, no clicks): facts are stored as JSON. */
export type KpiWindow = { from: number; to: number; value: number | null; shown: string };

export type BelowThresholdFacts = { measure: KpiMeasure; threshold: number; thresholdShown: string; previous: KpiWindow; current: KpiWindow };
export type TiringFacts = { current: KpiWindow; best: KpiWindow; dropPercent: number };
export type NotCompliantFacts = { reason: string };

export type Alert =
  | { kind: "below_threshold"; variantId: string; day: number; facts: BelowThresholdFacts }
  | { kind: "tiring"; variantId: string; day: number; facts: TiringFacts }
  | { kind: "not_compliant"; variantId: string; day: number; facts: NotCompliantFacts };

/** The launch's alerts already stored are never raised again. */
export type AlertInput = HealthInput & { raised: { variantId: string; kind: AlertKind }[] };

const percent = (v: number) => `${v.toFixed(2)}%`;

function windowOf(kpi: AdKpi): KpiWindow {
  const judgeable = Number.isFinite(kpi.value) && !/^No /.test(kpi.shown);
  return { from: kpi.from, to: kpi.to, value: judgeable ? kpi.value : null, shown: kpi.shown };
}

type Totals = { impressions: number; clicks: number };

/**
 * Each ad's three-day click-through windows after learning, by the day they
 * end: a window d-2..d counts when the ad isn't learning on d-2 (past its
 * first two days, with 2,000 impressions to date).
 */
function ctrWindows(rows: SimRow[], variantId: string, through: number): Map<number, KpiWindow> {
  const daily = new Map<number, Totals>();
  for (const r of rows) {
    if (r.variantId !== variantId || r.day > through) continue;
    const t = daily.get(r.day) ?? { impressions: 0, clicks: 0 };
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    daily.set(r.day, t);
  }
  const out = new Map<number, KpiWindow>();
  let toDate = 0;
  const impressionsToDate = new Map<number, number>();
  for (let day = 1; day <= through; day++) {
    toDate += daily.get(day)?.impressions ?? 0;
    impressionsToDate.set(day, toDate);
  }
  for (let end = 3; end <= through; end++) {
    const from = end - 2;
    if (!daily.has(end)) continue;
    const learning = from <= LEARNING.days || (impressionsToDate.get(from) ?? 0) < LEARNING.impressions;
    if (learning) continue;
    let impressions = 0;
    let clicks = 0;
    for (let d = from; d <= end; d++) {
      impressions += daily.get(d)?.impressions ?? 0;
      clicks += daily.get(d)?.clicks ?? 0;
    }
    if (impressions === 0) continue;
    const value = (clicks / impressions) * 100;
    out.set(end, { from, to: end, value, shown: percent(value) });
  }
  return out;
}

/**
 * The alerts due on days fromDay..toDay (rows of later days are ignored), in
 * day order, then the launch's ad order, then ALERT_KINDS order. Each ad and
 * kind at most once, and never one already raised.
 */
export function alertsFor(input: AlertInput, fromDay: number, toDay: number): Alert[] {
  const rows = input.rows.filter((r) => r.day <= toDay);
  const base: HealthInput = { threshold: input.threshold, ads: input.ads, rows };
  const done = new Set(input.raised.map((r) => `${r.variantId}:${r.kind}`));
  const out: Alert[] = [];
  const raise = (a: Alert) => {
    const key = `${a.variantId}:${a.kind}`;
    if (done.has(key)) return;
    done.add(key);
    out.push(a);
  };
  const windows = new Map(input.ads.map((a) => [a.variantId, ctrWindows(rows, a.variantId, toDay)]));
  const healthOn = new Map<number, ReturnType<typeof dayHealth>>();
  const health = (day: number) => {
    if (!healthOn.has(day)) healthOn.set(day, dayHealth(base, day));
    return healthOn.get(day)!;
  };
  const start = Math.max(1, Math.floor(fromDay));

  for (let day = start; day <= toDay; day++) {
    for (const ad of input.ads) {
      // Below threshold: the day before and the day both missed, neither learning.
      if (day >= 2) {
        const today = health(day)?.ads.find((x) => x.variantId === ad.variantId);
        const before = health(day - 1)?.ads.find((x) => x.variantId === ad.variantId);
        if (today && before && !today.learning && !before.learning && !today.meets && !before.meets) {
          raise({
            kind: "below_threshold",
            variantId: ad.variantId,
            day,
            facts: {
              measure: input.threshold.measure,
              threshold: input.threshold.value,
              thresholdShown: formatThreshold(input.threshold.measure, input.threshold.value),
              previous: windowOf(before.kpi),
              current: windowOf(today.kpi),
            },
          });
        }
      }

      // Tiring: the window ending today against the best counted window so far.
      const mine = windows.get(ad.variantId)!;
      const current = mine.get(day);
      if (current && current.value !== null) {
        let best: KpiWindow | null = null;
        for (let end = 3; end <= day; end++) {
          const w = mine.get(end);
          if (w && w.value !== null && (best === null || w.value > (best.value as number))) best = w;
        }
        const bestValue = best?.value ?? 0;
        if (best && bestValue > 0) {
          const drop = (bestValue - current.value) / bestValue;
          if (drop >= TIRING_DROP - 1e-9) {
            raise({ kind: "tiring", variantId: ad.variantId, day, facts: { current, best, dropPercent: drop * 100 } });
          }
        }
      }

      // Not compliant: today's compliance, dated the day the step reaches.
      if (day === toDay && !ad.compliance.compliant) {
        raise({ kind: "not_compliant", variantId: ad.variantId, day, facts: { reason: ad.compliance.reason ?? "It no longer passes compliance." } });
      }
    }
  }
  return out;
}

/** One alert in a line, with its figures. */
export function alertLine(alert: Alert, adNumber: number): string {
  switch (alert.kind) {
    case "tiring": {
      const { current, best, dropPercent } = alert.facts;
      return `Ad ${adNumber} is tiring: its click-through rate over simulated days ${current.from} to ${current.to} is ${current.shown}, ${Math.round(dropPercent)}% below its best of ${best.shown} over days ${best.from} to ${best.to}.`;
    }
    case "below_threshold": {
      const { measure, threshold, previous, current } = alert.facts;
      return `Ad ${adNumber} has missed its threshold two simulated days in a row: ${MEASURE_NAMES[measure]} ${previous.shown} over days ${previous.from} to ${previous.to}, then ${current.shown} over days ${current.from} to ${current.to}, against ${thresholdPhrase(measure, threshold)}.`;
    }
    case "not_compliant":
      return `Ad ${adNumber} no longer passes compliance: ${alert.facts.reason}`;
  }
}
