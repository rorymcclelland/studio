// P9-3 The Performance dashboard and healthy spend share, in the database
// (nothing is mocked but generate(), replaced by a spy that fails the test if
// anything calls it: the dashboard is pure code over stored facts, rule 5).
// Test cases 1 (the data layer gives each day exactly as health.ts works it
// out from the stored rows and today's compliance), 2 (one ad below its
// threshold on stored figures: the share is exactly the other ads' spend over
// the day's), 3 (compliance worked out again today: a banned term added to the
// kit after launch turns that ad Not compliant, and removing it restores it;
// every launched size and language counts), 5 (the home line counts live
// campaigns only, and gives nothing when none are live) and 8 (another
// workspace's campaign has no Performance view, the same as a missing one).
// The pure rules and the hand-worked figures are tests/lib/health.test.ts; the
// page is tests/e2e/performance.spec.ts.
//
// ---------------------------------------------------------------- interface
// The builder follows this; the tests here, in tests/lib/health.test.ts and in
// tests/e2e/performance.spec.ts pin it. No migration: P9-3 adds no table, so
// there is no new RLS to test (rule 7 is the data layer's asUser() and case 8).
//
// src/lib/performance/health.ts: pure. No database, no model, no clock, no Math.random
// (imports only types, ./launch-rules, ./clock-rules and @/lib/format). The page, the
// home line and the monitor (P9-4) all use it.
// - LEARNING = { days: 2, impressions: 2000 }; KPI_WINDOW_DAYS = 3.
// - type AdStatus = "healthy" | "below_threshold" | "not_compliant" | "learning";
//   STATUS_NAMES: healthy "Healthy", below_threshold "Below threshold", not_compliant
//   "Not compliant", learning "Learning".
// - NOT_ENOUGH_DATA = "Not enough data yet".
// - HEALTHY_DEFINITION (one line, shown on the page) = "Healthy spend is simulated spend on ads
//   that still pass compliance and whose KPI over their last three simulated days meets the
//   launch's threshold; learning spend (an ad's first two days or first 2,000 impressions) is
//   left out of the share."
// - type AdComplianceToday = { compliant: boolean; reason: string | null }   (reason null when compliant).
// - type HealthInput = {
//     threshold: { measure: KpiMeasure; value: number }   (launches.kpi_measure and kpi_value; ctr and
//       conversion_rate in percent, cpa in simulated pounds, roas a ratio),
//     ads: { variantId: string; compliance: AdComplianceToday }[]   (the launch's ads, in launch order;
//       the output follows this order),
//     rows: SimRow[]   (the launch's stored rows, any order; rows of other ads, and rows after the day
//       judged, are ignored) }.
// - type AdHealth = { variantId; spendPence (that day); spendToDatePence (days 1..day);
//     impressionsToDate (days 1..day); kpi: { measure, value: number, shown: string, from: number, to: number };
//     meets: boolean; learning: boolean; compliant: boolean; reason: string | null; status: AdStatus }.
//   - The KPI is over days from = max(1, day - 2) to = day, as ratios of sums:
//     ctr = clicks / impressions × 100; conversion_rate = conversions / clicks × 100 (no clicks: value 0,
//     shown "No clicks"); cpa = spend in pounds / conversions (no conversions: value Infinity, shown
//     "No conversions", infinitely bad); roas = revenue / spend. shown: ctr and conversion rate "1.11%",
//     cpa "£30.00", roas "2.00×" (two decimal places).
//   - meets: cpa at or below the value, the others at or above (HEALTHY_WHEN), at full precision; a
//     value exactly at the threshold meets it. No conversions or no clicks never meets.
//   - learning: day <= LEARNING.days, or impressionsToDate (including the day) < LEARNING.impressions.
//   - status, in this order (CHOSEN PRECEDENCE): not_compliant when not compliant (whatever the data: a
//     non-compliant ad's spend is unhealthy even while it learns), else learning, else below_threshold
//     when !meets, else healthy.
// - type DayHealth = { day; date; events (the day's rows' events); healthyPence (spend of "healthy"
//     ads); learningPence (spend of "learning" ads); totalPence (every launched ad's spend that day);
//     share: number | null; shareShown: string; ads: AdHealth[] }.
//   share = healthyPence / (totalPence - learningPence); null, shown NOT_ENOUGH_DATA, when that is 0
//   (all spend learning, Q4). Not compliant and below-threshold spend are on the bottom only.
// - dayHealth(input: HealthInput, day: number): DayHealth | null   (null when no launched ad has a row that day).
// - healthSeries(input: HealthInput, through: number): DayHealth[]   (days 1..through that have rows; each
//   equals dayHealth for that day). The trend judges every past day with TODAY's compliance:
//   compliance isn't stored by day, so a term added to the kit moves the whole line (the page says so).
// - shareText(share: number | null): "84%" (Math.round(share × 100)) or NOT_ENOUGH_DATA.
// - homeLine(campaigns: number, share: number | null): "Healthy spend share across 2 live campaigns: 84%
//   (simulated)"; "1 live campaign"; "...: Not enough data yet (simulated)".
//
// src/lib/performance/dashboard.ts (every read through asUser(), rule 7; no model call, rule 5):
// - COMPLIANCE_GONE = "Its picture or words have been discarded, so its compliance can't be worked out.";
//   COMPLIANCE_NOT_DRAWN = "A launched size or language can no longer be drawn, so it can't be checked.".
// - complianceToday(userId, ads: LaunchAd[]): Promise<Map<variantId, AdComplianceToday>>, one entry per ad.
//   Worked out again now with complianceFor() (the kit as it is today), then for every launched
//   language (outer) and size (inner) of the ad, fileCompliance(ad, lang, size) without `drawn`: compliant
//   only when every one has leftOut null (each passes or was accepted, the pack's rule). Otherwise the
//   reason is the first file's leftOut (the pack's words, e.g. "Fails: banned term 'X' in English."),
//   COMPLIANCE_NOT_DRAWN when fileCompliance is null, or COMPLIANCE_GONE when complianceFor has no
//   entry (discarded, or not the user's: nothing about another workspace's ad is told).
// - performanceFor(userId, campaignId): Promise<PerformanceView | null>. null when the id is malformed,
//   missing or another workspace's (the page calls notFound()). PerformanceView = {
//     campaignId, title (the signed-off brief's title, else the objective),
//     launch: LaunchView | null   (the live launch, else the newest ended one; null when neither:
//       the page says NOT_LAUNCHED = "This campaign has no live or ended simulated launch yet."),
//     simDay, days, clock: clockLabel(simDay, days)   (0, 0 and "" when launch is null),
//     ads: (LaunchAdView & { thumb: string | null /* the gallery's /ads/<id>.png?layout=... */; compliance: AdComplianceToday })[]
//       (launch order; adNumber and headline as launchAdsFor gives them),
//     latest: DayHealth | null   (dayHealth at simDay; null at day 0),
//     series: DayHealth[]   (healthSeries through simDay) }.
//   The HealthInput is built from the launch's threshold, its ads with complianceToday, and the
//   launch's stored sim_daily rows.
// - homeHealth(userId): Promise<HomeHealth | null>. Every LIVE launch in the user's workspace (ended,
//   waiting and refused ones are not counted), each judged at its own latest simulated day with
//   complianceToday; pooled by spend, not an average of shares: healthyPence, learningPence and
//   totalPence are the sums, share = healthy / (total - learning) or null. A live launch with no days
//   yet counts as a live campaign and adds no spend. HomeHealth = { campaigns, healthyPence,
//   learningPence, totalPence, share, line: homeLine(campaigns, share) }; null when nothing is live.
//
// src/proxy.ts: malformedRecordPath also covers /campaigns/<id>/performance (a malformed id is a 404).
//
// The page, src/app/(app)/campaigns/[id]/performance/page.tsx (the campaign page has no tabs, so
// this is its own route, linked from the Launch (simulated) panel while live or ended by a link
// "See performance (simulated)"); a server component inside <Suspense>, no client code for the chart.
// - [data-perf-header]: the h1 "Performance" (name starts with it), the campaign's title, a
//   "Simulated" pill, and [data-perf-clock] with clockLabel.
// - [data-perf-headline] with data-healthy-pence, data-learning-pence, data-total-pence (the latest
//   day's, 0 at day 0): the label "Healthy spend share", [data-perf-share] with shareText(latest.share)
//   (NOT_ENOUGH_DATA at day 0 too), and [data-perf-learning] "Learning spend £50.00 (simulated), left
//   out of the share" (contains formatPrice(learningPence)).
// - [data-perf-trend]: the share by day, [data-trend-day="<n>"] each with data-share = String(share),
//   or "" when null.
// - [data-perf-definition]: HEALTHY_DEFINITION, exactly.
// - [data-perf-trend-note]: "Every day is judged with today's compliance."
// - The chart, src/app/(app)/campaigns/[id]/performance/chart.tsx: export function PerformanceChart(
//   { series: DayHealth[]; ads: { variantId; adNumber; headline }[]; threshold: { measure; value }; days: number })
//   with no hooks (renderable with renderToStaticMarkup). It renders:
//   <svg data-perf-chart role="img" aria-describedby="<the table's id>"> with a <title> that says
//   simulated, a <text> "Simulated" drawn on it, spend and the KPI per ad per day, and per day with
//   events <g data-perf-event="<YYYY-MM-DD>" data-events="<names joined by ', '>"> (in that attribute
//   order); and <table data-perf-chart-table id="..."> (visually hidden or in a details: for screen
//   readers) with a <caption> ending "(simulated)", one <tr data-perf-chart-row="<day>"> per day with
//   <td data-perf-cell-spend="<variantId>">formatPrice(spend)</td>, <td data-perf-cell-kpi="<variantId>">
//   kpi.shown</td> (the three-day KPI as of that day), <td data-perf-cell-share="">shareText</td> and
//   <td data-perf-cell-events="">names joined by ", "</td>, each cell's text directly inside it.
// - [data-perf-ads]: a table, one <tr data-perf-ad="<variantId>" data-status="<AdStatus>"
//   data-day-spend-pence="<n>"> per ad in launch order, with [data-perf-thumb] (an <img>),
//   [data-perf-words] (the headline), [data-perf-spend-to-date] (formatPrice), [data-perf-kpi]
//   (kpi.shown), [data-perf-status] (STATUS_NAMES) and, when not compliant, [data-perf-reason].
// Studio's home (src/app/(app)/page.tsx): [data-home-health] with homeHealth's line; nothing when null.
// ----------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));
// Rule 5: the dashboard reads stored facts; it never calls a model.
const modelCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/models/generate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/models/generate")>();
  const refuse = async () => {
    modelCalls.count++;
    throw new Error("The dashboard must not call a model");
  };
  return { ...real, generate: refuse, generateImage: refuse };
});

import { adCompliance, decideFinding } from "@/lib/compliance/compute";
import { clearSizeCache } from "@/lib/creative/ad-sizes";
import { DEMO_LANGUAGES } from "@/lib/creative/languages";
import { clearPackFitCache } from "@/lib/creative/pack";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { advance } from "@/lib/performance/clock";
import { COMPLIANCE_GONE, complianceToday, homeHealth, performanceFor } from "@/lib/performance/dashboard";
import { dayHealth, healthSeries, homeLine, type HealthInput } from "@/lib/performance/health";
import { endLaunch, type LaunchAd } from "@/lib/performance/launch";
import { simulateDays, type SimLaunch, type SimRow } from "@/lib/performance/simulate";
import { malformedRecordPath } from "@/proxy";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, builder, campaignFor, EN, productsFor, rawLaunch, SOCIAL, type Member } from "../helpers/launch";

const HEADLINES = ["Made for the long way round", "Kit for the long way round", "Walk further this autumn"];
const DE = { headline: "Für den langen Weg gemacht", body: "Eine Jacke für nasse Tage am Berg, gemacht zum Flicken statt zum Ersetzen.", cta: "Jacken ansehen" };

let a: Member;
let b: Member;
let brandA: string;
let ids: {
  /** A's signed-off campaign with three picked, accepted ads (the headlines above). */
  main: string;
  ads: string[];
  /** Three more of A's campaigns with one accepted ad each, for the home line. */
  second: string;
  secondAd: string;
  third: string;
  thirdAd: string;
  fourth: string;
  fourthAd: string;
  /** A's campaign with an ad translated into German, accepted. */
  translated: string;
  germanAd: string;
  /** An ad whose picture is discarded once launched. */
  goneAd: string;
  /** A's campaign that is never launched. */
  unlaunched: string;
  /** B's own campaign and ad. */
  theirs: string;
  theirAd: string;
};
/** A's brand's active product prices, ascending, as the clock reads them. */
let prices: number[];

const asAds = (variantIds: string[], langs: LaunchAd["langs"] = ["en-GB"]): LaunchAd[] => variantIds.map((variantId) => ({ variantId, sizes: SOCIAL as LaunchAd["sizes"], langs }));

/** Accepts every open review item on an ad, as a person does on its Compliance view. */
async function acceptReviews(m: Member, variantId: string) {
  const ad = (await adCompliance(m.userId, variantId))!;
  for (const f of [...ad.perAd, ...ad.picture, ...ad.items.flatMap((i) => i.findings)]) {
    if (f.outcome !== "review") continue;
    await decideFinding(m, variantId, { lang: f.lang, size: f.size, rule: f.key, hash: f.hash, decision: "accept", note: "Checked by hand" });
  }
}

/** A launch's stored rows, as the simulator's rows. */
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

/** Moves a live launch on to `day`, a week at a time, then a day at a time. */
async function toDay(m: Member, launchId: string, day: number) {
  let at = 0;
  while (at < day) at = (await advance(m, launchId, day - at >= 7 ? 7 : 1, at)).simDay;
}

/** What health.ts says for a launch, from its stored rows and today's compliance, as an independent reading. */
async function expectedInput(m: Member, launchId: string): Promise<HealthInput> {
  const [l] = await getSql()`select kpi_measure, kpi_value::text as kpi_value, ads from public.launches where id = ${launchId}`;
  const ads = l.ads as LaunchAd[];
  const compliance = await complianceToday(m.userId, ads);
  return {
    threshold: { measure: l.kpi_measure, value: Number(l.kpi_value) },
    ads: ads.map((x) => ({ variantId: x.variantId, compliance: compliance.get(x.variantId)! })),
    rows: await storedRows(launchId),
  };
}

const setBanned = (m: Member, terms: string[]) => asUser(m.userId, (tx) => tx`update public.brands set banned_terms = ${terms} where id = ${brandA}`);

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  brandA = await brandFor(a, "fernhollow");
  const sold = FERNHOLLOW.products.slice(0, 3);
  await productsFor(a, brandA, sold.map((p) => ({ name: p.name, pricePence: p.pricePence })));
  prices = sold.map((p) => p.pricePence).sort((x, y) => x - y);

  const main = await campaignFor(a, brandA, "signed off", "Bring walkers back for autumn, watched on the Performance view");
  const m = builder(a, brandA, main);
  const image = await m.image("performance one");
  const layouts = ["card", "full-bleed", "split"] as const;
  const adIds: string[] = [];
  for (let i = 0; i < 3; i++) adIds.push(await m.ad(image, await m.words(HEADLINES[i]), layouts[i], true));

  const one = async (objective: string, prompt: string) => {
    const c = await campaignFor(a, brandA, "signed off", objective);
    const x = builder(a, brandA, c);
    return { c, ad: await x.ad(await x.image(prompt), await x.words(EN.headline), "card", true) };
  };
  const second = await one("A second live campaign", "performance second");
  const third = await one("A campaign whose launch ended", "performance third");
  const fourth = await one("A campaign waiting for its launch's approval", "performance fourth");

  // An ad translated into German, as Translate records it.
  const translated = await campaignFor(a, brandA, "signed off", "Walkers in Germany too");
  const t = builder(a, brandA, translated);
  const setId = await t.words(EN.headline);
  await asUser(a.userId, (tx) => tx`
    insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by, lang, translated_from, simulated)
    values (${a.workspaceId}, ${translated}, 1, 'paid social', 'Walkers', ${tx.json(DE)}, ${DEMO_LANGUAGES.fernhollow["de-DE"].legalLines}, 'agent', ${a.userId}, 'de-DE', ${setId}, true)`);
  const germanAd = await t.ad(await t.image("performance german"), setId, "card", true);
  const goneAd = await t.ad(await t.image("performance gone"), await t.words("Mend it, don't replace it"), "card", true);

  const unlaunched = await campaignFor(a, brandA, "signed off", "Signed off, never launched");

  const brandB = await brandFor(b, "fernhollow");
  const theirs = await campaignFor(b, brandB, "signed off", "B's own campaign");
  const y = builder(b, brandB, theirs);
  const theirAd = await y.ad(await y.image("performance theirs"), await y.words(EN.headline), "card", true);

  for (const v of [...adIds, second.ad, third.ad, fourth.ad, germanAd, goneAd]) await acceptReviews(a, v);
  await acceptReviews(b, theirAd);

  ids = { main, ads: adIds, second: second.c, secondAd: second.ad, third: third.c, thirdAd: third.ad, fourth: fourth.c, fourthAd: fourth.ad, translated, germanAd, goneAd, unlaunched, theirs, theirAd };
}, 300_000);

beforeEach(async () => {
  clearSizeCache();
  clearPackFitCache();
  modelCalls.count = 0;
  // Each test starts with no results and no launches, and the kit as the demo loads it (as the tables' owner).
  await getSql()`truncate public.sim_daily`;
  await getSql()`delete from public.launches`;
  await getSql()`delete from public.approvals where kind = 'launch'`;
  await getSql()`update public.brands set banned_terms = ${FERNHOLLOW.kit.bannedTerms} where id = ${brandA}`;
});
afterAll(closeSql);

// These two make many round trips; on CI's Neon branch, across the network, they run just over
// the job's 60-second limit (also on main), while locally they take a few seconds.
const SLOW_ON_NEON = 240_000;

describe("P9-3 the Performance view's data", () => {
  it("#1 performanceFor gives the launch's latest simulated day and every day before it, exactly as health.ts works them out from the stored rows and today's compliance", async () => {
    const { launchId } = await rawLaunch(a, ids.main, ids.ads);
    // Before the first day: the launch, its ads, and nothing to judge yet.
    const before = (await performanceFor(a.userId, ids.main))!;
    expect(before).toMatchObject({ campaignId: ids.main, simDay: 0, days: 30, clock: "No simulated days yet (30 to run)", latest: null, series: [] });
    expect(before.launch).toMatchObject({ id: launchId, status: "live", kpiMeasure: "cpa", kpiValue: 20 });
    expect(before.title).toBe("Long way round 1");

    await toDay(a, launchId, 10);
    const view = (await performanceFor(a.userId, ids.main))!;
    expect(view).toMatchObject({ campaignId: ids.main, simDay: 10, days: 30, clock: "Simulated day 10 of 30" });
    // The ads, in launch order, with their number, words, picture and compliance today (all accepted, so compliant).
    expect(view.ads.map((x) => [x.variantId, x.headline])).toEqual(ids.ads.map((v, i) => [v, HEADLINES[i]]));
    for (const x of view.ads) {
      expect(x.adNumber, x.variantId).toBeGreaterThan(0);
      expect(x.thumb, x.variantId).toMatch(new RegExp(`^/ads/${x.variantId}`));
      expect(x.sizes, x.variantId).toEqual(SOCIAL);
      expect(x.compliance, x.variantId).toEqual({ compliant: true, reason: null });
    }
    // The headline, the table and the chart are health.ts's, over the stored rows.
    const input = await expectedInput(a, launchId);
    expect(input.rows).toHaveLength(30);
    expect(view.latest).toEqual(dayHealth(input, 10));
    expect(view.series).toEqual(healthSeries(input, 10));
    expect(view.series.map((d) => d.day)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    // The day-10 figures add up to the stored day's spend, and the share is healthy over what isn't learning.
    const day10 = input.rows.filter((r) => r.day === 10);
    const latest = view.latest!;
    expect(latest.totalPence).toBe(day10.reduce((n, r) => n + r.spendPence, 0));
    expect(latest.totalPence).toBeGreaterThanOrEqual(4999);
    expect(latest.learningPence).toBe(0);
    expect(latest.healthyPence).toBe(latest.ads.filter((x) => x.status === "healthy").reduce((n, x) => n + x.spendPence, 0));
    expect(latest.share).toBe(latest.healthyPence / latest.totalPence);
    // Days 1 and 2 are learning for every ad, so their share is Not enough data yet.
    expect(view.series.slice(0, 2).map((d) => d.share)).toEqual([null, null]);
    expect(modelCalls.count).toBe(0);
  });

  it("#1 a campaign with no live or ended launch has no performance to show, and an ended launch still shows its last simulated day", async () => {
    expect(await performanceFor(a.userId, ids.unlaunched)).toMatchObject({ campaignId: ids.unlaunched, launch: null, simDay: 0, latest: null, series: [], ads: [] });
    // Waiting for approval, or refused: not a launch to show.
    await rawLaunch(a, ids.fourth, [ids.fourthAd], { status: "awaiting_approval" });
    expect((await performanceFor(a.userId, ids.fourth))!.launch).toBeNull();
    await rawLaunch(a, ids.third, [ids.thirdAd], { status: "refused" });
    expect((await performanceFor(a.userId, ids.third))!.launch).toBeNull();
    // Ended on day 5: the view keeps day 5.
    const { launchId } = await rawLaunch(a, ids.third, [ids.thirdAd]);
    await toDay(a, launchId, 5);
    await endLaunch(a, launchId);
    const ended = (await performanceFor(a.userId, ids.third))!;
    expect(ended).toMatchObject({ simDay: 5, clock: "Simulated day 5 of 30" });
    expect(ended.launch).toMatchObject({ id: launchId, status: "ended" });
    expect(ended.latest).toEqual(dayHealth(await expectedInput(a, launchId), 5));
  });

  it("#2 one ad below its threshold on the stored day-10 figures: its status is Below threshold, and the share is exactly the other ads' spend over the day's", async () => {
    // The threshold is set between the lowest and the next click-through rate over days 8 to 10, worked out first
    // with the pure simulator (the stored rows are the simulator's, P9-2 #1), so exactly one ad is below it.
    const launch: SimLaunch = { seed: "42", startsOn: "2026-11-06", days: 30, dailyBudgetPence: 5000, ads: asAds(ids.ads), orderValuesPence: prices };
    const rows = simulateDays(launch, 1, 10, []);
    const probe = dayHealth({ threshold: { measure: "ctr", value: 0.0001 }, ads: ids.ads.map((variantId) => ({ variantId, compliance: { compliant: true, reason: null } })), rows }, 10)!;
    const ranked = [...probe.ads].sort((x, y) => x.kpi.value - y.kpi.value);
    expect(ranked[1].kpi.value).toBeGreaterThan(ranked[0].kpi.value);
    const value = (ranked[0].kpi.value + ranked[1].kpi.value) / 2;

    const { launchId } = await rawLaunch(a, ids.main, ids.ads, { kpi_measure: "ctr", kpi_value: value });
    await toDay(a, launchId, 10);
    expect(await storedRows(launchId)).toEqual(rows.sort((x, y) => x.day - y.day || (x.variantId < y.variantId ? -1 : 1)));
    const latest = (await performanceFor(a.userId, ids.main))!.latest!;
    const below = latest.ads.filter((x) => x.status === "below_threshold");
    expect(below.map((x) => x.variantId)).toEqual([ranked[0].variantId]);
    expect(latest.ads.filter((x) => x.status === "healthy")).toHaveLength(2);
    // Nothing is learning on day 10, so the share drops from 100% by exactly that ad's share of the day's spend.
    expect(latest.learningPence).toBe(0);
    expect(latest.share).toBeCloseTo((latest.totalPence - below[0].spendPence) / latest.totalPence, 12);
    expect(1 - latest.share!).toBeCloseTo(below[0].spendPence / latest.totalPence, 12);
  });

  it("#3 compliance is worked out again today: a banned term added to the kit after launch turns that ad Not compliant with the pack's reason, its spend leaves the healthy share, and removing the term restores it", async () => {
    // A threshold every ad meets, so every ad is healthy on day 10 while it is compliant.
    const { launchId } = await rawLaunch(a, ids.main, ids.ads, { kpi_measure: "ctr", kpi_value: 0.01 });
    await toDay(a, launchId, 10);
    const healthy = (await performanceFor(a.userId, ids.main))!.latest!;
    expect(healthy.ads.map((x) => x.status)).toEqual(["healthy", "healthy", "healthy"]);
    expect(healthy.share).toBe(1);

    // The kit gains ad 1's headline as a banned term, after the launch.
    await setBanned(a, [...FERNHOLLOW.kit.bannedTerms, HEADLINES[0]]);
    const today = await complianceToday(a.userId, asAds(ids.ads));
    expect(today.get(ids.ads[0])).toEqual({ compliant: false, reason: `Fails: banned term '${HEADLINES[0]}' in English.` });
    expect(today.get(ids.ads[1])).toEqual({ compliant: true, reason: null });
    expect(today.get(ids.ads[2])).toEqual({ compliant: true, reason: null });
    const view = (await performanceFor(a.userId, ids.main))!;
    expect(view.ads[0].compliance).toEqual(today.get(ids.ads[0]));
    const after = view.latest!;
    const ad1 = after.ads[0];
    expect(ad1).toMatchObject({ variantId: ids.ads[0], compliant: false, status: "not_compliant", reason: `Fails: banned term '${HEADLINES[0]}' in English.` });
    // Its spend leaves the healthy side only; the day's spend and the stored rows are unchanged.
    expect(after.totalPence).toBe(healthy.totalPence);
    expect(after.healthyPence).toBe(healthy.healthyPence - ad1.spendPence);
    expect(after.share).toBeCloseTo((healthy.totalPence - ad1.spendPence) / healthy.totalPence, 12);
    // The home line uses the same compliance.
    expect((await homeHealth(a.userId))!.share).toBe(after.share);
    // The trend judges every day with today's compliance (Not compliant comes before Learning, so days 1 and 2 too).
    expect(view.series.every((d) => d.ads[0].status === "not_compliant")).toBe(true);

    // The term removed: compliant again, and the share is back.
    await setBanned(a, FERNHOLLOW.kit.bannedTerms);
    const restored = (await performanceFor(a.userId, ids.main))!.latest!;
    expect(restored).toEqual(healthy);
  }, SLOW_ON_NEON);

  it("#3 compliance today covers every launched size and language: a German banned term fails a launched German file, an English-only ad is untouched, and a discarded ad is Not compliant", async () => {
    const german: LaunchAd = { variantId: ids.germanAd, sizes: SOCIAL as LaunchAd["sizes"], langs: ["en-GB", "de-DE"] };
    const englishOnly: LaunchAd = { variantId: ids.germanAd, sizes: SOCIAL as LaunchAd["sizes"], langs: ["en-GB"] };
    expect((await complianceToday(a.userId, [german])).get(ids.germanAd)).toEqual({ compliant: true, reason: null });
    const [{ before }] = await getSql()`select banned_terms as before from public.brand_languages where brand_id = ${brandA} and lang = 'de-DE'`;
    try {
      await asUser(a.userId, (tx) => tx`update public.brand_languages set banned_terms = array_append(banned_terms, ${DE.headline}) where brand_id = ${brandA} and lang = 'de-DE'`);
      const today = (await complianceToday(a.userId, [german])).get(ids.germanAd)!;
      expect(today.compliant).toBe(false);
      expect(today.reason).toMatch(/^Fails: banned term '.+' in German\.$/);
      // Launched in English only, the same ad is compliant: only what launched counts.
      expect((await complianceToday(a.userId, [englishOnly])).get(ids.germanAd)).toEqual({ compliant: true, reason: null });
    } finally {
      await getSql()`update public.brand_languages set banned_terms = ${before} where brand_id = ${brandA} and lang = 'de-DE'`;
    }
    expect((await complianceToday(a.userId, [german])).get(ids.germanAd)).toEqual({ compliant: true, reason: null });

    // A size the ad was never launched in doesn't count either.
    expect((await complianceToday(a.userId, [{ ...englishOnly, sizes: ["1080x1080"] as LaunchAd["sizes"] }])).get(ids.germanAd)).toEqual({ compliant: true, reason: null });

    // Its picture discarded after launch: its compliance can't be worked out, so it isn't compliant.
    expect((await complianceToday(a.userId, asAds([ids.goneAd]))).get(ids.goneAd)).toEqual({ compliant: true, reason: null });
    await getSql()`update public.assets set discarded_at = now() where id = (select image_asset_id from public.ad_variants where id = ${ids.goneAd})`;
    expect((await complianceToday(a.userId, asAds([ids.goneAd]))).get(ids.goneAd)).toEqual({ compliant: false, reason: COMPLIANCE_GONE });
    // Every ad asked about gets an answer, an unknown id too, and nothing about it is told.
    const unknown = randomUUID();
    expect((await complianceToday(a.userId, asAds([unknown]))).get(unknown)).toEqual({ compliant: false, reason: COMPLIANCE_GONE });
  });
});

describe("P9-3 the home line", () => {
  it("#5 homeHealth counts live campaigns only, pooling each one's latest simulated day, and gives nothing when none are live", async () => {
    // Nothing live: an ended launch and one waiting for approval don't count.
    expect(await homeHealth(a.userId)).toBeNull();
    const ended = await rawLaunch(a, ids.third, [ids.thirdAd]);
    await toDay(a, ended.launchId, 5);
    await endLaunch(a, ended.launchId);
    await rawLaunch(a, ids.fourth, [ids.fourthAd], { status: "awaiting_approval" });
    expect(await homeHealth(a.userId)).toBeNull();

    // One live campaign with no days yet: it counts, with nothing to judge.
    const second = await rawLaunch(a, ids.second, [ids.secondAd]);
    expect(await homeHealth(a.userId)).toEqual({ campaigns: 1, healthyPence: 0, learningPence: 0, totalPence: 0, share: null, line: "Healthy spend share across 1 live campaign: Not enough data yet (simulated)", live: expect.any(Array) });

    // Two live: the main campaign on day 10 and the second on day 2 (all learning). Pooled by spend, each at its latest day.
    const main = await rawLaunch(a, ids.main, ids.ads);
    await toDay(a, main.launchId, 10);
    await toDay(a, second.launchId, 2);
    const m10 = dayHealth(await expectedInput(a, main.launchId), 10)!;
    const s2 = dayHealth(await expectedInput(a, second.launchId), 2)!;
    expect(s2.share).toBeNull();
    const healthyPence = m10.healthyPence + s2.healthyPence;
    const learningPence = m10.learningPence + s2.learningPence;
    const totalPence = m10.totalPence + s2.totalPence;
    const share = totalPence - learningPence > 0 ? healthyPence / (totalPence - learningPence) : null;
    const home = await homeHealth(a.userId);
    // U10-5 added each live campaign (`live`); tests/flows/home-work.test.ts checks it.
    expect(home).toEqual({ campaigns: 2, healthyPence, learningPence, totalPence, share, line: homeLine(2, share), live: expect.any(Array) });
    expect(home!.line).toMatch(/^Healthy spend share across 2 live campaigns: (\d{1,3}%|Not enough data yet) \(simulated\)$/);
    // The ended campaign's spend is in neither side.
    expect(totalPence).toBe(m10.totalPence + s2.totalPence);

    // B's live launch is B's alone: it isn't counted for A, and A's aren't for B.
    const theirs = await rawLaunch(b, ids.theirs, [ids.theirAd]);
    await toDay(b, theirs.launchId, 3);
    expect((await homeHealth(a.userId))!.campaigns).toBe(2);
    const bHome = (await homeHealth(b.userId))!;
    const t3 = dayHealth(await expectedInput(b, theirs.launchId), 3)!;
    expect(bHome).toMatchObject({ campaigns: 1, healthyPence: t3.healthyPence, totalPence: t3.totalPence });

    // Ending the main launch leaves one live campaign; ending the last leaves nothing.
    await endLaunch(a, main.launchId);
    expect((await homeHealth(a.userId))!.campaigns).toBe(1);
    await endLaunch(a, second.launchId);
    expect(await homeHealth(a.userId)).toBeNull();
    expect(modelCalls.count).toBe(0);
  }, SLOW_ON_NEON);
});

describe("P9-3 another workspace", () => {
  it("#8 another workspace's campaign has no Performance view: performanceFor is null, the same as a missing or malformed id", async () => {
    const { launchId } = await rawLaunch(a, ids.main, ids.ads);
    await toDay(a, launchId, 3);
    expect(await performanceFor(a.userId, ids.main)).not.toBeNull();
    // B: the same answer as a campaign that isn't there, or an id that can't be one.
    expect(await performanceFor(b.userId, ids.main)).toBeNull();
    for (const id of [randomUUID(), "not-an-id", `${ids.main}x`, "../../etc/passwd", "1' or '1'='1", ""]) {
      expect(await performanceFor(a.userId, id), id).toBeNull();
    }
    // B's own campaign answers, so the null is about access.
    expect(await performanceFor(b.userId, ids.theirs)).toMatchObject({ campaignId: ids.theirs, launch: null });
    // Nothing of A's compliance reaches B: A's ads are unknown to B.
    const told = await complianceToday(b.userId, asAds(ids.ads));
    for (const v of ids.ads) expect(told.get(v), v).toEqual({ compliant: false, reason: COMPLIANCE_GONE });
    expect(await homeHealth(b.userId)).toBeNull();
    // A malformed id on the page itself is a real 404 before it streams.
    expect(malformedRecordPath("/campaigns/nope/performance")).toBe(true);
    expect(malformedRecordPath(`/campaigns/${ids.main}x/performance`)).toBe(true);
    expect(malformedRecordPath(`/campaigns/${ids.main}/performance`)).toBe(false);
  });
});
