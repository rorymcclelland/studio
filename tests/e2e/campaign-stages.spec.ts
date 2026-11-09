// U10-2 The campaign in stages, opening on what needs you, through the UI with
// the mock models. Every case has a browser test here except case 6, the stage
// pages' length budgets, which are U10-6's measurements
// (tests/e2e/page-length.spec.ts, annotated U10-2.6 too). The pure stage and
// "Needs you" functions are tests/lib/campaign-stages.test.ts (every
// combination); the loader that reads their facts, for real campaigns in each
// state and refusing another workspace's, is tests/flows/campaign-stages.test.ts.
//
// 1. A live campaign opens on its overview; its first screen at 375 px and
//    1440 px says it is live on simulated day 14, its unseen alerts and the ad
//    below the threshold.
// 2. Each "Needs you" item links to where it is done, and doing it removes it:
//    send for sign-off, decide the sign-off, decide compliance, approve the
//    launch, mark the alerts seen. One Fernhollow campaign is taken through
//    every stage from its overview (serial: case 1 reads it on day 14 before
//    its alerts are marked seen).
// 3. A campaign with nothing to do says "Nothing needs you right now."
// 4. The stage bar shows the right state for campaigns in five states.
// 5. Every action on today's campaign page is on a stage page, at most one
//    click further; history is one line with a count, opening in place; old
//    links (/campaigns/<id>#creative and the rest) land on the right stage.
// 7. Another workspace's campaign is the not-found page on every stage route.
// 8. A stage that isn't reachable yet says why in one line and links to the
//    step that unlocks it.
// 9. At 375 px the stage bar, with the longest labels, never makes the page
//    scroll sideways; it scrolls inside itself, and opens with the current
//    stage wholly in its view (a fix made with U10-3: on the locked Creative
//    page the bar showed "3 C..." cut off at its right edge).
// 10. The stage bar is a nav with aria-current; stage and "Needs you" links work
//     with Enter; axe finds nothing on either.
// Cases 3, 4, 5 (old links), 7, 8, 9 and 10 use campaigns written straight to
// the database (tests/e2e/status-fixture.ts): those pages read only the rows.
//
// ---------------------------------------------------------------- interface
// What the builder provides. The tests here and in the two CI files above pin it.
//
// Routes (all read through asUser(), rule 7; another workspace's or a malformed
// id is the not-found page on every one):
//   /campaigns/[id]              the overview (a campaign opens here, answer Q2;
//                                createCampaign still redirects to it)
//   /campaigns/[id]/brief        the brief, revisions and proposals, the sign-off
//                                panel ([data-signoff-panel]) and the version
//                                history; ?version=N views an old version here
//   /campaigns/[id]/audience     personas ([data-persona-review]) and the test plan
//   /campaigns/[id]/creative     the gallery and its checks: languages, compliance
//                                (summary and "Accept for every picked ad"), pre-test,
//                                picture checks, the launch pack, discarded, runs.
//                                ?show=decide is U10-3's filter; until U10-3 the
//                                page ignores ?show and shows every ad
//   /campaigns/[id]/launch       the Launch (simulated) panel ([data-launch-panel])
//                                with the clock and the earlier launches
//   /campaigns/[id]/performance  as today, with the stage bar
// Server actions revalidate the stage pages they change (and the overview).
//
// src/lib/campaigns/stages.ts (PURE: imports only ./status):
//   type StageId = "brief" | "audience" | "creative" | "launch" | "performance"
//   STAGES: { id, name }[] in that order, named Brief, Audience, Creative, Launch, Performance
//   stageHref(campaignId, stage) => "/campaigns/<id>/<stage>"
//   type CampaignFacts = {
//     campaignId: string;
//     status: string;                // campaigns.status as stored, maybe one this code doesn't know
//     currentVersion: number;        // 0 before the first brief
//     approvedVersion: number | null;
//     briefRun: string | null;       // the latest brief-writing run's status (CampaignDetail.run), null if none
//     signoffOpen: number | null;    // the pending sign-off's brief version (SignoffState.open)
//     versions: number;              // brief versions kept
//     audience: { personas: number; testPlan: boolean; running: boolean };
//                                    // personas in the latest review, any version; a test plan exists;
//                                    // a persona or test plan run queued or running
//     creative: { ads: number; picked: number; running: boolean; discarded: number; runs: number; costPence: number };
//                                    // from getCreative(): current ads, picked ones, Make creative running,
//                                    // discarded ads plus discarded word sets, creative runs, their total cost
//     toDecide: number;              // picked ads of the signed-off version whose compliance pill is "N to review"
//     launchable: number;            // launchEligibility().ads.length (0 when it refuses)
//     launches: { status: string; simDay: number; days: number }[];   // every launch, newest first
//     performance: { unseenAlerts: number; belowThreshold: number[] } | null;
//                                    // for the launch the Performance page shows (live, else the newest
//                                    // ended): its unseen alerts, and the gallery numbers of the ads whose
//                                    // status on the latest simulated day is below_threshold; null without one
//   }  (CampaignFacts satisfies U10-1's CampaignStatusFacts, so campaignStatusLabel(facts) is the overview's state)
//   campaignStages(facts) => StageView[], one per stage in order:
//     { id, name, href, label, locked: { reason, href, link } | null }
//     signed off = status "approved" and approvedVersion not null; the brief is being written = status
//     "drafting" or version 0. Labels (at most 30 characters):
//     Brief        writing: "Writing the brief" while its run is queued, running or completed, else "Not written";
//                  then campaignStatusLabel's brief words: "Draft", "Waiting for sign-off", "Signed off"
//                  (an unknown status: "Draft"). Never locked.
//     Audience     brief being written: locked, "After the brief"; a run in progress "Being written";
//                  none "Not run yet"; else "5 personas, test plan", "1 persona", "Test plan".
//     Creative     not signed off: locked, "After sign-off"; Make creative running "Making ads";
//                  no ads "No ads yet"; else "12 ads, 4 picked" ("1 ad, 0 picked").
//     Launch       launches of a status it doesn't know count for nothing. A live launch: liveLabel(simDay)
//                  ("Live (simulated day 14)", "Live (simulated, before day 1)"); else one waiting
//                  "Waiting for approval"; else an ended one "Ended"; else signed off with launchable > 0
//                  "4 ads ready" ("1 ad ready"); else a refused one "Refused"; else locked, "No ads ready".
//     Performance  no live or ended launch: locked, "After launch"; else "5 new alerts", "1 new alert",
//                  "No new alerts" (performance null reads as 0).
//     Locks (reason, link text, href):
//       Audience     "Personas and the test plan come once the brief is written." "Go to the brief" -> brief
//       Creative     "Creative is made only from a signed-off brief." "Sign off the brief" -> brief
//       Launch       not signed off: "A launch needs a signed-off brief and picked ads that pass compliance."
//                    "Sign off the brief" -> brief; signed off: "A launch needs picked ads that pass compliance
//                    or were accepted." "Decide compliance" -> creative?show=decide when toDecide > 0, else
//                    "Pick ads in Creative" -> creative
//       Performance  "Performance shows once a launch is live (simulated)." "Go to Launch" -> launch
//   needsYou(facts) => NeedView[] ({ id, text, href }), in this order:
//     send-signoff    status "draft", a version, no open sign-off: "Send version 2 for sign-off" -> brief
//     decide-signoff  an open sign-off: "Decide the sign-off of version 2" -> brief (rule 3: Approve stays
//                     on the Brief stage and in the inbox; the overview only links)
//     compliance      signed off and toDecide > 0: "Decide compliance for 3 picked ads" ("1 picked ad")
//                     -> creative?show=decide
//     approve-launch  a launch waiting: "Approve or refuse the launch (simulated)" -> /approvals
//     alerts          a live launch with unseen alerts: "5 unseen alerts (simulated)" ("1 unseen alert") -> performance
//     clock           a live launch before its last day: "Move the simulated clock on from day 14 of 30",
//                     on day 0 "Run the first simulated day of 30" -> launch
//   NOTHING_NEEDS_YOU = "Nothing needs you right now."
//   belowThresholdLine(adNumbers) => null for none; "Ad 3 is below the threshold (simulated).";
//     "Ads 2 and 5 are below the threshold (simulated)."; "Ads 1, 2 and 4 are below the threshold (simulated)."
//   stageForHash(hash) => StageId | null, with or without the "#": brief, signoff, history -> brief;
//     personas, test-plan -> audience; creative, discarded, creative-runs -> creative; launch -> launch;
//     performance -> performance; anything else null.
//
// src/lib/campaigns/facts.ts (server only): campaignFacts(userId, campaignId): Promise<CampaignFacts | null>,
//   null for a malformed, missing or another workspace's id. One loader per request, reading no more than
//   today's campaign page reads (getCampaign, getSignoffState, getReviews, getCreative, galleryCompliance,
//   launchEligibility, launchesFor) plus, only when a launch is live or ended, what the Performance page reads
//   for its alerts and latest day. No query per stage card.
//
// Components (synchronous, rendered in CI by tests/lib/campaign-stages.test.ts):
//   src/app/(app)/campaigns/[id]/stage-bar.tsx  StageBar({ stages: StageView[]; current: StageId | null })
//     <nav aria-label="Campaign stages" data-stage-bar> with an <ol>; per stage an <a href data-stage="<id>">
//     holding a leaf [data-stage-name] (the name) and a leaf [data-stage-state] (the label);
//     aria-current="page" on the current stage only (none on the overview); data-stage-locked on locked
//     stages, which stay links (their page says why). At every width; below 640 px it scrolls sideways
//     inside itself (overflow-x auto), never the page. Under the campaign's title on the overview, every
//     stage page and the Performance page.
//   src/app/(app)/campaigns/[id]/needs-you.tsx  NeedsYou({ items: NeedView[] })
//     <section data-needs-you> with <h2>Needs you</h2>; per item <li data-need="<id>"><a href>text</a></li>;
//     no items: a leaf [data-nothing-needs-you] with NOTHING_NEEDS_YOU, and no list.
//
// The overview: the header card (brand, the title as h1, the objective) with the state in a leaf
//   [data-campaign-state] (campaignStatusLabel(facts)) and, while a launch is live or ended and an ad is below
//   the threshold, a leaf [data-below-threshold] (belowThresholdLine) beside it; the stage bar; NeedsYou;
//   then one [data-stage-card="<id>"] per stage with its name, label and a link to the stage (a locked one
//   shows its reason and unlock link instead). The state, the alerts item and the below-threshold line are
//   in the first screen at 375 px and 1440 px.
//   Old links: on the overview, a fragment stageForHash() knows replaces the address with that stage's,
//   keeping the fragment (/campaigns/<id>#personas -> /campaigns/<id>/audience#personas).
// Every stage page: the same header (title as h1), a link [data-campaign-overview] "Overview" to the
//   overview, the stage bar with aria-current on its stage. A locked stage's page is not an error and not
//   the not-found page (status 200): [data-stage-locked] holding the reason as one sentence and a link
//   (the stage bar's locked links carry the same attribute, so the tests find the reason as
//   [data-stage-locked]:not([data-stage]))
//   (the link text, to its href); none of the stage's own controls.
// History collapses to one line with a count, opening in place: <details data-history="versions"> on Brief
//   (closed, but open when ?version= is given), and <details data-history="discarded"> and
//   <details data-history="runs"> on Creative (shown only when they have something); each <summary> holds
//   a leaf [data-history-count] with the number of rows inside (versions, discarded ads and sets, creative
//   runs) and starts "Version history", "Discarded", "Runs and AI cost". The launch panel's
//   "Earlier launches (N)" stays as it is.
// ----------------------------------------------------------------------------
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import {
  acceptDontRulesForPicked,
  adTool,
  demoBrandId,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  openHistory,
  openAdMenu,
  openLaunch,
  openStage,
  settle,
  signIn,
  stagePath,
  step,
  untilShown,
  type Stage,
} from "./helpers";
import { setWaitingLaunchTerms } from "./launch-fixture";
import { insertStatusCampaigns, removeCampaigns, STATUS_LABELS, type StatusKey } from "./status-fixture";

const STAGES: Stage[] = ["brief", "audience", "creative", "launch", "performance"];
const NAMES: Record<Stage, string> = { brief: "Brief", audience: "Audience", creative: "Creative", launch: "Launch", performance: "Performance" };
const NOTHING = "Nothing needs you right now.";
/** A locked stage page's reason: [data-stage-locked], but not one of the stage bar's links, which carry it too. */
const LOCK_REASON = "[data-stage-locked]:not([data-stage])";
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1440, height: 900 };
const OBJECTIVE = "Bring walkers back for the autumn range, one stage at a time";

const visible = (page: Page, css: string) => page.locator(css).filter({ visible: true });
const bar = (page: Page) => visible(page, "[data-stage-bar]");
const stageLink = (page: Page, stage: Stage) => bar(page).locator(`a[data-stage="${stage}"]`);
const needs = (page: Page) => visible(page, "[data-needs-you]");
const need = (page: Page, id: string) => needs(page).locator(`[data-need="${id}"]`);
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const idOf = (path: string) => path.split("/").pop()!;

function sqlOrSkip() {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the fixture rows (campaigns in each state, another workspace)");
  return postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function openOverview(page: Page, path: string) {
  await page.goto(path);
  await settle(page);
  await expect(needs(page)).toBeVisible();
}

/** The stage bar's labels, by stage. */
async function barLabels(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const s of STAGES) out[s] = ((await stageLink(page, s).locator("[data-stage-state]").textContent()) ?? "").trim();
  return out;
}

/** Whether an element is wholly within the first screen of the page (scrolled to the top). */
async function inFirstScreen(page: Page, css: string): Promise<{ top: number; bottom: number; height: number }> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const el = visible(page, css).first();
  await expect(el, css).toBeVisible();
  const box = (await el.boundingBox())!;
  const height = page.viewportSize()!.height;
  return { top: box.y, bottom: box.y + box.height, height };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// ---------------------------------------------------------------- cases 2, 1 and 5: one campaign through every stage
test.describe("U10-2 a Fernhollow campaign taken through every stage from its overview", () => {
  test.describe.configure({ mode: "serial" });
  let path = "";

  test(
    "U10-2 #2: each Needs you item links to where it is done, and doing it removes it, from sign-off to a live launch",
    { annotation: [{ type: "case", description: "U10-2.2" }] },
    async ({ page }) => {
      test.setTimeout(900_000);
      const sql = sqlOrSkip();
      try {
        await step(page, "A Fernhollow brief opens on its overview: Send version 1 for sign-off needs you", async () => {
          path = await newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
          await openOverview(page, path);
          await expect(need(page, "send-signoff")).toHaveText("Send version 1 for sign-off");
          await expect(need(page, "send-signoff").getByRole("link")).toHaveAttribute("href", stagePath(path, "brief"));
        });

        await step(page, "U10-2.2: the item opens the Brief stage; sending it removes the item and asks for the decision", async () => {
          await need(page, "send-signoff").getByRole("link").click();
          await page.waitForURL((u) => u.pathname === stagePath(path, "brief"));
          await visible(page, "[data-signoff-panel]").getByRole("button", { name: "Send version 1 for sign-off" }).click();
          await expect(toast(page, "Sent for sign-off")).toBeVisible();
          await openOverview(page, path);
          await expect(need(page, "send-signoff")).toHaveCount(0);
          await expect(need(page, "decide-signoff")).toHaveText("Decide the sign-off of version 1");
        });

        await step(page, "U10-2.2: deciding the sign-off on the Brief stage removes it; signed off with no ads, nothing needs you", async () => {
          await need(page, "decide-signoff").getByRole("link").click();
          await page.waitForURL((u) => u.pathname === stagePath(path, "brief"));
          await visible(page, "[data-signoff-panel]").getByRole("button", { name: "Approve version 1" }).click();
          await expect(toast(page, "Version 1 signed off.")).toBeVisible();
          await openOverview(page, path);
          await expect(needs(page).locator("[data-need]")).toHaveCount(0);
          await expect(needs(page)).toContainText(NOTHING);
          await expect(stageLink(page, "brief").locator("[data-stage-state]")).toHaveText("Signed off");
        });

        await step(page, "Make creative on the Creative stage and pick one paid-social ad", async () => {
          await makeCreative(page, 12);
          const card = page.locator('[data-gallery] > li[data-channel="paid social"]').first();
          const pick = await adTool(card, "pick");
          await expect(pick).toHaveAccessibleName(/^Pick ad \d+$/);
          await pick.click();
          await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
        });

        await step(page, "U10-2.2: the picked ad's compliance needs a decision; the item opens the gallery filtered to it; accepting removes it", async () => {
          await openOverview(page, path);
          await expect(need(page, "compliance")).toHaveText("Decide compliance for 1 picked ad");
          await need(page, "compliance").getByRole("link").click();
          await page.waitForURL((u) => u.pathname === stagePath(path, "creative") && u.searchParams.get("show") === "decide");
          await acceptDontRulesForPicked(page);
          await openOverview(page, path);
          await expect(need(page, "compliance")).toHaveCount(0);
          await expect(stageLink(page, "launch").locator("[data-stage-state]")).toHaveText("1 ad ready");
        });

        await step(page, "U10-2.2: asked to launch, the launch waits in the inbox; approving it there removes the item", async () => {
          await openLaunch(page, path);
          await visible(page, "[data-launch-panel]").getByRole("button", { name: "Ask to launch" }).click();
          await expect(visible(page, "[data-launch-panel]").locator("[data-launch-status]")).toHaveText("Waiting for approval", { timeout: 30_000 });
          await openOverview(page, path);
          await expect(need(page, "approve-launch")).toHaveText("Approve or refuse the launch (simulated)");
          // A click-through rate of 50% is out of any ad's reach: once learning is over the ad is below the threshold.
          const [l] = await sql`select id from public.launches where campaign_id = ${idOf(path)} and status = 'awaiting_approval'`;
          await setWaitingLaunchTerms(sql, l.id as string, { kpi_measure: "ctr", kpi_value: 50 });
          await need(page, "approve-launch").getByRole("link").click();
          await page.waitForURL((u) => u.pathname === "/approvals");
          await settle(page);
          const card = page.locator("[data-inbox-item=launch]").filter({ has: page.locator(`a[href^="${path}"]`) });
          await card.getByRole("button", { name: "Approve" }).click();
          await expect(card).toHaveCount(0, { timeout: 30_000 });
          await openOverview(page, path);
          await expect(need(page, "approve-launch")).toHaveCount(0);
          await expect(need(page, "clock")).toHaveText("Run the first simulated day of 30");
        });

        await step(page, "U10-2.2: the clock item opens the Launch stage; two weeks on, it says day 14", async () => {
          await need(page, "clock").getByRole("link").click();
          await page.waitForURL((u) => u.pathname === stagePath(path, "launch"));
          for (const day of [7, 14]) {
            await openLaunch(page, path);
            await visible(page, "[data-launch-panel]").getByRole("button", { name: "Next week" }).click();
            await expect(visible(page, "[data-launch-panel]").locator("[data-sim-clock]")).toHaveText(`Simulated day ${day} of 30`, { timeout: 60_000 });
          }
          await openOverview(page, path);
          await expect(need(page, "clock")).toHaveText("Move the simulated clock on from day 14 of 30");
          await expect(need(page, "alerts")).toHaveText(/^\d+ unseen alerts? \(simulated\)$/);
        });
      } finally {
        await sql.end();
      }
    },
  );

  test(
    "U10-2 #1: a live campaign opens on its overview, whose first screen at 375 px and 1440 px says it is live on day 14 with its unseen alerts and the ad below the threshold",
    { annotation: [{ type: "case", description: "U10-2.1" }] },
    async ({ page }) => {
      test.setTimeout(180_000);
      const sql = sqlOrSkip();
      try {
        expect(path, "the campaign from case 2's test").not.toBe("");
        const [{ n: unseen }] = await sql`
          select count(*)::int as n from public.performance_alerts a join public.launches l on l.id = a.launch_id
          where l.campaign_id = ${idOf(path)} and l.status = 'live' and a.seen_at is null`;
        expect(unseen).toBeGreaterThan(0);

        // The ad below the threshold, as the Performance page has it.
        await page.goto(stagePath(path, "performance"));
        await settle(page);
        const belowRows = visible(page, '[data-perf-ad][data-status="below_threshold"]');
        await expect(belowRows).toHaveCount(1);
        const adNumber = Number(/Ad (\d+)/.exec((await belowRows.first().locator("th").textContent()) ?? "")![1]);

        for (const size of [PHONE, DESKTOP]) {
          await step(page, `U10-2.1: the overview's first screen at ${size.width}px`, async () => {
            await page.setViewportSize(size);
            await page.goto(path);
            await settle(page);
            // It opens on the overview, not a stage.
            expect(new URL(page.url()).pathname).toBe(path);
            await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(0);
            await expect(visible(page, "[data-campaign-state]")).toHaveText("Live (simulated day 14)");
            await expect(need(page, "alerts")).toHaveText(`${unseen} unseen alert${unseen === 1 ? "" : "s"} (simulated)`);
            await expect(visible(page, "[data-below-threshold]")).toHaveText(`Ad ${adNumber} is below the threshold (simulated).`);
            await expect(stageLink(page, "launch").locator("[data-stage-state]")).toHaveText("Live (simulated day 14)");
            for (const css of ["[data-campaign-state]", '[data-need="alerts"]', "[data-below-threshold]"]) {
              const at = await inFirstScreen(page, css);
              expect(at.bottom, `${css} at ${size.width}px ends ${Math.round(at.bottom)} px down, past the first screen (${at.height} px)`).toBeLessThanOrEqual(at.height);
            }
            await expectNoHorizontalScroll(page, `the live overview at ${size.width}px`);
          });
        }
      } finally {
        await page.setViewportSize({ width: 1280, height: 900 });
        await sql.end();
      }
    },
  );

  test(
    "U10-2 #2: marking the alerts seen on Performance removes them from Needs you",
    { annotation: [{ type: "case", description: "U10-2.2" }] },
    async ({ page }) => {
      test.setTimeout(180_000);
      expect(path, "the campaign from case 2's first test").not.toBe("");
      await openOverview(page, path);
      await need(page, "alerts").getByRole("link").click();
      await page.waitForURL((u) => u.pathname === stagePath(path, "performance"));
      await settle(page);
      const unseen = visible(page, "[data-perf-alerts] [data-perf-alert]").filter({ has: page.getByRole("button", { name: "Mark as seen" }) });
      for (let n = await unseen.count(); n > 0; n--) {
        await unseen.first().getByRole("button", { name: "Mark as seen" }).click();
        await expect(unseen).toHaveCount(n - 1, { timeout: 30_000 });
      }
      await openOverview(page, path);
      await expect(need(page, "alerts")).toHaveCount(0);
      await expect(stageLink(page, "performance").locator("[data-stage-state]")).toHaveText("No new alerts");
      // The clock is still there to move.
      await expect(needs(page).locator("[data-need]")).toHaveCount(1);
      await expect(need(page, "clock")).toBeVisible();
    },
  );

  test(
    "U10-2 #5: every action on today's campaign page is on a stage page, at most one click further",
    { annotation: [{ type: "case", description: "U10-2.5" }] },
    async ({ page }) => {
      test.setTimeout(180_000);
      expect(path, "the campaign from case 2's first test").not.toBe("");
      const button = (name: string | RegExp) => page.getByRole("button", { name }).filter({ visible: true }).first();
      const link = (name: string | RegExp) => page.getByRole("link", { name }).filter({ visible: true }).first();

      await step(page, "U10-2.5: the overview links to every stage, from its bar and its cards", async () => {
        await openOverview(page, path);
        for (const s of STAGES) {
          await expect(stageLink(page, s)).toHaveAttribute("href", stagePath(path, s));
          await expect(stageLink(page, s).locator("[data-stage-name]")).toHaveText(NAMES[s]);
          const card = visible(page, `[data-stage-card="${s}"]`);
          await expect(card).toHaveCount(1);
          await expect(card.locator(`a[href="${stagePath(path, s)}"]`).first()).toBeVisible();
        }
      });

      await step(page, "U10-2.5: Brief: the brief's editors, revise with AI, the sign-off panel, the trail and the version history", async () => {
        await openStage(page, "brief", path);
        await expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible();
        for (const name of ["Edit the story", "Edit the title", "Revise with AI: the summary"]) await expect(button(name), name).toBeVisible();
        await expect(visible(page, "[data-signoff-panel]")).toBeVisible();
        await expect(link("See the Brief agent's trail")).toBeVisible();
        await openHistory(page, "versions");
        await expect(visible(page, "[data-version]")).toHaveCount(1);
        await expect(visible(page, "[data-campaign-overview]")).toHaveAttribute("href", path);
      });

      await step(page, "U10-2.5: Audience: the persona review and the test plan, with their buttons", async () => {
        await openStage(page, "audience", path);
        await expect(visible(page, "[data-persona-review]")).toBeVisible();
        await expect(visible(page, "[data-persona]").first()).toBeVisible();
        await expect(visible(page, "[data-hypothesis]").first()).toBeVisible();
        for (const name of [/^Ask the personas|^The personas are reading/, /^Make a test plan|^Writing the test plan/]) await expect(button(name)).toBeVisible();
      });

      await step(page, "U10-2.5: Creative: Make creative, the gallery, languages, compliance, pre-test, picture checks, sizes and compliance links, the launch pack, runs", async () => {
        await openStage(page, "creative", path);
        await expect(visible(page, "[data-creative]").getByRole("button", { name: /^Make creative/ })).toBeVisible();
        await expect(visible(page, "[data-gallery] > li").first()).toBeVisible();
        for (const css of ["[data-languages]", "[data-compliance-summary]", "[data-pretest-bar]", "[data-picture-check-bar]", "[data-launch-pack]"]) await expect(visible(page, css), css).toBeVisible();
        // U10-3: an ad's Sizes and Compliance links are in its card's More menu.
        await openAdMenu(visible(page, "[data-gallery] > li").first(), "more");
        await expect(visible(page, "[data-ad-sizes]").first()).toHaveAttribute("href", new RegExp(`^${path}/ads/[0-9a-f-]{36}/sizes$`));
        await expect(visible(page, "[data-ad-compliance]").first()).toHaveAttribute("href", new RegExp(`^${path}/ads/[0-9a-f-]{36}/compliance$`));
        await expect(visible(page, "[data-pack-download]")).toBeVisible();
        await openHistory(page, "runs");
        await expect(visible(page, "[data-creative-cost]")).toContainText("AI cost of the creative so far");
      });

      await step(page, "U10-2.5: Launch: the live launch, its clock, End the launch and the link to Performance", async () => {
        await openLaunch(page, path);
        const panel = visible(page, "[data-launch-panel]");
        await expect(panel.locator("[data-launch-status]")).toHaveText("Live (simulated)");
        for (const name of ["Next day", "Next week", "Run to the end", "End the launch"]) await expect(panel.getByRole("button", { name, exact: true }), name).toBeVisible();
        await expect(panel.getByRole("link", { name: "See performance (simulated)" })).toHaveAttribute("href", stagePath(path, "performance"));
      });

      await step(page, "U10-2.5: Performance: the share, the ads, the alerts and Ask, with the stage bar", async () => {
        await openStage(page, "performance", path);
        for (const css of ["[data-perf-headline]", "[data-perf-ads]", "[data-perf-alerts]", "[data-ask]"]) await expect(visible(page, css), css).toBeVisible();
        await expect(stageLink(page, "performance")).toHaveAttribute("aria-current", "page");
      });
    },
  );

  test(
    "U10-2 #5: history is one line with a count on its stage, and opens in place",
    { annotation: [{ type: "case", description: "U10-2.5" }] },
    async ({ page }) => {
      test.setTimeout(120_000);
      const sql = sqlOrSkip();
      try {
        expect(path, "the campaign from case 2's first test").not.toBe("");
        // One unpicked ad discarded, as the gallery's Discard leaves it (U10-3 moves the button into the card's menu).
        await sql`
          update public.ad_variants set discarded_at = now()
          where id = (select id from public.ad_variants where campaign_id = ${idOf(path)} and picked_at is null and discarded_at is null order by created_at limit 1)`;

        const checks: [Stage, "versions" | "discarded" | "runs", RegExp, string][] = [
          ["brief", "versions", /^Version history/, "[data-version]"],
          ["creative", "discarded", /^Discarded/, "[data-discarded-ad], [data-discarded-set]"],
          ["creative", "runs", /^Runs and AI cost/, '[aria-label="Creative runs, newest first"] > li'],
        ];
        for (const [stage, kind, words, rows] of checks) {
          await step(page, `U10-2.5: ${kind} on ${NAMES[stage]} is one line with a count, closed, and opens in place`, async () => {
            await openStage(page, stage, path);
            const details = visible(page, `details[data-history="${kind}"]`);
            await expect(details).toHaveCount(1);
            await expect(details).not.toHaveAttribute("open", "");
            const summary = details.locator("summary");
            await expect(summary).toHaveText(words);
            // One line: no taller than two lines of body text.
            expect((await summary.boundingBox())!.height, `${kind}'s summary`).toBeLessThanOrEqual(56);
            await expect(details.locator(rows).first()).toBeHidden();
            const count = Number((await summary.locator("[data-history-count]").textContent())!.trim());
            expect(count, kind).toBeGreaterThan(0);
            const url = page.url();
            await openHistory(page, kind);
            // In place: the address doesn't change and the rows are there.
            expect(page.url()).toBe(url);
            await expect(details.locator(rows)).toHaveCount(count);
          });
        }
        // Viewing an old version opens the history where it is.
        await page.goto(`${stagePath(path, "brief")}?version=1`);
        await settle(page);
        await expect(visible(page, 'details[data-history="versions"]')).toHaveAttribute("open", "");
      } finally {
        await sql.end();
      }
    },
  );
});

// ---------------------------------------------------------------- cases 3, 4, 5 (old links), 7, 8, 9 and 10 on fixture campaigns
test.describe("U10-2 campaigns in each state, written to the database", () => {
  let sql: postgres.Sql;
  let ids: Record<StatusKey, string>;
  let day0: Record<StatusKey, string>;
  const ov = (key: StatusKey, from: Record<StatusKey, string> = ids) => `/campaigns/${from[key]}`;

  test.beforeAll(async ({ browser }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the fixture rows (campaigns in each state)");
    sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const page = await browser.newPage();
    try {
      await signIn(page);
      const fernhollow = await demoBrandId(page, "Fernhollow Outfitters");
      ids = await insertStatusCampaigns(sql, fernhollow, "Stages");
      day0 = await insertStatusCampaigns(sql, fernhollow, "Stages, live before day 1", { liveDay: 0 });
    } finally {
      await page.close();
    }
  });

  test.afterAll(async () => {
    if (!sql) return;
    await removeCampaigns(sql, [...Object.values(ids ?? {}), ...Object.values(day0 ?? {})]);
    await sql.end();
  });

  test(
    "U10-2 #3: a campaign with nothing to do says Nothing needs you, not an empty list",
    { annotation: [{ type: "case", description: "U10-2.3" }] },
    async ({ page }) => {
      for (const key of ["signedOff", "ended", "writing"] as StatusKey[]) {
        await step(page, `U10-2.3: ${STATUS_LABELS[key]}: nothing needs you`, async () => {
          await openOverview(page, ov(key));
          await expect(needs(page).getByRole("heading", { name: "Needs you" })).toBeVisible();
          await expect(visible(page, "[data-nothing-needs-you]")).toHaveText(NOTHING);
          await expect(needs(page).locator("[data-need], li")).toHaveCount(0);
        });
      }
      // Beside them, a draft has its one thing to do, and no "nothing".
      await openOverview(page, ov("draft"));
      await expect(need(page, "send-signoff")).toHaveText("Send version 1 for sign-off");
      await expect(visible(page, "[data-nothing-needs-you]")).toHaveCount(0);
    },
  );

  test(
    "U10-2 #4: the stage bar shows the right state for campaigns waiting for sign-off, signed off, launch waiting, live and ended",
    { annotation: [{ type: "case", description: "U10-2.4" }] },
    async ({ page }) => {
      const expected: [StatusKey, Record<Stage, string>][] = [
        ["waiting", { brief: "Waiting for sign-off", audience: "Not run yet", creative: "After sign-off", launch: "No ads ready", performance: "After launch" }],
        ["signedOff", { brief: "Signed off", audience: "Not run yet", creative: "No ads yet", launch: "No ads ready", performance: "After launch" }],
        ["launchWaiting", { brief: "Signed off", audience: "Not run yet", creative: "No ads yet", launch: "Waiting for approval", performance: "After launch" }],
        ["live", { brief: "Signed off", audience: "Not run yet", creative: "No ads yet", launch: "Live (simulated day 14)", performance: "No new alerts" }],
        ["ended", { brief: "Signed off", audience: "Not run yet", creative: "No ads yet", launch: "Ended", performance: "No new alerts" }],
      ];
      for (const [key, labels] of expected) {
        await step(page, `U10-2.4: ${STATUS_LABELS[key]}`, async () => {
          await openOverview(page, ov(key));
          await expect(visible(page, "[data-campaign-state]")).toHaveText(STATUS_LABELS[key]);
          expect(await barLabels(page), key).toEqual(labels);
          // The same bar on every stage page, with that stage current.
          for (const s of STAGES) {
            await page.goto(stagePath(ov(key), s));
            await settle(page);
            expect(await barLabels(page), `${key}, ${s}`).toEqual(labels);
            await expect(bar(page).locator('[aria-current="page"]'), `${key}, ${s}`).toHaveAttribute("data-stage", s);
          }
        });
      }
    },
  );

  test(
    "U10-2 #5: old links to the campaign page's sections land on the right stage",
    { annotation: [{ type: "case", description: "U10-2.5" }] },
    async ({ page }) => {
      const cases: [string, Stage][] = [
        ["#creative", "creative"],
        ["#personas", "audience"],
        ["#test-plan", "audience"],
        ["#signoff", "brief"],
        ["#history", "brief"],
        ["#launch", "launch"],
        ["#performance", "performance"],
      ];
      for (const [hash, stage] of cases) {
        await step(page, `U10-2.5: ${hash} lands on ${NAMES[stage]}`, async () => {
          await page.goto(`${ov("signedOff")}${hash}`);
          await page.waitForURL((u) => u.pathname === stagePath(ov("signedOff"), stage), { timeout: 15_000 });
          expect(new URL(page.url()).hash).toBe(hash);
          await settle(page);
          await expect(stageLink(page, stage)).toHaveAttribute("aria-current", "page");
        });
      }
      // A fragment that names no stage stays on the overview.
      await page.goto(`${ov("signedOff")}#nothing-here`);
      await settle(page);
      await expect(needs(page)).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(new URL(page.url()).pathname).toBe(ov("signedOff"));
    },
  );

  test(
    "U10-2 #7: another workspace's campaign id gives the not-found page on every stage route",
    { annotation: [{ type: "case", description: "U10-2.7" }] },
    async ({ page }) => {
      const userId = randomUUID();
      try {
        const [c] = await sql.begin(async (tx) => {
          await tx`insert into auth.users (id, email) values (${userId}, ${`other-${userId}@example.test`})`;
          const [ws] = await tx`insert into public.workspaces (name, created_by) values ('Other workspace', ${userId}) returning id`;
          await tx`insert into public.workspace_members (workspace_id, user_id) values (${ws.id}, ${userId})`;
          const [brand] = await tx`insert into public.brands (workspace_id, created_by, name, slug) values (${ws.id}, ${userId}, 'Hidden Harbour Teas', 'hidden-harbour-stages') returning id`;
          return tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by) values (${ws.id}, ${brand.id}, 'Hidden Harbour Teas: a campaign nobody else may see', ${userId}) returning id`;
        });
        const paths = [`/campaigns/${c.id}`, ...STAGES.map((s) => `/campaigns/${c.id}/${s}`), `/campaigns/${c.id}/brief?version=1`, "/campaigns/not-a-uuid/creative", "/campaigns/11111111-1111-4111-8111-111111111111/launch"];
        for (const p of paths) {
          await step(page, `U10-2.7: ${p} is not found`, async () => {
            await page.goto(p);
            await expect(page.getByRole("heading", { name: "Not found" }), p).toBeVisible();
            await expect(page.getByText("Hidden Harbour Teas"), p).toHaveCount(0);
            await expect(bar(page), p).toHaveCount(0);
          });
        }
      } finally {
        await sql`delete from public.workspaces where created_by = ${userId}`;
        await sql`delete from auth.users where id = ${userId}`;
      }
    },
  );

  test(
    "U10-2 #8: a stage that isn't reachable yet says why in one line and links to the step that unlocks it",
    { annotation: [{ type: "case", description: "U10-2.8" }] },
    async ({ page }) => {
      const locks: [StatusKey, Stage, string, string, Stage, string][] = [
        ["waiting", "creative", "Creative is made only from a signed-off brief.", "Sign off the brief", "brief", "[data-signoff-panel]"],
        ["waiting", "launch", "A launch needs a signed-off brief and picked ads that pass compliance.", "Sign off the brief", "brief", "[data-signoff-panel]"],
        ["waiting", "performance", "Performance shows once a launch is live (simulated).", "Go to Launch", "launch", "[data-stage-locked]"],
        ["signedOff", "launch", "A launch needs picked ads that pass compliance or were accepted.", "Pick ads in Creative", "creative", "[data-creative]"],
        ["signedOff", "performance", "Performance shows once a launch is live (simulated).", "Go to Launch", "launch", "[data-stage-locked]"],
        ["writing", "audience", "Personas and the test plan come once the brief is written.", "Go to the brief", "brief", "h1"],
      ];
      for (const [key, stage, reason, linkText, to, there] of locks) {
        await step(page, `U10-2.8: ${STATUS_LABELS[key]}, ${NAMES[stage]}: "${reason}"`, async () => {
          const res = await page.goto(stagePath(ov(key), stage));
          await settle(page);
          expect(res?.status(), `${key} ${stage}`).toBe(200);
          await expect(page.getByRole("heading", { name: "Not found" })).toHaveCount(0);
          // No error shown. Every page holds two empty alert regions (the toaster's and Next's route announcer), so
          // the check is for an alert with something in it.
          await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
          await expect(stageLink(page, stage)).toHaveAttribute("aria-current", "page");
          await expect(stageLink(page, stage)).toHaveAttribute("data-stage-locked", "");
          // The reason, not the stage bar's locked links (which carry data-stage-locked too).
          const locked = visible(page, LOCK_REASON);
          await expect(locked).toHaveCount(1);
          await expect(locked).toContainText(reason);
          // One line: a sentence, not a page of explanation.
          expect(((await locked.textContent()) ?? "").replace(reason, "").replace(linkText, "").trim().length, `${key} ${stage}: more than the reason and the link`).toBeLessThanOrEqual(2);
          const link = locked.getByRole("link", { name: linkText });
          await expect(link).toHaveAttribute("href", stagePath(ov(key), to));
          // None of the stage's own controls.
          for (const css of ["[data-gallery]", "[data-launch-panel]", "[data-perf-ads]", "[data-persona-review]"]) await expect(visible(page, css), css).toHaveCount(0);
          // The overview's card says the same.
          await page.goto(ov(key));
          await settle(page);
          await expect(visible(page, `[data-stage-card="${stage}"]`)).toContainText(reason);
          // The link unlocks: it opens the step.
          await page.goto(stagePath(ov(key), stage));
          await settle(page);
          await visible(page, LOCK_REASON).getByRole("link", { name: linkText }).click();
          await page.waitForURL((u) => u.pathname === stagePath(ov(key), to));
          await expect(visible(page, there).first()).toBeVisible();
        });
      }
    },
  );

  test(
    "U10-2 #9: at 375 px the stage bar with the longest labels never makes the page scroll sideways",
    { annotation: [{ type: "case", description: "U10-2.9" }] },
    async ({ page }) => {
      await page.setViewportSize(PHONE);
      const pages: [string, string][] = [];
      for (const [label, from, key] of [
        ["live, before day 1", day0, "live"],
        ["waiting for sign-off", ids, "waiting"],
        ["launch waiting", ids, "launchWaiting"],
      ] as [string, Record<StatusKey, string>, StatusKey][]) {
        pages.push([`${label}, overview`, ov(key, from)]);
        for (const s of STAGES) pages.push([`${label}, ${NAMES[s]}`, stagePath(ov(key, from), s)]);
      }
      for (const [name, p] of pages) {
        await step(page, `U10-2.9: ${name} at 375px`, async () => {
          await page.goto(p);
          await settle(page);
          await expectNoHorizontalScroll(page, `${name} at 375px`);
          const b = bar(page);
          await expect(b).toBeVisible();
          const box = (await b.boundingBox())!;
          expect(box.x, `${name}: the bar starts off screen`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `${name}: the bar is wider than the screen`).toBeLessThanOrEqual(PHONE.width);
          // On a stage page the current stage is wholly within the bar's visible box as the page opens, before anything is scrolled.
          const current = b.locator('a[aria-current="page"]');
          if ((await current.count()) > 0) {
            const cb = (await current.boundingBox())!;
            expect(cb.x, `${name}: the current stage starts left of the bar's view`).toBeGreaterThanOrEqual(box.x - 0.5);
            expect(cb.x + cb.width, `${name}: the current stage is cut off at the bar's right edge`).toBeLessThanOrEqual(box.x + box.width + 0.5);
            await expectNoHorizontalScroll(page, `${name} at 375px, with the current stage brought into the bar's view`);
          }
          // When its stages don't fit, the bar scrolls inside itself, and every stage can be reached.
          const scroll = await b.evaluate((el) => {
            const scroller = [el, ...Array.from(el.querySelectorAll("*"))].find((x) => x.scrollWidth > x.clientWidth + 1) ?? null;
            return scroller ? { overflowX: getComputedStyle(scroller).overflowX } : null;
          });
          if (scroll) expect(["auto", "scroll"], `${name}: the bar's overflow`).toContain(scroll.overflowX);
          for (const s of STAGES) {
            await stageLink(page, s).scrollIntoViewIfNeeded();
            const lb = (await stageLink(page, s).boundingBox())!;
            expect(lb.x, `${name}: ${s}`).toBeGreaterThanOrEqual(-0.5);
            expect(lb.x + lb.width, `${name}: ${s}`).toBeLessThanOrEqual(PHONE.width + 0.5);
          }
          await expectNoHorizontalScroll(page, `${name} at 375px, after scrolling the bar`);
        });
      }
      // The longest label is there.
      await page.goto(ov("live", day0));
      await settle(page);
      await expect(stageLink(page, "launch").locator("[data-stage-state]")).toHaveText("Live (simulated, before day 1)");
    },
  );

  test(
    "U10-2 #10: the stage bar is a nav with aria-current, and stage and Needs you links work with Enter",
    { annotation: [{ type: "case", description: "U10-2.10" }] },
    async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      const axe = async (css: string) =>
        (await new AxeBuilder({ page }).include(css).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.flatMap((v) =>
          v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.failureSummary}`),
        );

      await step(page, "U10-2.10: the bar is a navigation landmark named Campaign stages, Brief current; axe finds nothing", async () => {
        await page.goto(stagePath(ov("signedOff"), "brief"));
        await settle(page);
        const nav = page.getByRole("navigation", { name: "Campaign stages" }).filter({ visible: true });
        await expect(nav).toHaveCount(1);
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
        await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("data-stage", "brief");
        expect(await axe("[data-stage-bar]")).toEqual([]);
      });

      await step(page, "U10-2.10: Tab moves along the stages with a focus ring; Enter on Creative opens it", async () => {
        await stageLink(page, "brief").focus();
        await page.keyboard.press("Tab");
        await expect(stageLink(page, "audience")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(stageLink(page, "creative")).toBeFocused();
        const ring = await stageLink(page, "creative").evaluate((el) => {
          const cs = getComputedStyle(el);
          return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
        });
        expect(ring, "the focused stage shows its focus ring").toBe(true);
        await page.keyboard.press("Enter");
        await page.waitForURL((u) => u.pathname === stagePath(ov("signedOff"), "creative"));
        await settle(page);
        await expect(stageLink(page, "creative")).toHaveAttribute("aria-current", "page");
        await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(1);
      });

      await step(page, "U10-2.10: on the overview no stage is current; Enter on a Needs you link opens where it is done; axe finds nothing", async () => {
        await openOverview(page, ov("draft"));
        await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(0);
        expect(await axe("[data-needs-you]")).toEqual([]);
        expect(await axe("[data-stage-bar]")).toEqual([]);
        await need(page, "send-signoff").getByRole("link").focus();
        await page.keyboard.press("Enter");
        await page.waitForURL((u) => u.pathname === stagePath(ov("draft"), "brief"));
        await settle(page);
        await expect(visible(page, "[data-signoff-panel]").getByRole("button", { name: "Send version 1 for sign-off" })).toBeVisible();
      });

      await step(page, "U10-2.10: Enter on the Overview link goes back", async () => {
        await visible(page, "[data-campaign-overview]").focus();
        await page.keyboard.press("Enter");
        await page.waitForURL((u) => u.pathname === ov("draft"));
        await untilShown(page, () => expect(needs(page)).toBeVisible({ timeout: 5_000 }), 30_000);
      });
    },
  );
});
