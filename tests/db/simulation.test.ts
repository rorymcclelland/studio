// P9-2 The simulator: daily results with fatigue and events, in the database
// and through the clock and its server action (the session is the only thing
// mocked; the database is real, and generate() is replaced by a spy that fails
// the test if anything calls it). Test cases 1 (the stored rows are the
// simulator's, identical for the same seed whatever the order of Next day,
// Next week and Run to the end), 5 (two Next day requests at once write one
// day, not two; Run to the end writes exactly the remaining days, then the
// clock can't move; a day is never rewritten), 6 (an ended launch writes no
// more days), 7 (another workspace can't read the results or move the clock)
// and 8 (no model call: a 60-day launch of eight ads adds nothing to
// usage_ledger). The pure simulator's cases (1 to 4) are
// tests/lib/simulate.test.ts; Run to the end in the browser is
// tests/e2e/simulation.spec.ts.
//
// ---------------------------------------------------------------- interface
// The builder follows this; the tests here, in tests/lib/simulate.test.ts and
// in tests/e2e/simulation.spec.ts pin it.
//
// src/config/simulation.ts (no imports but types; Studio's assumptions, never benchmarks, rule 1):
// - type Range = readonly [min: number, max: number];
//   type EventEffect = { cost: number; conversion: number }   (multipliers on the day's cost per
//     thousand impressions and on its conversion rate; 1 is no change)
// - type SimulationConfig = {
//     label: string   (says these are Studio's assumptions, not benchmarks: matches
//       /Studio's (own )?assumptions/ and /not .*benchmarks?/),
//     channels: Record<"paid social" | "display", { ctr: Range; conversionRate: Range; cpmPence: Range; audience: Range }>
//       (ctr and conversionRate as fractions of 1, cpmPence in pence, audience in people),
//     orderValuePence: Range   (used when the brand has no active products),
//     fatigue: { fast: Range; slow: Range; floor: number; fastShare: number }   (speeds, fast[0] > slow[1];
//       the share of its click-through rate an ad keeps however tired; the chance an ad tires fast),
//     weekend: EventEffect,
//     bankHolidays: { region: "England and Wales"; source: "https://www.gov.uk/bank-holidays";
//       effect: EventEffect; days: { date: "YYYY-MM-DD"; name: string }[] }   (2026 and 2027 in
//       date order, as gov.uk lists them: 2026-01-01, 04-03, 04-06, 05-04, 05-25, 08-31, 12-25
//       "Christmas Day", 12-28; 2027-01-01, 03-26, 03-29, 05-03, 05-31, 08-30, 12-27, 12-28),
//     retail: { date; name: "Black Friday" | "Cyber Monday"; effect: EventEffect }[]   (2026-11-27,
//       2026-11-30, 2027-11-26, 2027-11-29),
//     noise: number   (the day-to-day amplitude, between 0 and 0.5) };
//   Every effect moves cost or conversion by at least 0.1 either way.
// - export const SIMULATION: SimulationConfig.
//
// src/lib/performance/simulate.ts: pure and deterministic. No database, no model, no clock, no
// Math.random: a seeded generator keyed by the launch's seed, the ad's variant id and the day, so a
// day's rows never depend on the order days are produced.
// - type SimLaunch = { seed: string /* launches.seed as text */; startsOn: "YYYY-MM-DD"; days: number;
//     dailyBudgetPence: number; ads: LaunchAd[] /* launches.ads */;
//     orderValuesPence: number[] /* the brand's active products' prices, ascending; [] for none */ }.
// - type BaseRates = { channel: "paid social" | "display" /* from the ad's sizes, SIZES[size].channel */;
//     ctr: number; conversionRate: number; cpmPence: number; orderValuePence: number /* whole pence */;
//     audience: number /* whole */; fatigue: "fast" | "slow"; fatigueSpeed: number /* in config.fatigue[fatigue] */ }.
//   Each within its channel's range; the order value within [min, max] of orderValuesPence, or
//   config.orderValuePence when that is empty. Nothing else goes in (Q3: not the pre-test scores).
// - baseRates(launch: SimLaunch, ad: LaunchAd, config = SIMULATION): BaseRates. In a launch of two or
//   more ads at least one ad is "fast" (chosen from the seed, using launch.ads).
// - type SimRow = { variantId: string; day: number; date: "YYYY-MM-DD" /* startsOn + day - 1 */;
//     impressions: number; clicks: number; conversions: number; spendPence: number; revenuePence: number;
//     events: string[] }.
// - simulateDay(launch: SimLaunch, ads: LaunchAd[], day: number, history?: SimRow[], config = SIMULATION): SimRow[]
//   One row per ad, in the order of `ads`. `history` is the rows of the days before `day` (any order;
//   the clock passes the stored ones); left out, the simulator works them out itself, with the same
//   result. A day outside 1..launch.days, or not whole, is a RangeError.
//   - Spend: the daily budget split evenly, whole pence, the day's total within 1p of the budget and
//     no two ads more than 1p apart. Events never change the spend.
//   - Impressions = spend / the day's cost per thousand × 1000; the cost per thousand is the ad's base
//     times the day's event cost multipliers, times noise.
//   - Fatigue: the click-through rate falls as the ad's average frequency (its impressions before the
//     day / its audience) grows, at its own speed. Over 30 days at £50 a day with 2 to 8 ads, at least
//     one ad's click-through rate in days 24-30 is 30% or more below days 1-7, and every "slow" ad's
//     falls by less than 15%.
//   - Conversions from clicks at the conversion rate times the event conversion multipliers, times
//     noise; revenue = conversions × the order value (with noise), 0 when there are none.
//   - Whole numbers, never negative, impressions > 0, conversions <= clicks <= impressions.
//   - events: "Weekend" on a Saturday or Sunday; the bank holiday's config name ("Christmas Day");
//     "Black Friday"; "Cyber Monday". An ordinary weekday has [].
//
// src/lib/performance/clock-rules.ts (pure, for the page too; clock.ts re-exports it):
// - type ClockStep = 1 | 7 | "end".
// - SIM_NOT_LIVE = "There's no live launch to move on." (not live, ended, waiting, refused, missing,
//   malformed or another workspace's: the same for each).
// - SIM_AT_END = "The simulation has reached its last day".
// - SIM_STEP_NOT_VALID = "Move the simulation on by a day, a week or to the end.".
// - clockLabel(simDay, days): "No simulated days yet (30 to run)" at 0, else "Simulated day 12 of 30".
//
// src/lib/performance/clock.ts (every read and write through asUser(), rule 7; no model call, rule 5):
// - class ClockError extends Error.
// - advance(member: Member, launchId: string, by: ClockStep, fromDay: number, opts?: { campaignId?: string }):
//     Promise<{ simDay: number; days: number; written: number }>
//   `fromDay` is the day the page showed (launches.sim_day when it was drawn). In one transaction:
//   checks the step and that fromDay is a whole number from 0 (SIM_STEP_NOT_VALID), locks the launch
//   row (for update), refuses anything not live, or of another campaign than opts.campaignId
//   (SIM_NOT_LIVE); then, if launches.sim_day is no longer fromDay, writes nothing and returns the
//   current state with written: 0 (not an error: the page just shows the current day); otherwise
//   refuses a launch already at its last day (SIM_AT_END), reads the stored rows as history and the
//   campaign's brand's active product prices (ascending), writes the next 1, up to 7, or all
//   remaining days' rows for every launched ad (never past `days`), and sets launches.sim_day.
//   `written` is the number of sim_daily rows written. Two requests at once from the same day queue
//   on the lock: the first writes the next day, the second finds the clock moved on and writes
//   nothing, so a double click moves the clock once. Reaching the last day leaves the launch live (a
//   person ends it); the controls are disabled.
// - LaunchView (launchesFor) gains simDay: number.
//
// Migration db/migrations/20261106000002_sim_daily.sql:
// - launches: sim_day integer not null default 0, check (sim_day between 0 and days); a unique key
//   (id, workspace_id) for sim_daily's foreign key. launches_guard is replaced (create or replace) so
//   sim_day moves only while the launch is live, only forward (errcode 42501, every role, the owner
//   too); it stays 0 while waiting, and an ended or refused launch's sim_day never changes. Status
//   live to ended stays allowed.
// - public.sim_daily: workspace_id not null (RLS), launch_id with foreign key (launch_id, workspace_id)
//   references launches (id, workspace_id) on delete cascade, variant_id with foreign key (variant_id,
//   workspace_id) references ad_variants (id, workspace_id) on delete cascade, day integer check 1..60,
//   date date, impressions, clicks, conversions, spend_pence, revenue_pence integer not null >= 0 with
//   conversions <= clicks <= impressions, events text[] not null default '{}', created_at;
//   unique (launch_id, variant_id, day).
// - A before-insert trigger (every role) refuses a row whose launch isn't live, whose day is past the
//   launch's days, whose date isn't starts_on + day - 1, or whose variant isn't one of the launch's ads.
// - Append-only: a trigger refuses update for every role (errcode 42501), and delete too, except a
//   cascade from deleting the launch's campaign, brand or workspace (pg_trigger_depth() > 1). The
//   owner may truncate (the tests clear the table so).
// - RLS: select and insert (with check is_member(workspace_id)) for members; revoke all from anon;
//   revoke update, delete, truncate, references, trigger from authenticated.
//
// Server action, src/app/(app)/campaigns/[id]/launch-actions.ts:
// - advanceClock(campaignId, launchId, by: ClockStep, fromDay: number): BriefActionState: { done } with
//   the day the clock is on (also when it had already moved on), or { error } with a ClockError's
//   message; a launch of another campaign is SIM_NOT_LIVE.
//
// The page (tests/e2e/simulation.spec.ts), on the Launch (simulated) panel while live:
// [data-sim-clock] with clockLabel ("No simulated days yet (30 to run)", "Simulated day 1 of 30");
// buttons "Next day", "Next week" and "Run to the end", each sending the day shown as fromDay; at the
// last day all three disabled, with
// [data-sim-at-end] "The simulation has reached its last day". Once ended, no clock buttons, and
// P9-1's [data-launch-ended] reads "Ended by <email> on simulated day N of D." once days have run.
// ----------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ member: null as null | { id: string; email: string; userId: string; workspaceId: string } }));
vi.mock("@/lib/auth/session", () => ({
  requireMember: async () => {
    if (!session.member) throw new Error("No one is signed in for this test");
    return session.member;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));
// Rule 5: the simulator never calls a model. Anything that does fails here.
const modelCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/models/generate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/models/generate")>();
  const refuse = async () => {
    modelCalls.count++;
    throw new Error("The simulator must not call a model");
  };
  return { ...real, generate: refuse, generateImage: refuse };
});

import { advanceClock } from "@/app/(app)/campaigns/[id]/launch-actions";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { advance, ClockError, clockLabel, SIM_AT_END, SIM_NOT_LIVE, SIM_STEP_NOT_VALID, type ClockStep } from "@/lib/performance/clock";
import { endLaunch, launchesFor, type LaunchAd } from "@/lib/performance/launch";
import { simulateDay, type SimLaunch, type SimRow } from "@/lib/performance/simulate";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, builder, campaignFor, EN, productsFor, rawLaunch, type Member } from "../helpers/launch";

let a: Member;
let b: Member;
let aEmail: string;
let bEmail: string;
let ids: {
  /** A's signed-off campaign, with eight picked ads. */
  main: string;
  ads: string[];
  /** Another signed-off campaign of A's, with one ad: deleted in the append-only test. */
  spare: string;
  spareAd: string;
};
/** A's brand's active product prices, ascending (one inactive product is left out). */
let prices: number[];

/** How a call was refused: whether as a ClockError, and its message (null when it wasn't refused). */
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (x: unknown) => ({ clockError: x instanceof ClockError, message: (x as Error).message }),
  );

/** Signs a member in for the server actions (requireMember is the only mock). */
function signedInAs(m: Member, email: string) {
  session.member = { id: m.userId, email, userId: m.userId, workspaceId: m.workspaceId };
}

/** A launch's stored rows, as the simulator's rows, by day then ad. */
async function storedRows(launchId: string): Promise<SimRow[]> {
  const rows = await getSql()`
    select variant_id, day, to_char(date, 'YYYY-MM-DD') as date, impressions, clicks, conversions, spend_pence, revenue_pence, events
    from public.sim_daily where launch_id = ${launchId} order by day, variant_id`;
  return rows.map((r) => ({
    variantId: r.variant_id as string,
    day: r.day as number,
    date: r.date as string,
    impressions: r.impressions as number,
    clicks: r.clicks as number,
    conversions: r.conversions as number,
    spendPence: r.spend_pence as number,
    revenuePence: r.revenue_pence as number,
    events: r.events as string[],
  }));
}

/** The launch as the simulator takes it, read back from the database with the brand's prices. */
async function simLaunchOf(launchId: string): Promise<SimLaunch> {
  const [l] = await getSql()`select seed::text as seed, to_char(starts_on, 'YYYY-MM-DD') as starts_on, days, daily_budget_pence, ads from public.launches where id = ${launchId}`;
  return { seed: l.seed, startsOn: l.starts_on, days: l.days, dailyBudgetPence: l.daily_budget_pence, ads: l.ads as LaunchAd[], orderValuesPence: prices };
}

/** The pure simulator's rows for days 1 to `to`, by day then ad. */
function expectedRows(launch: SimLaunch, to = launch.days): SimRow[] {
  const rows: SimRow[] = [];
  for (let d = 1; d <= to; d++) rows.push(...simulateDay(launch, launch.ads, d, rows.slice()));
  return rows.sort((x, y) => x.day - y.day || (x.variantId < y.variantId ? -1 : x.variantId > y.variantId ? 1 : 0));
}

const simDayOf = async (launchId: string) => {
  const [l] = await getSql()`select sim_day from public.launches where id = ${launchId}`;
  return l.sim_day as number;
};
const countRows = async (launchId: string) => {
  const [r] = await getSql()`select count(*)::int as n from public.sim_daily where launch_id = ${launchId}`;
  return r.n as number;
};

/** A live launch of A's main campaign with its first `n` ads. */
const liveLaunch = (n: number, over: Record<string, unknown> = {}) => rawLaunch(a, ids.main, ids.ads.slice(0, n), over);

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  [{ email: aEmail }] = await getSql()`select email from auth.users where id = ${a.userId}`;
  [{ email: bEmail }] = await getSql()`select email from auth.users where id = ${b.userId}`;
  const brand = await brandFor(a, "fernhollow");
  // The Business Context store's catalogue: three of Fernhollow's simulated products, and one no longer sold.
  const sold = FERNHOLLOW.products.slice(0, 3);
  await productsFor(a, brand, [...sold.map((p) => ({ name: p.name, pricePence: p.pricePence })), { name: "Discontinued gaiters", pricePence: 99_900, active: false }]);
  prices = sold.map((p) => p.pricePence).sort((x, y) => x - y);

  const main = await campaignFor(a, brand, "signed off", "Bring walkers back for autumn, run in a simulation");
  const m = builder(a, brand, main);
  const image = await m.image("simulation one");
  const layouts = ["card", "full-bleed", "split"] as const;
  const adIds: string[] = [];
  for (let i = 0; i < 8; i++) adIds.push(await m.ad(image, await m.words(`${EN.headline} ${i + 1}`), layouts[i % 3], true));

  const spare = await campaignFor(a, brand, "signed off", "A campaign deleted with its results");
  const s = builder(a, brand, spare);
  const spareAd = await s.ad(await s.image("simulation spare"), await s.words(EN.headline), "card", true);
  ids = { main, ads: adIds, spare, spareAd };
}, 300_000);

beforeEach(async () => {
  session.member = null;
  modelCalls.count = 0;
  // Each test starts with no results and no launches (as the tables' owner: the app can't delete them).
  await getSql()`truncate public.sim_daily`;
  await getSql()`delete from public.launches`;
  await getSql()`delete from public.approvals where kind = 'launch'`;
});
afterAll(closeSql);

describe("P9-2 the simulated clock", () => {
  it("#1 the stored rows are the simulator's, the same for the same seed whatever the order of Next day, Next week and Run to the end", async () => {
    const orders: ClockStep[][] = [
      ["end"],
      [1, 7, 1, 1, 7, "end"],
      [7, 7, 7, 7, 1, 1],
      [1, 1, 1, "end"],
    ];
    let first: SimRow[] | null = null;
    for (const order of orders) {
      // The same launch again: same ads, budget, length, start and seed (one live launch per campaign, so the last is ended first).
      const { launchId } = await liveLaunch(3, { seed: "8675309", starts_on: "2026-11-20" });
      let last = { simDay: 0, days: 30, written: 0 };
      for (const by of order) last = await advance(a, launchId, by, last.simDay);
      expect(last, order.join(", ")).toMatchObject({ simDay: 30, days: 30 });
      const rows = await storedRows(launchId);
      expect(rows, order.join(", ")).toHaveLength(30 * 3);
      // The rows are the pure simulator's, with the brand's active prices, and a Run to the end's.
      expect(rows, order.join(", ")).toEqual(expectedRows(await simLaunchOf(launchId)));
      if (first) expect(rows, order.join(", ")).toEqual(first);
      first ??= rows;
      // Workspace and launch are the launch's.
      const [w] = await getSql()`select count(*)::int as n from public.sim_daily where launch_id = ${launchId} and workspace_id <> ${a.workspaceId}`;
      expect(w.n).toBe(0);
      await endLaunch(a, launchId);
    }
    // The events reach the database: Black Friday is day 8 from 20 November 2026.
    expect(first!.filter((r) => r.day === 8).every((r) => r.events.includes("Black Friday"))).toBe(true);
    // The page's label for the clock.
    expect(clockLabel(0, 30)).toBe("No simulated days yet (30 to run)");
    expect(clockLabel(12, 30)).toBe("Simulated day 12 of 30");
  });

  it("#5 two Next day requests at once write one day, not two: the second finds the clock moved on and writes nothing", async () => {
    const { launchId } = await liveLaunch(4);
    // A double click: both requests carry the day the page showed, day 0.
    const results = await Promise.allSettled([advance(a, launchId, 1, 0), advance(a, launchId, 1, 0)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const values = results.map((r) => (r as PromiseFulfilledResult<{ simDay: number; days: number; written: number }>).value);
    expect(values.sort((x, y) => x.written - y.written)).toEqual([
      { simDay: 1, days: 30, written: 0 },
      { simDay: 1, days: 30, written: 4 },
    ]);
    expect(await simDayOf(launchId)).toBe(1);
    const rows = await storedRows(launchId);
    expect(rows.map((r) => `${r.day} ${r.variantId}`)).toEqual([...new Set(rows.map((r) => `${r.day} ${r.variantId}`))]);
    expect(rows).toEqual(expectedRows(await simLaunchOf(launchId), 1));

    // Through the server action too: two Next week clicks from day 1 move the clock one week.
    signedInAs(a, aEmail);
    const clicks = await Promise.all([advanceClock(ids.main, launchId, 7, 1), advanceClock(ids.main, launchId, 7, 1)]);
    for (const c of clicks) expect(c).toMatchObject({ done: expect.stringMatching(/simulated day 8 of 30/i) });
    expect(await simDayOf(launchId)).toBe(8);
    expect(await countRows(launchId)).toBe(8 * 4);

    // Run to the end twice at once: exactly the remaining days, once; the second finds the clock at the end and writes nothing.
    const both = await Promise.allSettled([advance(a, launchId, "end", 8), advance(a, launchId, "end", 8)]);
    expect(both.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const ends = both.map((r) => (r as PromiseFulfilledResult<{ simDay: number; days: number; written: number }>).value);
    expect(ends.sort((x, y) => x.written - y.written)).toEqual([
      { simDay: 30, days: 30, written: 0 },
      { simDay: 30, days: 30, written: 22 * 4 },
    ]);
    expect(await countRows(launchId)).toBe(30 * 4);
    expect(await storedRows(launchId)).toEqual(expectedRows(await simLaunchOf(launchId)));
    // A late request from an earlier day still writes nothing; one from the last day is told the simulation has ended.
    expect(await advance(a, launchId, 1, 3)).toEqual({ simDay: 30, days: 30, written: 0 });
    expect(await refusal(advance(a, launchId, 1, 30))).toEqual({ clockError: true, message: SIM_AT_END });
    expect(await countRows(launchId)).toBe(30 * 4);
  });

  it("#5 two Next day requests one after the other, each from the day the page then showed, write days 1 and 2", async () => {
    const { launchId } = await liveLaunch(3);
    expect(await advance(a, launchId, 1, 0)).toEqual({ simDay: 1, days: 30, written: 3 });
    expect(await advance(a, launchId, 1, 1)).toEqual({ simDay: 2, days: 30, written: 3 });
    expect(await simDayOf(launchId)).toBe(2);
    const rows = await storedRows(launchId);
    expect(rows.map((r) => r.day)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(rows).toEqual(expectedRows(await simLaunchOf(launchId), 2));
  });

  it("#5 Run to the end on a 30-day launch writes exactly the remaining days, then the clock can't move", async () => {
    expect(SIM_AT_END).toBe("The simulation has reached its last day");
    const { launchId } = await liveLaunch(2);
    expect((await launchesFor(a.userId, ids.main))![0].simDay).toBe(0);
    expect(await advance(a, launchId, 1, 0)).toEqual({ simDay: 1, days: 30, written: 2 });
    expect(await advance(a, launchId, 7, 1)).toEqual({ simDay: 8, days: 30, written: 14 });
    expect(await advance(a, launchId, "end", 8)).toEqual({ simDay: 30, days: 30, written: 22 * 2 });
    expect(await simDayOf(launchId)).toBe(30);
    expect((await launchesFor(a.userId, ids.main))![0]).toMatchObject({ id: launchId, status: "live", simDay: 30 });
    // Each ad has days 1 to 30, once each.
    const rows = await storedRows(launchId);
    for (const v of ids.ads.slice(0, 2)) expect(rows.filter((r) => r.variantId === v).map((r) => r.day)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    // At the end, every step is refused and nothing more is written.
    for (const by of [1, 7, "end"] as const) {
      expect(await refusal(advance(a, launchId, by, 30)), String(by)).toEqual({ clockError: true, message: SIM_AT_END });
    }
    expect(await countRows(launchId)).toBe(60);
    // Through the server action, as the person.
    signedInAs(a, aEmail);
    expect(await advanceClock(ids.main, launchId, 1, 30)).toEqual({ error: SIM_AT_END });

    // Next week near the end stops at the last day: a 10-day launch at day 6 writes 4 days.
    await endLaunch(a, launchId);
    const short = await liveLaunch(3, { days: 10 });
    for (let day = 0; day < 6; day++) await advance(a, short.launchId, 1, day);
    expect(await advanceClock(ids.main, short.launchId, 7, 6)).toMatchObject({ done: expect.any(String) });
    expect(await simDayOf(short.launchId)).toBe(10);
    expect(await countRows(short.launchId)).toBe(10 * 3);
    // Anything but a day, a week or the end is refused before anything is read.
    for (const by of [0, 2, 30, -1, "1", "week", null]) {
      expect(await refusal(advance(a, short.launchId, by as never, 10)), String(by)).toEqual({ clockError: true, message: SIM_STEP_NOT_VALID });
    }
    // So is a day the page couldn't have shown.
    for (const fromDay of [-1, 1.5, "10", null, Number.NaN]) {
      expect(await refusal(advance(a, short.launchId, 1, fromDay as never)), String(fromDay)).toEqual({ clockError: true, message: SIM_STEP_NOT_VALID });
    }
  });

  it("#5 a day is never written twice or rewritten: the unique key, the insert checks and the append-only trigger", async () => {
    const { launchId } = await liveLaunch(2);
    await advance(a, launchId, 7, 0);
    const before = await storedRows(launchId);
    const [row] = await getSql()`select * from public.sim_daily where launch_id = ${launchId} and day = 3 limit 1`;
    const copy = (over: Record<string, unknown> = {}) => {
      const r: Record<string, unknown> = { ...row, ...over };
      delete r.id;
      delete r.created_at;
      return r;
    };
    // The same launch, ad and day again: the unique key, as the member and as the owner.
    await expect(asUser(a.userId, (tx) => tx`insert into public.sim_daily ${tx(copy() as never)}`)).rejects.toMatchObject({ code: "23505" });
    await expect(getSql()`insert into public.sim_daily ${getSql()(copy() as never)}`).rejects.toMatchObject({ code: "23505" });
    // Past the launch's days, a date that isn't the day's, or an ad that isn't in the launch: refused, even for the owner.
    for (const over of [{ day: 31, date: "2026-12-06" }, { day: 9, date: "2026-11-20" }, { day: 9, date: "2026-11-14", variant_id: ids.ads[5] }]) {
      await expect(getSql()`insert into public.sim_daily ${getSql()(copy(over) as never)}`, JSON.stringify(over)).rejects.toThrow();
    }
    // Never rewritten: no update or delete, for the member (no grant) or the owner (the trigger).
    await expect(asUser(a.userId, (tx) => tx`update public.sim_daily set clicks = clicks + 1 where launch_id = ${launchId}`)).rejects.toThrow(/permission denied/);
    await expect(asUser(a.userId, (tx) => tx`delete from public.sim_daily where launch_id = ${launchId}`)).rejects.toThrow(/permission denied/);
    await expect(getSql()`update public.sim_daily set clicks = clicks + 1 where launch_id = ${launchId}`).rejects.toMatchObject({ code: "42501" });
    await expect(getSql()`update public.sim_daily set events = '{}' where launch_id = ${launchId}`).rejects.toMatchObject({ code: "42501" });
    await expect(getSql()`delete from public.sim_daily where launch_id = ${launchId}`).rejects.toMatchObject({ code: "42501" });
    expect(await storedRows(launchId)).toEqual(before);
    // The clock only moves forward, and only while live; it never passes the launch's days.
    await expect(getSql()`update public.launches set sim_day = 3 where id = ${launchId}`).rejects.toMatchObject({ code: "42501" });
    await expect(getSql()`update public.launches set sim_day = 31 where id = ${launchId}`).rejects.toMatchObject({ code: "23514" });
    expect(await simDayOf(launchId)).toBe(7);

    // Deleting a campaign still removes its launches' results (a cascade, not a rewrite).
    const spare = await rawLaunch(a, ids.spare, [ids.spareAd]);
    await advance(a, spare.launchId, 7, 0);
    expect(await countRows(spare.launchId)).toBe(7);
    await getSql()`delete from public.campaigns where id = ${ids.spare}`;
    expect(await countRows(spare.launchId)).toBe(0);
  });

  it("#6 an ended launch writes no more days, and keeps the day it ended on", async () => {
    expect(SIM_NOT_LIVE).toBe("There's no live launch to move on.");
    const { launchId } = await liveLaunch(3);
    for (let day = 0; day < 5; day++) await advance(a, launchId, 1, day);
    await endLaunch(a, launchId);
    const rows = await storedRows(launchId);
    expect(rows).toHaveLength(5 * 3);
    for (const by of [1, 7, "end"] as const) {
      expect(await refusal(advance(a, launchId, by, 5)), String(by)).toEqual({ clockError: true, message: SIM_NOT_LIVE });
    }
    signedInAs(a, aEmail);
    expect(await advanceClock(ids.main, launchId, "end", 5)).toEqual({ error: SIM_NOT_LIVE });
    expect(await storedRows(launchId)).toEqual(rows);
    // The day it ended on stays, for "Ended ... on simulated day 5 of 30.".
    expect((await launchesFor(a.userId, ids.main))![0]).toMatchObject({ id: launchId, status: "ended", simDay: 5 });

    // In the database too: no row for an ended launch, and its clock can't move, even for the owner.
    const [row] = await getSql()`select * from public.sim_daily where launch_id = ${launchId} and day = 5 limit 1`;
    const day6: Record<string, unknown> = { ...row, day: 6, date: "2026-11-11" };
    delete day6.id;
    delete day6.created_at;
    await expect(getSql()`insert into public.sim_daily ${getSql()(day6 as never)}`).rejects.toThrow();
    await expect(asUser(a.userId, (tx) => tx`insert into public.sim_daily ${tx(day6 as never)}`)).rejects.toThrow();
    await expect(getSql()`update public.launches set sim_day = 6 where id = ${launchId}`).rejects.toMatchObject({ code: "42501" });
    expect(await countRows(launchId)).toBe(15);
    expect(await simDayOf(launchId)).toBe(5);

    // A launch refused, or waiting for approval, has no clock to move either, and stays at day 0 (refused first: one open request at a time).
    const refused = await rawLaunch(a, ids.main, ids.ads.slice(0, 2), { status: "refused" });
    expect(await refusal(advance(a, refused.launchId, "end", 0))).toEqual({ clockError: true, message: SIM_NOT_LIVE });
    const waiting = await rawLaunch(a, ids.main, ids.ads.slice(0, 2), { status: "awaiting_approval" });
    expect(await refusal(advance(a, waiting.launchId, 1, 0))).toEqual({ clockError: true, message: SIM_NOT_LIVE });
    await expect(getSql()`update public.launches set sim_day = 1 where id = ${waiting.launchId}`).rejects.toMatchObject({ code: "42501" });
    expect(await countRows(waiting.launchId)).toBe(0);
    expect(await countRows(refused.launchId)).toBe(0);
  });

  it("#7 another workspace can't read a launch's results or advance its clock: the same refusal as a missing launch, and RLS in the database", async () => {
    const { launchId } = await liveLaunch(2);
    await advance(a, launchId, 7, 0);
    const before = await storedRows(launchId);
    expect(before).toHaveLength(14);

    // Through the app, as B: the same refusal as a launch that isn't there, or a malformed id.
    const missing = await refusal(advance(b, randomUUID(), 1, 0));
    expect(missing).toEqual({ clockError: true, message: SIM_NOT_LIVE });
    expect(await refusal(advance(a, "not-an-id", 1, 0))).toEqual(missing);
    // B is refused from any day, the day A's page shows too: nothing tells B which day A's clock is on.
    for (const fromDay of [0, 7]) {
      for (const by of [1, 7, "end"] as const) expect(await refusal(advance(b, launchId, by, fromDay)), `${by} from ${fromDay}`).toEqual(missing);
    }
    signedInAs(b, bEmail);
    expect(await advanceClock(ids.main, launchId, "end", 7)).toEqual({ error: SIM_NOT_LIVE });
    // A's own launch named under another campaign is refused too.
    signedInAs(a, aEmail);
    expect(await advanceClock(randomUUID(), launchId, 1, 7)).toEqual({ error: SIM_NOT_LIVE });
    expect(await simDayOf(launchId)).toBe(7);
    expect(await storedRows(launchId)).toEqual(before);

    // In the database, as B: no rows to read, and none can be written into A's workspace or about A's launch.
    expect(await asUser(b.userId, (tx) => tx`select * from public.sim_daily`)).toHaveLength(0);
    expect(await asUser(b.userId, (tx) => tx`select * from public.sim_daily where launch_id = ${launchId}`)).toHaveLength(0);
    expect((await asUser(b.userId, (tx) => tx`update public.launches set sim_day = 30 where id = ${launchId}`)).count).toBe(0);
    const [row] = await getSql()`select * from public.sim_daily where launch_id = ${launchId} and day = 7 limit 1`;
    const insertAs = (workspaceId: string) => {
      const r: Record<string, unknown> = { ...row, workspace_id: workspaceId, day: 8, date: "2026-11-13" };
      delete r.id;
      delete r.created_at;
      return asUser(b.userId, (tx) => tx`insert into public.sim_daily ${tx(r as never)}`);
    };
    await expect(insertAs(a.workspaceId)).rejects.toThrow(/row-level security/);
    await expect(insertAs(b.workspaceId)).rejects.toThrow();
    // The anonymous role has no access at all.
    expect(await asAnon((tx) => tx`select has_table_privilege('anon', 'public.sim_daily', 'select') as ok`)).toEqual([{ ok: false }]);
    // A reads its own.
    expect(await asUser(a.userId, (tx) => tx`select id from public.sim_daily where launch_id = ${launchId}`)).toHaveLength(14);
    expect(await countRows(launchId)).toBe(14);
  });

  it("#8 no model call: advancing a 60-day launch with eight ads adds nothing to usage_ledger", async () => {
    const counts = async () => {
      const [r] = await getSql()`select
        (select count(*)::int from public.usage_ledger) as ledger,
        (select count(*)::int from public.spend_reservations) as reservations,
        (select count(*)::int from public.agent_runs) as runs,
        (select count(*)::int from public.agent_steps) as steps`;
      return r;
    };
    const { launchId } = await liveLaunch(8, { days: 60, daily_budget_pence: 50_000 });
    const before = await counts();
    expect(await advance(a, launchId, 1, 0)).toMatchObject({ simDay: 1, written: 8 });
    expect(await advance(a, launchId, 7, 1)).toMatchObject({ simDay: 8, written: 56 });
    expect(await advance(a, launchId, "end", 8)).toEqual({ simDay: 60, days: 60, written: 52 * 8 });
    expect(await countRows(launchId)).toBe(480);
    expect(await counts()).toEqual(before);
    expect(modelCalls.count).toBe(0);
    // The simulator and the clock don't reach for a model at all.
    for (const file of ["src/lib/performance/simulate.ts", "src/lib/performance/clock.ts", "src/config/simulation.ts"]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(/@\/lib\/models|runModelStep|\bgenerate(Image)?\(/);
    }
    expect(readFileSync(join(process.cwd(), "src/lib/performance/simulate.ts"), "utf8")).not.toMatch(/Math\.random|@\/lib\/db|Date\.now|new Date\(\)/);
  }, 60_000);
});
