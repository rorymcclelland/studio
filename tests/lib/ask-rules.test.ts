// P9-4 Ask about this campaign, the pure rules (src/lib/performance/ask-rules.ts):
// no database, no model. Test cases 4 (the query a plan describes, worked out
// from a campaign's rows: measures, grouping, day range, ad filter, sort and
// limit, with each figure as the table shows it) and 5 (every figure in an
// answer must be in the result, allowing for the result's rounding and its
// display formats; forecasts and more than three sentences are refused). The
// plan's schema and the agents are tests/agents/monitor.test.ts; the run, the
// repair and the refusal are tests/flows/monitor.test.ts.
//
// The interface these tests expect is written at the top of
// tests/flows/monitor.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCount, formatPrice } from "@/lib/format";
import {
  ANSWER_LABEL,
  CANNOT_ANSWER,
  checkAnswer,
  GROUP_BY,
  MEASURE_LABELS,
  MEASURES,
  QUESTION_MAX,
  resolveDays,
  resultFrom,
  type AnswerablePlan,
  type QueryResult,
} from "@/lib/performance/ask-rules";
import { mockAnswerFor } from "@/lib/agents/monitor";
import type { LaunchAdView } from "@/lib/performance/launch";
import type { SimRow } from "@/lib/performance/simulate";
import { SOCIAL_SIZES, sums } from "../helpers/monitor";

// ---------------------------------------------------------------- the fixed rows
//
// Three ads (Ad 1 to Ad 3, in launch order), days 1 to 12 stored, from
// 6 November 2026. For ad i (0, 1, 2) on day d:
//   impressions 1,000 + 100i + 10d; clicks 10 + i + d; conversions (d + i) mod 3;
//   spend 1,000 + 7i pence; revenue conversions × (4,500 + 500i) pence.
// A row of an ad that isn't in the launch is mixed in, and must be ignored.

const IDS = ["c1111111-1111-4111-8111-111111111111", "c2222222-2222-4222-8222-222222222222", "c3333333-3333-4333-8333-333333333333"];
const STRANGER = "c4444444-4444-4444-8444-444444444444";
const HEADLINES = ["Made for the long way round", "Mended, not replaced", "Dry on the high ground"];
const VIEWS: LaunchAdView[] = IDS.map((variantId, i) => ({ variantId, sizes: SOCIAL_SIZES, langs: ["en-GB"], adNumber: i + 1, headline: HEADLINES[i] }));
const dateOf = (d: number) => `2026-11-${String(5 + d).padStart(2, "0")}`;

const ROWS: SimRow[] = IDS.flatMap((variantId, i) =>
  Array.from({ length: 12 }, (_, k) => {
    const d = k + 1;
    const conversions = (d + i) % 3;
    return { variantId, day: d, date: dateOf(d), impressions: 1000 + 100 * i + 10 * d, clicks: 10 + i + d, conversions, spendPence: 1000 + 7 * i, revenuePence: conversions * (4500 + 500 * i), events: [] };
  }),
).concat([{ variantId: STRANGER, day: 5, date: dateOf(5), impressions: 99_999, clicks: 9_999, conversions: 999, spendPence: 99_999, revenuePence: 99_999, events: [] }]);

const plan = (over: Partial<AnswerablePlan> = {}): AnswerablePlan => ({
  answerable: true,
  measures: ["cpa", "spend", "conversions"],
  groupBy: "ad",
  days: { kind: "last", days: 7 },
  ads: [],
  sort: { by: "cpa", direction: "asc" },
  limit: 30,
  ...over,
});

/** The cost per acquisition of an ad over days from..to, worked out here: pence over conversions. */
const cpaOf = (variantId: string, from: number, to: number) => {
  const s = sums(ROWS, variantId, from, to);
  return s.conversions > 0 ? { value: s.spendPence / 100 / s.conversions, shown: formatPrice(Math.round(s.spendPence / s.conversions)) } : { value: null, shown: "No conversions" };
};

describe("P9-4 the query a plan describes", () => {
  it("names: the measures, groupings and labels, the fixed replies and the 300-character limit", () => {
    expect(MEASURES).toEqual(["impressions", "clicks", "conversions", "spend", "revenue", "ctr", "conversion_rate", "cpa", "roas"]);
    expect(GROUP_BY).toEqual(["ad", "day", "none"]);
    expect(MEASURE_LABELS).toEqual({
      impressions: "Impressions",
      clicks: "Clicks",
      conversions: "Conversions",
      spend: "Spend",
      revenue: "Revenue",
      ctr: "Click-through rate",
      conversion_rate: "Conversion rate",
      cpa: "Cost per acquisition",
      roas: "Return on ad spend",
    });
    expect(CANNOT_ANSWER).toBe("I can only answer from this campaign's simulated results");
    expect(ANSWER_LABEL).toBe("Simulated data. Answer written by AI");
    expect(QUESTION_MAX).toBe(300);
  });

  it("#4 day ranges: all days, the last N days to the current simulated day, or days between two, never past the current day", () => {
    expect(resolveDays({ kind: "all" }, 12)).toEqual({ from: 1, to: 12 });
    expect(resolveDays({ kind: "last", days: 7 }, 14)).toEqual({ from: 8, to: 14 });
    expect(resolveDays({ kind: "last", days: 7 }, 5)).toEqual({ from: 1, to: 5 });
    expect(resolveDays({ kind: "last", days: 1 }, 9)).toEqual({ from: 9, to: 9 });
    expect(resolveDays({ kind: "between", from: 3, to: 40 }, 12)).toEqual({ from: 3, to: 12 });
    expect(resolveDays({ kind: "between", from: 2, to: 5 }, 12)).toEqual({ from: 2, to: 5 });
  });

  it("#4 lowest cost per acquisition last week: one row per ad over the last seven days, sorted, each figure as the table shows it", () => {
    const r = resultFrom(plan(), ROWS, VIEWS, 10);
    expect(r).toMatchObject({ from: 4, to: 10, fromDate: "2026-11-09", toDate: "2026-11-15", groupBy: "ad", measures: ["cpa", "spend", "conversions"], sort: { by: "cpa", direction: "asc" }, ads: [1, 2, 3] });
    const expected = IDS.map((id, i) => {
      const s = sums(ROWS, id, 4, 10);
      const cpa = cpaOf(id, 4, 10);
      return {
        adNumber: i + 1,
        headline: HEADLINES[i],
        day: null,
        date: null,
        values: { cpa: cpa.value, spend: s.spendPence / 100, conversions: s.conversions },
        shown: { cpa: cpa.shown, spend: formatPrice(s.spendPence), conversions: formatCount(s.conversions) },
      };
    }).sort((x, y) => (x.values.cpa ?? Infinity) - (y.values.cpa ?? Infinity));
    expect(r.rows).toEqual(expected.map((e) => ({ ...e, values: { ...e.values, cpa: e.values.cpa === null ? null : expect.closeTo(e.values.cpa, 9) } })));
    // The stranger's row (another ad, maybe another campaign's) and the days after the current one are left out.
    expect(JSON.stringify(r)).not.toContain("99,999");
    expect(resultFrom(plan(), ROWS, VIEWS, 10)).toEqual(resultFrom(plan(), ROWS.filter((x) => x.day <= 10).reverse(), VIEWS, 10));
  });

  it("#4 by day, between two days, for one ad, with every rate and ratio; by none, the totals; the limit and descending sort", () => {
    const byDay = resultFrom(plan({ measures: ["impressions", "clicks", "ctr", "conversion_rate", "roas", "revenue"], groupBy: "day", days: { kind: "between", from: 2, to: 5 }, ads: [2], sort: null }), ROWS, VIEWS, 12);
    expect(byDay.rows.map((x) => [x.day, x.date, x.adNumber])).toEqual([
      [2, "2026-11-07", null],
      [3, "2026-11-08", null],
      [4, "2026-11-09", null],
      [5, "2026-11-10", null],
    ]);
    expect(byDay.ads).toEqual([2]);
    const d3 = sums(ROWS, IDS[1], 3, 3);
    expect(byDay.rows[1].values).toEqual({
      impressions: d3.impressions,
      clicks: d3.clicks,
      ctr: expect.closeTo((d3.clicks / d3.impressions) * 100, 9),
      conversion_rate: expect.closeTo((d3.conversions / d3.clicks) * 100, 9),
      roas: expect.closeTo(d3.revenuePence / d3.spendPence, 9),
      revenue: d3.revenuePence / 100,
    });
    expect(byDay.rows[1].shown).toEqual({
      impressions: formatCount(d3.impressions),
      clicks: formatCount(d3.clicks),
      ctr: `${((d3.clicks / d3.impressions) * 100).toFixed(2)}%`,
      conversion_rate: `${((d3.conversions / d3.clicks) * 100).toFixed(2)}%`,
      roas: `${(d3.revenuePence / d3.spendPence).toFixed(2)}×`,
      revenue: formatPrice(d3.revenuePence),
    });

    const total = resultFrom(plan({ measures: ["spend", "clicks"], groupBy: "none", days: { kind: "all" }, sort: null }), ROWS, VIEWS, 12);
    const all = sums(ROWS.filter((x) => x.variantId !== STRANGER), null, 1, 12);
    expect(total.rows).toEqual([{ adNumber: null, headline: null, day: null, date: null, values: { spend: all.spendPence / 100, clicks: all.clicks }, shown: { spend: formatPrice(all.spendPence), clicks: formatCount(all.clicks) } }]);

    const top = resultFrom(plan({ measures: ["clicks"], days: { kind: "all" }, sort: { by: "clicks", direction: "desc" }, limit: 1 }), ROWS, VIEWS, 12);
    expect(top.rows.map((x) => x.adNumber)).toEqual([3]);
  });

  it("#4 a measure that can't be worked out is null with its reason, and sorts last whichever way", () => {
    // Ad 1's conversions are (d + 0) mod 3: none on day 3, so its cost per acquisition for day 3 alone can't be worked out.
    const r = resultFrom(plan({ days: { kind: "between", from: 3, to: 3 } }), ROWS, VIEWS, 12);
    expect(r.rows.at(-1)).toMatchObject({ adNumber: 1, values: { cpa: null }, shown: { cpa: "No conversions" } });
    const desc = resultFrom(plan({ days: { kind: "between", from: 3, to: 3 }, sort: { by: "cpa", direction: "desc" } }), ROWS, VIEWS, 12);
    expect(desc.rows.at(-1)).toMatchObject({ adNumber: 1, values: { cpa: null } });
    // Stored as JSON, it stays as it is: never Infinity.
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("ask-rules.ts is pure: no database, model or clock", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/performance/ask-rules.ts"), "utf8");
    expect(src).not.toMatch(/@\/lib\/(db|models)|asUser|runModelStep|\bgenerate\(|Math\.random|Date\.now|new Date\(\)/);
    // No SQL is ever built from a plan: the query is this code over the campaign's own rows.
    expect(src).not.toMatch(/\bselect\b[\s\S]*\bfrom\b|sql`|tx`/i);
  });
});

describe("P9-4 every figure in an answer is in the result", () => {
  // The fixed result: last week's cost per acquisition by ad at day 10, as above.
  const result: QueryResult = resultFrom(plan(), ROWS, VIEWS, 10);
  const best = result.rows[0];
  const rest = result.rows[1];

  it("#4 an answer that uses the result's figures as the table shows them passes", () => {
    const answer = `Ad ${best.adNumber} had the lowest cost per acquisition over simulated days 4 to 10: ${best.shown.cpa}.`;
    expect(checkAnswer(answer, result)).toEqual([]);
    // Spend and conversions, a second ad, and the number of days in the range (seven) are all in the result.
    expect(checkAnswer(`Over the last 7 simulated days Ad ${rest.adNumber} spent ${rest.shown.spend} for ${rest.shown.conversions} conversions.`, result)).toEqual([]);
  });

  it("#5 rounding: a figure rounded from the result's is allowed, and one that isn't is refused", () => {
    const pounds = best.values.cpa as number;
    // "£8.81" in the table may be written "£8.8" or "£9"; a figure that isn't the value rounded is not allowed.
    // Dates are not figures of the result: an answer names simulated days by number (the instructions say so).
    expect(checkAnswer(`Ad ${best.adNumber} cost £${pounds.toFixed(1)} a conversion.`, result)).toEqual([]);
    expect(checkAnswer(`Ad ${best.adNumber} cost £${Math.round(pounds)} a conversion.`, result)).toEqual([]);
    const wrong = `£${(pounds + 0.3).toFixed(2)}`;
    expect(checkAnswer(`Ad ${best.adNumber} cost ${wrong} a conversion.`, result)).toEqual([`the answer states ${wrong}, which is not in the result; use only figures from the result, as they are shown`]);
  });

  it("#5 a figure written exactly as the table shows it passes at a half-way tie, whichever way floating point rounds the value (the monitor.spec.ts flake)", () => {
    // £116.69 over 14 conversions is 833.5p: the table shows £8.34, while the value in pounds is 8.334999999999999.
    // 19 clicks from 4,000 impressions is 0.475%, shown 0.47%; £0.57 of revenue from £1.20 of spend is 0.475×, shown 0.47×.
    const day = (d: number, over: Partial<SimRow>): SimRow => ({ variantId: IDS[0], day: d, date: dateOf(d), impressions: 0, clicks: 0, conversions: 0, spendPence: 0, revenuePence: 0, events: [], ...over });
    const one = [VIEWS[0]];
    const between = { kind: "between", from: 8, to: 9 } as const;
    const tie = resultFrom(plan({ days: between }), [day(8, { conversions: 7, spendPence: 5835 }), day(9, { conversions: 7, spendPence: 5834 })], one, 9);
    const top = tie.rows[0];
    expect(top.shown.cpa).toBe("£8.34");
    expect(top.values.cpa).not.toBe(8.335);
    expect(checkAnswer(`Ad 1 had the lowest cost per acquisition over simulated days 8 to 9: ${top.shown.cpa}.`, tie)).toEqual([]);
    const rates = resultFrom(
      plan({ measures: ["ctr", "roas"], sort: null, days: between }),
      [day(8, { impressions: 2000, clicks: 9, spendPence: 60, revenuePence: 30 }), day(9, { impressions: 2000, clicks: 10, spendPence: 60, revenuePence: 27 })],
      one,
      9,
    );
    expect(rates.rows[0].shown).toEqual({ ctr: "0.47%", roas: "0.47×" });
    expect(checkAnswer(`Its click-through rate was ${rates.rows[0].shown.ctr} and its return on ad spend ${rates.rows[0].shown.roas}.`, rates)).toEqual([]);
    // The mock model's answer, which quotes the table, passes its own check.
    expect(checkAnswer(mockAnswerFor(tie), tie)).toEqual([]);
    // Only the figure as shown, or the value rounded: £8.35 is neither.
    expect(checkAnswer("Ad 1 cost £8.35 a conversion.", tie)).toEqual(["the answer states £8.35, which is not in the result; use only figures from the result, as they are shown"]);
  });

  it("#5 display formats: pounds, percentages, ratios and counts with or without the thousands comma", () => {
    const r = resultFrom(plan({ measures: ["impressions", "ctr", "roas"], sort: { by: "impressions", direction: "desc" }, days: { kind: "all" } }), ROWS, VIEWS, 12);
    const top = r.rows[0];
    const imp = top.values.impressions as number;
    expect(imp).toBeGreaterThan(9999);
    expect(checkAnswer(`Ad ${top.adNumber} had ${formatCount(imp)} impressions.`, r)).toEqual([]);
    expect(checkAnswer(`Ad ${top.adNumber} had ${imp} impressions.`, r)).toEqual([]);
    expect(checkAnswer(`Its click-through rate was ${top.shown.ctr} and its return on ad spend ${top.shown.roas}.`, r)).toEqual([]);
    const ratio = (top.values.roas as number).toFixed(1);
    expect(checkAnswer(`Its return on ad spend was ${ratio}x.`, r)).toEqual([]);
    // A figure's unit must be the measure's: a click-through rate isn't a sum of money, and a count isn't a percentage.
    const ctr = (top.values.ctr as number).toFixed(2);
    expect(checkAnswer(`It cost £${ctr}.`, r)).toEqual([`the answer states £${ctr}, which is not in the result; use only figures from the result, as they are shown`]);
    expect(checkAnswer(`It reached ${imp}%.`, r)).toEqual([`the answer states ${imp}%, which is not in the result; use only figures from the result, as they are shown`]);
  });

  it("#5 a figure that isn't in the result (\"about 40% better\") is refused, with the figure named", () => {
    expect(checkAnswer(`Ad ${best.adNumber} was about 40% better than the others.`, result)).toEqual([
      "the answer states 40%, which is not in the result; use only figures from the result, as they are shown",
    ]);
    expect(checkAnswer(`Ad ${best.adNumber} had 5 times the conversions of Ad 9.`, result)).toEqual([
      "the answer states 5, which is not in the result; use only figures from the result, as they are shown",
      "the answer states 9, which is not in the result; use only figures from the result, as they are shown",
    ]);
  });

  it("#5 a forecast (\"will\", \"next month\", \"expect\") is refused, with the word named", () => {
    expect(checkAnswer(`Ad ${best.adNumber} will reach ${best.shown.cpa} again.`, result)).toEqual(['the answer forecasts ("will"); say only what the result shows']);
    expect(checkAnswer(`Ad ${best.adNumber} should win next month.`, result)).toEqual(['the answer forecasts ("next month"); say only what the result shows']);
    expect(checkAnswer(`We expect Ad ${best.adNumber} to stay ahead.`, result)).toEqual(['the answer forecasts ("expect"); say only what the result shows']);
    // Words that merely contain the letters are not forecasts.
    expect(checkAnswer(`Ad ${best.adNumber} was the cheapest; its willow green headline did well.`, result)).toEqual([]);
  });

  it("#5 up to three sentences: a fourth is refused", () => {
    const s = `Ad ${best.adNumber} was cheapest.`;
    expect(checkAnswer(`${s} ${s} ${s}`, result)).toEqual([]);
    expect(checkAnswer(`${s} ${s} ${s} ${s}`, result)).toEqual(["the answer has 4 sentences; use at most three"]);
    // A figure's decimal point doesn't end a sentence.
    expect(checkAnswer(`Ad ${best.adNumber} cost ${best.shown.cpa} a conversion. ${s} ${s}`, result)).toEqual([]);
  });
});

describe("P9-4 the answer check is total: no figure gets past unchecked (review fixes)", () => {
  // A one-row result: Ad 2's cost per acquisition, spend and conversions over simulated days 1 to 14, of Ads 1 to 3.
  const one: QueryResult = {
    from: 1,
    to: 14,
    fromDate: "2026-11-06",
    toDate: "2026-11-19",
    groupBy: "ad",
    measures: ["cpa", "spend", "conversions"],
    sort: { by: "cpa", direction: "asc" },
    ads: [1, 2, 3],
    rows: [{ adNumber: 2, headline: "Mended, not replaced", day: null, date: null, values: { cpa: 8.86, spend: 175, conversions: 20 }, shown: { cpa: "£8.86", spend: "£175.00", conversions: "20" } }],
  };
  const states = (x: string) => `the answer states ${x}, which is not in the result; use only figures from the result, as they are shown`;
  const inWords = (x: string) => `the answer writes a number in words ("${x}"); use only figures from the result, as they are shown`;

  it("a figure from the result, ads and days named by number, and the range's length before \"days\" pass", () => {
    expect(checkAnswer("Ad 2 had the lowest cost per acquisition over simulated days 1 to 14: £8.86, from £175.00 and 20 conversions.", one)).toEqual([]);
    expect(checkAnswer("Of Ads 1, 2 and 3, Ad 2 was cheapest over days 1-14, the last 14 simulated days: £8.86.", one)).toEqual([]);
    expect(checkAnswer("Between day 1 and day 14, Ad 2 had 20 conversions.", one)).toEqual([]);
  });

  it("a bare number is a figure unless it names an ad or a day: day 14 and Ad 3 don't let \"14 conversions\" or \"had 3\" through", () => {
    expect(checkAnswer("Ad 2 had 14 conversions and Ad 1 had 3 over simulated days 1 to 14.", one)).toEqual([states("14"), states("3")]);
    // An ad or a day the result doesn't hold is refused where it is named.
    expect(checkAnswer("Ad 4 had 20 conversions on day 15.", one)).toEqual([states("4"), states("15")]);
    // The range's length counts only straight before "days", and only when it is the length.
    expect(checkAnswer("Ad 2 had 20 conversions in 14 clicks.", one)).toEqual([states("14")]);
    expect(checkAnswer("Over the last 7 days Ad 2 had 20 conversions.", one)).toEqual([states("7")]);
    // A day takes no comma list, so the figure after it is still checked; nor does a single ad.
    expect(checkAnswer("On day 1, 14 clicks.", one)).toEqual([states("14")]);
    expect(checkAnswer("Ad 2, 3 conversions.", one)).toEqual([states("3")]);
  });

  it("numbers and multipliers in words are refused: twelve, twice, half, double, a dozen", () => {
    expect(checkAnswer("Ad 2 had twelve conversions.", one)).toEqual([inWords("twelve")]);
    expect(checkAnswer("Ad 2 had twice as many conversions as Ad 1.", one)).toEqual([inWords("twice")]);
    expect(checkAnswer("Ad 2 cost half as much, about a dozen pounds less; Ad 3 had Three hundred clicks, double Ad 1, threefold.", one)).toEqual([
      inWords("half"),
      inWords("dozen"),
      inWords("Three"),
      inWords("hundred"),
      inWords("double"),
      inWords("threefold"),
    ]);
    // Ordinary words that aren't numbers pass: once, someone, often, tension, weight, first.
    expect(checkAnswer("Once again Ad 2 came first, as someone often noted: no tension, no weight.", one)).toEqual([]);
  });

  it("a digit hidden after a decimal point, a letter or a comma is refused, not skipped", () => {
    expect(checkAnswer("Ad 2's conversion rate was .5% higher.", one)).toEqual([states(".5%")]);
    expect(checkAnswer("Ad 2 had ROAS3.5× overall.", one)).toEqual([states("ROAS3.5×")]);
    expect(checkAnswer("Ad 2 had 20 conversions from clicks,42 of them.", one)).toEqual([states("clicks,42")]);
    // Any digit at all: a date, a fraction, another script's numerals.
    expect(checkAnswer("Ad 2 led on 2026-11-19.", one)).toEqual([states("2026"), states("11"), states("19")]);
    expect(checkAnswer("Ad 2 had ½ the spend.", one)).toEqual([states("½")]);
  });
});
