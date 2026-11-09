// U10-5 Home leads with work, through the UI. Home shows what needs a person
// across all campaigns: a "Needs you" list (approvals waiting, and unseen
// alerts per campaign linked to that campaign's Performance page), the live
// campaigns with their simulated day and healthy spend share, and the recent
// runs naming their campaign; the Sprint 1 tagline demo becomes a small card at
// the bottom (answer Q4). Answer B1 (9 November) folds the approvals inbox in:
// a sign-off card shows a summary, with its personas and test plan on request,
// and (U10-2's note) the inbox links each card to the stage where its decision
// is made, not the campaign's overview.
//
// The dev workspace holds whatever other specs leave waiting while this runs,
// so these tests use a new invitee's own workspace: the owner invites them on
// /invites and they accept, as a person does (case 2 reads it empty), then its
// work is written to the database (tests/e2e/home-fixture.ts) and one real
// tagline run, started from the demo card at the bottom of home, waits for a
// choice. The cases run in the order that needs (serial): 2, 1, 3 (marks
// alerts seen), 4, 6, then 5 (approves the sign-off, the failure path's
// counterpart: the item leaves home). Home's place in the length budgets is
// U10-6's "home" page (tests/e2e/page-budgets.ts: [data-needs-you] within 1.5
// screens at 375 px); the inbox's are its "approvals" page.
//
// 1. With approvals and alerts waiting, home's first screen at 375 px and
//    1440 px lists them, each linking to its place; the live campaigns show
//    their day and share; the tagline demo is the last card.
// 2. With nothing waiting, home says "Nothing needs you right now."
// 3. The alerts item links to the campaign's Performance page, not the list;
//    marking them seen there removes the item, and an ended launch's alerts
//    never show.
// 4. Recent runs show their campaign, or "No campaign"; a run naming another
//    workspace's campaign shows "No campaign", never its name (rule 7).
// 5. (B1) A sign-off card is a summary: its personas and test plan open on
//    request; the first Approve is within 1.5 screens at 375 px; Approve from
//    the card still works, and the item leaves home.
// 6. (B1, U10-2's note) The inbox links a sign-off to the campaign's Brief
//    stage and a launch to its Launch stage.
//
// ---------------------------------------------------------------- interface
// What the builder provides. The tests here, tests/lib/home-work.test.ts and
// tests/flows/home-work.test.ts pin it. Rules 1, 3 and 7 hold: every figure
// keeps its simulated label; home only links to where decisions are made
// (Approve stays in the inbox and on its stage); everything is read through
// asUser().
//
// src/lib/home/needs.ts (NEW, PURE: imports only @/lib/campaigns/stages, @/lib/performance/health and types):
//   NOTHING_NEEDS_YOU (re-exported from @/lib/campaigns/stages) = "Nothing needs you right now."
//   NO_CAMPAIGN = "No campaign"
//   HOME_TITLE = "Home"
//   LIVE_HEADING = "Live campaigns"
//   type CampaignRef = { id: string; name: string }
//   campaignName({ title: string | null; objective: string }) => string: the title trimmed, else the objective
//     (as the campaigns list names a campaign: its current brief version's title, else its objective).
//   type HomeApproval =
//     | { kind: "brief_signoff"; approvalId: string; campaign: CampaignRef; version: number }
//     | { kind: "launch"; approvalId: string; campaign: CampaignRef }
//     | { kind: "run_choice"; approvalId: string; runId: string; runLabel: string | null; question: string }
//   type CampaignAlerts = { campaign: CampaignRef; unseen: number; newestAt: Date }
//   type HomeNeedKind = "decide-signoff" | "approve-launch" | "run-choice" | "alerts"
//   type HomeNeed = { key: string; kind: HomeNeedKind; text: string; href: string; campaignId: string | null }
//   homeNeeds(approvals: readonly HomeApproval[], alerts: readonly CampaignAlerts[]) => HomeNeed[]:
//     every approval, in the order given (the inbox's: newest first), then one item per campaign with
//     unseen > 0, newestAt descending, then campaign id ascending; a campaign with 0 unseen has no item.
//       decide-signoff  key "decide-signoff:<approvalId>", "Decide the sign-off of version 2: <name>"
//                       -> /campaigns/<id>/brief (where Approve is, beside the inbox; rule 3)
//       approve-launch  key "approve-launch:<approvalId>", "Approve or refuse the launch (simulated): <name>"
//                       -> /approvals#approval-<approvalId> (the inbox card's heading id, as today)
//       run-choice      key "run-choice:<approvalId>", "Choose on the run: <runLabel trimmed, else question>"
//                       -> /runs/<runId>; campaignId null
//       alerts          key "alerts:<campaignId>", "3 unseen alerts (simulated): <name>" ("1 unseen alert")
//                       -> /campaigns/<id>/performance (never /campaigns)
//   liveShareLine(share: number | null) => "Healthy spend share: 84% (simulated)",
//     "Healthy spend share: Not enough data yet (simulated)" (shareText's words).
//
// src/lib/approvals/inbox-view.ts (NEW, PURE: no imports but types):
//   REVIEWS_SUMMARY_LABEL = "Personas and test plan"
//   reviewsSummary({ personas: number; plan: boolean; preparing: boolean }) => string, for a sign-off's own
//     version (personas: in its review, 0 for none):
//       preparing (a persona or test plan run for it queued or running)  "Being prepared"
//       personas > 0 and a plan   "3 synthetic personas and a test plan" ("1 synthetic persona and a test plan")
//       personas > 0, no plan     "3 synthetic personas; no test plan"
//       no personas, a plan       "A test plan; no persona review"
//       neither                   "No persona review or test plan"
//
// src/lib/home/work.ts (NEW, server, through asUser(); rule 7):
//   homeNeedsFor(userId) => Promise<HomeNeed[]>: homeNeeds() of what listInbox() would list (pending, not
//     expired; a run choice only while its run awaits approval; newest first; it closes stale sign-offs and
//     launches first, as listInbox does), and, per campaign, the unseen alerts on its live launch (an ended
//     launch's alerts don't count, as unseenAlertCount), newestAt the newest unseen alert's created_at. Names
//     by campaignName() from the current brief version's title. Another workspace's approvals and alerts
//     never appear.
//
// src/lib/performance/dashboard.ts:
//   HomeHealth gains live: LiveCampaign[], every live launch in the order homeHealth reads them (created_at,
//   id): LiveCampaign = { campaignId: string; name: string; launchId: string; simDay: number; days: number;
//   share: number | null }, share being that launch's own healthy spend share on its simulated day
//   (dayHealth's share, as its Performance page shows it), null on day 0 or with no rows. homeHealth stays
//   null when nothing is live; its pooled line is unchanged.
//
// src/lib/agents/runs.ts:
//   RunSummary gains campaign: CampaignRef | null, from the same query: the campaign the run's input names
//   (input ->> 'campaignId'), else, for a run whose input names a questionId (monitorPlan), that question's
//   launch's campaign; null otherwise, and null for an id that isn't a campaign in the reader's workspace
//   (rule 7: never another workspace's name). The name is campaignName(). U10-8 shows the same.
//
// Home (src/app/(app)/page.tsx), top to bottom:
//   - <h1> HOME_TITLE.
//   - <section data-needs-you> (aria-labelledby its <h2> "Needs you"), the overview's look: per homeNeeds()
//     item, in order, <li data-need="<kind>" data-need-key="<key>"> (with data-campaign="<campaignId>" when it
//     has one) holding one <a href> with the item's text. No items: a leaf [data-nothing-needs-you] with
//     NOTHING_NEEDS_YOU, and no list. Wholly within the first screen at 375 px (812 px tall) and 1440 px
//     (900 px) with the five items of this spec's fixture.
//   - <section data-home-live> only while a launch is live, with <h2> LIVE_HEADING; the healthy spend share
//     card as today inside it or just above it ([data-home-health] with the pooled line, and
//     [data-home-alerts] with alertsLine(unseenAlertCount) when it is not 0, unchanged for P9-3, P9-4 and
//     U10-4's specs); per LiveCampaign, in order, <li data-live-campaign="<campaignId>"> with a link to
//     /campaigns/<id> named by the campaign's name, a leaf [data-live-day] with liveLabel(simDay) ("Live
//     (simulated day 14)") and a leaf [data-live-share] with liveShareLine(share).
//   - Recent runs, as today (<h2> "Recent runs", "See all runs", the empty state "No runs yet"), each row
//     <li data-run="<runId>"> keeping its link to /runs/<id>, with a leaf [data-run-campaign] holding the
//     run's campaign's name or NO_CAMPAIGN.
//   - Last: the tagline demo as a small card, <section data-tagline-demo> (not the hero), with <h2> "Try the
//     tagline agent" and today's form (Brand name, "Propose taglines"), so signIn()'s check still finds it.
//   In document order: [data-needs-you], [data-home-live] (when shown), Recent runs, [data-tagline-demo].
//
// The approvals inbox (src/app/(app)/approvals/page.tsx), every card as today plus:
//   - each card <li data-inbox-item="<kind>" data-approval="<approvalId>">, sign-off and launch cards with
//     data-campaign="<campaignId>" (helpers.ts inboxCard() finds a campaign's card by it);
//   - the link to the campaign is a[data-inbox-campaign-link]: a sign-off card's
//     "Read the brief on the campaign" -> /campaigns/<id>/brief; a launch card's
//     "See the launch on the campaign" -> /campaigns/<id>/launch;
//   - a sign-off card shows on its face: the pill, brand and when asked, "Version N: <title>" (h2, id
//     approval-<id>, as today), the objective, when it closes, the link and the decision (Approve version N,
//     Reject), and a closed <details data-signoff-reviews> whose <summary> reads "Personas and test plan: "
//     followed by a leaf [data-reviews-summary] with reviewsSummary(); opening it (Enter on the summary)
//     shows today's two panels in place (Personas with [data-persona-overall], Test plan with the
//     "Hypotheses" list and PLAN_NOTE, or their being prepared or failed lines). With the reviews closed
//     the card is at most one screen tall at 375 px, and the inbox's first Approve starts within 1.5 screens.
//   Launch and run-choice cards are otherwise as today.
// ----------------------------------------------------------------------------
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { liveLabel } from "@/lib/campaigns/status";
import { alertsLine } from "@/lib/performance/alerts";
import { contrastViolations, expectNoHorizontalScroll, inboxCard, settle, signIn, startRunAwaitingApproval, step } from "./helpers";
import { insertHomeFixture, memberByEmail, removeHomeFixture, type FixtureMember, type HomeFixture, type HomeKey } from "./home-fixture";

type Sql = postgres.Sql;
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const NOTHING = "Nothing needs you right now.";
const NO_CAMPAIGN = "No campaign";
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };
const TAGLINE_BRAND = "Larkspur Mill";
const PLAN_NOTE_START = "The plan has no sample sizes or run lengths on purpose.";

const signoffText = (version: number, name: string) => `Decide the sign-off of version ${version}: ${name}`;
const launchText = (name: string) => `Approve or refuse the launch (simulated): ${name}`;
const runChoiceText = (labelOrQuestion: string) => `Choose on the run: ${labelOrQuestion}`;
const alertsText = (n: number, name: string) => `${n} unseen ${n === 1 ? "alert" : "alerts"} (simulated): ${name}`;
const shareLine = (shown: string) => `Healthy spend share: ${shown} (simulated)`;

const needs = (page: Page) => page.locator("[data-needs-you]");
const items = (page: Page) => needs(page).locator("[data-need]");
const needByKey = (page: Page, key: string) => needs(page).locator(`[data-need-key="${key}"]`);
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });

// The journey's state, shared by the serial tests below.
let guestEmail = "";
let guestState: StorageState | null = null;
let guest: FixtureMember | null = null;
let fx: HomeFixture | null = null;
/** The real tagline run waiting for a choice, and its approval. */
let taglineRun = "";
let taglineApproval = "";
let taglineLabel = "";

const withSql = async <T>(body: (sql: Sql) => Promise<T>): Promise<T> => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return await body(sql);
  } finally {
    await sql.end();
  }
};

/** The invitee's own signed-in page, at a width. */
async function guestPage(browser: Browser, viewport = DESKTOP): Promise<Page> {
  expect(guestState, "the invitee from case 2's test").not.toBeNull();
  const ctx = await browser.newContext({ storageState: guestState!, viewport });
  return ctx.newPage();
}

async function openHome(page: Page) {
  await page.goto("/");
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Whether an element is wholly within the first screen, with the page at its top. */
async function expectInFirstScreen(page: Page, el: Locator, what: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(el, what).toBeVisible();
  const box = (await el.boundingBox())!;
  const height = page.viewportSize()!.height;
  expect(box.y, `${what}'s top`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what} ends ${Math.round(box.y + box.height)} px down; the first screen is ${height} px`).toBeLessThanOrEqual(height);
}

/** The document's top of an element. */
const topOf = (el: Locator) => el.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);

/** What home must list for the fixture, in order (newest approval first, then campaigns by their newest unseen alert). */
function expectedNeeds(f: HomeFixture): { key: string; kind: string; text: string; href: string; campaign: string | null }[] {
  const n = f.names;
  const c = f.campaigns;
  return [
    { key: `run-choice:${taglineApproval}`, kind: "run-choice", text: runChoiceText(taglineLabel), href: `/runs/${taglineRun}`, campaign: null },
    { key: `approve-launch:${f.launchApproval}`, kind: "approve-launch", text: launchText(n.launchWaiting), href: `/approvals#approval-${f.launchApproval}`, campaign: c.launchWaiting },
    { key: `decide-signoff:${f.signoffApproval}`, kind: "decide-signoff", text: signoffText(1, n.waiting), href: `/campaigns/${c.waiting}/brief`, campaign: c.waiting },
    { key: `alerts:${c.liveB}`, kind: "alerts", text: alertsText(f.unseen.liveB, n.liveB), href: `/campaigns/${c.liveB}/performance`, campaign: c.liveB },
    { key: `alerts:${c.liveA}`, kind: "alerts", text: alertsText(f.unseen.liveA, n.liveA), href: `/campaigns/${c.liveA}/performance`, campaign: c.liveA },
  ];
}

test.describe("U10-5 home for a new invitee's workspace, then with its work waiting", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    if (!process.env.DATABASE_URL) return;
    await withSql((sql) => removeHomeFixture(sql, guest, fx?.hidden.campaignId ?? null));
  });

  test(
    "U10-5 #2: with nothing waiting, home says Nothing needs you right now, and the tagline demo is a small card at the bottom",
    { annotation: [{ type: "case", description: "U10-5.2" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to find the invitee's workspace and write its work for the cases that follow");
      test.setTimeout(180_000);
      guestEmail = `home-${Date.now()}@example.test`;

      await step(page, "The owner invites someone; they accept, and land on their own empty workspace's home", async () => {
        await signIn(page);
        await page.goto("/invites");
        await settle(page);
        await page.getByLabel("Email").filter({ visible: true }).fill(guestEmail);
        await page.getByRole("button", { name: "Create invite link" }).click();
        const link = await page.locator("[data-invite-link] input").first().inputValue();
        const ctx = await browser.newContext({ viewport: DESKTOP });
        const g = await ctx.newPage();
        await g.goto(new URL(link).pathname);
        await g.getByRole("button", { name: "Continue to Studio" }).click();
        await expect(g.getByRole("heading", { name: "Try the tagline agent" })).toBeVisible();
        guestState = await ctx.storageState();
        guest = await withSql((sql) => memberByEmail(sql, guestEmail));
        await ctx.close();
      });

      for (const viewport of [PHONE, DESKTOP]) {
        await step(page, `U10-5.2: at ${viewport.width} px, Needs you says nothing needs you, in the first screen, with no list`, async () => {
          const g = await guestPage(browser, viewport);
          await openHome(g);
          await expect(needs(g).getByRole("heading", { level: 2, name: "Needs you" })).toBeVisible();
          await expect(needs(g).locator("[data-nothing-needs-you]")).toHaveText(NOTHING);
          await expect(items(g)).toHaveCount(0);
          await expect(needs(g).locator("ul, ol")).toHaveCount(0);
          await expectInFirstScreen(g, needs(g), "Needs you");
          // Nothing is live, so there is no live campaigns section; no runs yet.
          await expect(g.locator("[data-home-live]")).toHaveCount(0);
          await expect(g.locator("[data-home-health]")).toHaveCount(0);
          await expect(g.getByRole("heading", { name: "No runs yet" })).toBeVisible();
          await expectNoHorizontalScroll(g, `home with nothing waiting at ${viewport.width}px`);
          expect(await contrastViolations(g), `home with nothing waiting at ${viewport.width}px`).toEqual([]);
          await g.context().close();
        });
      }

      await step(page, "Answer Q4: the tagline demo is a card after Needs you and Recent runs, its heading an h2, with its form", async () => {
        const g = await guestPage(browser, DESKTOP);
        await openHome(g);
        const demo = g.locator("[data-tagline-demo]");
        await expect(demo).toHaveCount(1);
        await expect(demo.getByRole("heading", { level: 2, name: "Try the tagline agent" })).toBeVisible();
        await expect(g.getByRole("heading", { level: 1, name: "Try the tagline agent" })).toHaveCount(0);
        await expect(demo.getByLabel("Brand name")).toBeVisible();
        await expect(demo.getByRole("button", { name: "Propose taglines" })).toBeVisible();
        const recent = g.getByRole("heading", { level: 2, name: "Recent runs" });
        expect(await topOf(needs(g))).toBeLessThan(await topOf(recent));
        expect(await topOf(recent)).toBeLessThan(await topOf(demo));
        // It is the last section of the page: its heading is the last h2 in main.
        await expect(g.locator("main h2").last()).toHaveText("Try the tagline agent");
        await g.context().close();
      });
    },
  );

  test(
    "U10-5 #1: with approvals and alerts waiting, home's first screen lists them at 375 px and 1440 px, each linking to its place",
    { annotation: [{ type: "case", description: "U10-5.1" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the invitee's work");
      test.setTimeout(300_000);
      expect(guest, "the invitee from case 2's test").not.toBeNull();

      await step(page, "From the tagline card at the bottom of home, the invitee starts a tagline run, which waits for their choice", async () => {
        const g = await guestPage(browser, DESKTOP);
        const runPath = await startRunAwaitingApproval(g, TAGLINE_BRAND);
        taglineRun = runPath.split("/").pop()!;
        const [r] = await withSql((sql) => sql`
          select a.id, r.label, a.question from public.approvals a join public.agent_runs r on r.id = a.run_id
          where a.run_id = ${taglineRun} and a.kind = 'run_choice' and a.status = 'pending'`);
        expect(r, "the tagline run's open choice").toBeDefined();
        taglineApproval = r.id as string;
        taglineLabel = ((r.label as string | null) ?? "").trim() || (r.question as string);
        await g.context().close();
      });

      await step(page, "Their workspace's work is written: a sign-off and a launch waiting, three live campaigns (two with unseen alerts), one ended", async () => {
        fx = await withSql((sql) => insertHomeFixture(sql, guest!, `U10-5 ${Date.now()}`));
      });

      for (const viewport of [PHONE, DESKTOP]) {
        await step(page, `U10-5.1: at ${viewport.width} px, Needs you lists the approvals, newest first, then the unseen alerts per campaign, all in the first screen`, async () => {
          const g = await guestPage(browser, viewport);
          await openHome(g);
          const want = expectedNeeds(fx!);
          expect(await items(g).evaluateAll((xs) => xs.map((x) => x.getAttribute("data-need-key")))).toEqual(want.map((w) => w.key));
          await expect(needs(g).locator("[data-nothing-needs-you]")).toHaveCount(0);
          for (const w of want) {
            const item = needByKey(g, w.key);
            await expect(item, w.key).toHaveAttribute("data-need", w.kind);
            if (w.campaign) await expect(item, w.key).toHaveAttribute("data-campaign", w.campaign);
            const link = item.getByRole("link");
            await expect(link, w.key).toHaveCount(1);
            await expect(link, w.key).toHaveText(w.text);
            await expect(link, w.key).toHaveAttribute("href", w.href);
            await expectInFirstScreen(g, item, w.key);
          }
          // The ended launch's alerts and the quiet live campaign have no item.
          await expect(needs(g).locator(`[data-campaign="${fx!.campaigns.ended}"]`)).toHaveCount(0);
          await expect(needs(g).locator(`[data-campaign="${fx!.campaigns.quiet}"]`)).toHaveCount(0);
          await expectNoHorizontalScroll(g, `home with work waiting at ${viewport.width}px`);
          expect(await contrastViolations(g), `home with work waiting at ${viewport.width}px`).toEqual([]);
          await g.context().close();
        });
      }

      await step(page, "U10-5.1: the live campaigns, in the order they launched, each with its simulated day and its own share; the pooled line and its unseen alerts as before", async () => {
        const g = await guestPage(browser, DESKTOP);
        await openHome(g);
        const live = g.locator("[data-home-live]");
        await expect(live.getByRole("heading", { level: 2, name: "Live campaigns" })).toBeVisible();
        const keys: HomeKey[] = ["liveA", "liveB", "quiet"];
        expect(await live.locator("[data-live-campaign]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-live-campaign")))).toEqual(keys.map((k) => fx!.campaigns[k]));
        for (const k of keys) {
          const row = live.locator(`[data-live-campaign="${fx!.campaigns[k]}"]`);
          await expect(row.getByRole("link", { name: fx!.names[k] })).toHaveAttribute("href", `/campaigns/${fx!.campaigns[k]}`);
          await expect(row.locator("[data-live-day]")).toHaveText(liveLabel(fx!.launches[k as "liveA" | "liveB" | "quiet"].simDay));
          // No simulated days are stored in the fixture, so each share has nothing to judge yet.
          await expect(row.locator("[data-live-share]")).toHaveText(shareLine("Not enough data yet"));
        }
        await expect(live.locator(`[data-live-campaign="${fx!.campaigns.ended}"]`)).toHaveCount(0);
        await expect(g.locator("[data-home-health]")).toHaveText(/^Healthy spend share across 3 live campaigns: .+ \(simulated\)$/);
        await expect(g.locator("[data-home-alerts]")).toHaveText(alertsLine(fx!.unseen.liveA + fx!.unseen.liveB));
        // The order of the page: Needs you, live campaigns, recent runs, then the tagline demo.
        const tops = [needs(g), live, g.getByRole("heading", { level: 2, name: "Recent runs" }), g.locator("[data-tagline-demo]")];
        const at = await Promise.all(tops.map(topOf));
        expect(at).toEqual([...at].sort((x, y) => x - y));
        await g.context().close();
      });

      await step(page, "U10-5.1: the sign-off item opens the campaign's Brief stage, where Approve version 1 is", async () => {
        const g = await guestPage(browser, DESKTOP);
        await openHome(g);
        await needByKey(g, `decide-signoff:${fx!.signoffApproval}`).getByRole("link").click();
        await g.waitForURL((u) => u.pathname === `/campaigns/${fx!.campaigns.waiting}/brief`);
        await settle(g);
        await expect(g.locator("[data-signoff-panel]").filter({ visible: true }).getByRole("button", { name: "Approve version 1" })).toBeVisible();
        await g.context().close();
      });

      await step(page, "U10-5.1: the launch item opens its card in Approvals, by keyboard, with Approve in view", async () => {
        const g = await guestPage(browser, DESKTOP);
        await openHome(g);
        await needByKey(g, `approve-launch:${fx!.launchApproval}`).getByRole("link").focus();
        await g.keyboard.press("Enter");
        await g.waitForURL((u) => u.pathname === "/approvals" && u.hash === `#approval-${fx!.launchApproval}`);
        await settle(g);
        const card = g.locator(`[data-inbox-item="launch"][data-approval="${fx!.launchApproval}"]`);
        await expect(card.locator(`#approval-${fx!.launchApproval}`)).toBeInViewport();
        await expect(card.getByRole("button", { name: "Approve" })).toBeVisible();
        await g.context().close();
      });

      await step(page, "U10-5.1: the run's choice opens the run, which asks for it", async () => {
        const g = await guestPage(browser, DESKTOP);
        await openHome(g);
        await needByKey(g, `run-choice:${taglineApproval}`).getByRole("link").click();
        await g.waitForURL((u) => u.pathname === `/runs/${taglineRun}`);
        await expect(g.getByRole("heading", { name: "Which tagline should we use?" })).toBeVisible();
        await g.context().close();
      });
    },
  );

  test(
    "U10-5 #3: the alerts item links to the campaign's Performance page, not the list, and marking them seen there removes it",
    { annotation: [{ type: "case", description: "U10-5.3" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the invitee's work");
      expect(fx, "the fixture from case 1's test").not.toBeNull();
      const f = fx!;
      const g = await guestPage(browser, PHONE);

      await step(page, "U10-5.3: each campaign's alerts item links to its own Performance page; none links to the campaigns list", async () => {
        await openHome(g);
        for (const k of ["liveA", "liveB"] as const) {
          await expect(needByKey(g, `alerts:${f.campaigns[k]}`).getByRole("link")).toHaveAttribute("href", `/campaigns/${f.campaigns[k]}/performance`);
        }
        await expect(needs(g).locator('a[href="/campaigns"]')).toHaveCount(0);
        await expect(needByKey(g, `alerts:${f.campaigns.ended}`)).toHaveCount(0);
      });

      await step(page, "U10-5.3: Enter on the first campaign's item opens its Performance page, with its alerts", async () => {
        const link = needByKey(g, `alerts:${f.campaigns.liveA}`).getByRole("link");
        await link.focus();
        await g.keyboard.press("Enter");
        await g.waitForURL((u) => u.pathname === `/campaigns/${f.campaigns.liveA}/performance`);
        await settle(g);
        await expect(g.getByRole("heading", { level: 1, name: /^Performance/ })).toBeVisible();
        await expect(g.locator("[data-perf-alerts] [data-perf-alert]:not([data-seen])")).toHaveCount(f.unseen.liveA);
      });

      await step(page, "U10-5.3: Mark all as seen there; back home, that campaign's item is gone, the other's stays, and the pooled count goes down", async () => {
        await g.locator("[data-perf-alerts]").getByRole("button", { name: "Mark all as seen", exact: true }).click();
        await expect(toast(g, `Marked ${f.unseen.liveA} alerts as seen.`)).toBeVisible({ timeout: 30_000 });
        await openHome(g);
        await expect(needByKey(g, `alerts:${f.campaigns.liveA}`)).toHaveCount(0);
        await expect(needByKey(g, `alerts:${f.campaigns.liveB}`).getByRole("link")).toHaveText(alertsText(f.unseen.liveB, f.names.liveB));
        await expect(g.locator("[data-home-alerts]")).toHaveText(alertsLine(f.unseen.liveB));
      });
      await g.context().close();
    },
  );

  test(
    "U10-5 #4: recent runs show their campaign, or No campaign, and never another workspace's campaign",
    { annotation: [{ type: "case", description: "U10-5.4" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the invitee's work");
      expect(fx, "the fixture from case 1's test").not.toBeNull();
      const f = fx!;

      for (const viewport of [PHONE, DESKTOP]) {
        await step(page, `U10-5.4: at ${viewport.width} px, the five newest runs, each naming its campaign`, async () => {
          const g = await guestPage(browser, viewport);
          await openHome(g);
          const rows = g.locator("[data-run]");
          // Newest first: the tagline run (now), the hostile run (20 minutes ago), the pictures (30), the brief (40), the test plan (60).
          const want: [string, string][] = [
            [taglineRun, NO_CAMPAIGN],
            [f.runs.hostile, NO_CAMPAIGN],
            [f.runs.imagery, f.names.liveA],
            [f.runs.brief, f.names.waiting],
            [f.runs.testPlan, f.names.waiting],
          ];
          expect(await rows.evaluateAll((xs) => xs.map((x) => x.getAttribute("data-run")))).toEqual(want.map(([id]) => id));
          for (const [id, campaign] of want) {
            const row = g.locator(`[data-run="${id}"]`);
            await expect(row.locator("[data-run-campaign]"), id).toHaveText(campaign);
            await expect(row.getByRole("link").first(), id).toHaveAttribute("href", `/runs/${id}`);
          }
          await expectNoHorizontalScroll(g, `home's recent runs at ${viewport.width}px`);
          await g.context().close();
        });
      }

      await step(page, "U10-5.4, the failure path: the run whose input names the owner's campaign shows No campaign, and the owner's campaign's name is nowhere on the page", async () => {
        const g = await guestPage(browser, DESKTOP);
        await openHome(g);
        await expect(g.locator(`[data-run="${f.runs.hostile}"] [data-run-campaign]`)).toHaveText(NO_CAMPAIGN);
        await expect(g.getByText(f.hidden.name)).toHaveCount(0);
        expect(await g.content()).not.toContain(f.hidden.campaignId);
        await g.context().close();
      });
    },
  );

  test(
    "U10-5 #6: the approvals inbox links a sign-off to the campaign's Brief stage and a launch to its Launch stage",
    { annotation: [{ type: "case", description: "U10-5.6" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the invitee's work");
      expect(fx, "the fixture from case 1's test").not.toBeNull();
      const f = fx!;
      const g = await guestPage(browser, DESKTOP);
      const cases: ["brief_signoff" | "launch", HomeKey, string, string][] = [
        ["brief_signoff", "waiting", "Read the brief on the campaign", "brief"],
        ["launch", "launchWaiting", "See the launch on the campaign", "launch"],
      ];
      for (const [kind, key, text, stage] of cases) {
        await step(page, `U10-5.6: the ${kind === "launch" ? "launch" : "sign-off"} card's link goes to the ${stage === "brief" ? "Brief" : "Launch"} stage, not the overview`, async () => {
          await g.goto("/approvals");
          await settle(g);
          const card = inboxCard(g, kind, `/campaigns/${f.campaigns[key]}`);
          await expect(card).toHaveCount(1);
          await expect(card).toHaveAttribute("data-approval", kind === "launch" ? f.launchApproval : f.signoffApproval);
          const link = card.locator("a[data-inbox-campaign-link]");
          await expect(link).toHaveText(text);
          await expect(link).toHaveAttribute("href", `/campaigns/${f.campaigns[key]}/${stage}`);
          await expect(card.locator(`a[href="/campaigns/${f.campaigns[key]}"]`)).toHaveCount(0);
          await link.click();
          await g.waitForURL((u) => u.pathname === `/campaigns/${f.campaigns[key]}/${stage}`);
          await settle(g);
          await expect(g.locator("[data-stage-bar]").filter({ visible: true }).locator(`a[data-stage="${stage}"]`)).toHaveAttribute("aria-current", "page");
        });
      }
      await g.context().close();
    },
  );

  test(
    "U10-5 #5: a sign-off card in the inbox is a summary, with its personas and test plan on request, and Approve near the top",
    { annotation: [{ type: "case", description: "U10-5.5" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the invitee's work");
      expect(fx, "the fixture from case 1's test").not.toBeNull();
      const f = fx!;
      const g = await guestPage(browser, PHONE);
      const card = () => inboxCard(g, "brief_signoff", `/campaigns/${f.campaigns.waiting}`);
      const reviews = () => card().locator("details[data-signoff-reviews]");

      await step(page, "U10-5.5: at 375 px the card shows its version and title, brand, objective, closing date, link and decision; the reviews are one closed line", async () => {
        await g.goto("/approvals");
        await settle(g);
        await expect(card()).toHaveCount(1);
        await expect(card().getByRole("heading", { level: 2 })).toHaveText(`Version 1: ${f.names.waiting}`);
        await expect(card()).toContainText("Fernhollow Outfitters");
        await expect(card()).toContainText(`${f.names.waiting}: bring walkers back for the autumn range`);
        await expect(card()).toContainText(/Closes \d{1,2} \w+ \d{4}/);
        await expect(card().getByRole("button", { name: "Approve version 1" })).toBeVisible();
        await expect(card().getByRole("button", { name: "Reject" })).toBeVisible();
        await expect(reviews()).toHaveCount(1);
        await expect(reviews()).not.toHaveAttribute("open", "");
        await expect(reviews().locator(":scope > summary")).toHaveText("Personas and test plan: 3 synthetic personas and a test plan");
        await expect(reviews().locator(":scope > summary [data-reviews-summary]")).toHaveText("3 synthetic personas and a test plan");
        await expect(card().locator("[data-persona-overall]")).toBeHidden();
        await expect(card().getByRole("list", { name: "Hypotheses" })).toBeHidden();
        await expectNoHorizontalScroll(g, "/approvals at 375px");
        expect(await contrastViolations(g), "/approvals at 375px").toEqual([]);
      });

      await step(page, "U10-5.5: closed, the card is at most one screen tall at 375 px, and the inbox's first Approve starts within 1.5 screens", async () => {
        await g.evaluate(() => window.scrollTo(0, 0));
        const box = (await card().boundingBox())!;
        expect(box.height, `the sign-off card is ${Math.round(box.height)} px tall`).toBeLessThanOrEqual(PHONE.height);
        const first = g.locator("[data-inbox-item] button").filter({ hasText: "Approve" }).filter({ visible: true }).first();
        const top = await topOf(first);
        expect(top, `the first Approve is ${Math.round(top)} px down; 1.5 screens is ${1.5 * PHONE.height} px`).toBeLessThanOrEqual(1.5 * PHONE.height);
      });

      await step(page, "U10-5.5: Enter on the summary opens the personas and the test plan in place", async () => {
        await reviews().locator(":scope > summary").focus();
        await g.keyboard.press("Enter");
        await expect(reviews()).toHaveAttribute("open", "");
        await expect(card().locator("[data-persona-overall]")).toBeVisible();
        await expect(card().locator("[data-persona-overall]")).toContainText("out of 5 overall");
        await expect(card().getByRole("list", { name: "Hypotheses" })).toBeVisible();
        await expect(card().getByText(PLAN_NOTE_START)).toBeVisible();
        expect(await contrastViolations(g), "/approvals with the reviews open").toEqual([]);
      });

      await step(page, "U10-5.5: Approve version 1 from the card works as before, and home no longer lists the sign-off", async () => {
        await card().getByRole("button", { name: "Approve version 1" }).click();
        await expect(toast(g, "Version 1 signed off.")).toBeVisible({ timeout: 30_000 });
        await expect(card()).toHaveCount(0, { timeout: 30_000 });
        await openHome(g);
        await expect(needByKey(g, `decide-signoff:${f.signoffApproval}`)).toHaveCount(0);
        await expect(needByKey(g, `approve-launch:${f.launchApproval}`)).toHaveCount(1);
      });
      await g.context().close();
    },
  );
});
