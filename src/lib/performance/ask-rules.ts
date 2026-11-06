// P9-4: Ask about this campaign, the pure rules. No database, no model, no
// clock. A plan (the Monitor's plan step, a closed schema) describes a query;
// resultFrom works it out in code over the campaign's own simulated rows, so
// no query text is ever built from what a model wrote. checkAnswer then holds
// the answer step to the result: every figure it states must be in it.
import { formatCount, formatPrice } from "@/lib/format";
import type { LaunchAdView } from "./launch";
import type { SimRow } from "./simulate";

export const MEASURES = ["impressions", "clicks", "conversions", "spend", "revenue", "ctr", "conversion_rate", "cpa", "roas"] as const;
export type Measure = (typeof MEASURES)[number];

export const GROUP_BY = ["ad", "day", "none"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const MEASURE_LABELS: Record<Measure, string> = {
  impressions: "Impressions",
  clicks: "Clicks",
  conversions: "Conversions",
  spend: "Spend",
  revenue: "Revenue",
  ctr: "Click-through rate",
  conversion_rate: "Conversion rate",
  cpa: "Cost per acquisition",
  roas: "Return on ad spend",
};

export const CANNOT_ANSWER = "I can only answer from this campaign's simulated results";
export const ANSWER_LABEL = "Simulated data. Answer written by AI";
export const QUESTION_MAX = 300;
/**
 * What the page shows when a question's run stops on the AI: fixed sentences,
 * so nothing a model wrote (an invented figure the checks refused) and no
 * provider's error text reaches the page. The details are the run's error, in
 * its trail.
 */
export const ANSWER_NOT_CHECKED = "The answer couldn't be checked against the results, so it isn't shown.";
export const PLAN_NOT_CHECKED = "The question couldn't be turned into a check of the results, so it isn't answered.";
export const AI_UNREACHED = "The AI couldn't be reached, so the question isn't answered. Try asking again.";

export type DayRange = { kind: "all" } | { kind: "last"; days: number } | { kind: "between"; from: number; to: number };

export type AnswerablePlan = {
  answerable: true;
  measures: Measure[];
  groupBy: GroupBy;
  days: DayRange;
  /** The campaign's ad numbers; [] is every ad. */
  ads: number[];
  sort: { by: Measure; direction: "asc" | "desc" } | null;
  limit: number;
};

export type Plan = AnswerablePlan | { answerable: false; reason: string };

/** The simulated days a range covers at simDay: never past it. */
export function resolveDays(range: DayRange, simDay: number): { from: number; to: number } {
  switch (range.kind) {
    case "all":
      return { from: 1, to: simDay };
    case "last":
      return { from: Math.max(1, simDay - range.days + 1), to: simDay };
    case "between":
      return { from: range.from, to: Math.min(range.to, simDay) };
  }
}

export type ResultRow = {
  adNumber: number | null;
  headline: string | null;
  day: number | null;
  date: string | null;
  values: Partial<Record<Measure, number | null>>;
  shown: Partial<Record<Measure, string>>;
};

export type QueryResult = {
  from: number;
  to: number;
  fromDate: string;
  toDate: string;
  groupBy: GroupBy;
  measures: Measure[];
  sort: AnswerablePlan["sort"];
  /** The ad numbers included, in launch order. */
  ads: number[];
  rows: ResultRow[];
};

type Sums = { impressions: number; clicks: number; conversions: number; spendPence: number; revenuePence: number };

const empty = (): Sums => ({ impressions: 0, clicks: 0, conversions: 0, spendPence: 0, revenuePence: 0 });

function add(s: Sums, r: SimRow) {
  s.impressions += r.impressions;
  s.clicks += r.clicks;
  s.conversions += r.conversions;
  s.spendPence += r.spendPence;
  s.revenuePence += r.revenuePence;
}

const rate = (v: number) => `${v.toFixed(2)}%`;

/** One measure over a group's sums, as a ratio of sums, with how the table shows it. */
function measureOf(m: Measure, s: Sums): { value: number | null; shown: string } {
  switch (m) {
    case "impressions":
      return { value: s.impressions, shown: formatCount(s.impressions) };
    case "clicks":
      return { value: s.clicks, shown: formatCount(s.clicks) };
    case "conversions":
      return { value: s.conversions, shown: formatCount(s.conversions) };
    case "spend":
      return { value: s.spendPence / 100, shown: formatPrice(s.spendPence) };
    case "revenue":
      return { value: s.revenuePence / 100, shown: formatPrice(s.revenuePence) };
    case "ctr":
      return s.impressions > 0 ? { value: (s.clicks / s.impressions) * 100, shown: rate((s.clicks / s.impressions) * 100) } : { value: null, shown: "No impressions" };
    case "conversion_rate":
      return s.clicks > 0 ? { value: (s.conversions / s.clicks) * 100, shown: rate((s.conversions / s.clicks) * 100) } : { value: null, shown: "No clicks" };
    case "cpa":
      return s.conversions > 0 ? { value: s.spendPence / 100 / s.conversions, shown: formatPrice(Math.round(s.spendPence / s.conversions)) } : { value: null, shown: "No conversions" };
    case "roas":
      return s.spendPence > 0 ? { value: s.revenuePence / s.spendPence, shown: `${(s.revenuePence / s.spendPence).toFixed(2)}×` } : { value: null, shown: "No spend" };
  }
}

/** The day's date: day 1 is the launch's first. Worked out from the rows when they have it, else from any row's date. */
function dateOfDay(rows: SimRow[], day: number): string {
  const exact = rows.find((r) => r.day === day);
  if (exact) return exact.date;
  const any = rows[0];
  if (!any) return "";
  const d = new Date(`${any.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (day - any.day));
  return d.toISOString().slice(0, 10);
}

/** The query a plan describes, worked out over the campaign's own rows. */
export function resultFrom(plan: AnswerablePlan, rows: SimRow[], ads: LaunchAdView[], simDay: number): QueryResult {
  const { from, to } = resolveDays(plan.days, simDay);
  const included = plan.ads.length ? ads.filter((a) => plan.ads.includes(a.adNumber)) : ads;
  const byId = new Map(included.map((a) => [a.variantId, a]));
  const mine = rows.filter((r) => byId.has(r.variantId) && r.day >= from && r.day <= to);

  const groups: { key: { adNumber: number | null; headline: string | null; day: number | null; date: string | null }; sums: Sums }[] = [];
  if (plan.groupBy === "ad") {
    for (const a of included) {
      const sums = empty();
      for (const r of mine) if (r.variantId === a.variantId) add(sums, r);
      groups.push({ key: { adNumber: a.adNumber, headline: a.headline, day: null, date: null }, sums });
    }
  } else if (plan.groupBy === "day") {
    for (let day = from; day <= to; day++) {
      const today = mine.filter((r) => r.day === day);
      if (today.length === 0) continue;
      const sums = empty();
      for (const r of today) add(sums, r);
      groups.push({ key: { adNumber: null, headline: null, day, date: today[0].date }, sums });
    }
  } else {
    const sums = empty();
    for (const r of mine) add(sums, r);
    groups.push({ key: { adNumber: null, headline: null, day: null, date: null }, sums });
  }

  let out: ResultRow[] = groups.map(({ key, sums }) => {
    const values: ResultRow["values"] = {};
    const shown: ResultRow["shown"] = {};
    for (const m of plan.measures) {
      const v = measureOf(m, sums);
      values[m] = v.value;
      shown[m] = v.shown;
    }
    return { ...key, values, shown };
  });

  if (plan.sort) {
    const { by, direction } = plan.sort;
    const keyed = out.map((r, i) => ({ r, i, v: r.values[by] !== undefined ? (r.values[by] as number | null) : measureOf(by, groups[i].sums).value }));
    keyed.sort((x, y) => {
      if (x.v === null && y.v === null) return x.i - y.i;
      if (x.v === null) return 1;
      if (y.v === null) return -1;
      const d = direction === "asc" ? x.v - y.v : y.v - x.v;
      return d !== 0 ? d : x.i - y.i;
    });
    out = keyed.map((k) => k.r);
  }
  out = out.slice(0, plan.limit);

  return {
    from,
    to,
    fromDate: dateOfDay(rows.filter((r) => byId.has(r.variantId)), from),
    toDate: dateOfDay(rows.filter((r) => byId.has(r.variantId)), to),
    groupBy: plan.groupBy,
    measures: [...plan.measures],
    sort: plan.sort ? { ...plan.sort } : null,
    ads: included.map((a) => a.adNumber),
    rows: out,
  };
}

// ---------------------------------------------------------------- the answer's checks

const MONEY: ReadonlySet<Measure> = new Set(["spend", "revenue", "cpa"]);
const PERCENT: ReadonlySet<Measure> = new Set(["ctr", "conversion_rate"]);
const RATIO: ReadonlySet<Measure> = new Set(["roas"]);

type Unit = "£" | "%" | "×" | "";

/** A figure as written: an optional £, digits with thousands commas, decimals, then %, × or x. */
const FIGURE = /(?<![\p{L}\p{N}_.,])(£)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%|×|x(?![\p{L}\p{N}]))?/gu;

/**
 * An ad or a simulated day named by number: "Ad 2", "Ads 1, 2 and 3", "day 9",
 * "days 8 to 14", "day 8-14". Each number in the run is checked as an ad
 * number or a day number of the result, never as a measured figure. Only
 * "Ads" takes a list (so "Ad 2, 14 conversions" checks the 14 as a figure);
 * a day takes a range or a pair, never a comma ("On day 3, 12 clicks"). A
 * number followed by a decimal point or a thousands comma is not one ("Ad 2.5").
 */
const N = String.raw`\d+(?![.,]?\d)`;
const NAMED = new RegExp(
  String.raw`\b(?:(ad)\s+(${N})|(ads)\s+(${N}(?:\s*(?:,|and|or|to|-|–)\s*${N})*)|(days?)\s+(${N}(?:\s*(?:to|and|-|–)\s*${N})*))`,
  "giu",
);
/** The number of days in the range, written straight before "days" or "simulated days": "the last 7 simulated days". */
const DAY_COUNT = /(?<![\p{L}\p{N}_.,£])(\d+)(?=\s+(?:simulated\s+)?days\b)/giu;

/**
 * Numbers and multipliers written in words: the result writes every figure in
 * digits, so a number in words is a figure the checker can't hold to it
 * ("twelve conversions", "twice as many", "half the spend"). "Once" and
 * ordinals ("first", "second") are not refused: they are ordinary words more
 * often than figures, and an ordinal ranks the result's own rows.
 */
const NUMBER_WORDS =
  /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)(?:fold|s)?|zero|half|halves|halved|halving|quarter|quarters|double|doubled|doubling|twice|triple|tripled|treble|trebled|thrice|quadruple|quadrupled)\b/giu;

const FORECAST = /\b(will|won't|going to|next (week|month|year)|expects?|expected|forecasts?|predicts?|predicted)\b/i;

/**
 * Whether a figure written with `decimals` places is the value rounded to them.
 * A bare whole number (no unit, no decimals) matches only a whole value: "9"
 * alone could be anything, so it is never a rounded £8.86.
 */
function matches(figure: number, decimals: number, value: number, unit: Unit): boolean {
  if (unit === "" && decimals === 0 && Math.abs(value - Math.round(value)) > 1e-9) return false;
  const f = 10 ** decimals;
  return Math.abs(Math.round(value * f) / f - figure) < 1e-9;
}

/**
 * The measured figures a result allows, with the units each may be written in.
 * Ad numbers, day numbers and the length of the range are not among them: they
 * are allowed only where the answer names an ad or a day (NAMED, DAY_COUNT), so
 * a bare "14 conversions" can't pass because day 14 is in the range.
 */
function allowed(result: QueryResult): { value: number; units: Set<Unit> }[] {
  const out: { value: number; units: Set<Unit> }[] = [];
  for (const r of result.rows) {
    for (const [m, v] of Object.entries(r.values) as [Measure, number | null][]) {
      if (v === null || v === undefined) continue;
      const units = new Set<Unit>([""]);
      if (MONEY.has(m)) units.add("£");
      if (PERCENT.has(m)) units.add("%");
      if (RATIO.has(m)) units.add("×");
      out.push({ value: v, units });
    }
  }
  return out;
}

const notInResult = (written: string) => `the answer states ${written}, which is not in the result; use only figures from the result, as they are shown`;

/** Splits into sentences on . ! or ? followed by a space or the end (a decimal point is not an end). */
function sentences(text: string): number {
  return text
    .split(/[.!?](?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

/**
 * Every problem with an answer against its result, in the answer's order;
 * empty when it passes. The check is total: ads and days named by number are
 * checked against the result's own, every other figure against its measured
 * values, numbers in words are refused, and any digit left over after that
 * (".5%", "ROAS3.5×", "clicks,42") is refused too.
 */
export function checkAnswer(answer: string, result: QueryResult): string[] {
  const found: { at: number; problem: string }[] = [];
  // What has been checked is blanked out of `rest`, keeping every position.
  let rest = answer;
  const blank = (at: number, length: number) => {
    rest = rest.slice(0, at) + " ".repeat(length) + rest.slice(at + length);
  };

  const adNumbers = new Set(result.ads);
  const dayNumbers = new Set([result.from, result.to, ...result.rows.flatMap((r) => (r.day === null ? [] : [r.day]))]);
  for (const m of answer.matchAll(NAMED)) {
    const isAd = m[1] !== undefined || m[3] !== undefined;
    const numbers = m[2] ?? m[4] ?? m[6];
    const numbersAt = m.index + m[0].length - numbers.length;
    for (const n of numbers.matchAll(/\d+/g)) {
      const value = Number(n[0]);
      if (!(isAd ? adNumbers : dayNumbers).has(value)) found.push({ at: numbersAt + n.index, problem: notInResult(n[0]) });
    }
    blank(numbersAt, numbers.length);
  }
  for (const m of rest.matchAll(DAY_COUNT)) {
    if (Number(m[1]) === result.to - result.from + 1) blank(m.index, m[0].length);
  }

  const ok = allowed(result);
  for (const m of rest.matchAll(FIGURE)) {
    const written = m[0];
    const value = Number(`${m[2].replace(/,/g, "")}${m[3] ?? ""}`);
    const decimals = m[3] ? m[3].length - 1 : 0;
    const unit: Unit = m[1] ? "£" : m[4] === "%" ? "%" : m[4] ? "×" : "";
    if ((m[1] && m[4]) || !ok.some((a) => a.units.has(unit) && matches(value, decimals, a.value, unit))) {
      found.push({ at: m.index, problem: notInResult(written) });
    }
    blank(m.index, written.length);
  }

  for (const m of rest.matchAll(NUMBER_WORDS)) {
    found.push({ at: m.index, problem: `the answer writes a number in words ("${m[0]}"); use only figures from the result, as they are shown` });
  }
  // Anything with a digit still in it was never checked: refused as it is written.
  for (const m of rest.matchAll(/\S*\p{N}\S*/gu)) {
    const written = m[0].replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/gu, "") || m[0];
    found.push({ at: m.index, problem: notInResult(written) });
  }

  const forecast = FORECAST.exec(answer);
  if (forecast) found.push({ at: forecast.index, problem: `the answer forecasts ("${forecast[0]}"); say only what the result shows` });
  found.sort((x, y) => x.at - y.at);
  const problems = found.map((f) => f.problem);
  const n = sentences(answer);
  if (n > 3) problems.push(`the answer has ${n} sentences; use at most three`);
  return problems;
}
