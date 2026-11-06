// P9-2 The simulator, as pure code: no database, no model, no clock. Test
// cases 1 (the same launch and seed give identical rows in any order of Next
// day, Next week and Run to the end: a property test over random launches and
// random interleavings, with a small seeded loop rather than a new
// dependency), 2 (spend within 1p of the daily budget, split evenly; whole
// numbers with conversions <= clicks <= impressions), 3 (fatigue: at least one
// ad tires by 30% or more over 30 days; a slow ad falls by less than 15%) and 4
// (25 December 2026 and Black Friday 2026 move cost and conversion the way the
// config says, against the same run with that event's multipliers set to 1, and
// the row's events name them). The database, the clock and the page are
// tests/db/simulation.test.ts and tests/e2e/simulation.spec.ts.
//
// The interface these tests expect is written at the top of
// tests/db/simulation.test.ts.
import { describe, expect, it } from "vitest";
import { SIMULATION, type EventEffect, type SimulationConfig } from "@/config/simulation";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { makeRng } from "@/lib/demo/rng";
import type { LaunchAd } from "@/lib/performance/launch";
import { baseRates, simulateDay, type SimLaunch, type SimRow } from "@/lib/performance/simulate";

const SOCIAL = ["1080x1080", "1080x1350", "1080x1920", "1200x628"] as LaunchAd["sizes"];
const DISPLAY = ["300x250", "300x600", "728x90"] as LaunchAd["sizes"];
/** The Fernhollow demo brand's product prices, ascending, as the clock reads them from the Business Context store. */
const PRICES = FERNHOLLOW.products.map((p) => p.pricePence).sort((x, y) => x - y);

type Rng = ReturnType<typeof makeRng>;

const hex = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.int(0, 15).toString(16)).join("");
const uuid = (rng: Rng) => `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-8${hex(rng, 3)}-${hex(rng, 12)}`;

/** YYYY-MM-DD, `n` days after `start`. */
function addDays(start: string, n: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ad(rng: Rng, sizes = SOCIAL): LaunchAd {
  return { variantId: uuid(rng), sizes, langs: ["en-GB"] };
}

/** A launch as the clock gives it to the simulator. */
function launchOf(over: Partial<SimLaunch> & { ads: LaunchAd[] }): SimLaunch {
  return { seed: "42", startsOn: "2026-11-06", days: 30, dailyBudgetPence: 5000, orderValuesPence: PRICES, ...over };
}

/** Any launch P9-1 allows: 1 to 8 ads (mostly social, some display), £5 to £500 a day, 7 to 60 days from any start in 2026 or 2027. */
function randomLaunch(rng: Rng): SimLaunch {
  const ads = Array.from({ length: rng.int(1, 8) }, () => ad(rng, rng.next() < 0.75 ? SOCIAL : DISPLAY));
  return {
    seed: String(rng.int(1, 2 ** 31 - 1)),
    startsOn: addDays("2026-01-01", rng.int(0, 729)),
    days: rng.int(7, 60),
    dailyBudgetPence: rng.int(500, 50_000),
    ads,
    orderValuesPence: rng.next() < 0.25 ? [] : PRICES,
  };
}

/** One Run to the end from day 1: each day worked out from the days before it. */
function fullRun(launch: SimLaunch, config?: SimulationConfig): SimRow[] {
  const rows: SimRow[] = [];
  for (let d = 1; d <= launch.days; d++) rows.push(...simulateDay(launch, launch.ads, d, rows.slice(), config));
  return rows;
}

const byDayThenAd = (rows: SimRow[]) => [...rows].sort((x, y) => x.day - y.day || (x.variantId < y.variantId ? -1 : x.variantId > y.variantId ? 1 : 0));

function shuffled<T>(rng: Rng, xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Click-through rate over a run of days for one ad: clicks over impressions. */
function ctrOver(rows: SimRow[], variantId: string, from: number, to: number): number {
  const mine = rows.filter((r) => r.variantId === variantId && r.day >= from && r.day <= to);
  return sum(mine.map((r) => r.clicks)) / sum(mine.map((r) => r.impressions));
}

const neutral: EventEffect = { cost: 1, conversion: 1 };

describe("P9-2 the simulator", () => {
  it("#1 property: the same launch and seed give identical rows, day by day, in any order of Next day, Next week and Run to the end", () => {
    const rng = makeRng(20261106);
    for (let i = 0; i < 40; i++) {
      const launch = randomLaunch(rng);
      const what = `launch ${i}: ${JSON.stringify({ seed: launch.seed, startsOn: launch.startsOn, days: launch.days, budget: launch.dailyBudgetPence, ads: launch.ads.length })}`;
      const once = fullRun(launch);
      expect(once, what).toHaveLength(launch.days * launch.ads.length);
      // The same launch again, as a fresh copy: identical.
      expect(fullRun(structuredClone(launch)), what).toEqual(once);

      // A random interleaving of Next day, Next week and Run to the end, as the clock steps: each day's rows from the
      // rows before it (sometimes passed in another order, sometimes not passed at all), never past the last day.
      let simDay = 0;
      const produced: SimRow[] = [];
      while (simDay < launch.days) {
        const r = rng.next();
        const by: 1 | 7 | "end" = r < 0.5 ? 1 : r < 0.85 ? 7 : "end";
        const to = by === "end" ? launch.days : Math.min(simDay + by, launch.days);
        for (let d = simDay + 1; d <= to; d++) {
          const history = rng.next() < 0.6 ? shuffled(rng, produced) : undefined;
          produced.push(...simulateDay(structuredClone(launch), launch.ads, d, history));
        }
        simDay = to;
      }
      expect(byDayThenAd(produced), what).toEqual(byDayThenAd(once));
    }
  });

  it("#1 a day's rows don't depend on the order the days are worked out, or on whether the earlier days are passed in", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 8; i++) {
      const launch = randomLaunch(rng);
      const once = fullRun(launch);
      // Each day on its own, in a shuffled order, with no history: the simulator works the earlier days out itself.
      for (const d of shuffled(rng, Array.from({ length: launch.days }, (_, k) => k + 1))) {
        const alone = simulateDay(launch, launch.ads, d);
        expect(alone, `launch ${i} day ${d}`).toEqual(once.filter((r) => r.day === d));
        // One row per ad, in the order the ads are given.
        expect(alone.map((r) => r.variantId)).toEqual(launch.ads.map((a) => a.variantId));
      }
    }
    // Another seed gives another month.
    const launch = launchOf({ ads: [ad(rng), ad(rng)] });
    expect(fullRun({ ...launch, seed: "43" })).not.toEqual(fullRun(launch));
    // Only days 1 to the launch's length exist.
    expect(() => simulateDay(launch, launch.ads, 0)).toThrow(RangeError);
    expect(() => simulateDay(launch, launch.ads, launch.days + 1)).toThrow(RangeError);
    expect(() => simulateDay(launch, launch.ads, 1.5)).toThrow(RangeError);
  });

  it("#1 base rates come from the launch's seed and the ad alone, within Studio's assumed ranges, with an order value from the brand's products", () => {
    const rng = makeRng(99);
    let checked = 0;
    for (let i = 0; i < 30; i++) {
      const launch = randomLaunch(rng);
      for (const a of launch.ads) {
        const rates = baseRates(launch, a);
        const channel = SIMULATION.channels[rates.channel];
        expect(rates.channel).toBe(a.sizes[0] === "300x250" ? "display" : "paid social");
        const within = (x: number, [min, max]: readonly [number, number], what: string) => {
          expect(x, what).toBeGreaterThanOrEqual(min);
          expect(x, what).toBeLessThanOrEqual(max);
        };
        within(rates.ctr, channel.ctr, "click-through rate");
        within(rates.conversionRate, channel.conversionRate, "conversion rate");
        within(rates.cpmPence, channel.cpmPence, "cost per thousand");
        within(rates.audience, channel.audience, "audience");
        expect(Number.isInteger(rates.audience)).toBe(true);
        within(rates.fatigueSpeed, SIMULATION.fatigue[rates.fatigue], `a ${rates.fatigue} fatigue speed`);
        // Order value: within the brand's simulated products' prices, or the config's range when it has none.
        expect(Number.isInteger(rates.orderValuePence)).toBe(true);
        within(rates.orderValuePence, launch.orderValuesPence.length ? [launch.orderValuesPence[0], launch.orderValuesPence.at(-1)!] : SIMULATION.orderValuePence, "order value");
        // The same seed and ad, the same rates (Q3: nothing else, such as the pre-test panel's scores, goes in).
        expect(baseRates(structuredClone(launch), structuredClone(a))).toEqual(rates);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("#2 each day's spend is within 1p of the daily budget, split evenly across the ads, in whole numbers with conversions at most clicks and clicks at most impressions", () => {
    const rng = makeRng(2);
    const launches = Array.from({ length: 30 }, () => randomLaunch(rng));
    // The edges P9-1 allows: £5 over eight ads, £500 over one, and a budget that doesn't divide evenly.
    launches.push(launchOf({ dailyBudgetPence: 500, ads: Array.from({ length: 8 }, () => ad(rng)) }));
    launches.push(launchOf({ dailyBudgetPence: 50_000, days: 60, ads: [ad(rng)] }));
    launches.push(launchOf({ dailyBudgetPence: 5001, ads: Array.from({ length: 3 }, () => ad(rng)) }));
    for (const [i, launch] of launches.entries()) {
      const rows = fullRun(launch);
      for (let d = 1; d <= launch.days; d++) {
        const day = rows.filter((r) => r.day === d);
        const what = `launch ${i} day ${d}`;
        expect(day, what).toHaveLength(launch.ads.length);
        const spends = day.map((r) => r.spendPence);
        expect(Math.abs(sum(spends) - launch.dailyBudgetPence), what).toBeLessThanOrEqual(1);
        expect(Math.max(...spends) - Math.min(...spends), `${what}: split evenly`).toBeLessThanOrEqual(1);
        for (const r of day) {
          expect(r.date, what).toBe(addDays(launch.startsOn, d - 1));
          for (const k of ["impressions", "clicks", "conversions", "spendPence", "revenuePence"] as const) {
            expect(Number.isInteger(r[k]), `${what} ${k} ${r[k]}`).toBe(true);
            expect(r[k], `${what} ${k}`).toBeGreaterThanOrEqual(0);
          }
          expect(r.impressions, what).toBeGreaterThan(0);
          expect(r.clicks, what).toBeLessThanOrEqual(r.impressions);
          expect(r.conversions, what).toBeLessThanOrEqual(r.clicks);
          if (r.conversions === 0) expect(r.revenuePence, what).toBe(0);
          expect(Array.isArray(r.events) && r.events.every((e) => typeof e === "string"), what).toBe(true);
        }
      }
    }
  });

  it("#3 fatigue: over 30 days at least one ad's click-through rate in its last seven days is at least 30% below its first seven; an ad with a slow fatigue speed falls by less than 15%", () => {
    const rng = makeRng(3);
    let slowAds = 0;
    let launches = 0;
    for (const n of [2, 3, 4, 6, 8]) {
      for (let s = 0; s < 10; s++) {
        // The default and the demo's: £50 a day for 30 days, from any start in 2026 or 2027.
        const launch = launchOf({ seed: String(rng.int(1, 2 ** 31 - 1)), startsOn: addDays("2026-01-01", rng.int(0, 700)), ads: Array.from({ length: n }, () => ad(rng)) });
        const rows = fullRun(launch);
        const what = `${n} ads, seed ${launch.seed}, from ${launch.startsOn}`;
        const ratios = launch.ads.map((a) => ({ a, rates: baseRates(launch, a), ratio: ctrOver(rows, a.variantId, 24, 30) / ctrOver(rows, a.variantId, 1, 7) }));
        // In a launch of two or more ads, at least one has a fast fatigue speed, and at least one tires noticeably.
        expect(ratios.some((x) => x.rates.fatigue === "fast"), `${what}: a fast ad`).toBe(true);
        expect(Math.min(...ratios.map((x) => x.ratio)), `${what}: the most tired ad's last seven days against its first`).toBeLessThanOrEqual(0.7);
        for (const x of ratios.filter((y) => y.rates.fatigue === "slow")) {
          expect(x.ratio, `${what}: slow ad ${x.a.variantId}`).toBeGreaterThan(0.85);
          slowAds++;
        }
        launches++;
      }
    }
    expect(launches).toBe(50);
    // There are slow ads to check, and a faster speed range than the slow one.
    expect(slowAds).toBeGreaterThan(20);
    expect(SIMULATION.fatigue.fast[0]).toBeGreaterThan(SIMULATION.fatigue.slow[1]);
  });
});

describe("P9-2 the simulator's events", () => {
  it("#4 the config: Studio's assumptions, the gov.uk bank holidays for England and Wales in 2026 and 2027, Black Friday and Cyber Monday", () => {
    // Rule 1: the rates are Studio's assumptions, never benchmarks.
    expect(SIMULATION.label).toMatch(/Studio's (own )?assumptions/);
    expect(SIMULATION.label).toMatch(/not .*benchmarks?/);
    for (const channel of ["paid social", "display"] as const) {
      const c = SIMULATION.channels[channel];
      for (const [k, [min, max]] of Object.entries(c)) {
        expect(min, `${channel} ${k}`).toBeGreaterThan(0);
        expect(max, `${channel} ${k}`).toBeGreaterThanOrEqual(min);
      }
      // Rates are fractions of one.
      expect(c.ctr[1]).toBeLessThan(1);
      expect(c.conversionRate[1]).toBeLessThan(1);
    }
    expect(SIMULATION.noise).toBeGreaterThan(0);
    expect(SIMULATION.noise).toBeLessThan(0.5);

    // Bank holiday dates are facts, with gov.uk as their source.
    expect(SIMULATION.bankHolidays.source).toBe("https://www.gov.uk/bank-holidays");
    expect(SIMULATION.bankHolidays.region).toBe("England and Wales");
    expect(SIMULATION.bankHolidays.days.map((d) => d.date)).toEqual([
      "2026-01-01",
      "2026-04-03",
      "2026-04-06",
      "2026-05-04",
      "2026-05-25",
      "2026-08-31",
      "2026-12-25",
      "2026-12-28",
      "2027-01-01",
      "2027-03-26",
      "2027-03-29",
      "2027-05-03",
      "2027-05-31",
      "2027-08-30",
      "2027-12-27",
      "2027-12-28",
    ]);
    expect(SIMULATION.bankHolidays.days.find((d) => d.date === "2026-12-25")!.name).toBe("Christmas Day");
    for (const d of SIMULATION.bankHolidays.days) expect(d.name.length, d.date).toBeGreaterThan(3);
    expect(
      SIMULATION.retail.map((e) => [e.date, e.name]).sort(),
    ).toEqual([
      ["2026-11-27", "Black Friday"],
      ["2026-11-30", "Cyber Monday"],
      ["2027-11-26", "Black Friday"],
      ["2027-11-29", "Cyber Monday"],
    ]);
    // Each event moves cost and conversion by enough to see on the chart.
    const effects: [string, EventEffect][] = [["bank holidays", SIMULATION.bankHolidays.effect], ["weekends", SIMULATION.weekend], ...SIMULATION.retail.map((e): [string, EventEffect] => [`${e.name} ${e.date}`, e.effect])];
    for (const [what, e] of effects) {
      expect(e.cost, what).toBeGreaterThan(0);
      expect(e.conversion, what).toBeGreaterThan(0);
      expect(Math.max(Math.abs(e.cost - 1), Math.abs(e.conversion - 1)), what).toBeGreaterThanOrEqual(0.1);
    }
  });

  /**
   * The event's day against the same launch with that event's multipliers set
   * to 1 (through the injectable config). The launch starts on the event's day,
   * so no earlier day (and no fatigue) differs between the two runs: the noise
   * is the same, and the only difference on the day is the event's. One ad at
   * £500 a day keeps the counts large; the cost per thousand is compared seed by
   * seed, and the conversion rate over ten seeds' conversions together, so
   * rounding to whole conversions can't hide the direction.
   */
  function checkEvent(opts: { startsOn: string; name: string; effect: EventEffect; neutralConfig: SimulationConfig; ordinary: number[] }) {
    const rng = makeRng(4);
    const totals = { on: { clicks: 0, conversions: 0 }, off: { clicks: 0, conversions: 0 } };
    for (let s = 0; s < 10; s++) {
      const seed = String(rng.int(1, 2 ** 31 - 1));
      const launch = launchOf({ seed, startsOn: opts.startsOn, days: 7, dailyBudgetPence: 50_000, ads: [ad(rng)] });
      const withEvent = fullRun(launch);
      const without = fullRun(launch, opts.neutralConfig);
      const what = `${opts.name}, seed ${seed}`;
      const on = withEvent[0];
      const off = without[0];
      expect(on).toMatchObject({ day: 1, date: opts.startsOn });
      // The row names the event; the neighbouring ordinary weekdays have none.
      expect(on.events, what).toContain(opts.name);
      for (const d of opts.ordinary) expect(withEvent.find((r) => r.day === d)!.events, `${what}, day ${d}`).toEqual([]);
      // The spend is the budget either way; the event moves the cost per thousand.
      expect(on.spendPence, what).toBe(off.spendPence);
      const cpm = (r: SimRow) => (r.spendPence * 1000) / r.impressions;
      if (opts.effect.cost > 1) expect(cpm(on), `${what}: cost up`).toBeGreaterThan(cpm(off));
      if (opts.effect.cost < 1) expect(cpm(on), `${what}: cost down`).toBeLessThan(cpm(off));
      if (opts.effect.cost === 1) expect(on.impressions, what).toBe(off.impressions);
      totals.on.clicks += on.clicks;
      totals.on.conversions += on.conversions;
      totals.off.clicks += off.clicks;
      totals.off.conversions += off.conversions;
    }
    // ... and the conversion rate.
    expect(totals.off.conversions, `${opts.name}: enough conversions to compare`).toBeGreaterThanOrEqual(50);
    const cvr = (t: { clicks: number; conversions: number }) => t.conversions / t.clicks;
    if (opts.effect.conversion > 1) expect(cvr(totals.on), `${opts.name}: conversion up`).toBeGreaterThan(cvr(totals.off));
    if (opts.effect.conversion < 1) expect(cvr(totals.on), `${opts.name}: conversion down`).toBeLessThan(cvr(totals.off));
  }

  it("#4 a bank holiday, 25 December 2026, moves that day's cost and conversion the way the config says, and the row's events name it", () => {
    const christmas = SIMULATION.bankHolidays.days.find((d) => d.date === "2026-12-25")!;
    const neutralConfig: SimulationConfig = { ...SIMULATION, bankHolidays: { ...SIMULATION.bankHolidays, effect: neutral } };
    // From Christmas Day, a Friday: 29 to 31 December (days 5 to 7) are ordinary weekdays.
    checkEvent({ startsOn: "2026-12-25", name: christmas.name, effect: SIMULATION.bankHolidays.effect, neutralConfig, ordinary: [5, 6, 7] });
    // In a month's run too: from Tuesday 1 December 2026, day 25 is Christmas Day and day 28 Boxing Day's substitute.
    const rows = fullRun(launchOf({ startsOn: "2026-12-01", ads: [ad(makeRng(6)), ad(makeRng(7))] }));
    for (const r of rows.filter((x) => x.day === 25)) expect(r).toMatchObject({ date: "2026-12-25", events: expect.arrayContaining([christmas.name]) });
    const boxing = SIMULATION.bankHolidays.days.find((d) => d.date === "2026-12-28")!;
    for (const r of rows.filter((x) => x.day === 28)) expect(r.events).toContain(boxing.name);
    for (const r of rows.filter((x) => x.day >= 22 && x.day <= 24)) expect(r.events).toEqual([]);
  });

  it("#4 Black Friday, 27 November 2026, moves that day's cost and conversion the way the config says; the row's events name it, and Cyber Monday's", () => {
    const blackFriday = SIMULATION.retail.find((e) => e.date === "2026-11-27")!;
    expect(blackFriday.name).toBe("Black Friday");
    const neutralConfig: SimulationConfig = { ...SIMULATION, retail: SIMULATION.retail.map((e) => ({ ...e, effect: neutral })) };
    // From Black Friday: 1 to 3 December (days 5 to 7) are ordinary weekdays.
    checkEvent({ startsOn: "2026-11-27", name: "Black Friday", effect: blackFriday.effect, neutralConfig, ordinary: [5, 6, 7] });
    // In a run from Friday 20 November 2026: day 8 is Black Friday, day 11 Cyber Monday, and days 2 and 3 (21 and 22 November) a weekend.
    const rows = fullRun(launchOf({ startsOn: "2026-11-20", ads: [ad(makeRng(5))] }));
    expect(rows.find((r) => r.day === 8)).toMatchObject({ date: "2026-11-27", events: expect.arrayContaining(["Black Friday"]) });
    expect(rows.find((r) => r.day === 11)).toMatchObject({ date: "2026-11-30", events: expect.arrayContaining(["Cyber Monday"]) });
    expect(rows.find((r) => r.day === 2)!.events).toContain("Weekend");
    expect(rows.find((r) => r.day === 3)!.events).toContain("Weekend");
    expect(rows.find((r) => r.day === 4)!.events).toEqual([]);
  });
});
