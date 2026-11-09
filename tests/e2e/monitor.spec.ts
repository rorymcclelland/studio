// P9-4 The Monitor agent through the UI, with the mock models: the alerts on
// the Performance view and Ask about this campaign. The flow follows
// tests/e2e/performance.spec.ts on a new signed-off Fernhollow campaign with
// ads (simulated pictures), launched with the defaults and approved in the
// inbox. The database is read through DATABASE_URL, so the page can be
// checked against the stored rows. It is written once: a launch's terms never
// change once it is asked for (launches_terms, the rule P9-1.6 checks in
// tests/db/launch.test.ts #6, with the fixture's own test there), so the
// browser-test fixture (tests/e2e/launch-fixture.ts) sets the waiting
// launch's seed and threshold as the table's owner, switching launches_terms
// off for that one update.
//
// Main path (cases 1 and 4). Three paid-social ads are picked and launched.
// While the launch waits for approval, the fixture sets its seed to one whose month,
// worked out first with the pure simulator, has an ad tiring between days 9
// and 14 and none before, and its threshold to a click-through rate every ad
// meets (so the only alerts are Tiring). Day 7: no alert yet. Day 14: the
// tiring ad's alert, on the day the reading says, with the current and the
// best three-day rates; the home page counts unseen alerts; Mark as seen
// records who. Then "Which ad had the lowest cost per acquisition last week?"
// is asked, with the cost shown: the answer comes with "Simulated data.
// Answer written by AI", the table it used sits underneath, lowest cost per
// acquisition first, and the answer names its first ad with that ad's figure;
// every figure in the answer is in that table. 375 px and 1440 px with AA
// contrast.
// Failure path: "What did our rivals spend?" gets "I can only answer from this
// campaign's simulated results", with no table.
//
// SHOTS_DIR=<folder> saves screenshots. The interface it expects is written at
// the top of tests/flows/monitor.test.ts.
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { ANSWER_LABEL, CANNOT_ANSWER, checkAnswer, type QueryResult } from "@/lib/performance/ask-rules";
import { alertLine, ALERT_NAMES, NO_ALERTS, type Alert } from "@/lib/performance/alerts";
import type { LaunchAd } from "@/lib/performance/launch";
import type { SimRow } from "@/lib/performance/simulate";
import { MOCK_CPA_QUESTION, percentShown, referenceTiring, seedWithTiring } from "../helpers/monitor";
import { setWaitingLaunchTerms } from "./launch-fixture";
import {
  acceptDontRulesForPicked,
  contrastViolations,
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
  untilShown,
} from "./helpers";

type Sql = postgres.Sql;

const panel = (page: Page) => page.locator("[data-launch-panel]");
const launchStatus = (page: Page) => panel(page).locator("[data-launch-status]");
const clock = (page: Page) => panel(page).locator("[data-sim-clock]");
const social = (page: Page) => page.locator('[data-gallery] > li[data-channel="paid social"]');
const alerts = (page: Page) => page.locator("[data-perf-alerts]");
const alertItems = (page: Page) => alerts(page).locator("[data-perf-alert]");
const askBox = (page: Page) => page.locator("[data-ask]");
const asked = (page: Page, question: string) => page.locator("[data-ask-question]").filter({ has: page.locator("[data-ask-text]", { hasText: question }) }).first();
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

async function pickCard(page: Page, card: ReturnType<Page["locator"]>) {
  await card.getByRole("button", { name: /^Pick ad \d+$/ }).click();
  await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
}

/** The campaign's Launch stage (U10-2), through the stage bar, with its Launch (simulated) panel. */
async function openPanel(page: Page, path: string) {
  await openLaunch(page, path);
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

async function moveOn(page: Page, path: string, button: "Next day" | "Next week", day: number) {
  await openPanel(page, path);
  await panel(page).getByRole("button", { name: button }).click();
  await expect(clock(page)).toHaveText(`Simulated day ${day} of 30`, { timeout: 60_000 });
}

async function openPerformance(page: Page, path: string) {
  await openPanel(page, path);
  await panel(page).getByRole("link", { name: "See performance (simulated)" }).click();
  await page.waitForURL(new RegExp(`${escape(path)}/performance$`));
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: /^Performance/ })).toBeVisible();
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

/**
 * Asks a question in the box and waits for its answer to show (the page
 * refreshes; a reload always lands). The mock model always answers, so a
 * refusal fails here, with the sentence the page shows and the run's error from
 * its trail (the checks' problems), so a failure explains itself.
 */
async function askAndWait(page: Page, sql: Sql, launchId: string, question: string) {
  await askBox(page).getByRole("textbox", { name: "Ask about this campaign" }).fill(question);
  await askBox(page).getByRole("button", { name: "Ask" }).click();
  await untilShown(page, async () => {
    await expect(asked(page, question).locator("[data-ask-answer]")).not.toBeEmpty({ timeout: 2_000 });
  }, 120_000);
  const item = asked(page, question);
  if ((await item.getAttribute("data-status")) === "refused") {
    const shown = ((await item.locator("[data-ask-answer]").textContent()) ?? "").trim();
    const [run] = await sql`
      select r.status, r.error from public.performance_questions q left join public.agent_runs r on r.id = q.run_id
      where q.launch_id = ${launchId} and q.question = ${question} order by q.created_at desc limit 1`;
    throw new Error(`"${question}" was refused: ${shown} (run ${run?.status ?? "not found"}: ${run?.error ?? "no error recorded"})`);
  }
  return item;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "P9-4 #1, #4: a launched Fernhollow campaign's tiring ad raises its alert on the right simulated day with both figures and is marked as seen, and Which ad had the lowest cost per acquisition last week? is answered from the table shown under it",
  { annotation: [{ type: "case", description: "P9-4.1" }, { type: "case", description: "P9-4.4" }] },
  async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to set the launch's seed before approval and read the stored results");
    test.setTimeout(900_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    let path = "";
    let launchId = "";
    let tiring = { variantId: "", day: 0 };
    try {
      await step(page, "A signed-off Fernhollow brief and its ads (simulated pictures); pick three paid-social ads and accept their don't rules", async () => {
        path = await newCampaign(page, "Fernhollow Outfitters", "Bring walkers back for the autumn range, watched by the monitor");
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
        expect(await social(page).count()).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < 3; i++) await pickCard(page, social(page).nth(i));
        await page.reload();
        await acceptDontRulesForPicked(page);
      });

      await step(page, "Ask to launch; while it waits, give it a seed whose month has an ad tiring between days 9 and 14, and a threshold every ad meets", async () => {
        await openPanel(page, path);
        await expect(panel(page).locator("[data-launch-ad]")).toHaveCount(3);
        await panel(page).getByRole("button", { name: "Ask to launch" }).click();
        await expect(launchStatus(page)).toHaveText("Waiting for approval", { timeout: 30_000 });
        const [l] = await sql`
          select id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, days, daily_budget_pence, ads
          from public.launches where campaign_id = ${campaignIdOf(path)} and status = 'awaiting_approval'`;
        launchId = l.id as string;
        const prices = await sql`
          select p.price_pence from public.products p join public.campaigns c on c.brand_id = p.brand_id
          where c.id = ${campaignIdOf(path)} and p.active order by p.price_pence`;
        const found = seedWithTiring(
          { startsOn: l.starts_on, days: l.days, dailyBudgetPence: l.daily_budget_pence, ads: l.ads as LaunchAd[], orderValuesPence: prices.map((p) => p.price_pence as number) },
          9,
          14,
        );
        tiring = { variantId: found.variantId, day: found.day };
        // A launch's terms never change once asked for (launches_terms): the fixture sets them as the tables' owner.
        await setWaitingLaunchTerms(sql, launchId, { seed: found.seed, kpi_measure: "ctr", kpi_value: 0.01 });
        await approveInInbox(page, path);
      });

      await step(page, "P9-4.1: Next week to simulated day 7: no alert yet, not earlier than the day the reading says", async () => {
        await moveOn(page, path, "Next week", 7);
        await openPerformance(page, path);
        await expect(alerts(page).getByRole("heading", { name: "Alerts (simulated)" })).toBeVisible();
        await expect(alertItems(page)).toHaveCount(0);
        await expect(alerts(page)).toContainText(NO_ALERTS);
      });

      let alertId = "";
      await step(page, "P9-4.1: Next week to day 14: the tiring ad's alert, on its first day 25% below its best, with both three-day rates and their days", async () => {
        await moveOn(page, path, "Next week", 14);
        await openPerformance(page, path);
        const rows = await storedRows(sql, launchId);
        const due = referenceTiring(rows, tiring.variantId, 14)!;
        expect(due.day).toBe(tiring.day);
        // Every Tiring alert on the page is one the reading says is due by day 14, on its day (another ad may tire too).
        const [{ ads }] = await sql`select ads from public.launches where id = ${launchId}`;
        const expected = (ads as LaunchAd[]).map((x) => ({ variantId: x.variantId, day: referenceTiring(rows, x.variantId, 14)?.day })).filter((x) => x.day !== undefined);
        const shown = await alertItems(page).evaluateAll((xs) => xs.map((x) => ({ kind: x.getAttribute("data-kind"), day: Number(x.getAttribute("data-day")) })));
        expect(shown.every((x) => x.kind === "tiring")).toBe(true);
        expect(shown.map((x) => x.day).sort((p, q) => p - q)).toEqual(expected.map((x) => x.day!).sort((p, q) => p - q));

        const [stored] = await sql`select id, day, facts from public.performance_alerts where launch_id = ${launchId} and variant_id = ${tiring.variantId} and kind = 'tiring'`;
        alertId = stored.id as string;
        expect(stored.day).toBe(tiring.day);
        const item = alerts(page).locator(`[data-perf-alert="${alertId}"]`);
        await expect(item).toHaveAttribute("data-kind", "tiring");
        await expect(item).toHaveAttribute("data-day", String(tiring.day));
        await expect(item.locator("[data-alert-kind]")).toHaveText(ALERT_NAMES.tiring);
        await expect(item.locator("[data-alert-day]")).toHaveText(`Simulated day ${tiring.day}`);
        const facts = item.locator("[data-alert-facts]");
        await expect(facts).toContainText(percentShown(due.current.ctr));
        await expect(facts).toContainText(percentShown(due.best.ctr));
        await expect(facts).toContainText(`simulated days ${due.current.from} to ${due.current.to}`);
        await expect(facts).toContainText(`days ${due.best.from} to ${due.best.to}`);
        const adNumber = Number(/^Ad (\d+) /.exec((await facts.textContent()) ?? "")?.[1]);
        await expect(facts).toHaveText(alertLine({ kind: "tiring", variantId: tiring.variantId, day: tiring.day, facts: stored.facts } as Alert, adNumber));
        // Alerts never act: the only control is Mark as seen.
        await expect(item.getByRole("button")).toHaveText(["Mark as seen"]);
      });

      await step(page, "P9-4.1: Studio's home counts the unseen alerts, labelled simulated", async () => {
        await page.goto("/");
        await settle(page);
        // Other specs' launches may have alerts too, so the count isn't pinned.
        await expect(page.locator("[data-home-alerts]")).toHaveText(/^\d+ unseen alerts? on live campaigns \(simulated\)$/);
      });

      await step(page, "P9-4.1: Mark as seen records who and when", async () => {
        await openPerformance(page, path);
        const item = alerts(page).locator(`[data-perf-alert="${alertId}"]`);
        await item.getByRole("button", { name: "Mark as seen" }).click();
        await expect(item.locator("[data-alert-seen]")).toContainText(`Seen by ${DEV_EMAIL}`, { timeout: 30_000 });
        await expect(item.getByRole("button", { name: "Mark as seen" })).toHaveCount(0);
        const [row] = await sql`select seen_at, (select email from auth.users u where u.id = a.seen_by) as email from public.performance_alerts a where id = ${alertId}`;
        expect(row.email).toBe(DEV_EMAIL);
        expect(row.seen_at).toBeInstanceOf(Date);
      });

      await step(page, "P9-4.4: Ask about this campaign shows its cost and a 300-character limit; Which ad had the lowest cost per acquisition last week? is answered", async () => {
        const box = askBox(page);
        const input = box.getByRole("textbox", { name: "Ask about this campaign" });
        await expect(input).toHaveAttribute("maxlength", "300");
        await expect(box.locator("[data-ask-cost]")).toHaveText(/about [\d.]+p/);
        const item = await askAndWait(page, sql, launchId, MOCK_CPA_QUESTION);
        const answer = (await item.locator("[data-ask-answer]").textContent())!.trim();
        await expect(item.locator("[data-ask-label]")).toHaveText(ANSWER_LABEL);

        // The table it used, under it: the stored result, last week being simulated days 8 to 14.
        const [q] = await sql`
          select answer, result from public.performance_questions where launch_id = ${launchId} and question = ${MOCK_CPA_QUESTION}
          order by created_at desc limit 1`;
        const result = q.result as QueryResult;
        expect(answer).toBe(q.answer);
        expect(result).toMatchObject({ from: 8, to: 14, groupBy: "ad", sort: { by: "cpa", direction: "asc" } });
        // Lowest cost per acquisition first (an ad with no conversions has none, and comes last).
        expect(result.rows.length).toBeGreaterThan(0);
        const cpas = result.rows.map((r) => r.values.cpa ?? null);
        const ascending = [...cpas].sort((a, b) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b));
        expect(cpas).toEqual(ascending);
        const table = item.locator("[data-ask-result]");
        await expect(table.locator("caption")).toHaveText("Simulated days 8 to 14 (simulated)");
        await expect(table.locator("tbody tr")).toHaveCount(result.rows.length);
        for (const [i, r] of result.rows.entries()) {
          const row = table.locator("tbody tr").nth(i);
          await expect(row).toContainText(`Ad ${r.adNumber}`);
          for (const m of result.measures) await expect(row).toContainText(r.shown[m]!);
        }
        // Every figure in the answer is in the result (the check in code), and on the page in the table under it.
        expect(checkAnswer(answer, result)).toEqual([]);
        // The answer names the ad with the lowest cost per acquisition, the result's first row, with its figure as the
        // table shows it, so the figure check below can't pass on an answer with no figures in it.
        expect(answer).toMatch(new RegExp(`\\bAd ${result.rows[0].adNumber}\\b`));
        expect(answer).toContain(result.rows[0].shown.cpa!);
        const figures = answer.match(/£?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
        expect(figures.length, answer).toBeGreaterThan(0);
        const tableText = (await table.textContent()) ?? "";
        for (const figure of figures) expect(tableText, figure).toContain(figure);
        await checkWidths(page, "performance, alerts and an answer");
      });

      await step(page, "The failure path: What did our rivals spend? gets the fixed reply, and no table", async () => {
        const item = await askAndWait(page, sql, launchId, "What did our rivals spend?");
        await expect(item.locator("[data-ask-answer]")).toHaveText(CANNOT_ANSWER);
        await expect(item.locator("[data-ask-result]")).toHaveCount(0);
        await expect(item.locator("[data-ask-label]")).toHaveCount(0);
      });
    } finally {
      await sql.end();
    }
  },
);
