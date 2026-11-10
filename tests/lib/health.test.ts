// P9-3 The healthy spend share, as pure code (src/lib/performance/health.ts):
// no database, no model, no clock. Test cases 1 (health.ts matches figures
// worked out by hand for three chosen days of a small fixed set of rows), 2
// (one ad below its threshold: the share drops by exactly that ad's share of
// the day's spend), 3 (an ad that is no longer compliant leaves the healthy
// share, whatever its KPI), 4 (all spend learning: "Not enough data yet"), 6
// (the home line and the chart say "Simulated") and 7 (the chart has a text
// alternative: a table with a row per day). The data layer, compliance worked
// out again today, the home line's count and another workspace are
// tests/db/performance.test.ts; the page is tests/e2e/performance.spec.ts.
//
// The interface these tests expect is written at the top of
// tests/db/performance.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerformanceChart, PerformanceTable } from "@/app/(app)/campaigns/[id]/performance/chart";
import {
  dayHealth,
  HEALTHY_DEFINITION,
  healthSeries,
  homeLine,
  KPI_WINDOW_DAYS,
  LEARNING,
  NOT_ENOUGH_DATA,
  shareText,
  STATUS_NAMES,
  type AdHealth,
  type DayHealth,
  type HealthInput,
} from "@/lib/performance/health";
import type { SimRow } from "@/lib/performance/simulate";

// ---------------------------------------------------------------- the fixed rows
//
// Three ads, X, Y and Z, on a £30-a-day launch (£10 each), from Thursday 26
// November 2026, so day 2 is Black Friday, days 3 and 4 a weekend and day 5
// Cyber Monday. Z is cheap to show (few impressions), so it is still learning
// on day 3 by impressions (1,600 to date, under 2,000) though past its first
// two days.
//
//   day  date        events         X: imp clk conv rev   Y: imp clk conv rev    Z: imp clk conv rev
//   1    2026-11-26  -              2500  30  1  4000      2400  36  1   5000     500   6  0     0
//   2    2026-11-27  Black Friday   2500  30  0     0      2400  36  2  10000     500   6  1  3000
//   3    2026-11-28  Weekend        2500  28  1  4000      2400  35  1   5000     600   7  0     0
//   4    2026-11-29  Weekend        2500  25  0     0      2400  34  2  10000     500   6  1  3000
//   5    2026-11-30  Cyber Monday   2500  20  0     0      2400  33  1   5000     500   5  0     0
//
// Every row spends 1000p (£10.00). The threshold is cost per acquisition at or
// below £20 (simulated). The KPI is over the ad's last three simulated days,
// as a ratio of sums: CPA = spend in pounds / conversions.

const X = "11111111-1111-4111-8111-111111111111";
const Y = "22222222-2222-4222-8222-222222222222";
const Z = "33333333-3333-4333-8333-333333333333";

const DATES = ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"];
const EVENTS = [[], ["Black Friday"], ["Weekend"], ["Weekend"], ["Cyber Monday"]];

/** [impressions, clicks, conversions, revenue pence] per day, days 1 to 5. */
const FIGURES: Record<string, [number, number, number, number][]> = {
  [X]: [
    [2500, 30, 1, 4000],
    [2500, 30, 0, 0],
    [2500, 28, 1, 4000],
    [2500, 25, 0, 0],
    [2500, 20, 0, 0],
  ],
  [Y]: [
    [2400, 36, 1, 5000],
    [2400, 36, 2, 10000],
    [2400, 35, 1, 5000],
    [2400, 34, 2, 10000],
    [2400, 33, 1, 5000],
  ],
  [Z]: [
    [500, 6, 0, 0],
    [500, 6, 1, 3000],
    [600, 7, 0, 0],
    [500, 6, 1, 3000],
    [500, 5, 0, 0],
  ],
};

const ROWS: SimRow[] = Object.entries(FIGURES).flatMap(([variantId, days]) =>
  days.map(([impressions, clicks, conversions, revenuePence], i) => ({
    variantId,
    day: i + 1,
    date: DATES[i],
    impressions,
    clicks,
    conversions,
    spendPence: 1000,
    revenuePence,
    events: EVENTS[i],
  })),
);

const compliant = { compliant: true, reason: null };
const REASON = "Fails: banned term 'Made for the long way round' in English.";

/** The fixed launch: every ad compliant, CPA at or below £20, unless a test says otherwise. */
function input(over: Partial<HealthInput> = {}, notCompliant: string[] = []): HealthInput {
  return {
    threshold: { measure: "cpa", value: 20 },
    ads: [X, Y, Z].map((variantId) => ({ variantId, compliance: notCompliant.includes(variantId) ? { compliant: false, reason: REASON } : compliant })),
    // Shuffled, with a row of an ad that isn't in the launch: order doesn't matter, and that row is ignored.
    rows: [...ROWS].reverse().concat([{ ...ROWS[0], variantId: "44444444-4444-4444-8444-444444444444", spendPence: 99_999 }]),
    ...over,
  };
}

const adOf = (d: DayHealth | null, id: string): AdHealth => {
  const a = d?.ads.find((x) => x.variantId === id);
  if (!a) throw new Error(`No ad ${id} on day ${d?.day}`);
  return a;
};

/** One ad's figures for a day, as worked out by hand. */
function expectAd(d: DayHealth | null, id: string, want: { spend: number; toDate: number; impressionsToDate: number; kpi: number; shown: string; from: number; meets: boolean; learning: boolean; status: AdHealth["status"] }) {
  const a = adOf(d, id);
  const what = `${id.slice(0, 1) === "1" ? "X" : id.slice(0, 1) === "2" ? "Y" : "Z"} on day ${d!.day}`;
  expect(a.spendPence, what).toBe(want.spend);
  expect(a.spendToDatePence, what).toBe(want.toDate);
  expect(a.impressionsToDate, what).toBe(want.impressionsToDate);
  expect(a.kpi.measure, what).toBe("cpa");
  if (Number.isFinite(want.kpi)) expect(a.kpi.value, what).toBeCloseTo(want.kpi, 10);
  else expect(a.kpi.value, what).toBe(Number.POSITIVE_INFINITY);
  expect(a.kpi.shown, what).toBe(want.shown);
  expect([a.kpi.from, a.kpi.to], what).toEqual([want.from, d!.day]);
  expect(a.meets, what).toBe(want.meets);
  expect(a.learning, what).toBe(want.learning);
  expect(a.compliant, what).toBe(true);
  expect(a.reason, what).toBeNull();
  expect(a.status, what).toBe(want.status);
}

describe("P9-3 the healthy spend share, worked out by hand", () => {
  it("#1 the rules: learning is the first two days or 2,000 impressions, the KPI is over the last three days, and the definition is one line", () => {
    expect(LEARNING).toEqual({ days: 2, impressions: 2000 });
    expect(KPI_WINDOW_DAYS).toBe(3);
    expect(STATUS_NAMES).toEqual({ healthy: "Healthy", below_threshold: "Below threshold", not_compliant: "Not compliant", learning: "Learning" });
    expect(NOT_ENOUGH_DATA).toBe("Not enough data yet");
    expect(HEALTHY_DEFINITION).toBe(
      "Healthy spend is simulated spend on ads that still pass compliance and whose KPI over their last three simulated days meets the launch's threshold; learning spend (an ad's first two days or first 2,000 impressions) is left out of the share.",
    );
    // One line: no line breaks, and nothing that reads like a platform's own metric.
    expect(HEALTHY_DEFINITION).not.toMatch(/\n|\u2014/);
    expect(shareText(null)).toBe(NOT_ENOUGH_DATA);
    expect(shareText(1)).toBe("100%");
    expect(shareText(2 / 3)).toBe("67%");
    expect(shareText(0)).toBe("0%");
  });

  it("#1 #4 day 2: every ad is in its first two days, so all £30.00 is learning and the share reads Not enough data yet", () => {
    const d = dayHealth(input(), 2);
    expect(d).not.toBeNull();
    expect(d!).toMatchObject({ day: 2, date: "2026-11-27", events: ["Black Friday"], healthyPence: 0, learningPence: 3000, totalPence: 3000, share: null, shareShown: NOT_ENOUGH_DATA });
    expect(d!.ads.map((a) => a.variantId)).toEqual([X, Y, Z]);
    // Days 1 and 2 (the window is shorter than three days at the start).
    // X: £20.00 / 1 conversion = £20.00, at the threshold (meets), but learning.
    expectAd(d, X, { spend: 1000, toDate: 2000, impressionsToDate: 5000, kpi: 20, shown: "£20.00", from: 1, meets: true, learning: true, status: "learning" });
    // Y: £20.00 / 3 = £6.67.
    expectAd(d, Y, { spend: 1000, toDate: 2000, impressionsToDate: 4800, kpi: 20 / 3, shown: "£6.67", from: 1, meets: true, learning: true, status: "learning" });
    // Z: £20.00 / 1 = £20.00.
    expectAd(d, Z, { spend: 1000, toDate: 2000, impressionsToDate: 1000, kpi: 20, shown: "£20.00", from: 1, meets: true, learning: true, status: "learning" });
  });

  it("#1 day 3: X and Y are healthy; Z is past its first two days but under 2,000 impressions, so still learning: 100%, with Z's £10.00 left out of both sides", () => {
    const d = dayHealth(input(), 3);
    expect(d!).toMatchObject({ day: 3, date: "2026-11-28", events: ["Weekend"], healthyPence: 2000, learningPence: 1000, totalPence: 3000, shareShown: "100%" });
    // 2000 / (3000 - 1000).
    expect(d!.share).toBe(1);
    // Days 1 to 3. X: £30.00 / 2 = £15.00. Y: £30.00 / 4 = £7.50. Z: £30.00 / 1 = £30.00, with 500 + 500 + 600 = 1,600 impressions.
    expectAd(d, X, { spend: 1000, toDate: 3000, impressionsToDate: 7500, kpi: 15, shown: "£15.00", from: 1, meets: true, learning: false, status: "healthy" });
    expectAd(d, Y, { spend: 1000, toDate: 3000, impressionsToDate: 7200, kpi: 7.5, shown: "£7.50", from: 1, meets: true, learning: false, status: "healthy" });
    // Learning comes before Below threshold: Z's £30.00 misses the threshold, but it is still learning.
    expectAd(d, Z, { spend: 1000, toDate: 3000, impressionsToDate: 1600, kpi: 30, shown: "£30.00", from: 1, meets: false, learning: true, status: "learning" });
  });

  it("#1 #2 day 4: X is below its threshold, so the share is 67%: £20.00 healthy of £30.00", () => {
    const d = dayHealth(input(), 4);
    expect(d!).toMatchObject({ day: 4, date: "2026-11-29", events: ["Weekend"], healthyPence: 2000, learningPence: 0, totalPence: 3000, shareShown: "67%" });
    expect(d!.share).toBeCloseTo(2 / 3, 12);
    // Days 2 to 4. X: £30.00 / (0 + 1 + 0) = £30.00, over £20. Y: £30.00 / (2 + 1 + 2) = £6.00. Z: £30.00 / (1 + 0 + 1) = £15.00, now with 2,100 impressions.
    expectAd(d, X, { spend: 1000, toDate: 4000, impressionsToDate: 10_000, kpi: 30, shown: "£30.00", from: 2, meets: false, learning: false, status: "below_threshold" });
    expectAd(d, Y, { spend: 1000, toDate: 4000, impressionsToDate: 9600, kpi: 6, shown: "£6.00", from: 2, meets: true, learning: false, status: "healthy" });
    expectAd(d, Z, { spend: 1000, toDate: 4000, impressionsToDate: 2100, kpi: 15, shown: "£15.00", from: 2, meets: true, learning: false, status: "healthy" });
  });

  it("#1 the other three measures over the same window, as ratios of sums, each with its threshold direction", () => {
    const at = (measure: "ctr" | "conversion_rate" | "roas", value: number) => dayHealth(input({ threshold: { measure, value } }), 4)!;
    // Click-through rate, days 2 to 4: X 83 / 7,500 = 1.11%; Y 105 / 7,200 = 1.46%; Z 19 / 1,600 = 1.19%. At or above 1.2%: only Y.
    const ctr = at("ctr", 1.2);
    expect(ctr.ads.map((a) => [a.kpi.shown, a.status])).toEqual([
      ["1.11%", "below_threshold"],
      ["1.46%", "healthy"],
      ["1.19%", "below_threshold"],
    ]);
    expect(adOf(ctr, X).kpi.value).toBeCloseTo((83 / 7500) * 100, 10);
    expect(ctr.share).toBeCloseTo(1 / 3, 12);
    // Conversion rate: X 1 / 83 = 1.20%; Y 5 / 105 = 4.76%; Z 2 / 19 = 10.53%. At or above 2%: Y and Z.
    const conversion = at("conversion_rate", 2);
    expect(conversion.ads.map((a) => [a.kpi.shown, a.status])).toEqual([
      ["1.20%", "below_threshold"],
      ["4.76%", "healthy"],
      ["10.53%", "healthy"],
    ]);
    expect(conversion.share).toBeCloseTo(2 / 3, 12);
    // Return on ad spend: X £40 / £30 = 1.33; Y £250 / £30 = 8.33; Z £60 / £30 = 2.00. At or above 2: Y, and Z exactly at it.
    const roas = at("roas", 2);
    expect(roas.ads.map((a) => [a.kpi.shown, a.status])).toEqual([
      ["1.33×", "below_threshold"],
      ["8.33×", "healthy"],
      ["2.00×", "healthy"],
    ]);
    expect(adOf(roas, Z).meets).toBe(true);
    expect(roas.share).toBeCloseTo(2 / 3, 12);
  });

  it("#1 no conversions is infinitely bad for cost per acquisition, shown as No conversions; no clicks shows as No clicks", () => {
    // Day 1: Z has no conversions yet: still learning, so not below.
    const day1 = dayHealth(input(), 1)!;
    expect(adOf(day1, Z)).toMatchObject({ kpi: { value: Number.POSITIVE_INFINITY, shown: "No conversions" }, meets: false, learning: true, status: "learning" });
    // W: three days of clicks and no conversions, past learning: Below threshold, whatever the threshold.
    const W = "55555555-5555-4555-8555-555555555555";
    const rows: SimRow[] = [1, 2, 3].map((day) => ({ variantId: W, day, date: DATES[day - 1], impressions: 3000, clicks: 30, conversions: 0, spendPence: 1000, revenuePence: 0, events: EVENTS[day - 1] }));
    const w = dayHealth({ threshold: { measure: "cpa", value: 500 }, ads: [{ variantId: W, compliance: compliant }], rows }, 3)!;
    expect(adOf(w, W)).toMatchObject({ kpi: { value: Number.POSITIVE_INFINITY, shown: "No conversions" }, meets: false, learning: false, status: "below_threshold" });
    expect(w).toMatchObject({ healthyPence: 0, learningPence: 0, totalPence: 1000, share: 0, shareShown: "0%" });
    // V: no clicks at all: its conversion rate can't be worked out, and doesn't meet any threshold.
    const V = "66666666-6666-4666-8666-666666666666";
    const none = rows.map((r) => ({ ...r, variantId: V, clicks: 0 }));
    const v = dayHealth({ threshold: { measure: "conversion_rate", value: 0.1 }, ads: [{ variantId: V, compliance: compliant }], rows: none }, 3)!;
    expect(adOf(v, V)).toMatchObject({ kpi: { value: 0, shown: "No clicks" }, meets: false, status: "below_threshold" });
  });

  it("#1 the series: one day each, with the trend of the share and the events, and rows after the day are ignored", () => {
    const series = healthSeries(input(), 5);
    expect(series.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
    expect(series.map((d) => d.events)).toEqual(EVENTS);
    // Day 5, days 3 to 5: X £30 / 1 = £30 (below); Y £30 / 4 = £7.50; Z £30 / 1 = £30 (below): £10.00 of £30.00.
    const shares = series.map((d) => d.share);
    expect(shares[0]).toBeNull();
    expect(shares[1]).toBeNull();
    expect(shares[2]).toBe(1);
    expect(shares[3]).toBeCloseTo(2 / 3, 12);
    expect(shares[4]).toBeCloseTo(1 / 3, 12);
    expect(series.map((d) => d.shareShown)).toEqual([NOT_ENOUGH_DATA, NOT_ENOUGH_DATA, "100%", "67%", "33%"]);
    // Each day of the series is that day's health.
    for (const d of series) expect(d, `day ${d.day}`).toEqual(dayHealth(input(), d.day));
    // A shorter series stops at its day; the later rows don't change the earlier days.
    expect(healthSeries(input(), 3)).toEqual(series.slice(0, 3));
    expect(dayHealth(input({ rows: ROWS.filter((r) => r.day <= 4) }), 4)).toEqual(dayHealth(input(), 4));
    // A day with no rows has no health.
    expect(dayHealth(input(), 6)).toBeNull();
    expect(dayHealth(input(), 0)).toBeNull();
    expect(healthSeries(input(), 0)).toEqual([]);
  });
});

describe("P9-3 one ad below its threshold, and an ad no longer compliant", () => {
  it("#2 one ad below its threshold: its status is Below threshold, and the share drops by exactly that ad's share of the day's spend", () => {
    // Day 4 at CPA <= £30: X's £30.00 is at the threshold, so every ad is healthy.
    const loose = dayHealth(input({ threshold: { measure: "cpa", value: 30 } }), 4)!;
    expect(loose.ads.map((a) => a.status)).toEqual(["healthy", "healthy", "healthy"]);
    expect(loose.share).toBe(1);
    // At CPA <= £20, X alone is below: the share drops by X's £10.00 of the day's £30.00 (none of it learning).
    const strict = dayHealth(input(), 4)!;
    expect(strict.ads.map((a) => a.status)).toEqual(["below_threshold", "healthy", "healthy"]);
    const x = adOf(strict, X);
    expect(loose.share! - strict.share!).toBeCloseTo(x.spendPence / (strict.totalPence - strict.learningPence), 12);
    expect(loose.healthyPence - strict.healthyPence).toBe(x.spendPence);
    expect([strict.totalPence, strict.learningPence]).toEqual([loose.totalPence, loose.learningPence]);
  });

  it("#3 an ad that no longer passes compliance is Not compliant, its spend leaves the healthy share but stays in the day's spend, and the reason is kept", () => {
    // Day 4 with Y not compliant: Y would be healthy, so £10.00 leaves the healthy side only: £10.00 of £30.00.
    const d = dayHealth(input({}, [Y]), 4)!;
    expect(adOf(d, Y)).toMatchObject({ compliant: false, reason: REASON, meets: true, learning: false, status: "not_compliant" });
    expect(d).toMatchObject({ healthyPence: 1000, learningPence: 0, totalPence: 3000, shareShown: "33%" });
    expect(d.share).toBeCloseTo(1 / 3, 12);
    // Compliant again (the term removed): back to the figures worked out by hand.
    expect(dayHealth(input(), 4)!.share).toBeCloseTo(2 / 3, 12);
  });

  it("#3 Not compliant comes before Learning: a learning ad that isn't compliant counts as unhealthy spend, not learning", () => {
    // Day 3 with Z not compliant: Z's £10.00 is no longer left out, so the share is £20.00 of £30.00.
    const d3 = dayHealth(input({}, [Z]), 3)!;
    expect(adOf(d3, Z)).toMatchObject({ learning: true, compliant: false, status: "not_compliant" });
    expect(d3).toMatchObject({ healthyPence: 2000, learningPence: 0, totalPence: 3000, shareShown: "67%" });
    // Day 2, the others learning: the share can be worked out (0%), so it isn't Not enough data yet.
    const d2 = dayHealth(input({}, [Z]), 2)!;
    expect(d2).toMatchObject({ healthyPence: 0, learningPence: 2000, totalPence: 3000, share: 0, shareShown: "0%" });
  });

  it("#4 when all spend is learning, the share is null and reads Not enough data yet, with the learning spend still counted", () => {
    const d1 = dayHealth(input(), 1)!;
    expect(d1).toMatchObject({ day: 1, healthyPence: 0, learningPence: 3000, totalPence: 3000, share: null, shareShown: NOT_ENOUGH_DATA });
    expect(d1.ads.every((a) => a.status === "learning")).toBe(true);
  });
});

describe("P9-3 labelled simulated, with a text alternative", () => {
  it("#6 the home line counts live campaigns and says simulated", () => {
    expect(homeLine(2, 0.84)).toBe("Healthy spend share across 2 live campaigns: 84% (simulated)");
    expect(homeLine(1, 1)).toBe("Healthy spend share across 1 live campaign: 100% (simulated)");
    expect(homeLine(3, null)).toBe("Healthy spend share across 3 live campaigns: Not enough data yet (simulated)");
  });

  it("#7 the chart is an SVG labelled Simulated, with the events marked and a table version of every day for screen readers", () => {
    const series = healthSeries(input(), 5);
    const ads = [
      { variantId: X, adNumber: 1, headline: "Made for the long way round" },
      { variantId: Y, adNumber: 2, headline: "Kit for the long way round" },
      { variantId: Z, adNumber: 3, headline: "Walk further this autumn" },
    ];
    // U10-4: the chart and its table are two tabs on the page, rendered side by side here.
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(PerformanceChart, { series, ads, threshold: { measure: "cpa", value: 20 }, days: 30 }),
        createElement(PerformanceTable, { series, ads, measure: "cpa" }),
      ),
    );
    // The chart: an image with a title that says simulated, and "Simulated" drawn on it.
    const svg = /<svg[^>]*data-perf-chart[^>]*>[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
    expect(svg).toMatch(/role="img"/);
    expect(/<title[^>]*>([^<]*)<\/title>/.exec(svg)?.[1]).toMatch(/simulated/i);
    expect(svg).toMatch(/<text[^>]*>[^<]*Simulated[^<]*<\/text>/);
    // Each day with an event is marked, with its names: Black Friday, the weekend and Cyber Monday.
    const marks = [...svg.matchAll(/data-perf-event="([^"]+)"[^>]*data-events="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(marks).toEqual([
      ["2026-11-27", "Black Friday"],
      ["2026-11-28", "Weekend"],
      ["2026-11-29", "Weekend"],
      ["2026-11-30", "Cyber Monday"],
    ]);
    // The text alternative: a table with a simulated caption, a row per day, each ad's spend and KPI, the share and the events.
    const table = /<table[^>]*data-perf-chart-table[^>]*>[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";
    expect(/<caption[^>]*>([\s\S]*?)<\/caption>/.exec(table)?.[1]).toMatch(/\(simulated\)/);
    const rows = [...table.matchAll(/<tr[^>]*data-perf-chart-row="(\d+)"[\s\S]*?<\/tr>/g)];
    expect(rows.map((r) => Number(r[1]))).toEqual([1, 2, 3, 4, 5]);
    const day4 = rows[3][0];
    for (const [id, kpi] of [
      [X, "£30.00"],
      [Y, "£6.00"],
      [Z, "£15.00"],
    ]) {
      expect(day4).toMatch(new RegExp(`data-perf-cell-spend="${id}"[^>]*>£10\\.00<`));
      expect(day4).toMatch(new RegExp(`data-perf-cell-kpi="${id}"[^>]*>${kpi.replace(/[.$]/g, "\\$&")}<`));
    }
    expect(day4).toMatch(/data-perf-cell-share=""[^>]*>67%</);
    expect(day4).toMatch(/data-perf-cell-events=""[^>]*>Weekend</);
    // The chart points at its table for screen readers.
    const described = /aria-describedby="([^"]+)"/.exec(svg)?.[1];
    expect(described).toBeTruthy();
    expect(table).toContain(`id="${described}"`);
  });
});

describe("P9-3 health.ts is pure", () => {
  it("#1 health.ts reads no database, model or clock: the page, the home line and the monitor all get the same answer from the same facts", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/performance/health.ts"), "utf8");
    expect(src).not.toMatch(/@\/lib\/db|@\/lib\/models|runModelStep|\bgenerate(Image)?\(|Math\.random|Date\.now|new Date\(\)/);
    // The same input always gives the same answer.
    expect(dayHealth(input(), 4)).toEqual(dayHealth(input(), 4));
  });
});
