// P9-1 Launch a simulated campaign through the UI, with the mock models. One
// signed-off Fernhollow campaign with ads (simulated pictures):
//
// 1. The failure path (case 2): four paid-social ads are picked, but no one has
//    looked at the brand's don't rules yet, so none passes compliance. U10-2:
//    the Launch stage is locked with the reason ("A launch needs picked ads that
//    pass compliance or were accepted.") and a link to the decisions, so there
//    is no Ask to launch; the launch pack on the Creative stage lists each ad as
//    left out with its reason.
// 2. The main path (cases 1 and 2): the don't rules are accepted for every
//    picked ad, and a fifth ad is picked, still waiting on its rules. The panel
//    lists the four that would launch, and the fifth left out with the same
//    reason the launch pack gives. Ask to launch with the defaults (£50 a day,
//    30 days, today, and the threshold the brief's KPI suggests, labelled as
//    Studio's own simulated default); the inbox shows the request with its ads,
//    budget, length, threshold and "Simulated: no real money is spent"; Approve
//    makes the campaign Live (simulated) with four ads, £50 a day for 30 days.
// 3. Case 7: End the launch asks to confirm (Keep it live leaves it running),
//    then the campaign shows Ended, with who ended it, before its first
//    simulated day (the clock never moves here; tests/e2e/simulation.spec.ts
//    ends a launch on its last simulated day).
//
// U10-2: the panel is on the campaign's Launch stage and the pack on its
// Creative stage; both are reached through the stage bar.
//
// Each page at 375 px and 1440 px: nothing scrolls sideways, AA contrast.
// SHOTS_DIR=<folder> saves screenshots. The brand's kit is not changed, so this
// runs in the main project. The interface it expects is written at the top of
// tests/flows/launch.test.ts.
import { expect, test, type Page } from "@playwright/test";
import {
  acceptDontRulesForPicked,
  contrastViolations,
  DEV_EMAIL,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  openLaunch,
  openStage,
  saveShot,
  settle,
  signIn,
  signOffVersion,
  stagePath,
  step,
} from "./helpers";

const OBJECTIVE = "Bring walkers back for the autumn range, launched in a simulation";
const LOCKED = "A launch needs picked ads that pass compliance or were accepted.";
const SIMULATED_DEFAULT = "Studio's own simulated default, not a benchmark";

const panel = (page: Page) => page.locator("[data-launch-panel]");
const launchStatus = (page: Page) => panel(page).locator("[data-launch-status]");
const social = (page: Page) => page.locator('[data-gallery] > li[data-channel="paid social"]');
const pack = (page: Page) => page.locator("[data-launch-pack]");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Today in London, as the panel's default start date. */
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    await saveShot(page, `${what}-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Picks the i-th paid-social ad from its card; returns its gallery number. */
async function pickSocial(page: Page, i: number): Promise<number> {
  const card = social(page).nth(i);
  const button = card.getByRole("button", { name: /^Pick ad \d+$/ });
  const n = Number((await button.getAttribute("aria-label"))!.replace("Pick ad ", ""));
  await button.click();
  await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
  return n;
}

/** The campaign's Launch stage, through the stage bar, with its Launch (simulated) panel. */
async function openPanel(page: Page, path: string) {
  await openLaunch(page, path);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "P9-1 #1, #2, #7: a signed-off Fernhollow campaign's four passing ads launch with the defaults once approved in the inbox, an ad still waiting is left out with the pack's reason, and End the launch ends it",
  { annotation: [{ type: "case", description: "P9-1.1" }, { type: "case", description: "P9-1.2" }, { type: "case", description: "P9-1.7" }] },
  async ({ page }) => {
    test.setTimeout(900_000);
    let path = "";

    await step(page, "A signed-off Fernhollow brief and its ads (simulated pictures)", async () => {
      path = await newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
      await signOffVersion(page, 1);
      await makeCreative(page, 12);
      expect(await social(page).count()).toBeGreaterThanOrEqual(5);
    });

    await step(page, "Pick four paid-social ads, whose don't rules no one has looked at yet", async () => {
      for (let i = 0; i < 4; i++) await pickSocial(page, i);
    });

    await step(page, "P9-1.2: no picked ad passes compliance yet, so the Launch stage says why and offers no Ask to launch; the pack gives each ad's reason", async () => {
      // U10-2: with no ad that can launch, the Launch stage is locked with its reason and the step that unlocks it.
      await openStage(page, "launch", path);
      // The reason, not the stage bar's locked links (which carry data-stage-locked too).
      const locked = page.locator("[data-stage-locked]:not([data-stage])").filter({ visible: true });
      await expect(locked).toContainText(LOCKED);
      await expect(locked.getByRole("link", { name: "Decide compliance" })).toHaveAttribute("href", `${stagePath(path, "creative")}?show=decide`);
      await expect(page.getByRole("button", { name: "Ask to launch" })).toHaveCount(0);
      await expect(page.locator("[data-launch-ad]")).toHaveCount(0);
      await checkWidths(page, "launch stage, nothing passes yet");
      // Each picked ad's reason, as the launch pack on the Creative stage gives it.
      await openStage(page, "creative", path);
      await pack(page).locator("[data-pack-left-out] summary").click();
      const rows = pack(page).locator("[data-pack-left-out] li").filter({ hasText: /^Ad \d+, every size, English:/ });
      await expect(rows).toHaveCount(4);
      for (const row of await rows.all()) await expect(row).toHaveText(/^Ad \d+, every size, English:\s*Awaiting review: don't rule/);
    });

    let waiting = 0;
    await step(page, "Accept the brand's don't rules for every picked ad, then pick a fifth ad, still waiting on its rules", async () => {
      await openStage(page, "creative", path);
      await acceptDontRulesForPicked(page);
      waiting = await pickSocial(page, 4);
    });

    await step(page, "P9-1.2: the panel lists the four ads that would launch, and the fifth left out with the same reason the launch pack gives", async () => {
      // The pack's reason for the same ad, in English (the pack lists English first), on the Creative stage.
      await openStage(page, "creative", path);
      await pack(page).locator("[data-pack-left-out] summary").click();
      const packRow = pack(page).locator("[data-pack-left-out] li").filter({ hasText: new RegExp(`^Ad ${waiting}, every size, English:`) });
      await expect(packRow).toHaveCount(1);
      const packReason = (await packRow.textContent())!.replace(/^Ad \d+, every size, English:\s*/, "").trim();
      expect(packReason).toMatch(/^Awaiting review: don't rule/);
      await openPanel(page, path);
      await expect(panel(page).locator("[data-launch-ad]")).toHaveCount(4);
      const left = panel(page).locator("[data-launch-left-out]");
      await expect(left).toHaveCount(1);
      await expect(left).toHaveText(`Ad ${waiting}: ${packReason}`);
      await expect(panel(page).locator("[data-launch-reason]")).toHaveCount(0);
      await expect(panel(page).getByRole("button", { name: "Ask to launch" })).toBeEnabled();
    });

    await step(page, "P9-1.1: the defaults: £50 a day, 30 days, from today, and the threshold the brief's KPI suggests, labelled as Studio's own simulated default", async () => {
      await expect(panel(page).getByLabel("Daily budget (simulated £)")).toHaveValue("50");
      await expect(panel(page).getByLabel("Length in days")).toHaveValue("30");
      await expect(panel(page).getByLabel("Start date")).toHaveValue(londonToday());
      // The mock brief's KPI is the reactivation rate: cost per acquisition, at or below the value.
      await expect(panel(page).getByLabel("KPI measure")).toHaveValue("cpa");
      await expect(panel(page).getByLabel("Threshold")).toHaveValue("20");
      await expect(panel(page).locator("[data-threshold-default]")).toContainText(SIMULATED_DEFAULT);
      await checkWidths(page, "launch panel, four ads to launch");
    });

    await step(page, "P9-1.1: Ask to launch with the defaults: it waits for approval in the inbox", async () => {
      await panel(page).getByRole("button", { name: "Ask to launch" }).click();
      await expect(launchStatus(page)).toHaveText("Waiting for approval", { timeout: 30_000 });
      await expect(panel(page).getByRole("button", { name: "Ask to launch" })).toHaveCount(0);
    });

    await step(page, "P9-1.1: the inbox shows the request with its four ads, budget, length, threshold and that no real money is spent; Approve", async () => {
      await page.goto("/approvals");
      await settle(page);
      const card = page.locator("[data-inbox-item=launch]").filter({ has: page.locator(`a[href="${path}"]`) });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText("Simulated: no real money is spent");
      await expect(card.locator("[data-launch-ad]")).toHaveCount(4);
      await expect(card).toContainText("£50 a day");
      await expect(card).toContainText("30 days");
      await expect(card).toContainText("Cost per acquisition");
      await expect(card.getByRole("button", { name: "Refuse" })).toBeVisible();
      await checkWidths(page, "approvals with a launch request");
      await card.getByRole("button", { name: "Approve" }).click();
      await expect(card).toHaveCount(0, { timeout: 30_000 });
    });

    await step(page, "P9-1.1: the campaign is Live (simulated) with exactly the four ads, £50 a day for 30 days", async () => {
      await openPanel(page, path);
      await expect(launchStatus(page)).toHaveText("Live (simulated)");
      await expect(panel(page).locator("[data-launch-ad]")).toHaveCount(4);
      await expect(panel(page).locator("[data-launch-summary]")).toContainText("4 ads, £50 a day for 30 days");
      await expect(panel(page).locator("[data-launch-summary]")).toContainText("(simulated)");
      await checkWidths(page, "launch panel, live");
    });

    await step(page, "P9-1.7: End the launch asks first; Keep it live leaves it running", async () => {
      await panel(page).getByRole("button", { name: "End the launch" }).click();
      await expect(panel(page).getByRole("button", { name: "Yes, end the launch" })).toBeVisible();
      await panel(page).getByRole("button", { name: "Keep it live" }).click();
      await expect(panel(page).getByRole("button", { name: "Yes, end the launch" })).toHaveCount(0);
      await page.reload();
      await settle(page);
      await expect(launchStatus(page)).toHaveText("Live (simulated)");
    });

    await step(page, "P9-1.7: End the launch, confirmed: the campaign shows Ended, with who ended it and on which simulated day", async () => {
      await panel(page).getByRole("button", { name: "End the launch" }).click();
      await panel(page).getByRole("button", { name: "Yes, end the launch" }).click();
      await expect(launchStatus(page)).toHaveText("Ended", { timeout: 30_000 });
      await page.reload();
      await settle(page);
      await expect(launchStatus(page)).toHaveText("Ended");
      // This launch's clock never moves, so it ends before its first simulated day. Ending on the last simulated day
      // is shown by tests/e2e/simulation.spec.ts, which runs the clock to the end first (also tagged P9-1.7).
      await expect(panel(page).locator("[data-launch-ended]")).toHaveText(new RegExp(`^Ended by ${escape(DEV_EMAIL)} before its first simulated day\\.$`));
      await expect(panel(page).getByRole("button", { name: "End the launch" })).toHaveCount(0);
      await checkWidths(page, "launch panel, ended");
    });
  },
);
