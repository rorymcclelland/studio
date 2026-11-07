// P9-2: the simulator. Pure and deterministic: no database, no model, no
// clock and no unseeded randomness. Every number comes from a seeded generator
// keyed by the launch's seed, the ad and the day, so a day's rows never depend
// on the order the days are worked out in, and the same launch always gives
// the same month. The rates are Studio's assumptions (src/config/simulation.ts),
// never benchmarks (rule 1), and an ad's base rates come from the seed and the
// ad alone, not from the pre-test panel's scores (Q3).
//
// A day, for each ad:
// - spend: the daily budget split evenly, in whole pence (events never change it);
// - impressions: spend over the day's cost per thousand (the ad's base, the
//   day's events, a cost shared by the launch's ads that day, and noise);
// - clicks: impressions at the ad's click-through rate, which falls as its
//   frequency (its impressions so far over its audience) grows, at its own
//   fatigue speed, down to a floor;
// - conversions: clicks at the ad's conversion rate, times the day's events
//   and noise; revenue: conversions at the ad's order value, with noise.
// Clicks are rounded by a seeded draw (their day-to-day movement is the
// noise); conversions, a handful a day, are a seeded Poisson draw around
// their expected value, so they scatter as real small counts do (0.9 a day
// gives none on some days and two on others).
import { SIMULATION, type EventEffect, type Range, type SimulationConfig } from "@/config/simulation";
import { SIZES, type SizeChannel } from "@/lib/creative/render/sizes";
import { makeRng, seedFrom } from "@/lib/demo/rng";
import type { LaunchAd } from "./launch";

export type SimLaunch = {
  /** launches.seed as text. */
  seed: string;
  /** The first simulated day, YYYY-MM-DD. */
  startsOn: string;
  days: number;
  dailyBudgetPence: number;
  /** launches.ads. */
  ads: LaunchAd[];
  /** The brand's active products' prices, ascending; empty when it has none. */
  orderValuesPence: number[];
};

export type BaseRates = {
  channel: SizeChannel;
  ctr: number;
  conversionRate: number;
  cpmPence: number;
  /** Whole pence. */
  orderValuePence: number;
  /** Whole people. */
  audience: number;
  fatigue: "fast" | "slow";
  fatigueSpeed: number;
};

export type SimRow = {
  variantId: string;
  day: number;
  /** startsOn + day − 1, YYYY-MM-DD. */
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spendPence: number;
  revenuePence: number;
  /** "Weekend", a bank holiday's name, "Black Friday" or "Cyber Monday"; empty on an ordinary weekday. */
  events: string[];
};

type Rng = ReturnType<typeof makeRng>;

/** A generator for one purpose: the same keys always give the same sequence. */
const rngFor = (...keys: (string | number)[]): Rng => makeRng(seedFrom(keys.join("|"), 0x9e3779b9));

const between = ([min, max]: Range, u: number) => min + (max - min) * u;

/** A multiplier around 1, at most `amplitude` either way, more often near 1 than at the edges. */
const wobble = (rng: Rng, amplitude: number) => 1 + amplitude * (rng.next() + rng.next() - 1);

/** The standard normal quantile of p in (0, 1) (Acklam's rational approximation, to about 1e-9). */
function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * A whole count with this expected value, as real counts scatter (a Poisson
 * draw), from one draw in [0, 1): the same draw always gives the same count,
 * and a higher expected value never a lower one. Large counts use the normal
 * approximation.
 */
function count(draw: number, expected: number): number {
  if (!(expected > 0)) return 0;
  const u = Math.min(Math.max(draw, 1e-12), 1 - 1e-12);
  if (expected > 40) return Math.max(0, Math.round(expected + Math.sqrt(expected) * normalQuantile(u)));
  let k = 0;
  let term = Math.exp(-expected);
  let cdf = term;
  while (cdf < u && k < 400) {
    k++;
    term *= expected / k;
    cdf += term;
  }
  return k;
}

/** The launch's ad that always tires fast (in a launch of two or more): chosen from the seed, whatever the ads' order. */
function alwaysFast(launch: SimLaunch): string | null {
  if (launch.ads.length < 2) return null;
  let pick: { id: string; key: number } | null = null;
  for (const a of launch.ads) {
    const key = rngFor(launch.seed, a.variantId, "fast").next();
    if (!pick || key < pick.key || (key === pick.key && a.variantId < pick.id)) pick = { id: a.variantId, key };
  }
  return pick!.id;
}

/** An ad's rates before any day's events, fatigue or noise: from the launch's seed and the ad alone. */
export function baseRates(launch: SimLaunch, ad: LaunchAd, config: SimulationConfig = SIMULATION): BaseRates {
  const channel = SIZES[ad.sizes[0]]?.channel ?? "paid social";
  const c = config.channels[channel];
  const rng = rngFor(launch.seed, ad.variantId, "base");
  const ctr = between(c.ctr, rng.next());
  const conversionRate = between(c.conversionRate, rng.next());
  const cpmPence = between(c.cpmPence, rng.next());
  const audience = Math.round(between(c.audience, rng.next()));
  const fast = alwaysFast(launch) === ad.variantId || rng.next() < config.fatigue.fastShare;
  const fatigue = fast ? "fast" : "slow";
  const fatigueSpeed = between(config.fatigue[fatigue], rng.next());
  // The ad's order value: a basket of three of the brand's simulated products, on average (so within their
  // prices), or within the config's range when the brand has none.
  const prices = launch.orderValuesPence;
  const picks = [rng.next(), rng.next(), rng.next()];
  const orderValuePence = prices.length
    ? Math.round(picks.reduce((sum, u) => sum + prices[Math.min(prices.length - 1, Math.floor(u * prices.length))], 0) / picks.length)
    : Math.round(between(config.orderValuePence, picks[0]));
  return { channel, ctr, conversionRate, cpmPence, orderValuePence, audience, fatigue, fatigueSpeed };
}

/** YYYY-MM-DD, `n` days after `start`. */
function addDays(start: string, n: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day's events, in the order they are named, with their combined multipliers. */
export function eventsOn(date: string, config: SimulationConfig = SIMULATION): { names: string[]; effect: EventEffect } {
  const names: string[] = [];
  let cost = 1;
  let conversion = 1;
  const apply = (name: string, e: EventEffect) => {
    names.push(name);
    cost *= e.cost;
    conversion *= e.conversion;
  };
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) apply("Weekend", config.weekend);
  for (const h of config.bankHolidays.days) if (h.date === date) apply(h.name, config.bankHolidays.effect);
  for (const r of config.retail) if (r.date === date) apply(r.name, r.effect);
  return { names, effect: { cost, conversion } };
}

/** One day's rows, given each ad's impressions before the day. */
function dayRows(launch: SimLaunch, ads: LaunchAd[], day: number, seenBefore: (variantId: string) => number, config: SimulationConfig): SimRow[] {
  const date = addDays(launch.startsOn, day - 1);
  const { names, effect } = eventsOn(date, config);
  // A cost the launch's ads share that day (the auction is busier on some days than others).
  const market = wobble(rngFor(launch.seed, "market", day), config.noise / 2);
  const share = Math.floor(launch.dailyBudgetPence / ads.length);
  const extra = launch.dailyBudgetPence - share * ads.length;
  const { floor } = config.fatigue;

  return ads.map((ad, i) => {
    const base = baseRates(launch, ad, config);
    const rng = rngFor(launch.seed, ad.variantId, "day", day);
    // Always the same draws in the same order, whatever the config's effects, so two configs differ only by their effects.
    const cpmNoise = wobble(rng, config.noise / 2);
    const ctrNoise = wobble(rng, config.noise);
    const conversionNoise = wobble(rng, config.noise);
    const valueNoise = wobble(rng, config.noise);
    const clickDraw = rng.next();
    const conversionDraw = rng.next();

    const spendPence = share + (i < extra ? 1 : 0);
    const cpm = base.cpmPence * effect.cost * market * cpmNoise;
    const impressions = Math.max(1, Math.round((spendPence * 1000) / cpm));
    const frequency = seenBefore(ad.variantId) / base.audience;
    const tired = floor + (1 - floor) / (1 + base.fatigueSpeed * frequency);
    const clicks = Math.min(impressions, Math.floor(impressions * base.ctr * tired * ctrNoise + clickDraw));
    const conversions = Math.min(clicks, count(conversionDraw, clicks * base.conversionRate * effect.conversion * conversionNoise));
    const revenuePence = conversions > 0 ? Math.round(conversions * base.orderValuePence * valueNoise) : 0;
    return { variantId: ad.variantId, day, date, impressions, clicks, conversions, spendPence, revenuePence, events: [...names] };
  });
}

/**
 * A day's rows, one per ad in the order of `ads`. `history` is the rows of the
 * days before `day`, in any order (the clock passes the stored ones); left
 * out, the earlier days are worked out here, with the same result.
 */
export function simulateDay(launch: SimLaunch, ads: LaunchAd[], day: number, history?: SimRow[], config: SimulationConfig = SIMULATION): SimRow[] {
  if (!Number.isInteger(day) || day < 1 || day > launch.days) throw new RangeError(`A simulated day is a whole number from 1 to ${launch.days}.`);
  if (ads.length === 0) return [];
  const seen = new Map<string, number>();
  if (history) {
    for (const r of history) if (r.day < day) seen.set(r.variantId, (seen.get(r.variantId) ?? 0) + r.impressions);
  } else {
    for (let d = 1; d < day; d++) {
      for (const r of dayRows(launch, ads, d, (id) => seen.get(id) ?? 0, config)) seen.set(r.variantId, (seen.get(r.variantId) ?? 0) + r.impressions);
    }
  }
  return dayRows(launch, ads, day, (id) => seen.get(id) ?? 0, config);
}

/** Days `from` to `to`, each from the rows before it (the stored `history` plus the days worked out here). */
export function simulateDays(launch: SimLaunch, from: number, to: number, history: SimRow[], config: SimulationConfig = SIMULATION): SimRow[] {
  const rows = history.filter((r) => r.day < from);
  const out: SimRow[] = [];
  for (let d = from; d <= to; d++) {
    const day = simulateDay(launch, launch.ads, d, rows, config);
    rows.push(...day);
    out.push(...day);
  }
  return out;
}
