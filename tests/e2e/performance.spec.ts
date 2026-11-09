// P9-3 The Performance dashboard and healthy spend share through the UI, with
// the mock models. Each test follows tests/e2e/simulation.spec.ts's flow on a
// new signed-off Fernhollow campaign with ads (simulated pictures), launched
// with the defaults and approved in the inbox; the database is read through
// DATABASE_URL, so the page's figures can be checked against health.ts over
// the stored rows. It is written only for a waiting launch's threshold, and in
// test 2 the setup and clean-up below. A launch's terms never change once it
// is asked for (launches_terms, the rule P9-1.6 checks in
// tests/db/launch.test.ts #6, with the fixture's own test there), so the
// browser-test fixture (tests/e2e/launch-fixture.ts) sets the threshold as the
// table's owner, switching launches_terms off for that one update.
//
// 1. Cases 1, 2, 4, 6 and 7 (main project). Three paid-social ads are picked
//    and launched. While the launch waits for approval the fixture sets its threshold to
//    a click-through rate between the lowest and the next ad's over days 8 to
//    10, worked out first with the pure simulator, so exactly one ad is below
//    it on day 10 (case 2). Day 1: the headline reads "Not enough data yet",
//    with the learning spend shown, and every ad is Learning (case 4). Day 10:
//    the headline, each ad's row, the chart's table, the trend and the event
//    marks are health.ts's over the stored rows (case 1), and the share is
//    exactly the other two ads' spend over the day's (case 2). "Simulated" is
//    in the header and on the chart, and the home line says simulated (case 6;
//    no CSV export is added this sprint). Day 1 and day 10 at 375 px and
//    1440 px: nothing scrolls sideways, AA contrast, and the chart has a table
//    for screen readers (case 7). The failure path: a campaign that isn't in
//    the workspace shows Not found, and a malformed id is a 404.
// 2. Cases 3 and 5 (tagged @brand-kit: it changes Fernhollow's banned terms
//    for a moment, and it ends every live launch in the dev workspace first,
//    so it runs in the brand-kit project, after every other spec and one at a
//    time). With nothing live, the home page has no healthy spend line. Two
//    ads with different words launch on campaign A with a threshold every ad
//    meets, and run a week: the home line counts 1 live campaign at 100%.
//    Campaign B launches too (no days yet): 2 live campaigns. Ad 1's headline
//    is added to the kit's banned terms on the brand kit editor: ad 1 is Not
//    compliant with the pack's reason, its spend leaves the healthy share, and
//    the home line moves with it; removing the term restores 100% (case 3).
//    Ending B leaves 1 live campaign, and ending A leaves no line (case 5).
//
// SHOTS_DIR=<folder> saves screenshots. The interface it expects is written at
// the top of tests/db/performance.test.ts.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { formatPrice } from "@/lib/format";
import { dayHealth, healthSeries, HEALTHY_DEFINITION, NOT_ENOUGH_DATA, shareText, STATUS_NAMES, type HealthInput } from "@/lib/performance/health";
import type { LaunchAd } from "@/lib/performance/launch";
import { simulateDays, type SimLaunch, type SimRow } from "@/lib/performance/simulate";
import {
  acceptDontRulesForPicked,
  contrastViolations,
  demoBrandId,
  DEV_EMAIL,
  expectNoHorizontalScroll,
  inboxCard,
  makeCreative,
  newCampaign,
  openLaunch,
  saveShot,
  settle,
  signIn,
  signOffVersion,
  step,
} from "./helpers";
import { setWaitingLaunchTerms } from "./launch-fixture";

type Sql = postgres.Sql;

const panel = (page: Page) => page.locator("[data-launch-panel]");
const launchStatus = (page: Page) => panel(page).locator("[data-launch-status]");
const clock = (page: Page) => panel(page).locator("[data-sim-clock]");
const social = (page: Page) => page.locator('[data-gallery] > li[data-channel="paid social"]');
const headline = (page: Page) => page.locator("[data-perf-headline]");
const share = (page: Page) => page.locator("[data-perf-headline] [data-perf-share]");
const adRow = (page: Page, variantId: string) => page.locator(`[data-perf-ads] [data-perf-ad="${variantId}"]`);
const homeLine = (page: Page) => page.locator("[data-home-health]");
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const campaignIdOf = (path: string) => path.split("/").pop()!;

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    await saveShot(page, `${what}-${width}`, { fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Picks a paid-social ad from its card. */
async function pickCard(page: Page, card: ReturnType<Page["locator"]>) {
  await card.getByRole("button", { name: /^Pick ad \d+$/ }).click();
  await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
}

/** The campaign's Launch stage (U10-2), through the stage bar, with its Launch (simulated) panel. */
async function openPanel(page: Page, path: string) {
  await openLaunch(page, path);
}

/** Ask to launch with the panel's defaults; the launch then waits for approval. */
async function askToLaunch(page: Page, path: string, ads: number) {
  await openPanel(page, path);
  await expect(panel(page).locator("[data-launch-ad]")).toHaveCount(ads);
  await panel(page).getByRole("button", { name: "Ask to launch" }).click();
  await expect(launchStatus(page)).toHaveText("Waiting for approval", { timeout: 30_000 });
}

async function approveInInbox(page: Page, path: string) {
  await page.goto("/approvals");
  await settle(page);
  const card = inboxCard(page, "launch", path);
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await openPanel(page, path);
  await expect(launchStatus(page)).toHaveText("Live (simulated)");
}

/** Moves the clock on from the campaign's panel and waits for the day. */
async function moveOn(page: Page, path: string, button: "Next day" | "Next week", day: number) {
  await openPanel(page, path);
  await panel(page).getByRole("button", { name: button }).click();
  await expect(clock(page)).toHaveText(`Simulated day ${day} of 30`, { timeout: 30_000 });
}

/** Opens the Performance view from the Launch (simulated) panel's link. */
async function openPerformance(page: Page, path: string) {
  await openPanel(page, path);
  await panel(page).getByRole("link", { name: "See performance (simulated)" }).click();
  await page.waitForURL(new RegExp(`${escape(path)}/performance$`));
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: /^Performance/ })).toBeVisible();
}

async function launchOf(sql: Sql, campaignId: string, status: string) {
  const [l] = await sql`
    select id, seed::text as seed, to_char(starts_on, 'YYYY-MM-DD') as starts_on, days, daily_budget_pence, ads, kpi_measure, kpi_value::text as kpi_value
    from public.launches where campaign_id = ${campaignId} and status = ${status}`;
  expect(l, `a ${status} launch of ${campaignId}`).toBeDefined();
  return l;
}

async function storedRows(sql: Sql, launchId: string): Promise<SimRow[]> {
  const rows = await sql`
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

/** The headline's figures, from its data attributes. */
async function headlineFigures(page: Page) {
  const n = async (name: string) => Number(await headline(page).getAttribute(name));
  return { healthy: await n("data-healthy-pence"), learning: await n("data-learning-pence"), total: await n("data-total-pence") };
}

/** Each ad's row on the page: its status and the day's spend, in the table's order. */
async function adRows(page: Page) {
  return page.locator("[data-perf-ads] [data-perf-ad]").evaluateAll((rows) =>
    rows.map((r) => ({ variantId: r.getAttribute("data-perf-ad")!, status: r.getAttribute("data-status")!, spend: Number(r.getAttribute("data-day-spend-pence")) })),
  );
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "P9-3 #1, #2, #4, #6, #7: a launched Fernhollow campaign's Performance view reads Not enough data yet on day 1, then shows the stored day-10 figures as health.ts works them out, with one ad below its threshold, labelled simulated",
  {
    annotation: [
      { type: "case", description: "P9-3.1" },
      { type: "case", description: "P9-3.2" },
      { type: "case", description: "P9-3.4" },
      { type: "case", description: "P9-3.6" },
      { type: "case", description: "P9-3.7" },
    ],
  },
  async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to read the stored results and set the threshold before approval");
    test.setTimeout(900_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    let path = "";
    let launchId = "";
    let belowAd = "";
    try {
      await step(page, "A signed-off Fernhollow brief and its ads (simulated pictures); pick three paid-social ads and accept their don't rules", async () => {
        path = await newCampaign(page, "Fernhollow Outfitters", "Bring walkers back for the autumn range, watched day by day on the Performance view");
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
        expect(await social(page).count()).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < 3; i++) await pickCard(page, social(page).nth(i));
        await page.reload();
        await acceptDontRulesForPicked(page);
      });

      await step(page, "Ask to launch with the defaults; while it waits, set a click-through-rate threshold that exactly one ad will miss on day 10", async () => {
        await askToLaunch(page, path, 3);
        const l = await launchOf(sql, campaignIdOf(path), "awaiting_approval");
        launchId = l.id as string;
        const prices = await sql`
          select p.price_pence from public.products p join public.campaigns c on c.brand_id = p.brand_id
          where c.id = ${campaignIdOf(path)} and p.active order by p.price_pence`;
        const launch: SimLaunch = {
          seed: l.seed,
          startsOn: l.starts_on,
          days: l.days,
          dailyBudgetPence: l.daily_budget_pence,
          ads: l.ads as LaunchAd[],
          orderValuesPence: prices.map((p) => p.price_pence as number),
        };
        // The stored rows will be the simulator's (P9-2 #1), so the day-10 rates can be worked out now.
        const rows = simulateDays(launch, 1, 10, []);
        const probe = dayHealth({ threshold: { measure: "ctr", value: 0.0001 }, ads: launch.ads.map((x) => ({ variantId: x.variantId, compliance: { compliant: true, reason: null } })), rows }, 10)!;
        const ranked = [...probe.ads].sort((x, y) => x.kpi.value - y.kpi.value);
        expect(ranked[1].kpi.value).toBeGreaterThan(ranked[0].kpi.value);
        belowAd = ranked[0].variantId;
        // A launch's terms never change once asked for (launches_terms): the fixture sets them as the tables' owner.
        await setWaitingLaunchTerms(sql, launchId, { kpi_measure: "ctr", kpi_value: (ranked[0].kpi.value + ranked[1].kpi.value) / 2 });
        await approveInInbox(page, path);
      });

      await step(page, "P9-3.4: day 1, the headline reads Not enough data yet, with the day's learning spend shown, and every ad is Learning", async () => {
        await moveOn(page, path, "Next day", 1);
        await openPerformance(page, path);
        await expect(page.locator("[data-perf-header] [data-perf-clock]")).toHaveText("Simulated day 1 of 30");
        await expect(headline(page)).toContainText("Healthy spend share");
        await expect(share(page)).toHaveText(NOT_ENOUGH_DATA);
        const rows = await storedRows(sql, launchId);
        const spent = rows.filter((r) => r.day === 1).reduce((n, r) => n + r.spendPence, 0);
        expect(await headlineFigures(page)).toEqual({ healthy: 0, learning: spent, total: spent });
        await expect(headline(page).locator("[data-perf-learning]")).toContainText(formatPrice(spent));
        await expect(headline(page).locator("[data-perf-learning]")).toContainText("(simulated)");
        const ads = await adRows(page);
        expect(ads).toHaveLength(3);
        for (const a of ads) {
          expect(a.status, a.variantId).toBe("learning");
          await expect(adRow(page, a.variantId).locator("[data-perf-status]")).toHaveText(STATUS_NAMES.learning);
        }
        await checkWidths(page, "performance, day 1");
      });

      await step(page, "Next week, then Next day twice: simulated day 10 of 30", async () => {
        await moveOn(page, path, "Next week", 8);
        await moveOn(page, path, "Next day", 9);
        await moveOn(page, path, "Next day", 10);
      });

      let input: HealthInput | null = null;
      await step(page, "P9-3.1: the day-10 headline, each ad's row, the chart's table and the trend are health.ts's over the stored rows", async () => {
        await openPerformance(page, path);
        await expect(page.locator("[data-perf-header] [data-perf-clock]")).toHaveText("Simulated day 10 of 30");
        const l = await launchOf(sql, campaignIdOf(path), "live");
        const ads = l.ads as LaunchAd[];
        // Every launched ad still passes today (none of them shows Not compliant), so each is compliant in the reading.
        await expect(page.locator('[data-perf-ads] [data-perf-ad][data-status="not_compliant"]')).toHaveCount(0);
        input = {
          threshold: { measure: l.kpi_measure, value: Number(l.kpi_value) },
          ads: ads.map((x) => ({ variantId: x.variantId, compliance: { compliant: true, reason: null } })),
          rows: await storedRows(sql, launchId),
        };
        const h = dayHealth(input, 10)!;
        const series = healthSeries(input, 10);
        // The headline.
        expect(await headlineFigures(page)).toEqual({ healthy: h.healthyPence, learning: h.learningPence, total: h.totalPence });
        await expect(share(page)).toHaveText(h.shareShown);
        // The table: one row per ad, in launch order, with its picture, words, spend to date, three-day KPI and status.
        expect((await adRows(page)).map((r) => [r.variantId, r.status, r.spend])).toEqual(h.ads.map((x) => [x.variantId, x.status, x.spendPence]));
        for (const x of h.ads) {
          const row = adRow(page, x.variantId);
          await expect(row.locator("[data-perf-thumb] img, img[data-perf-thumb]")).toHaveCount(1);
          await expect(row.locator("[data-perf-words]")).not.toBeEmpty();
          await expect(row.locator("[data-perf-spend-to-date]")).toHaveText(formatPrice(x.spendToDatePence));
          await expect(row.locator("[data-perf-kpi]")).toHaveText(x.kpi.shown);
          await expect(row.locator("[data-perf-status]")).toHaveText(STATUS_NAMES[x.status]);
        }
        // The chart's table: a row per day, and day 10's cells are the headline's day.
        const table = page.locator("[data-perf-chart-table]");
        await expect(table.locator("[data-perf-chart-row]")).toHaveCount(10);
        const day10 = table.locator('[data-perf-chart-row="10"]');
        for (const x of h.ads) {
          await expect(day10.locator(`[data-perf-cell-spend="${x.variantId}"]`)).toHaveText(formatPrice(x.spendPence));
          await expect(day10.locator(`[data-perf-cell-kpi="${x.variantId}"]`)).toHaveText(x.kpi.shown);
        }
        await expect(day10.locator("[data-perf-cell-share]")).toHaveText(h.shareShown);
        // The trend, day by day.
        const trend = await page.locator("[data-perf-trend] [data-trend-day]").evaluateAll((xs) => xs.map((x) => [Number(x.getAttribute("data-trend-day")), x.getAttribute("data-share")]));
        expect(trend).toEqual(series.map((d) => [d.day, d.share === null ? "" : String(d.share)]));
        // The events are marked on the chart (ten days always hold a weekend).
        const marked = await page.locator("[data-perf-chart] [data-perf-event]").evaluateAll((xs) => xs.map((x) => [x.getAttribute("data-perf-event"), x.getAttribute("data-events")]));
        const withEvents = series.filter((d) => d.events.length > 0);
        expect(withEvents.length).toBeGreaterThan(0);
        expect(marked).toEqual(withEvents.map((d) => [d.date, d.events.join(", ")]));
        await expect(page.locator("[data-perf-definition]")).toHaveText(HEALTHY_DEFINITION);
      });

      await step(page, "P9-3.2: exactly one ad is below its threshold, and the share is exactly the other ads' spend over the day's", async () => {
        const rows = await adRows(page);
        expect(rows.filter((r) => r.status === "below_threshold").map((r) => r.variantId)).toEqual([belowAd]);
        expect(rows.filter((r) => r.status === "healthy")).toHaveLength(2);
        await expect(adRow(page, belowAd).locator("[data-perf-status]")).toHaveText(STATUS_NAMES.below_threshold);
        const { healthy, learning, total } = await headlineFigures(page);
        const below = rows.find((r) => r.variantId === belowAd)!.spend;
        // Nothing is learning on day 10, so the share drops from 100% by exactly that ad's share of the day's spend.
        expect(learning).toBe(0);
        expect(healthy).toBe(total - below);
        await expect(share(page)).toHaveText(shareText((total - below) / total));
      });

      await step(page, "P9-3.6: Simulated in the page header and on the chart, and on the home line", async () => {
        await expect(page.locator("[data-perf-header]")).toContainText("Simulated");
        const chart = page.locator("svg[data-perf-chart]");
        await expect(chart.locator("text").filter({ hasText: "Simulated" }).first()).toBeAttached();
        expect(await chart.locator("title").first().textContent()).toMatch(/simulated/i);
        await expect(page.locator("[data-perf-chart-table] caption")).toContainText("(simulated)");
      });

      await step(page, "P9-3.7: at 375 px and 1440 px nothing scrolls sideways, contrast is AA, and the chart's text alternative is its table", async () => {
        const chart = page.locator("svg[data-perf-chart]");
        await expect(chart).toHaveAttribute("role", "img");
        const described = (await chart.getAttribute("aria-describedby"))!;
        expect(described).toBeTruthy();
        await expect(page.locator(`[id="${described}"]`)).toHaveAttribute("data-perf-chart-table", "");
        await checkWidths(page, "performance, day 10");
      });

      await step(page, "P9-3.6: Studio's home shows the healthy spend share across the live campaigns, labelled simulated", async () => {
        await page.goto("/");
        await settle(page);
        // Other specs' launches may be live at the same time, so the count isn't pinned here (it is in test 2).
        await expect(homeLine(page)).toHaveText(/^Healthy spend share across \d+ live campaigns?: (\d{1,3}%|Not enough data yet) \(simulated\)$/);
      });

      await step(page, "The failure path: a campaign that isn't in the workspace shows Not found, and a malformed id is a 404", async () => {
        await page.goto(`/campaigns/${randomUUID()}/performance`);
        await expect(page.getByRole("heading", { name: "Not found" }).filter({ visible: true })).toBeVisible();
        const res = await page.goto("/campaigns/not-a-campaign/performance");
        expect(res?.status()).toBe(404);
      });
    } finally {
      await sql.end();
    }
  },
);

test(
  "P9-3 #3, #5: a banned term added to the kit after launch turns that ad Not compliant and removing it restores it; the home line counts live campaigns only, and shows nothing when none are live",
  { tag: "@brand-kit", annotation: [{ type: "case", description: "P9-3.3" }, { type: "case", description: "P9-3.5" }] },
  async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to end the live launches first and set the threshold before approval");
    test.setTimeout(1_500_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const brandId = await demoBrandId(page, "Fernhollow Outfitters");
    const [{ banned: bannedBefore }] = await sql`select banned_terms as banned from public.brands where id = ${brandId}`;
    let pathA = "";
    let pathB = "";
    let term = "";
    try {
      await step(page, "P9-3.5: with no live campaign, the home page shows no healthy spend line", async () => {
        // Every other spec has run (this is the brand-kit project), so their live launches are ended here,
        // as their owner would on each campaign's panel, to start from none.
        const [{ id: devId, workspace_id: workspaceId }] = await sql`
          select u.id, m.workspace_id from auth.users u join public.workspace_members m on m.user_id = u.id where u.email = ${DEV_EMAIL}`;
        await sql`update public.launches set status = 'ended', ended_by = ${devId}, ended_at = now() where workspace_id = ${workspaceId} and status = 'live'`;
        await page.goto("/");
        await settle(page);
        await expect(homeLine(page)).toHaveCount(0);
      });

      await step(page, "Campaign A: pick two paid-social ads with different words, accept their don't rules, launch with a threshold every ad meets, and run a week", async () => {
        pathA = await newCampaign(page, "Fernhollow Outfitters", "Bring walkers back for the autumn range, with a kit that changes after launch");
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
        const first = social(page).first();
        const words = await first.getAttribute("data-words");
        await pickCard(page, first);
        // A second ad with other words (another copy set), so a banned term taken from ad 1's headline is in ad 1 alone.
        await pickCard(page, page.locator(`[data-gallery] > li[data-channel="paid social"]:not([data-words="${words}"])`).first());
        await page.reload();
        await acceptDontRulesForPicked(page);
        await askToLaunch(page, pathA, 2);
        const l = await launchOf(sql, campaignIdOf(pathA), "awaiting_approval");
        await setWaitingLaunchTerms(sql, l.id as string, { kpi_measure: "ctr", kpi_value: 0.01 });
        await approveInInbox(page, pathA);
        await moveOn(page, pathA, "Next week", 7);
      });

      await step(page, "P9-3.5: the home line counts one live campaign, at 100%", async () => {
        await page.goto("/");
        await settle(page);
        await expect(homeLine(page)).toHaveText("Healthy spend share across 1 live campaign: 100% (simulated)");
      });

      await step(page, "P9-3.5: campaign B launches too, with no simulated days yet: two live campaigns, and B adds no spend", async () => {
        pathB = await newCampaign(page, "Fernhollow Outfitters", "Walkers for the winter range, launched beside another campaign");
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
        await pickCard(page, social(page).first());
        await page.reload();
        await acceptDontRulesForPicked(page);
        await askToLaunch(page, pathB, 1);
        await approveInInbox(page, pathB);
        await page.goto("/");
        await settle(page);
        await expect(homeLine(page)).toHaveText("Healthy spend share across 2 live campaigns: 100% (simulated)");
        await checkWidths(page, "home, healthy spend share");
      });

      let adOne = "";
      let other = "";
      await step(page, "On A's Performance view both ads are Healthy at 100%", async () => {
        await openPerformance(page, pathA);
        const rows = await adRows(page);
        expect(rows.map((r) => r.status)).toEqual(["healthy", "healthy"]);
        await expect(share(page)).toHaveText("100%");
        adOne = rows[0].variantId;
        other = rows[1].variantId;
        term = (await adRow(page, adOne).locator("[data-perf-words]").textContent())!.trim();
        const otherWords = (await adRow(page, other).locator("[data-perf-words]").textContent())!.trim();
        expect(term.length).toBeGreaterThan(0);
        expect(term.length).toBeLessThanOrEqual(80);
        expect(otherWords.toLowerCase()).not.toContain(term.toLowerCase());
      });

      await step(page, `P9-3.3: add ad 1's headline to Fernhollow's banned terms on the brand kit editor`, async () => {
        await page.goto(`/brands/${brandId}/edit`);
        await settle(page);
        const terms = page.getByRole("group", { name: "Banned terms" }).getByRole("textbox");
        await page.getByRole("button", { name: "Add a banned term" }).click();
        await terms.last().fill(term);
        await page.getByRole("button", { name: "Save brand kit" }).click();
        await expect(toast(page, "Brand kit saved for Fernhollow Outfitters.")).toBeVisible({ timeout: 30_000 });
      });

      await step(page, "P9-3.3: ad 1 is Not compliant with the pack's reason, its spend leaves the healthy share, and the home line moves with it", async () => {
        await openPerformance(page, pathA);
        const row = adRow(page, adOne);
        await expect(row).toHaveAttribute("data-status", "not_compliant");
        await expect(row.locator("[data-perf-status]")).toHaveText(STATUS_NAMES.not_compliant);
        await expect(row.locator("[data-perf-reason]")).toHaveText(`Fails: banned term '${term}' in English.`);
        await expect(adRow(page, other)).toHaveAttribute("data-status", "healthy");
        const rows = await adRows(page);
        const { healthy, learning, total } = await headlineFigures(page);
        const spent = rows.find((r) => r.variantId === adOne)!.spend;
        expect(learning).toBe(0);
        expect(healthy).toBe(total - spent);
        const shown = shareText((total - spent) / total);
        await expect(share(page)).toHaveText(shown);
        await checkWidths(page, "performance, an ad not compliant");
        await page.goto("/");
        await settle(page);
        await expect(homeLine(page)).toHaveText(`Healthy spend share across 2 live campaigns: ${shown} (simulated)`);
      });

      await step(page, "P9-3.3: remove the term on the brand kit editor, and the ad is Healthy again, at 100%", async () => {
        await page.goto(`/brands/${brandId}/edit`);
        await settle(page);
        const terms = page.getByRole("group", { name: "Banned terms" }).getByRole("textbox");
        const values = await terms.evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value));
        const at = values.indexOf(term);
        expect(at).toBeGreaterThan(-1);
        await page.getByRole("button", { name: `Remove Banned term ${at + 1}` }).click();
        await page.getByRole("button", { name: "Save brand kit" }).click();
        await expect(toast(page, "Brand kit saved for Fernhollow Outfitters.")).toBeVisible({ timeout: 30_000 });
        await openPerformance(page, pathA);
        await expect(adRow(page, adOne)).toHaveAttribute("data-status", "healthy");
        await expect(adRow(page, adOne).locator("[data-perf-reason]")).toHaveCount(0);
        await expect(share(page)).toHaveText("100%");
      });

      await step(page, "P9-3.5: ending B leaves one live campaign; ending A leaves no healthy spend line", async () => {
        for (const [path, left] of [
          [pathB, "Healthy spend share across 1 live campaign: 100% (simulated)"],
          [pathA, null],
        ] as const) {
          await openPanel(page, path);
          await panel(page).getByRole("button", { name: "End the launch" }).click();
          await panel(page).getByRole("button", { name: "Yes, end the launch" }).click();
          await expect(launchStatus(page)).toHaveText("Ended", { timeout: 30_000 });
          await page.goto("/");
          await settle(page);
          if (left) await expect(homeLine(page)).toHaveText(left);
          else await expect(homeLine(page)).toHaveCount(0);
        }
        // An ended campaign still has its Performance view, with its last simulated day.
        await openPerformance(page, pathA);
        await expect(page.locator("[data-perf-header] [data-perf-clock]")).toHaveText("Simulated day 7 of 30");
      });
    } finally {
      // The kit as it was, whatever happened above.
      await sql`update public.brands set banned_terms = ${bannedBefore} where id = ${brandId}`;
      await sql.end();
    }
  },
);
