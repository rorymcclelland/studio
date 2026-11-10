// U10-4 Performance: what needs action first, as pure code: recovery worked
// out from stored simulated days (recoveredOn in src/lib/performance/health.ts)
// and the page's ordering and words (src/lib/performance/attention.ts). No
// database, no model, no clock. Test cases 1 (what needs action now: the ads
// below the threshold today, then those tiring, each with the alert that
// flagged it), 2 (alerts newest first; a seen alert's one line), 3 (an alert's
// ad "Recovered on day N" once it has been at or above the threshold two days
// in a row, from the stored days alone) and 4 (the words after Mark all as
// seen). Mark all as seen against the database, one launch only and another
// workspace refused, is tests/flows/performance-attention.test.ts; the page is
// tests/e2e/performance-attention.spec.ts, whose header holds the interface.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alertsFor, ALERT_NAMES, type AlertKind } from "@/lib/performance/alerts";
import {
  alertOneLine,
  ALERTS_IN_FULL,
  alertsShown,
  ATTENTION_HEADING,
  MARK_ALL_LABEL,
  markedAllLine,
  needsAttention,
  newestFirst,
  NO_ATTENTION,
  recoveredLine,
  showAllAlertsLabel,
  type AlertRef,
} from "@/lib/performance/attention";
import { dayHealth, healthSeries, recoveredOn, type HealthInput } from "@/lib/performance/health";
import type { SimRow } from "@/lib/performance/simulate";
import { DEMO_ADS, demoRows, referenceRecovery, type Measure } from "../helpers/monitor";

// ---------------------------------------------------------------- the fixed rows
//
// Four ads on a click-through-rate threshold of 1% (at or above), ten
// simulated days from Monday 2 November 2026, every row £10.00. The KPI is the
// three-day click-through rate, as a ratio of sums.
//
// X: 2,500 impressions a day; clicks 30 30 30 20 20 20 30 40 40 40. Its
//    three-day rate is 1.20% on days 1 to 3, 1.07% on day 4, then 0.93%, 0.80%
//    and 0.93% on days 5 to 7 (misses), then 1.20%, 1.47% and 1.60%. Not
//    learning from day 3. So its Below threshold alert is day 6 (days 5 and 6
//    missed), and it recovers on day 9 (days 8 and 9 meet, both after day 6).
// Y: 2,500 impressions and 40 clicks a day: 1.60% every day, always meets.
// W: as Y (the tests give it a Tiring alert by hand).
// V: 300 impressions and 6 clicks a day (2%, meets), so it is learning until
//    its impressions to date reach 2,000 on day 7: its first day judged is 7.

const X = "11111111-1111-4111-8111-111111111111";
const Y = "22222222-2222-4222-8222-222222222222";
const W = "33333333-3333-4333-8333-333333333333";
const V = "44444444-4444-4444-8444-444444444444";

const CLICKS: Record<string, number[]> = {
  [X]: [30, 30, 30, 20, 20, 20, 30, 40, 40, 40],
  [Y]: Array(10).fill(40),
  [W]: Array(10).fill(40),
  [V]: Array(10).fill(6),
};
const IMPRESSIONS: Record<string, number> = { [X]: 2500, [Y]: 2500, [W]: 2500, [V]: 300 };

const ROWS: SimRow[] = Object.entries(CLICKS).flatMap(([variantId, clicks]) =>
  clicks.map((c, i) => ({
    variantId,
    day: i + 1,
    date: `2026-11-${String(i + 2).padStart(2, "0")}`,
    impressions: IMPRESSIONS[variantId],
    clicks: c,
    conversions: 1,
    spendPence: 1000,
    revenuePence: 4000,
    events: [],
  })),
);

const compliant = { compliant: true, reason: null };

function input(rows: SimRow[] = ROWS, notCompliant: string[] = []): HealthInput {
  return {
    threshold: { measure: "ctr", value: 1 },
    ads: [X, Y, W, V].map((variantId) => ({ variantId, compliance: notCompliant.includes(variantId) ? { compliant: false, reason: "Fails: banned term 'Dry' in English." } : compliant })),
    rows,
  };
}

const series = (through: number, rows: SimRow[] = ROWS) => healthSeries(input(rows), through);
const below = (variantId: string, day: number) => ({ variantId, kind: "below_threshold", day });

describe("U10-4 #3 recovered on day N, from the stored simulated days", () => {
  it("U10-4 #3 recovered on day N: the second of two days in a row at or above the threshold after the alert's day, not learning", () => {
    // The fixture's own alert, as the monitor raises it: X on day 6.
    const raised = alertsFor({ ...input(), raised: [] }, 1, 10).filter((a) => a.kind === "below_threshold");
    expect(raised.map((a) => [a.variantId, a.day])).toEqual([[X, 6]]);
    // Days 7 misses, 8 meets, 9 meets: recovered on day 9, the second of the two.
    expect(recoveredOn(series(10), below(X, 6))).toBe(9);
    expect(recoveredOn(series(9), below(X, 6))).toBe(9);
  });

  it("#3 not recovered: one good day, or days up to the latest only", () => {
    // Through day 8 X has met once since its alert: not yet.
    expect(recoveredOn(series(8), below(X, 6))).toBeNull();
    expect(recoveredOn(series(7), below(X, 6))).toBeNull();
    expect(recoveredOn(series(6), below(X, 6))).toBeNull();
    expect(recoveredOn([], below(X, 6))).toBeNull();
  });

  it("#3 the alert's own day and the days before it don't count, nor do learning days", () => {
    // Y meets every day: an alert dated day 4 recovers on day 6 (days 5 and 6), not day 5 (days 4 and 5).
    expect(recoveredOn(series(10), below(Y, 4))).toBe(6);
    // V meets from day 1 but is learning until day 7: its two days judged in a row are 7 and 8.
    expect(recoveredOn(series(10), below(V, 3))).toBe(8);
  });

  it("#3 a day the ad has no stored row breaks the two days in a row", () => {
    const missing = ROWS.filter((r) => !(r.variantId === X && r.day === 8));
    // Without X's day 8 its three-day rates are 1.40% on day 9 (days 7 and 9) and 1.60% on day 10: recovered on day 10.
    expect(recoveredOn(series(10, missing), below(X, 6))).toBe(10);
  });

  it("#3 only a Below threshold alert recovers: Tiring and Not compliant never say Recovered", () => {
    for (const kind of ["tiring", "not_compliant"] satisfies AlertKind[]) expect(recoveredOn(series(10), { variantId: Y, kind, day: 4 }), kind).toBeNull();
    // An ad that isn't in the series at all.
    expect(recoveredOn(series(10), below("55555555-5555-4555-8555-555555555555", 4))).toBeNull();
  });

  it("#3 worked out from stored days alone: on the demo launch's month, every Below threshold alert recovers on the day the independent reading says", () => {
    const rows = demoRows(30);
    let checked = 0;
    let recovered = 0;
    for (const value of [12, 16, 20, 25, 30]) {
      const threshold = { measure: "cpa" as Measure, value };
      const demo: HealthInput = { threshold, ads: DEMO_ADS.map((a) => ({ variantId: a.variantId, compliance: compliant })), rows };
      const all = healthSeries(demo, 30);
      for (const alert of alertsFor({ ...demo, raised: [] }, 1, 30).filter((a) => a.kind === "below_threshold")) {
        for (const through of [alert.day + 3, 14, 30]) {
          const want = referenceRecovery(rows, alert.variantId, threshold, alert.day, through);
          expect(recoveredOn(all.filter((d) => d.day <= through), alert), `£${value}, ${alert.variantId.slice(0, 2)} alerted on day ${alert.day}, through day ${through}`).toBe(want);
          checked++;
          if (want !== null) recovered++;
        }
      }
    }
    // The readings include alerts that recover and alerts that don't.
    expect(checked).toBeGreaterThan(5);
    expect(recovered).toBeGreaterThan(0);
    expect(recovered).toBeLessThan(checked);
  });

  it("#3 the words: Recovered on day N", () => {
    expect(recoveredLine(9)).toBe("Recovered on day 9");
    expect(recoveredLine(14)).toBe("Recovered on day 14");
  });
});

const ref = (id: string, variantId: string, kind: AlertKind, day: number): AlertRef => ({ id, variantId, kind, day });

describe("U10-4 #1 what needs action now", () => {
  it("U10-4 #1 what needs action now: ads below the threshold today, then ads with a Tiring alert, each with the alerts that flagged it", () => {
    // Day 6: X is below its threshold (its alert is today's); W has a Tiring alert; Y has a Not compliant alert but is
    // compliant again and healthy, so it isn't listed. The launch's order puts W first: below comes before tiring.
    const latest = dayHealth(input(), 6);
    const alerts = [ref("x-below", X, "below_threshold", 6), ref("w-tiring", W, "tiring", 5), ref("y-nc", Y, "not_compliant", 4)];
    expect(needsAttention([{ variantId: W }, { variantId: Y }, { variantId: X }], latest, alerts)).toEqual([
      { variantId: X, reasons: ["below_threshold"], alertIds: ["x-below"] },
      { variantId: W, reasons: ["tiring"], alertIds: ["w-tiring"] },
    ]);
  });

  it("#1 an ad both below and tiring is listed once, with both reasons and both alerts newest first", () => {
    const latest = dayHealth(input(), 6);
    const alerts = [ref("x-tiring", X, "tiring", 5), ref("x-below", X, "below_threshold", 6)];
    expect(needsAttention([{ variantId: X }, { variantId: Y }], latest, alerts)).toEqual([{ variantId: X, reasons: ["below_threshold", "tiring"], alertIds: ["x-below", "x-tiring"] }]);
  });

  it("#1 an ad below the threshold today with no alert yet (one day missed) is listed, with no alert", () => {
    // Day 5 is X's first missed day: below today, but not yet two days in a row.
    expect(needsAttention([{ variantId: X }, { variantId: Y }], dayHealth(input(), 5), [])).toEqual([{ variantId: X, reasons: ["below_threshold"], alertIds: [] }]);
  });

  it("#1 a Below threshold alert alone doesn't list a recovered ad; a Not compliant ad is its own status, not below the threshold", () => {
    // Day 10: X has recovered, so its day-6 alert alone doesn't list it.
    expect(needsAttention([{ variantId: X }, { variantId: Y }], dayHealth(input(), 10), [ref("x-below", X, "below_threshold", 6)])).toEqual([]);
    // Day 6 with X not compliant: its status is Not compliant, so it isn't listed as below the threshold.
    expect(needsAttention([{ variantId: X }], dayHealth(input(ROWS, [X]), 6), [])).toEqual([]);
  });

  it("#1 nothing needs action: an empty list before day 1 and when every ad is healthy, and the line the page shows instead", () => {
    expect(needsAttention([{ variantId: X }], null, [])).toEqual([]);
    expect(needsAttention([{ variantId: Y }, { variantId: W }], dayHealth(input(), 10), [])).toEqual([]);
    expect(NO_ATTENTION).toBe("No ad is below its threshold or tiring now (simulated).");
    expect(ATTENTION_HEADING).toBe("Needs action now");
  });
});

describe("U10-4 #2 alerts newest first, and a seen alert in one line", () => {
  it("U10-4 #2 alerts newest first: by day, then the launch's ad order, then kind", () => {
    const ads = [{ variantId: W }, { variantId: X }, { variantId: Y }];
    const alerts = [
      ref("x6-below", X, "below_threshold", 6),
      ref("w4-below", W, "below_threshold", 4),
      ref("y9-nc", Y, "not_compliant", 9),
      ref("x9-tiring", X, "tiring", 9),
      ref("x9-below", X, "below_threshold", 9),
      ref("w9-tiring", W, "tiring", 9),
    ];
    const copy = [...alerts];
    expect(newestFirst(alerts, ads).map((a: AlertRef) => a.id)).toEqual(["w9-tiring", "x9-below", "x9-tiring", "y9-nc", "x6-below", "w4-below"]);
    // The list given is left as it was.
    expect(alerts).toEqual(copy);
    // An ad that is no longer in the launch's list goes after the launch's own ads on its day.
    expect(newestFirst([ref("gone", V, "tiring", 9), ref("x9", X, "tiring", 9)], ads).map((a: AlertRef) => a.id)).toEqual(["x9", "gone"]);
  });

  it("#2 a seen alert's one line: the ad, the kind and the simulated day", () => {
    expect(alertOneLine({ kind: "below_threshold", adNumber: 1, day: 6 })).toBe("Ad 1: Below threshold on simulated day 6");
    expect(alertOneLine({ kind: "tiring", adNumber: 12, day: 9 })).toBe("Ad 12: Tiring on simulated day 9");
    expect(alertOneLine({ kind: "not_compliant", adNumber: 3, day: 14 })).toBe(`Ad 3: ${ALERT_NAMES.not_compliant} on simulated day 14`);
    expect(alertOneLine({ kind: "tiring", adNumber: 0, day: 9 })).toBe("An ad no longer in the gallery: Tiring on simulated day 9");
  });
});

describe("U10-4 #8 (R1) which alerts are shown", () => {
  const seenAt = new Date("2026-11-10T09:00:00Z");
  const a = (id: string, seen = false) => ({ id, seenAt: seen ? seenAt : null });

  it("U10-4 #8 (R1) 5 unseen alerts: the newest 3 in full and shown; the other 2 one line, behind Show all 5 alerts", () => {
    const sorted = [a("u1"), a("u2"), a("u3"), a("u4"), a("u5")];
    expect(ALERTS_IN_FULL).toBe(3);
    expect(alertsShown(sorted)).toEqual({ inFull: ["u1", "u2", "u3"], shown: ["u1", "u2", "u3"] });
    expect(showAllAlertsLabel(5)).toBe("Show all 5 alerts");
  });

  it("#8 seen alerts between unseen ones: the newest 3 unseen are in full, whatever their places; every seen one is one line", () => {
    const sorted = [a("s1", true), a("u1"), a("s2", true), a("u2"), a("u3"), a("u4")];
    expect(alertsShown(sorted)).toEqual({ inFull: ["u1", "u2", "u3"], shown: ["u1", "u2", "u3"] });
  });

  it("#8 fewer than 3 unseen: those in full, made up to 3 shown with the newest of the rest, in the list's order", () => {
    expect(alertsShown([a("s1", true), a("s2", true), a("u1"), a("s3", true), a("s4", true)])).toEqual({ inFull: ["u1"], shown: ["s1", "s2", "u1"] });
    expect(alertsShown([a("s1", true), a("s2", true), a("s3", true), a("s4", true)])).toEqual({ inFull: [], shown: ["s1", "s2", "s3"] });
  });

  it("#8 3 alerts or fewer: every one shown, with nothing behind Show all", () => {
    expect(alertsShown([a("u1"), a("s1", true), a("u2")])).toEqual({ inFull: ["u1", "u2"], shown: ["u1", "s1", "u2"] });
    expect(alertsShown([])).toEqual({ inFull: [], shown: [] });
    expect(showAllAlertsLabel(1)).toBe("Show all 1 alert");
  });
});

describe("U10-4 #4 Mark all as seen, its words", () => {
  it("U10-4 #4 the words after Mark all as seen", () => {
    expect(MARK_ALL_LABEL).toBe("Mark all as seen");
    expect(markedAllLine(3)).toBe("Marked 3 alerts as seen.");
    expect(markedAllLine(1)).toBe("Marked 1 alert as seen.");
    expect(markedAllLine(0)).toBe("No unseen alerts to mark.");
  });
});

describe("U10-4 attention.ts is pure", () => {
  it("attention.ts and recoveredOn read no database, model or clock, and never act (rule 3)", () => {
    for (const file of ["src/lib/performance/attention.ts", "src/lib/performance/health.ts"]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(/@\/lib\/db|@\/lib\/models|server-only|next\/|runModelStep|\bgenerate(Image)?\(|Math\.random|Date\.now|new Date\(\)/);
    }
    // The same facts always give the same answer.
    expect(recoveredOn(series(10), below(X, 6))).toBe(recoveredOn(series(10), below(X, 6)));
  });
});
