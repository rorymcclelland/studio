// U10-4 Performance: what needs action first, through the UI with the mock
// models. One Fernhollow campaign is taken from sign-off to a live launch of
// three paid-social ads on simulated day 14, the shape of the audit's launch
// (Fernhollow, live on day 14, alerts, an ad below its threshold), built here
// so its days are known: while the launch waits for approval its seed and a
// cost-per-acquisition threshold are set (tests/e2e/launch-fixture.ts) to
// terms found with the pure simulator (seedWithRecovery in
// tests/helpers/monitor.ts), with which one ad's Below threshold alert is
// raised on day 6 and the ad then recovers before day 14, and another ad is
// below the threshold on day 14. The cases run in the order that needs
// (serial): 3 (built day by day, so the line is seen to appear), 1, 2 (marks
// the oldest alert seen), 5, 7, 6 (asks two questions), 8 (R1), then 4 (Mark all as
// seen, last, with its failure path: a stale tab's second press marks
// nothing again). The audit's own campaign (tests/e2e/fullest-data.ts) is
// measured by U10-6 (page-length.spec.ts, "performance"): the page within its
// budget, and [data-perf-attention] within 1.5 screens at 375 px.
//
// 1. On day 14, the first screen at 375 px shows the healthy spend share and
//    the ad below the threshold, in "Needs action now" with the alert that
//    flagged it; the page's order is share, needs action, the ads table, the
//    chart and table tabs, then Ask.
// 2. Alerts are newest first; a seen alert is one line (opening in place to
//    its facts and who saw it); the newest unseen ones are in full.
// 3. The ad's day-6 alert says "Recovered on day N" once the ad has been at or
//    above its threshold two days in a row: not on day N - 1, then on day N,
//    as the independent reading of the stored rows says; no other alert does
//    unless its reading says so.
// 4. Mark all as seen marks every unseen alert of this launch, records who,
//    the home line updates; a stale tab's Mark all as seen marks nothing again.
//    (Another launch's alerts unchanged and another workspace refused: CI,
//    tests/flows/performance-attention.test.ts.)
// 5. An alert's link scrolls to its ad's row in the table and highlights it.
// 6. Only the latest answer is open; opening an older one shows its answer and
//    table.
// 7. The chart and table tabs work by keyboard; the chart keeps its table
//    alternative for screen readers; axe finds nothing.
// 8. Rory's answer R1 (10 November): the newest 3 unseen alerts are in full and
//    every other alert is one line; only the first 3 show until "Show all N
//    alerts" reveals the rest in place. With 5 unseen alerts: 3 in full, 2 one
//    line behind "Show all 5 alerts". Runs after 6 and before 4.
//
// ---------------------------------------------------------------- interface
// What the builder provides. The tests here, tests/lib/performance-attention.test.ts
// and tests/flows/performance-attention.test.ts pin it. Rules 1 and 3 hold: every
// figure keeps its simulated label, "Recovered" is worked out from stored
// simulated days only (never stored), and alerts still change nothing.
//
// src/lib/performance/health.ts (stays PURE):
//   recoveredOn(series: DayHealth[], alert: { variantId: string; kind: string; day: number }) => number | null.
//     Only a "below_threshold" alert recovers (tiring and not_compliant: null). N is the first day such that
//     days N - 1 and N are both after the alert's day, both in `series`, and on both the ad has a row
//     (is in that day's ads), is not learning and meets the threshold (AdHealth.learning false, meets true);
//     N is the second of the two days. null when there is none in `series` (the page passes
//     PerformanceView.series, days 1 to the launch's simulated day).
//
// src/lib/performance/attention.ts (NEW, PURE: imports only ./alerts and ./health, and types):
//   ATTENTION_HEADING = "Needs action now"
//   NO_ATTENTION = "No ad is below its threshold or tiring now (simulated)."
//   MARK_ALL_LABEL = "Mark all as seen"
//   type AttentionReason = "below_threshold" | "tiring"
//   type AlertRef = { id: string; variantId: string; kind: AlertKind; day: number }   (AlertView satisfies it)
//   type AttentionAd = { variantId: string; reasons: AttentionReason[]; alertIds: string[] }
//   needsAttention(ads: readonly { variantId: string }[] /* launch order */, latest: DayHealth | null,
//     alerts: readonly AlertRef[]) => AttentionAd[]: an ad is listed when its status on `latest` is
//     "below_threshold" (reason below_threshold), or when it has a "tiring" alert (reason tiring: the
//     simulator's fatigue doesn't reverse, so a tiring ad stays tiring); an ad that is Not compliant or
//     Learning today, or whose only alert is a Below threshold one it has recovered from, isn't listed for
//     it. Reasons in that order; alertIds = the ad's alerts whose kind is one of its reasons, newest first.
//     Ads with below_threshold first, in launch order, then the rest, in launch order. [] when latest is null.
//   newestFirst<T extends AlertRef>(alerts: readonly T[], ads: readonly { variantId: string }[]) => T[]:
//     a new array, day descending, then launch ad order (an ad not in `ads` after them), then ALERT_KINDS order.
//   alertOneLine({ kind, adNumber, day }) => "Ad 1: Below threshold on simulated day 6" (ALERT_NAMES[kind]);
//     adNumber 0 => "An ad no longer in the gallery: Tiring on simulated day 9".
//   recoveredLine(day) => "Recovered on day 9".
//   markedAllLine(n) => "Marked 3 alerts as seen." | "Marked 1 alert as seen." | "No unseen alerts to mark." (0).
//
// src/lib/performance/alerts-store.ts (through asUser(), rule 7):
//   ALERT_CAMPAIGN_NOT_FOUND = "That campaign isn't in your workspace."
//   markAllAlertsSeen(member: Member, campaignId: string) => Promise<number>: ONE update statement, guarded like
//     markAlertSeen ("and seen_at is null"), setting seen_by = the member and seen_at = now() on every unseen
//     alert of the launch the Performance page shows (live, else the newest ended; listAlerts' launch) and no
//     other; returns how many it marked (0 with nothing to mark, or no launch). Two at once mark each alert
//     once. A malformed, missing or another workspace's campaign: AlertError(ALERT_CAMPAIGN_NOT_FOUND), and
//     nothing changes. listAlerts keeps its order and its callers (the page sorts with newestFirst).
//
// Server action (src/app/(app)/campaigns/[id]/performance/actions.ts):
//   markAllAlertsAsSeen(campaignId) => Promise<BriefActionState>: { done: markedAllLine(n) } or { error: the
//     AlertError's message }; revalidates the campaign and "/" (the home line), as markAlertAsSeen does.
//
// The page, /campaigns/[id]/performance, with a live or ended launch, top to bottom:
//   the header and the stage bar (as today), then
//   - [data-perf-headline] with [data-perf-share], as today, in the first screen at 375 px (812 px tall);
//   - <section data-perf-attention> with an <h2> ATTENTION_HEADING; per needsAttention() item, in its order,
//     <li data-attention-ad="<variantId>" data-reasons="<reasons joined by a space>"> holding a leaf
//     [data-attention-name] "Ad N" (the gallery number, as the table's), a leaf [data-attention-reason] per
//     reason (ALERT_NAMES: "Below threshold", "Tiring"), and per alertIds entry, in order, an element
//     [data-attention-alert="<alertId>"] with that alert's line (AlertView.line). No item: a leaf
//     [data-perf-attention-none] with NO_ATTENTION. The ad below the threshold is in the first screen at
//     375 px on day 14 (its [data-attention-name] wholly within the top 812 px with the page scrolled to 0).
//   - the ads table (table[data-perf-ads], rows as today), each row <tr data-perf-ad="<variantId>"
//     id="perf-ad-<variantId>">, highlighted while it is the fragment's target (CSS :target; a background,
//     outline or box-shadow other rows don't have);
//   - <section data-perf-views> (heading "Day by day", as today) with a [role=tablist] whose name includes
//     "Day by day", two [role=tab] buttons [data-perf-tab="chart"] "Chart" and [data-perf-tab="table"]
//     "Table" (aria-selected, aria-controls), Chart selected first; roving tabindex (selected 0, other -1);
//     ArrowRight and ArrowLeft move to the next or previous tab and select it (wrapping), Home and End to the
//     first and last; panels [role=tabpanel][data-perf-tabpanel="chart"|"table"] (aria-labelledby their tab),
//     the unselected one hidden; Tab from the selected tab reaches its panel. The chart (svg[data-perf-chart],
//     role img, as today) keeps aria-describedby pointing at table[data-perf-chart-table] (id perf-chart-table,
//     rows and caption as today), which is in the Table panel and stays in the DOM while Chart is selected.
//     The "Show the chart as a table" disclosure goes.
//   - <section data-perf-alerts> (heading "Alerts (simulated)" and NO_ALERTS as today), after
//     [data-perf-attention] and before Ask, with a <button data-mark-all-seen> MARK_ALL_LABEL while any alert is
//     unseen (none otherwise). Its items newestFirst(): <li data-perf-alert="<id>" data-kind data-day>, and
//     data-seen="" once seen.
//       The newest 3 unseen (R1, 10 November: alertsShown() in attention.ts), li[data-alert-full], in full as
//       today: [data-alert-kind], [data-alert-day], [data-alert-facts] (the line), the "Mark as seen" button.
//       Every other alert is one line, as a seen one is (an unseen one has Mark as seen inside it, in place
//       of who saw it). Only the first 3 are shown; the rest are li[data-alert-more], hidden until the
//       button[data-show-all-alerts] "Show all N alerts" below the list reveals them in place.
//       Seen, one line: a <details> (closed) whose <summary> holds a leaf [data-alert-oneline] with
//       alertOneLine(...), on one line at 1440 px; opening it in place shows [data-alert-facts] and
//       [data-alert-seen] ("Seen by <email>, <when>", as today); no Mark as seen.
//       Both: a link a[data-alert-ad-link] href "#perf-ad-<variantId>" (in the one line when seen) whose
//       accessible name names the ad ("Ad N"); and, when recoveredOn(view.series, alert) is a day, a leaf
//       [data-alert-recovered] with recoveredLine(day) (in the one line when seen), visible.
//   - Ask, <section data-perf-ask>: the box as today; questions newest first; the first [data-ask-question] in
//     full as today; each older one an <li data-ask-question="<id>" data-status> holding a closed
//     <details data-ask-older> whose <summary> holds its [data-ask-text], and inside it the answer
//     ([data-ask-answer], [data-ask-label]) and its table ([data-ask-result]), shown when opened (Enter on
//     the summary).
//   In document order: [data-perf-headline], [data-perf-attention], table[data-perf-ads], [data-perf-views],
//   [data-perf-ask]; [data-perf-alerts] after [data-perf-attention] and before [data-perf-ask].
//   Every figure keeps "(simulated)" or "Simulated" as today; nothing on the page acts on an ad (rule 3).
//   tests/e2e/fullest-data.ts waits for a seen alert as attached, not visible (it folds into one line).
// ----------------------------------------------------------------------------
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { alertLine, alertsLine, type Alert } from "@/lib/performance/alerts";
import type { LaunchAd } from "@/lib/performance/launch";
import type { SimRow } from "@/lib/performance/simulate";
import { MOCK_CPA_QUESTION, referenceRecovery, seedWithRecovery, type RecoveryPlan } from "../helpers/monitor";
import {
  acceptDontRulesForPicked,
  adTool,
  contrastViolations,
  DEV_EMAIL,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  openLaunch,
  settle,
  signIn,
  signOffVersion,
  stagePath,
  step,
  untilShown,
} from "./helpers";
import { PINNED_STARTS_ON, setWaitingLaunchTerms } from "./launch-fixture";

type Sql = postgres.Sql;

const OBJECTIVE = "Bring walkers back for the autumn range, with what needs action first";
const HEADING = "Needs action now";
const MARK_ALL = "Mark all as seen";
const NAMES: Record<string, string> = { below_threshold: "Below threshold", tiring: "Tiring", not_compliant: "Not compliant" };
const KINDS = ["below_threshold", "tiring", "not_compliant"];
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };
const RIVALS = "What did our rivals spend?";
const DAY = 14;

const visible = (page: Page, css: string) => page.locator(css).filter({ visible: true });
const panel = (page: Page) => page.locator("[data-launch-panel]");
const social = (page: Page) => page.locator('[data-gallery] > li[data-channel="paid social"]').filter({ visible: true });
const alertsSection = (page: Page) => page.locator("[data-perf-alerts]");
const alertItem = (page: Page, id: string) => alertsSection(page).locator(`[data-perf-alert="${id}"]`);
const attention = (page: Page) => page.locator("[data-perf-attention]");
const toast = (page: Page, text: string) => page.locator("[data-toast]").filter({ hasText: text });
const recoveredText = (day: number) => `Recovered on day ${day}`;
const oneLine = (kind: string, adNumber: number, day: number) => `Ad ${adNumber}: ${NAMES[kind]} on simulated day ${day}`;
const markedText = (n: number) => (n === 0 ? "No unseen alerts to mark." : `Marked ${n} ${n === 1 ? "alert" : "alerts"} as seen.`);
const idOf = (path: string) => path.split("/").pop()!;

// The journey's state, shared by the serial tests below.
let path = "";
let launchId = "";
let plan: RecoveryPlan;
/** The launch's ads, in launch order. */
let launchAds: string[] = [];

type StoredAlert = { id: string; variantId: string; kind: Alert["kind"]; day: number; facts: Alert["facts"]; seenBy: string | null; seenAt: Date | null };

async function storedAlerts(sql: Sql): Promise<StoredAlert[]> {
  const rows = await sql`select id, variant_id, kind, day, facts, seen_by, seen_at from public.performance_alerts where launch_id = ${launchId}`;
  return rows.map((r) => ({ id: r.id as string, variantId: r.variant_id as string, kind: r.kind as Alert["kind"], day: r.day as number, facts: r.facts as Alert["facts"], seenBy: (r.seen_by as string | null) ?? null, seenAt: (r.seen_at as Date | null) ?? null }));
}

/** Newest first, as the page lists them: day descending, then the launch's ad order, then kind. */
function newestFirst(alerts: StoredAlert[]): StoredAlert[] {
  const order = (id: string) => launchAds.indexOf(id);
  return [...alerts].sort((x, y) => y.day - x.day || order(x.variantId) - order(y.variantId) || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind));
}

async function storedRows(sql: Sql): Promise<SimRow[]> {
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

const withSql = async <T>(body: (sql: Sql) => Promise<T>): Promise<T> => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return await body(sql);
  } finally {
    await sql.end();
  }
};

/** The Performance stage, loaded afresh at the top. */
async function openPerformance(page: Page) {
  await page.goto(stagePath(path, "performance"));
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: /^Performance/ })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Moves the clock on from the Launch stage and waits for the day. */
async function moveOn(page: Page, button: "Next day" | "Next week", day: number) {
  await openLaunch(page, path);
  await panel(page).getByRole("button", { name: button }).click();
  await expect(panel(page).locator("[data-sim-clock]")).toHaveText(`Simulated day ${day} of 30`, { timeout: 60_000 });
}

/** Moves the clock on, a day at a time, to `day`. */
async function dayByDay(page: Page, from: number, day: number) {
  for (let d = from + 1; d <= day; d++) await moveOn(page, "Next day", d);
}

/** R1: reveals the alerts past the first 3, when there are more. */
async function showAllAlerts(page: Page) {
  const button = alertsSection(page).locator("button[data-show-all-alerts]");
  if (await button.count()) await button.click();
  await expect(button).toHaveCount(0);
}

/** How many lines of text an element takes, from its height and its line height. */
async function linesOf(el: Locator): Promise<number> {
  return el.evaluate((e) => {
    const cs = getComputedStyle(e);
    const line = cs.lineHeight === "normal" ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
    return Math.round(e.getBoundingClientRect().height / line);
  });
}

/** The document's top of an element, so the page's sections can be put in order. */
const topOf = (page: Page, css: string) => page.locator(css).first().evaluate((e) => e.getBoundingClientRect().top + window.scrollY);

/** The ad number an alert's line starts with ("Ad 3 is tiring: ..."). */
async function adNumberIn(item: Locator): Promise<number> {
  const text = (await item.locator("[data-alert-facts]").textContent()) ?? "";
  const n = Number(/^Ad (\d+) /.exec(text.trim())?.[1]);
  expect(n, `the ad number in "${text}"`).toBeGreaterThan(0);
  return n;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.describe("U10-4 a Fernhollow campaign's Performance page, live on simulated day 14", () => {
  test.describe.configure({ mode: "serial" });

  test(
    "U10-4 #3: an ad's day-6 alert says Recovered on day N once the ad has been at or above its threshold two days in a row, worked out from the stored days",
    { annotation: [{ type: "case", description: "U10-4.3" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to set the launch's terms before approval and read the stored days");
      test.setTimeout(1_200_000);

      await step(page, "A signed-off Fernhollow brief, 12 ads, three paid-social ads picked with their don't rules accepted", async () => {
        path = await newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
        expect(await social(page).count()).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < 3; i++) {
          const card = social(page).nth(i);
          await (await adTool(card, "pick")).click();
          await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
        }
        await acceptDontRulesForPicked(page);
      });

      await step(page, "Ask to launch; while it waits, give it terms with an ad alerted on day 6 that then recovers, and another below the threshold on day 14; approve it", async () => {
        await openLaunch(page, path);
        await expect(panel(page).locator("[data-launch-ad]")).toHaveCount(3);
        await panel(page).getByRole("button", { name: "Ask to launch" }).click();
        await expect(panel(page).locator("[data-launch-status]")).toHaveText("Waiting for approval", { timeout: 30_000 });
        await withSql(async (sql) => {
          const [l] = await sql`
            select id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, days, daily_budget_pence, ads
            from public.launches where campaign_id = ${idOf(path)} and status = 'awaiting_approval'`;
          launchId = l.id as string;
          launchAds = (l.ads as LaunchAd[]).map((a) => a.variantId);
          const prices = await sql`
            select p.price_pence from public.products p join public.campaigns c on c.brand_id = p.brand_id
            where c.id = ${idOf(path)} and p.active order by p.price_pence`;
          // QA finding 3 (10 November): a fixed start with no simulator event, so the days don't depend on the calendar.
          plan = seedWithRecovery({ startsOn: PINNED_STARTS_ON, days: l.days, dailyBudgetPence: l.daily_budget_pence, ads: l.ads as LaunchAd[], orderValuesPence: prices.map((p) => p.price_pence as number) }, DAY);
          // A launch's terms never change once asked for (launches_terms): the fixture sets them as the tables' owner.
          await setWaitingLaunchTerms(sql, launchId, { seed: plan.seed, kpi_measure: plan.threshold.measure, kpi_value: plan.threshold.value, starts_on: PINNED_STARTS_ON });
        });
        await page.goto("/approvals");
        await settle(page);
        const card = page.locator("[data-inbox-item=launch]").filter({ has: page.locator(`a[href^="${path}"]`) });
        await card.getByRole("button", { name: "Approve" }).click();
        await expect(card).toHaveCount(0, { timeout: 30_000 });
      });

      let alertId = "";
      await step(page, `Next week, then Next day: simulated day ${plan.recovered.day - 1}, the day before the ad has met its threshold two days in a row`, async () => {
        await moveOn(page, "Next week", 7);
        await dayByDay(page, 7, plan.recovered.day - 1);
      });

      await step(page, "U10-4.3: the ad's Below threshold alert is there, on its day, and doesn't say Recovered yet", async () => {
        const stored = await withSql((sql) => storedAlerts(sql));
        const mine = stored.find((x) => x.variantId === plan.recovered.variantId && x.kind === "below_threshold");
        expect(mine, "the recovering ad's Below threshold alert").toBeDefined();
        expect(mine!.day).toBe(plan.recovered.alertDay);
        alertId = mine!.id;
        await openPerformance(page);
        await expect(alertItem(page, alertId)).toHaveAttribute("data-day", String(plan.recovered.alertDay));
        await expect(alertItem(page, alertId).locator("[data-alert-recovered]")).toHaveCount(0);
      });

      await step(page, `U10-4.3: Next day to day ${plan.recovered.day}: the alert says ${recoveredText(plan.recovered.day)}, as the stored days say`, async () => {
        await dayByDay(page, plan.recovered.day - 1, plan.recovered.day);
        const rows = await withSql((sql) => storedRows(sql));
        // The independent reading of the stored rows agrees with the terms the search found.
        expect(referenceRecovery(rows, plan.recovered.variantId, plan.threshold, plan.recovered.alertDay, plan.recovered.day)).toBe(plan.recovered.day);
        expect(referenceRecovery(rows, plan.recovered.variantId, plan.threshold, plan.recovered.alertDay, plan.recovered.day - 1)).toBeNull();
        await openPerformance(page);
        await showAllAlerts(page);
        await expect(alertItem(page, alertId).locator("[data-alert-recovered]")).toHaveText(recoveredText(plan.recovered.day));
        await expect(alertItem(page, alertId).locator("[data-alert-recovered]")).toBeVisible();
      });

      await step(page, `Next day to simulated day ${DAY}`, async () => {
        await dayByDay(page, plan.recovered.day, DAY);
      });

      await step(page, `U10-4.3: on day ${DAY}, each alert says Recovered only when the stored days say so, and on that day`, async () => {
        const [rows, stored] = await withSql(async (sql) => [await storedRows(sql), await storedAlerts(sql)] as const);
        expect(stored.length).toBeGreaterThanOrEqual(2);
        await openPerformance(page);
        for (const a of stored) {
          const due = a.kind === "below_threshold" ? referenceRecovery(rows, a.variantId, plan.threshold, a.day, DAY) : null;
          const leaf = alertItem(page, a.id).locator("[data-alert-recovered]");
          if (due === null) await expect(leaf, `${a.kind} on day ${a.day}`).toHaveCount(0);
          else await expect(leaf, `${a.kind} on day ${a.day}`).toHaveText(recoveredText(due));
        }
        await expect(alertItem(page, alertId).locator("[data-alert-recovered]")).toHaveText(recoveredText(plan.recovered.day));
      });
    },
  );

  test(
    "U10-4 #1: on simulated day 14 the first screen at 375 px shows the healthy spend share and the ad below its threshold, with the alert that flagged it",
    { annotation: [{ type: "case", description: "U10-4.1" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to read the launch's alerts");
      expect(launchId, "the launch from case 3's test").not.toBe("");
      const stored = await withSql((sql) => storedAlerts(sql));

      await step(page, "U10-4.1: at 375 px, with the page at its top, the share and the ad below the threshold are both on the first screen", async () => {
        await page.setViewportSize(PHONE);
        await openPerformance(page);
        const share = page.locator("[data-perf-headline] [data-perf-share]");
        // QA finding 6 (10 November): on simulated day 14 the share is a figure, never "Not enough data yet".
        await expect(share).toHaveText(/^\d{1,3}%$/);
        await expect(attention(page).getByRole("heading", { level: 2 })).toHaveText(HEADING);
        const item = attention(page).locator(`[data-attention-ad="${plan.below.variantId}"]`);
        await expect(item).toBeVisible();
        for (const [what, el] of [
          ["the share", share],
          ["the ad below the threshold", item.locator("[data-attention-name]")],
        ] as const) {
          const box = (await el.boundingBox())!;
          expect(box.y, `${what}'s top`).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height, `${what} ends ${Math.round(box.y + box.height)} px down; the first screen is ${PHONE.height} px`).toBeLessThanOrEqual(PHONE.height);
        }
        await expectNoHorizontalScroll(page, "performance, day 14, at 375px");
        expect(await contrastViolations(page)).toEqual([]);
      });

      await step(page, "U10-4.1: Needs action now lists the ads below the threshold today, then the tiring ones, each with the alert that flagged it", async () => {
        // Below the threshold today: the table's own statuses (P9-3), in launch order.
        const belowToday = await page.locator('[data-perf-ads] [data-perf-ad][data-status="below_threshold"]').evaluateAll((rows) => rows.map((r) => r.getAttribute("data-perf-ad")!));
        expect(belowToday).toContain(plan.below.variantId);
        const tiring = launchAds.filter((ad) => stored.some((a) => a.variantId === ad && a.kind === "tiring"));
        const expected = [...belowToday, ...tiring.filter((ad) => !belowToday.includes(ad))];
        const items = attention(page).locator("[data-attention-ad]");
        expect(await items.evaluateAll((xs) => xs.map((x) => x.getAttribute("data-attention-ad")!))).toEqual(expected);
        for (const ad of expected) {
          const reasons = [...(belowToday.includes(ad) ? ["below_threshold"] : []), ...(tiring.includes(ad) ? ["tiring"] : [])];
          const item = attention(page).locator(`[data-attention-ad="${ad}"]`);
          await expect(item).toHaveAttribute("data-reasons", reasons.join(" "));
          await expect(item.locator("[data-attention-reason]")).toHaveText(reasons.map((r) => NAMES[r]));
          const flagged = newestFirst(stored.filter((a) => a.variantId === ad && reasons.includes(a.kind)));
          expect(await item.locator("[data-attention-alert]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-attention-alert")!)), `ad ${ad.slice(0, 8)}`).toEqual(flagged.map((a) => a.id));
        }
        // The ad below today shows its own Below threshold alert, on the day the search found, in full.
        const own = stored.find((a) => a.variantId === plan.below.variantId && a.kind === "below_threshold")!;
        expect(own.day).toBe(plan.below.alertDay);
        const flagged = attention(page).locator(`[data-attention-ad="${plan.below.variantId}"] [data-attention-alert="${own.id}"]`);
        await expect(flagged).toBeVisible();
        await expect(flagged).toContainText(/^Ad \d+ has missed its threshold two simulated days in a row/);
      });

      await step(page, "U10-4.1: the order: share, needs action, the ads table, the chart and table, then Ask; the alerts after needs action, before Ask", async () => {
        await page.setViewportSize(DESKTOP);
        await openPerformance(page);
        const tops = {
          headline: await topOf(page, "[data-perf-headline]"),
          attention: await topOf(page, "[data-perf-attention]"),
          table: await topOf(page, "table[data-perf-ads]"),
          views: await topOf(page, "[data-perf-views]"),
          ask: await topOf(page, "[data-perf-ask]"),
          alerts: await topOf(page, "[data-perf-alerts]"),
        };
        expect(tops.headline).toBeLessThan(tops.attention);
        expect(tops.attention).toBeLessThan(tops.table);
        expect(tops.table).toBeLessThan(tops.views);
        expect(tops.views).toBeLessThan(tops.ask);
        expect(tops.attention).toBeLessThan(tops.alerts);
        expect(tops.alerts).toBeLessThan(tops.ask);
        await expectNoHorizontalScroll(page, "performance, day 14, at 1440px");
        expect(await contrastViolations(page)).toEqual([]);
      });
    },
  );

  test(
    "U10-4 #2: alerts are newest first; a seen alert is one line that opens in place, and the newest unseen ones are in full",
    { annotation: [{ type: "case", description: "U10-4.2" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to read the launch's alerts");
      expect(launchId, "the launch from case 3's test").not.toBe("");
      await page.setViewportSize(DESKTOP);
      const items = () => alertsSection(page).locator("[data-perf-alert]");
      const shownOrder = () => items().evaluateAll((xs) => xs.map((x) => x.getAttribute("data-perf-alert")!));
      let oldest: StoredAlert;

      await step(page, "U10-4.2: every alert is listed newest first: by day, then the launch's ad order, then kind", async () => {
        const stored = await withSql((sql) => storedAlerts(sql));
        await openPerformance(page);
        const want = newestFirst(stored);
        expect(await shownOrder()).toEqual(want.map((a) => a.id));
        const days = await items().evaluateAll((xs) => xs.map((x) => Number(x.getAttribute("data-day"))));
        expect(days).toEqual([...days].sort((x, y) => y - x));
        expect(new Set(days).size, "alerts on at least two days").toBeGreaterThanOrEqual(2);
        oldest = want.at(-1)!;
      });

      let adNumber = 0;
      await step(page, "Mark the oldest alert as seen", async () => {
        const item = alertItem(page, oldest.id);
        adNumber = await adNumberIn(item);
        // R1: past the newest 3 unseen, an alert is one line, behind Show all; its Mark as seen is inside it.
        await showAllAlerts(page);
        if ((await item.getAttribute("data-alert-full")) === null) await item.locator("summary").click();
        await item.getByRole("button", { name: "Mark as seen" }).click();
        await expect(item).toHaveAttribute("data-seen", "", { timeout: 30_000 });
      });

      await step(page, "U10-4.2: the seen alert is one line: the ad, the kind and the day, with no facts and no Mark as seen; it stays in its place", async () => {
        await openPerformance(page);
        await showAllAlerts(page);
        const item = alertItem(page, oldest.id);
        await expect(item).toHaveAttribute("data-seen", "");
        const line = item.locator("[data-alert-oneline]");
        await expect(line).toHaveText(oneLine(oldest.kind, adNumber, oldest.day));
        await expect(line).toBeVisible();
        expect(await linesOf(line), "the seen alert's line at 1440 px").toBe(1);
        await expect(item.locator("[data-alert-facts]")).toBeHidden();
        await expect(item.getByRole("button", { name: "Mark as seen" })).toHaveCount(0);
        await expect(item.locator("details")).not.toHaveAttribute("open", "");
        // It keeps its place: still the last, newest first.
        expect((await shownOrder()).at(-1)).toBe(oldest.id);
      });

      await step(page, "U10-4.2: opening the seen alert in place, by keyboard, shows its facts and who saw it", async () => {
        const item = alertItem(page, oldest.id);
        await item.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(item.locator("details")).toHaveAttribute("open", "");
        await expect(item.locator("[data-alert-facts]")).toBeVisible();
        await expect(item.locator("[data-alert-facts]")).toHaveText(alertLine({ kind: oldest.kind, variantId: oldest.variantId, day: oldest.day, facts: oldest.facts } as Alert, adNumber));
        await expect(item.locator("[data-alert-seen]")).toBeVisible();
        await expect(item.locator("[data-alert-seen]")).toContainText(`Seen by ${DEV_EMAIL}`);
      });

      await step(page, "U10-4.2: the newest unseen alerts (up to 3, R1) are in full: their kind, their day, their facts and Mark as seen", async () => {
        await openPerformance(page);
        const unseen = alertsSection(page).locator("[data-perf-alert]:not([data-seen])");
        const n = Math.min(3, await unseen.count());
        expect(n).toBeGreaterThanOrEqual(1);
        await expect(alertsSection(page).locator("[data-perf-alert][data-alert-full]")).toHaveCount(n);
        for (let i = 0; i < n; i++) {
          const item = unseen.nth(i);
          const day = await item.getAttribute("data-day");
          await expect(item.locator("[data-alert-kind]")).toHaveText(NAMES[(await item.getAttribute("data-kind"))!]);
          await expect(item.locator("[data-alert-day]")).toHaveText(`Simulated day ${day}`);
          await expect(item.locator("[data-alert-facts]")).toBeVisible();
          await expect(item.locator("[data-alert-facts]")).toHaveText(/^Ad \d+ /);
          await expect(item.getByRole("button", { name: "Mark as seen" })).toBeVisible();
          await expect(item.locator("[data-alert-oneline]")).toHaveCount(0);
        }
        expect(await contrastViolations(page)).toEqual([]);
      });
    },
  );

  test(
    "U10-4 #5: an alert's link scrolls to its ad's row in the table and highlights it",
    { annotation: [{ type: "case", description: "U10-4.5" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to read the launch's alerts");
      expect(launchId, "the launch from case 3's test").not.toBe("");
      const stored = await withSql((sql) => storedAlerts(sql));
      const target = stored.find((a) => a.variantId === plan.below.variantId && a.kind === "below_threshold")!;
      const other = launchAds.find((ad) => ad !== plan.below.variantId)!;
      const row = (ad: string) => page.locator(`[data-perf-ads] [data-perf-ad="${ad}"]`);
      /** What marks a row out: its background, outline and shadow. */
      const look = (ad: string) =>
        row(ad).evaluate((e) => {
          const s = getComputedStyle(e);
          return `${s.backgroundColor} | ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} | ${s.boxShadow}`;
        });

      await step(page, "At 375 px, from the top of the page, the alert's link names its ad and points at its row", async () => {
        await page.setViewportSize(PHONE);
        await openPerformance(page);
        await showAllAlerts(page);
        await expect(row(target.variantId)).toHaveAttribute("id", `perf-ad-${target.variantId}`);
        const link = alertItem(page, target.id).locator("a[data-alert-ad-link]");
        await expect(link).toHaveAttribute("href", `#perf-ad-${target.variantId}`);
        await expect(link).toHaveAccessibleName(/\bAd \d+\b/);
        expect(await look(target.variantId)).toBe(await look(other));
      });

      await step(page, "U10-4.5: following it scrolls the ad's row into view and highlights it, and no other row", async () => {
        await alertItem(page, target.id).locator("a[data-alert-ad-link]").click();
        await page.waitForURL((u) => u.hash === `#perf-ad-${target.variantId}`);
        await expect(row(target.variantId)).toBeInViewport();
        expect(await row(target.variantId).evaluate((e) => e.matches(":target"))).toBe(true);
        expect(await look(target.variantId), "the highlighted row looks different from another").not.toBe(await look(other));
        expect(await contrastViolations(page)).toEqual([]);
      });

      await step(page, "U10-4.5: by keyboard too: Enter on the link lands on the row", async () => {
        await openPerformance(page);
        await showAllAlerts(page);
        const link = alertItem(page, target.id).locator("a[data-alert-ad-link]");
        await link.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL((u) => u.hash === `#perf-ad-${target.variantId}`);
        await expect(row(target.variantId)).toBeInViewport();
      });
    },
  );

  test(
    "U10-4 #7: the chart and table tabs work by keyboard, and the chart keeps its table alternative for screen readers",
    { annotation: [{ type: "case", description: "U10-4.7" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "case 3's test, which builds the campaign, needs DATABASE_URL");
      expect(path, "the campaign from case 3's test").not.toBe("");
      await page.setViewportSize(DESKTOP);
      await openPerformance(page);
      const views = page.locator("[data-perf-views]");
      const tablist = views.getByRole("tablist", { name: /Day by day/ });
      const chartTab = tablist.getByRole("tab", { name: "Chart", exact: true });
      const tableTab = tablist.getByRole("tab", { name: "Table", exact: true });
      const chartPanel = views.locator('[role="tabpanel"][data-perf-tabpanel="chart"]');
      const tablePanel = views.locator('[role="tabpanel"][data-perf-tabpanel="table"]');
      const chart = page.locator("svg[data-perf-chart]");
      const table = page.locator("table[data-perf-chart-table]");
      const selected = async (tab: "chart" | "table") => {
        const [on, off, onPanel, offPanel] = tab === "chart" ? [chartTab, tableTab, chartPanel, tablePanel] : [tableTab, chartTab, tablePanel, chartPanel];
        await expect(on).toHaveAttribute("aria-selected", "true");
        await expect(off).toHaveAttribute("aria-selected", "false");
        await expect(on).toHaveAttribute("tabindex", "0");
        await expect(off).toHaveAttribute("tabindex", "-1");
        await expect(onPanel).toBeVisible();
        await expect(offPanel).toBeHidden();
        await expect(on).toBeFocused();
      };
      const axe = async (what: string) => {
        const results = await new AxeBuilder({ page }).include("[data-perf-views]").analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(", ")}`), what).toEqual([]);
      };

      await step(page, "U10-4.7: two tabs, Chart first and selected; the chart is described by the day-by-day table, which is in the page though hidden", async () => {
        await expect(tablist.getByRole("tab")).toHaveText(["Chart", "Table"]);
        await expect(chartTab).toHaveAttribute("aria-selected", "true");
        await expect(chartTab).toHaveAttribute("aria-controls", (await chartPanel.getAttribute("id"))!);
        await expect(tableTab).toHaveAttribute("aria-controls", (await tablePanel.getAttribute("id"))!);
        await expect(chartPanel).toHaveAttribute("aria-labelledby", (await chartTab.getAttribute("id"))!);
        await expect(tablePanel).toHaveAttribute("aria-labelledby", (await tableTab.getAttribute("id"))!);
        await expect(chart).toBeVisible();
        await expect(chart).toHaveAttribute("role", "img");
        await expect(chart).toHaveAttribute("aria-describedby", "perf-chart-table");
        await expect(table).toHaveAttribute("id", "perf-chart-table");
        await expect(table).toBeAttached();
        await expect(table).toBeHidden();
        await expect(table.locator("[data-perf-chart-row]")).toHaveCount(DAY);
        await expect(table.locator("caption")).toContainText("(simulated)");
        await expect(page.getByText("Show the chart as a table")).toHaveCount(0);
        await axe("with Chart selected");
      });

      await step(page, "U10-4.7: ArrowRight selects Table and shows the day-by-day table; ArrowLeft goes back to Chart", async () => {
        await chartTab.focus();
        await page.keyboard.press("ArrowRight");
        await selected("table");
        await expect(table).toBeVisible();
        await expect(table.locator("[data-perf-chart-row]")).toHaveCount(DAY);
        await page.keyboard.press("ArrowLeft");
        await selected("chart");
      });

      await step(page, "U10-4.7: the arrows wrap, and Home and End go to the first and last tab", async () => {
        await page.keyboard.press("ArrowLeft");
        await selected("table");
        await page.keyboard.press("ArrowRight");
        await selected("chart");
        await page.keyboard.press("End");
        await selected("table");
        await page.keyboard.press("Home");
        await selected("chart");
      });

      await step(page, "U10-4.7: with Table selected, Tab moves from the tab into its panel; axe finds nothing", async () => {
        await page.keyboard.press("ArrowRight");
        await selected("table");
        await page.keyboard.press("Tab");
        expect(await tablePanel.evaluate((p) => p === document.activeElement || p.contains(document.activeElement))).toBe(true);
        // The chart, while hidden, is still described by the table.
        await expect(chart).toHaveAttribute("aria-describedby", "perf-chart-table");
        await axe("with Table selected");
        expect(await contrastViolations(page)).toEqual([]);
      });
    },
  );

  test(
    "U10-4 #6: only the latest answer is open; opening an older question shows its answer and its table",
    { annotation: [{ type: "case", description: "U10-4.6" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "case 3's test, which builds the campaign, needs DATABASE_URL");
      expect(path, "the campaign from case 3's test").not.toBe("");
      test.setTimeout(400_000);
      const box = () => page.locator("[data-ask]");
      const asked = (question: string) => page.locator("[data-ask-question]").filter({ has: page.locator("[data-ask-text]", { hasText: question }) }).first();

      for (const question of [MOCK_CPA_QUESTION, RIVALS]) {
        await step(page, `Ask "${question}" and wait for its answer`, async () => {
          await openPerformance(page);
          await box().getByRole("textbox", { name: "Ask about this campaign" }).fill(question);
          await box().getByRole("button", { name: "Ask" }).click();
          // The newest question is the open one, so its answer shows when it comes.
          await untilShown(page, () => expect(asked(question).locator("[data-ask-answer]")).toBeVisible({ timeout: 2_000 }), 120_000);
        });
      }

      await step(page, "U10-4.6: the latest question's answer is open, and it is the only answer shown", async () => {
        await openPerformance(page);
        const items = page.locator("[data-perf-ask] [data-ask-question]");
        await expect(items.first().locator("[data-ask-text]")).toHaveText(RIVALS);
        await expect(items.first().locator("[data-ask-answer]")).toBeVisible();
        await expect(visible(page, "[data-perf-ask] [data-ask-answer]")).toHaveCount(1);
        await expect(visible(page, "[data-perf-ask] [data-ask-result]")).toHaveCount(0);
      });

      await step(page, "U10-4.6: the older question is its question on one line, closed: no answer, no table", async () => {
        const older = asked(MOCK_CPA_QUESTION);
        const details = older.locator("details[data-ask-older]");
        await expect(details).not.toHaveAttribute("open", "");
        await expect(details.locator(":scope > summary [data-ask-text]")).toHaveText(MOCK_CPA_QUESTION);
        await expect(details.locator(":scope > summary [data-ask-text]")).toBeVisible();
        await expect(older.locator("[data-ask-answer]")).toBeHidden();
        await expect(older.locator("[data-ask-result]")).toBeHidden();
      });

      await step(page, "U10-4.6: opening it with Enter shows its answer, its label and its table, in place", async () => {
        const older = asked(MOCK_CPA_QUESTION);
        await older.locator("details[data-ask-older] > summary").focus();
        await page.keyboard.press("Enter");
        await expect(older.locator("details[data-ask-older]")).toHaveAttribute("open", "");
        await expect(older.locator("[data-ask-answer]")).toBeVisible();
        await expect(older.locator("[data-ask-answer]")).toHaveText(/^Ad \d+ had the lowest cost per acquisition/);
        await expect(older.locator("[data-ask-label]")).toBeVisible();
        const result = older.locator("[data-ask-result]");
        await expect(result).toBeVisible();
        await expect(result.locator("caption")).toHaveText("Simulated days 8 to 14 (simulated)");
        expect(await result.locator("tbody tr").count()).toBeGreaterThan(0);
        // The latest stays open.
        await expect(asked(RIVALS).locator("[data-ask-answer]")).toBeVisible();
        expect(await contrastViolations(page)).toEqual([]);
      });
    },
  );

  test(
    "U10-4 #8 (R1): with 5 unseen alerts, the newest 3 are in full and the other 2 are one line, behind Show all 5 alerts",
    { annotation: [{ type: "case", description: "U10-4.8" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to give the launch five unseen alerts");
      expect(launchId, "the launch from case 3's test").not.toBe("");
      let five: StoredAlert[] = [];

      await step(page, "Give the launch exactly 5 alerts, all unseen, as the tables' owner: a seen alert put back unseen, Not compliant alerts added for its ads, or the oldest removed", async () => {
        five = await withSql(async (sql) => {
          await sql.begin(async (tx) => {
            // An alert is only ever marked as seen (performance_alerts_guard), so a seen one is put back as an unseen copy, its id and facts kept.
            const seen = await tx`delete from public.performance_alerts where launch_id = ${launchId} and seen_at is not null returning *`;
            for (const a of seen) {
              await tx`
                insert into public.performance_alerts (id, workspace_id, launch_id, variant_id, day, kind, facts, created_at)
                values (${a.id}, ${a.workspace_id}, ${a.launch_id}, ${a.variant_id}, ${a.day}, ${a.kind}, ${tx.json(a.facts)}, ${a.created_at})`;
            }
            const [{ workspace_id: ws }] = await tx`select workspace_id from public.launches where id = ${launchId}`;
            for (const ad of launchAds) {
              const [{ n }] = await tx`select count(*)::int as n from public.performance_alerts where launch_id = ${launchId}`;
              if ((n as number) >= 5) break;
              // Test data, said so in its own words: only this test's launch shows it.
              await tx`
                insert into public.performance_alerts (workspace_id, launch_id, variant_id, day, kind, facts)
                values (${ws as string}, ${launchId}, ${ad}, ${DAY}, 'not_compliant', ${tx.json({ reason: "Added by the browser test for R1 (simulated)." })})
                on conflict do nothing`;
            }
          });
          for (const extra of newestFirst(await storedAlerts(sql)).slice(5)) await sql`delete from public.performance_alerts where id = ${extra.id}`;
          return newestFirst(await storedAlerts(sql));
        });
        expect(five.every((a) => a.seenAt === null)).toBe(true);
        expect(five).toHaveLength(5);
      });

      for (const size of [DESKTOP, PHONE]) {
        await step(page, `U10-4.8 at ${size.width} px: the newest 3 in full, the other 2 one line and hidden, and Show all 5 alerts below them`, async () => {
          await page.setViewportSize(size);
          await openPerformance(page);
          const items = alertsSection(page).locator("[data-perf-alert]");
          expect(await items.evaluateAll((xs) => xs.map((x) => x.getAttribute("data-perf-alert")!))).toEqual(five.map((a) => a.id));
          for (const a of five.slice(0, 3)) {
            const item = alertItem(page, a.id);
            await expect(item).toHaveAttribute("data-alert-full", "");
            await expect(item.locator("[data-alert-facts]")).toBeVisible();
            await expect(item.getByRole("button", { name: "Mark as seen" })).toBeVisible();
            await expect(item.locator("[data-alert-oneline]")).toHaveCount(0);
          }
          for (const a of five.slice(3)) {
            const item = alertItem(page, a.id);
            await expect(item).not.toHaveAttribute("data-alert-full", "");
            await expect(item.locator("[data-alert-oneline]")).toHaveCount(1);
            await expect(item).toBeHidden();
          }
          const button = alertsSection(page).getByRole("button", { name: "Show all 5 alerts", exact: true });
          await expect(button).toBeVisible();
          const below = (await button.boundingBox())!.y;
          expect(below, "the control is below the alerts in full").toBeGreaterThan((await alertItem(page, five[2].id).boundingBox())!.y);
          await expect(alertsSection(page).getByRole("button", { name: MARK_ALL, exact: true })).toBeVisible();
          await expectNoHorizontalScroll(page, `performance, 5 unseen alerts, at ${size.width}px`);
          expect(await contrastViolations(page)).toEqual([]);
        });
      }

      await step(page, "U10-4.8: by keyboard, Show all 5 alerts reveals the other 2 in place, each one line, and moves focus to the first of them", async () => {
        await page.setViewportSize(DESKTOP);
        await openPerformance(page);
        const button = alertsSection(page).getByRole("button", { name: "Show all 5 alerts", exact: true });
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(button).toHaveCount(0);
        for (const a of five.slice(3)) {
          const line = alertItem(page, a.id).locator("[data-alert-oneline]");
          await expect(line).toBeVisible();
          expect(await linesOf(line), "a one-line alert at 1440 px").toBe(1);
        }
        await expect(alertItem(page, five[3].id).locator("summary")).toBeFocused();
        const order = await alertsSection(page).locator("[data-perf-alert]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-perf-alert")!));
        expect(order, "still newest first").toEqual(five.map((a) => a.id));
        expect(await contrastViolations(page)).toEqual([]);
      });

      await step(page, "U10-4.8: an unseen one-line alert opens in place to its facts and Mark as seen, which marks it", async () => {
        const item = alertItem(page, five[4].id);
        await item.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(item.locator("[data-alert-facts]")).toBeVisible();
        await item.getByRole("button", { name: "Mark as seen" }).click();
        await expect(item).toHaveAttribute("data-seen", "", { timeout: 30_000 });
      });
    },
  );

  test(
    "U10-4 #4: Mark all as seen marks every unseen alert of this launch, records who, updates the home line, and a stale tab's second press marks nothing again",
    { annotation: [{ type: "case", description: "U10-4.4" }] },
    async ({ page }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to read who saw the alerts and the home count");
      expect(launchId, "the launch from case 3's test").not.toBe("");
      const before = await withSql((sql) => storedAlerts(sql));
      const unseen = before.filter((a) => a.seenAt === null);
      expect(unseen.length, "case 2 marked one; the rest are unseen").toBeGreaterThanOrEqual(1);
      expect(before.some((a) => a.seenAt !== null)).toBe(true);

      const stale = await page.context().newPage();
      await step(page, "Another tab opens the Performance page first: Mark all as seen is there too", async () => {
        await stale.goto(stagePath(path, "performance"));
        await settle(stale);
        await expect(stale.locator("[data-perf-alerts] button[data-mark-all-seen]")).toHaveText(MARK_ALL);
      });

      const pressed = Date.now();
      await step(page, `U10-4.4: Mark all as seen says it marked ${unseen.length}, and every alert is seen, with none left to mark`, async () => {
        await openPerformance(page);
        const button = alertsSection(page).getByRole("button", { name: MARK_ALL, exact: true });
        await expect(button).toHaveAttribute("data-mark-all-seen", "");
        await button.click();
        await expect(toast(page, markedText(unseen.length))).toBeVisible({ timeout: 30_000 });
        await openPerformance(page);
        await expect(alertsSection(page).locator("button[data-mark-all-seen]")).toHaveCount(0);
        await expect(alertsSection(page).getByRole("button", { name: "Mark as seen" })).toHaveCount(0);
        await expect(alertsSection(page).locator("[data-perf-alert]:not([data-seen])")).toHaveCount(0);
        await expect(alertsSection(page).locator("[data-perf-alert][data-seen]")).toHaveCount(before.length);
      });

      await step(page, "U10-4.4: each was recorded as seen by the person who pressed it, now; the one seen before keeps its time", async () => {
        const after = await withSql(async (sql) => {
          const [{ id: devId }] = await sql`select id from auth.users where email = ${DEV_EMAIL}`;
          return { devId: devId as string, alerts: await storedAlerts(sql) };
        });
        for (const a of unseen) {
          const now = after.alerts.find((x) => x.id === a.id)!;
          expect(now.seenBy, `${a.kind} on day ${a.day}`).toBe(after.devId);
          expect(now.seenAt!.getTime(), `${a.kind} on day ${a.day}`).toBeGreaterThanOrEqual(pressed - 5_000);
        }
        for (const a of before.filter((x) => x.seenAt !== null)) expect(after.alerts.find((x) => x.id === a.id)!.seenAt).toEqual(a.seenAt);
      });

      await step(page, "U10-4.4: Studio's home counts the unseen alerts on live campaigns without this launch's", async () => {
        await expect
          .poll(
            async () => {
              await page.goto("/");
              await settle(page);
              const shown = (await page.locator("[data-home-alerts]").count()) ? ((await page.locator("[data-home-alerts]").textContent()) ?? "").trim() : null;
              // Other specs' launches may raise or clear alerts meanwhile, so the line is read against the database at the same moment.
              const n = await withSql(async (sql) => {
                const [{ n }] = await sql`
                  select count(*)::int as n from public.performance_alerts a join public.launches l on l.id = a.launch_id
                  join public.workspace_members m on m.workspace_id = l.workspace_id join auth.users u on u.id = m.user_id
                  where u.email = ${DEV_EMAIL} and l.status = 'live' and a.seen_at is null`;
                return n as number;
              });
              return shown === (n === 0 ? null : alertsLine(n));
            },
            { timeout: 60_000, intervals: [2_000, 5_000] },
          )
          .toBe(true);
        const [{ n: mine }] = await withSql((sql) => sql`select count(*)::int as n from public.performance_alerts where launch_id = ${launchId} and seen_at is null`);
        expect(mine).toBe(0);
      });

      await step(page, "U10-4.4, the failure path: the stale tab's Mark all as seen marks nothing again, and who and when stay as they were", async () => {
        const first = await withSql((sql) => storedAlerts(sql));
        await stale.locator("[data-perf-alerts] button[data-mark-all-seen]").click();
        await expect(toast(stale, markedText(0))).toBeVisible({ timeout: 30_000 });
        const again = await withSql((sql) => storedAlerts(sql));
        expect(again.map((a) => [a.id, a.seenBy, a.seenAt?.getTime()]).sort()).toEqual(first.map((a) => [a.id, a.seenBy, a.seenAt?.getTime()]).sort());
      });
      await stale.close();
    },
  );
});
