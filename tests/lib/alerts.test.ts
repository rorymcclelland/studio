// P9-4 The monitor's alerts, as pure code (src/lib/performance/alerts.ts): no
// database, no model, no clock. Test cases 1 (the demo launch's tiring ad is
// alerted on the first day its three-day click-through rate is 25% or more
// below its best, not earlier, with both figures; only windows after learning
// count), 2 (Below threshold needs two days in a row after learning: a single
// bad day, or a bad learning day, raises nothing) and 3 (an alert is raised
// once per ad and kind in a launch, even when its condition clears and
// returns; another kind for the same ad is raised separately). The clock
// writing them, Mark as seen and the home count are tests/flows/monitor.test.ts;
// the page is tests/e2e/monitor.spec.ts.
//
// The interface these tests expect is written at the top of
// tests/flows/monitor.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALERT_KINDS, ALERT_NAMES, alertLine, alertsFor, alertsLine, NO_ALERTS, TIRING_DROP, type Alert, type AlertInput } from "@/lib/performance/alerts";
import { dayHealth } from "@/lib/performance/health";
import type { SimRow } from "@/lib/performance/simulate";
import { DEMO_IDS, DEMO_TIRING, demoRows, isLearning, percentShown, referenceBelow, referenceTiring } from "../helpers/monitor";

const compliant = { compliant: true, reason: null };

/** Rows for one ad: 2,500 impressions and £10 a day unless given, with the day's clicks. */
function rowsOf(variantId: string, clicks: number[], impressions: number | number[] = 2500, conversions = 1): SimRow[] {
  return clicks.map((c, i) => ({
    variantId,
    day: i + 1,
    date: `2026-11-${String(i + 1).padStart(2, "0")}`,
    impressions: Array.isArray(impressions) ? impressions[i] : impressions,
    clicks: c,
    conversions: Math.min(conversions, c),
    spendPence: 1000,
    revenuePence: 4000,
    events: [],
  }));
}

function input(rows: SimRow[], ids: string[], over: Partial<AlertInput> = {}): AlertInput {
  return { threshold: { measure: "ctr", value: 0.01 }, ads: ids.map((variantId) => ({ variantId, compliance: compliant })), rows, raised: [], ...over };
}

/** Works a launch out a day at a time, as the clock does after each simulated day, carrying what was raised. */
function dayByDay(base: AlertInput, through: number): Alert[] {
  const all: Alert[] = [];
  for (let day = 1; day <= through; day++) {
    const raised = all.map((a) => ({ variantId: a.variantId, kind: a.kind }));
    all.push(...alertsFor({ ...base, rows: base.rows.filter((r) => r.day <= day), raised }, day, day));
  }
  return all;
}

const T = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const L = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------- the tiring fixture
//
// Ad T shows 2,500 impressions a day, so each three-day window has 7,500 and
// its click-through rate is clicks ÷ 75 per cent. Days 1 and 2 are learning,
// with far more clicks than later: if learning windows counted, days 1 to 3
// (151 clicks, 2.01%) would be the best and the ad would be alerted on day 5.
// They don't, so the first window judged is days 3 to 5.
//
//   window   clicks   CTR      below the best (days 3 to 5, 92 clicks, 1.23%)
//   3-5      92       1.23%    0%
//   4-6      89       1.19%    3.3%
//   5-7      84       1.12%    8.7%
//   6-8      78       1.04%    15.2%
//   7-9      72       0.96%    21.7%
//   8-10     69       0.92%    25.0%   <- Tiring, day 10: exactly 25% counts
//   9-11     69       0.92%    25.0%   (already raised)
//   10-12    67       0.89%    27.2%
//   13-15    120      1.60%    the new best: the condition clears
//   16-18    75       1.00%    37.5% below the new best: it holds again, but is not raised again
const TIRING_CLICKS = [60, 60, 31, 31, 30, 28, 26, 24, 22, 23, 24, 20, 40, 40, 40, 25, 25, 25];

// ---------------------------------------------------------------- the below-threshold fixture
//
// Threshold: click-through rate at or above 1.00% (a window meets it with 75
// clicks or more out of 7,500). Ad B has 2,500 impressions a day; ad L only
// 500, so it learns until day 4 (2,000 impressions to date) though past its
// first two days on day 3.
//
//   B: day  window  clicks  CTR     meets   learning
//      2    1-2     40      0.80%   no      yes (day 2)
//      3    1-3     70      0.93%   no      no      one miss after a learning miss: nothing
//      4    2-4     80      1.07%   yes
//      5    3-5     90      1.20%   yes
//      6    4-6     70      0.93%   no              a single bad day: nothing
//      7    5-7     80      1.07%   yes
//      8-10         90-100  yes
//      11   9-11    70      0.93%   no
//      12   10-12   65      0.87%   no              <- Below threshold, day 12
//      13   11-13   60      0.80%   no              (already raised)
//   L: 2 clicks a day on 500 impressions (0.40%): misses every day; learning
//      on days 1 to 3, so its alert is day 5 (days 4 and 5), not day 4.
const BELOW_CLICKS = [20, 20, 30, 30, 30, 10, 40, 40, 20, 20, 30, 15, 15];

describe("P9-4 the tiring alert", () => {
  it("#1 the demo launch: the tiring ad's alert is on the first day its three-day click-through rate is 25% below its best, not earlier, with both figures", () => {
    const rows = demoRows(30);
    const base = input(rows, [...DEMO_IDS]);
    // The independent reading agrees with the day the demo is built around.
    const due = referenceTiring(rows, DEMO_TIRING.variantId, 30)!;
    expect(due).toMatchObject({ day: DEMO_TIRING.day, current: DEMO_TIRING.current, best: DEMO_TIRING.best });

    // Day by day, as the clock runs: nothing until day 9, then exactly one Tiring alert for ad 1.
    const before = alertsFor({ ...base, rows: rows.filter((r) => r.day <= DEMO_TIRING.day - 1) }, 1, DEMO_TIRING.day - 1);
    expect(before.filter((a) => a.kind === "tiring")).toEqual([]);
    const all = dayByDay(base, 30);
    const tiring = all.filter((a) => a.kind === "tiring");
    expect(tiring.map((a) => [a.variantId, a.day])).toEqual([[DEMO_TIRING.variantId, DEMO_TIRING.day]]);

    // The facts: the current and the best three-day rate, each with its days, as figures and as shown.
    const alert = tiring[0] as Extract<Alert, { kind: "tiring" }>;
    expect(alert.facts.current).toEqual({ from: 7, to: 9, value: expect.closeTo(due.current.ctr, 9), shown: percentShown(due.current.ctr) });
    expect(alert.facts.best).toEqual({ from: 3, to: 5, value: expect.closeTo(due.best.ctr, 9), shown: percentShown(due.best.ctr) });
    expect(alert.facts.current.shown).toBe("0.65%");
    expect(alert.facts.best.shown).toBe("0.90%");
    expect(alert.facts.dropPercent).toBeCloseTo(due.dropPercent, 6);
    expect(alert.facts.dropPercent).toBeGreaterThanOrEqual(TIRING_DROP * 100);
    expect(alertLine(alert, 1)).toBe("Ad 1 is tiring: its click-through rate over simulated days 7 to 9 is 0.65%, 27% below its best of 0.90% over days 3 to 5.");
  });

  it("#1 exactly 25% below the best counts, 21.7% doesn't, and only windows after learning are judged", () => {
    const base = input(rowsOf(T, TIRING_CLICKS), [T]);
    const all = dayByDay(base, 18);
    expect(all).toEqual([
      {
        kind: "tiring",
        variantId: T,
        day: 10,
        facts: {
          current: { from: 8, to: 10, value: expect.closeTo((69 / 7500) * 100, 9), shown: "0.92%" },
          best: { from: 3, to: 5, value: expect.closeTo((92 / 7500) * 100, 9), shown: "1.23%" },
          dropPercent: expect.closeTo(25, 9),
        },
      },
    ]);
    expect(alertLine(all[0], 3)).toBe("Ad 3 is tiring: its click-through rate over simulated days 8 to 10 is 0.92%, 25% below its best of 1.23% over days 3 to 5.");
    // Days 1 to 3 hold the highest rate of all, but day 3 is the first day after learning, so days 3 to 5 are the first window judged:
    // nothing is raised on day 5, though days 3 to 5 are 39% below days 1 to 3.
    expect(alertsFor({ ...base, rows: base.rows.filter((r) => r.day <= 5) }, 1, 5)).toEqual([]);
    // The reading in the helper agrees.
    expect(referenceTiring(base.rows, T, 18)).toMatchObject({ day: 10 });
  });

  it("#1 an ad still learning by impressions after its first two days has no window judged until it has 2,000 impressions on the window's first day", () => {
    // 600 impressions a day: learning until day 4 (2,400 to date), so the first window is days 4 to 6; days 3 to 5 is never the best.
    const clicks = [6, 6, 30, 6, 6, 6, 4, 4, 4];
    const rows = rowsOf(L, clicks, 600);
    expect(isLearning(rows, L, 3)).toBe(true);
    expect(isLearning(rows, L, 4)).toBe(false);
    const all = dayByDay(input(rows, [L]), 9);
    // Days 4 to 6 (18 clicks, 1.00%) are the best; days 7 to 9 (12 clicks, 0.67%) are 33% below it: raised on day 9.
    // Had days 3 to 5 (42 clicks) counted, it would have been raised on day 6.
    expect(all.map((a) => [a.kind, a.day])).toEqual([["tiring", 9]]);
    expect(all[0].facts).toMatchObject({ best: { from: 4, to: 6, shown: "1.00%" }, current: { from: 7, to: 9, shown: "0.67%" } });
  });
});

describe("P9-4 the below-threshold alert", () => {
  const threshold = { measure: "ctr" as const, value: 1 };

  it("#2 Below threshold needs two days in a row after learning: a single bad day, or a bad learning day, raises no alert", () => {
    const rows = [...rowsOf(B, BELOW_CLICKS), ...rowsOf(L, Array(13).fill(2), 500)];
    const base = input(rows, [B, L], { threshold });
    // (B also tires on day 11, from days 7 to 9; that is the tiring alert's business, and is left out here.)
    const all = dayByDay(base, 13).filter((a) => a.kind === "below_threshold");
    expect(all.map((a) => [a.kind, a.variantId, a.day])).toEqual([
      ["below_threshold", L, 5],
      ["below_threshold", B, 12],
    ]);
    // Day 3 (one miss after a learning miss) and day 6 (a single bad day) raise nothing for B; day 4 nothing for L (day 3 was learning).
    const below = (day: number, from = day) => alertsFor({ ...base, rows: rows.filter((r) => r.day <= day) }, from, day).filter((a) => a.kind === "below_threshold");
    for (const day of [3, 6, 7]) expect(below(day).filter((a) => a.variantId === B), `day ${day}`).toEqual([]);
    expect(below(4, 1)).toEqual([]);
    // The facts: the two three-day windows that missed, with the threshold.
    const b = all.find((a) => a.variantId === B)! as Extract<Alert, { kind: "below_threshold" }>;
    expect(b.facts).toEqual({
      measure: "ctr",
      threshold: 1,
      thresholdShown: "1%",
      previous: { from: 9, to: 11, value: expect.closeTo((70 / 7500) * 100, 9), shown: "0.93%" },
      current: { from: 10, to: 12, value: expect.closeTo((65 / 7500) * 100, 9), shown: "0.87%" },
    });
    expect(alertLine(b, 2)).toBe(
      "Ad 2 has missed its threshold two simulated days in a row: Click-through rate 0.93% over days 9 to 11, then 0.87% over days 10 to 12, against Click-through rate at or above 1%.",
    );
    // The reading in the helper agrees, for both ads.
    expect(referenceBelow(rows, B, threshold, 13)).toBe(12);
    expect(referenceBelow(rows, L, threshold, 13)).toBe(5);
  });

  it("#2 the KPI is health.ts's: the same three-day windows and learning as the Performance view's statuses", () => {
    const rows = rowsOf(B, BELOW_CLICKS);
    const base = input(rows, [B], { threshold });
    for (let day = 1; day <= 13; day++) {
      const h = dayHealth(base, day)!.ads[0];
      const prev = day > 1 ? dayHealth(base, day - 1)!.ads[0] : null;
      const due = !!prev && !prev.learning && !prev.meets && !h.learning && !h.meets;
      // Each day worked out on its own, with nothing raised before: an alert exactly when health.ts says the day and the day before missed, after learning.
      const raised = alertsFor({ ...base, rows: rows.filter((r) => r.day <= day) }, day, day).some((a) => a.kind === "below_threshold");
      expect(raised, `day ${day}`).toBe(due);
    }
  });

  it("#2 cost per acquisition with no conversions never meets the threshold, and the alert's figures say so", () => {
    // £10 a day, one conversion on each of days 1 and 2 and none after: days 1 to 3 are £15.00 (meets £20), days 2 to 4
    // £30.00 (misses), days 3 to 5 have no conversions (misses): the alert is day 5.
    const cpa = { measure: "cpa" as const, value: 20 };
    const rows = rowsOf(B, Array(8).fill(25)).map((r) => ({ ...r, conversions: r.day <= 2 ? 1 : 0 }));
    const all = dayByDay(input(rows, [B], { threshold: cpa }), 8);
    expect(all.map((a) => [a.kind, a.day])).toEqual([["below_threshold", 5]]);
    expect(all[0].facts).toEqual({
      measure: "cpa",
      threshold: 20,
      thresholdShown: "£20",
      previous: { from: 2, to: 4, value: 30, shown: "£30.00" },
      // Facts are stored as JSON: a window that can't be judged has value null, never Infinity.
      current: { from: 3, to: 5, value: null, shown: "No conversions" },
    });
    expect(JSON.parse(JSON.stringify(all[0]))).toEqual(all[0]);
    expect(referenceBelow(rows, B, cpa, 8)).toBe(5);
    // With no conversions at all, days 3 and 4 both miss.
    const none = dayByDay(input(rows.map((r) => ({ ...r, conversions: 0 })), [B], { threshold: cpa }), 8);
    expect(none.map((a) => a.day)).toEqual([4]);
    expect(none[0].facts).toMatchObject({ previous: { value: null, shown: "No conversions" }, current: { value: null, shown: "No conversions" } });
  });
});

describe("P9-4 alerts are raised once", () => {
  it("#3 advancing past a day that already has an alert doesn't raise it again, even when the condition clears and returns", () => {
    const base = input(rowsOf(T, TIRING_CLICKS), [T]);
    // Day 10 raised it; days 11, 12 and 16 to 18 still hold the condition, and 13 to 15 clear it first.
    const raised = [{ variantId: T, kind: "tiring" as const }];
    for (const day of [11, 12, 16, 17, 18]) expect(alertsFor({ ...base, rows: base.rows.filter((r) => r.day <= day), raised }, day, day), `day ${day}`).toEqual([]);
    // Worked out in one go over days 1 to 18, it is raised once too, on its first day.
    expect(alertsFor(base, 1, 18).map((a) => [a.kind, a.day])).toEqual([["tiring", 10]]);
    // And a week at a time gives what day by day gives.
    const weekly: Alert[] = [];
    for (const [from, to] of [[1, 7], [8, 14], [15, 18]]) {
      weekly.push(...alertsFor({ ...base, rows: base.rows.filter((r) => r.day <= to), raised: weekly.map((a) => ({ variantId: a.variantId, kind: a.kind })) }, from, to));
    }
    expect(weekly).toEqual(dayByDay(base, 18));
  });

  it("#3 a new kind of alert for the same ad is raised separately, each once, in day, ad and kind order", () => {
    // Ad T against a click-through rate of at least 1.1%: days 5 to 7 meet it (1.12%), days 6 to 8 (1.04%) and 7 to 9 (0.96%)
    // miss, so Below threshold is day 9; Tiring is day 10. Ad B (3.60% every window) raises nothing; it is first in the launch.
    const rows = [...rowsOf(T, TIRING_CLICKS), ...rowsOf(B, Array(18).fill(90))];
    const base = input(rows, [B, T], { threshold: { measure: "ctr", value: 1.1 } });
    const all = alertsFor(base, 1, 18);
    expect(all.map((a) => [a.kind, a.variantId, a.day])).toEqual([
      ["below_threshold", T, 9],
      ["tiring", T, 10],
    ]);
    expect(referenceBelow(rows, T, { measure: "ctr", value: 1.1 }, 18)).toBe(9);
    // With Below threshold already raised for T, Tiring still comes; with both raised, nothing does.
    expect(alertsFor({ ...base, raised: [{ variantId: T, kind: "below_threshold" }] }, 1, 18).map((a) => a.kind)).toEqual(["tiring"]);
    expect(alertsFor({ ...base, raised: [{ variantId: T, kind: "below_threshold" }, { variantId: T, kind: "tiring" }] }, 1, 18)).toEqual([]);
    // Another ad's alert of the same kind is its own.
    expect(alertsFor({ ...base, raised: [{ variantId: B, kind: "tiring" }] }, 1, 18).map((a) => [a.kind, a.variantId])).toEqual([
      ["below_threshold", T],
      ["tiring", T],
    ]);
  });

  it("#3 Not compliant: an ad that no longer passes compliance is alerted on the step's last day, even while learning, once, with the reason", () => {
    const REASON = "Fails: banned term 'Made for the long way round' in English.";
    const rows = [...rowsOf(T, Array(9).fill(90)), ...rowsOf(B, Array(9).fill(90))];
    const base = input(rows, [T, B], { ads: [{ variantId: T, compliance: compliant }, { variantId: B, compliance: { compliant: false, reason: REASON } }] });
    // Compliance is worked out once per clock step (today's), so the alert is dated the day the step reaches.
    expect(alertsFor({ ...base, rows: rows.filter((r) => r.day <= 1) }, 1, 1)).toEqual([{ kind: "not_compliant", variantId: B, day: 1, facts: { reason: REASON } }]);
    expect(alertsFor({ ...base, rows: rows.filter((r) => r.day <= 7) }, 1, 7)).toEqual([{ kind: "not_compliant", variantId: B, day: 7, facts: { reason: REASON } }]);
    expect(alertsFor({ ...base, raised: [{ variantId: B, kind: "not_compliant" }] }, 8, 9)).toEqual([]);
    expect(alertLine({ kind: "not_compliant", variantId: B, day: 7, facts: { reason: REASON } }, 2)).toBe(`Ad 2 no longer passes compliance: ${REASON}`);
  });

  it("names, the empty state and the home line; and alerts.ts is pure: no database, model, clock or action", () => {
    expect(ALERT_KINDS).toEqual(["below_threshold", "tiring", "not_compliant"]);
    expect(ALERT_NAMES).toEqual({ below_threshold: "Below threshold", tiring: "Tiring", not_compliant: "Not compliant" });
    expect(TIRING_DROP).toBe(0.25);
    expect(NO_ALERTS).toBe("No alerts yet (simulated).");
    expect(alertsLine(1)).toBe("1 unseen alert on live campaigns (simulated)");
    expect(alertsLine(3)).toBe("3 unseen alerts on live campaigns (simulated)");
    const src = readFileSync(join(process.cwd(), "src/lib/performance/alerts.ts"), "utf8");
    expect(src).not.toMatch(/@\/lib\/(db|models|agents)|runModelStep|\bgenerate\(|Math\.random|Date\.now|new Date\(\)|asUser/);
    // Alerts never act (rule 3): nothing in it approves, launches, ends, swaps or moves budget.
    expect(src).not.toMatch(/approv|endLaunch|requestLaunch|update public|insert into/i);
  });
});
