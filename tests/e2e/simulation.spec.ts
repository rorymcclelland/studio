// P9-2 The simulator through the UI, with the mock models. It follows
// tests/e2e/launch.spec.ts's flow on a new signed-off Fernhollow campaign with
// ads (simulated pictures):
//
// 1. Two paid-social ads are picked, their don't rules accepted, and the
//    campaign launched with the defaults (£50 a day for 30 days) and approved
//    in the inbox. The Launch (simulated) panel shows the simulated clock:
//    "No simulated days yet (30 to run)", with Next day, Next week and Run to the end.
// 2. Next day: "Simulated day 1 of 30". Next week: "Simulated day 8 of 30".
// 3. The main path of case 5: Run to the end shows "Simulated day 30 of 30",
//    and the controls are disabled with the reason, "The simulation has reached
//    its last day" (the failure path: the clock can't move past the end).
// 4. P9-1 case 7: End the launch: the panel says who ended it, on its last
//    simulated day, 30 of 30, and the clock's controls are gone.
//
// Every figure on the panel is labelled simulated. Each state at 375 px and
// 1440 px: nothing scrolls sideways, AA contrast. SHOTS_DIR=<folder> saves
// screenshots. The brand's kit is not changed, so this runs in the main
// project. The interface it expects is written at the top of
// tests/db/simulation.test.ts.
import { expect, test, type Page } from "@playwright/test";
import {
  acceptDontRulesForPicked,
  contrastViolations,
  DEV_EMAIL,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  openLaunch,
  saveShot,
  settle,
  signIn,
  signOffVersion,
  step,
} from "./helpers";

const OBJECTIVE = "Bring walkers back for the autumn range, over a simulated month";
const AT_END = "The simulation has reached its last day";
const CONTROLS = ["Next day", "Next week", "Run to the end"] as const;

const panel = (page: Page) => page.locator("[data-launch-panel]");
const launchStatus = (page: Page) => panel(page).locator("[data-launch-status]");
const clock = (page: Page) => panel(page).locator("[data-sim-clock]");
const social = (page: Page) => page.locator('[data-gallery] > li[data-channel="paid social"]');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/** Picks the i-th paid-social ad from its card. */
async function pickSocial(page: Page, i: number) {
  const card = social(page).nth(i);
  await card.getByRole("button", { name: /^Pick ad \d+$/ }).click();
  await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
}

/** The campaign's Launch stage (U10-2), through the stage bar, with its Launch (simulated) panel. */
async function openPanel(page: Page, path: string) {
  await openLaunch(page, path);
}

/** Every figure the panel shows is labelled simulated: the clock says "Simulated day", the summary "(simulated)". */
async function expectLabelledSimulated(page: Page) {
  await expect(clock(page)).toHaveText(/^(Simulated day \d+ of 30|No simulated days yet \(30 to run\))$/);
  await expect(panel(page).locator("[data-launch-summary]")).toContainText("(simulated)");
  await expect(panel(page)).not.toContainText(/(?<![Ss]imulated )\bday \d+ of 30/);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "P9-2 #5: a live 30-day Fernhollow launch moves on by Next day and Next week, then Run to the end shows simulated day 30 of 30 with the controls disabled",
  { annotation: [{ type: "case", description: "P9-2.5" }, { type: "case", description: "P9-1.7" }] },
  async ({ page }) => {
    test.setTimeout(900_000);
    let path = "";

    await step(page, "A signed-off Fernhollow brief and its ads (simulated pictures); pick two paid-social ads and accept their don't rules", async () => {
      path = await newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
      await signOffVersion(page, 1);
      await makeCreative(page, 12);
      expect(await social(page).count()).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < 2; i++) await pickSocial(page, i);
      await page.reload();
      await acceptDontRulesForPicked(page);
    });

    await step(page, "Ask to launch with the defaults, £50 a day for 30 days, and approve it in the inbox", async () => {
      await openPanel(page, path);
      await expect(panel(page).locator("[data-launch-ad]")).toHaveCount(2);
      await expect(panel(page).getByLabel("Length in days")).toHaveValue("30");
      await panel(page).getByRole("button", { name: "Ask to launch" }).click();
      await expect(launchStatus(page)).toHaveText("Waiting for approval", { timeout: 30_000 });
      // Nothing to move on while it waits.
      for (const name of CONTROLS) await expect(panel(page).getByRole("button", { name })).toHaveCount(0);
      await page.goto("/approvals");
      await settle(page);
      const card = page.locator("[data-inbox-item=launch]").filter({ has: page.locator(`a[href="${path}"]`) });
      await expect(card).toHaveCount(1);
      await card.getByRole("button", { name: "Approve" }).click();
      await expect(card).toHaveCount(0, { timeout: 30_000 });
    });

    await step(page, "Live (simulated): the clock hasn't started, with Next day, Next week and Run to the end", async () => {
      await openPanel(page, path);
      await expect(launchStatus(page)).toHaveText("Live (simulated)");
      await expect(clock(page)).toHaveText("No simulated days yet (30 to run)");
      for (const name of CONTROLS) await expect(panel(page).getByRole("button", { name })).toBeEnabled();
      await expect(panel(page).locator("[data-sim-at-end]")).toHaveCount(0);
      await expectLabelledSimulated(page);
      await checkWidths(page, "simulation, not started");
    });

    await step(page, "Next day: simulated day 1 of 30", async () => {
      await panel(page).getByRole("button", { name: "Next day" }).click();
      await expect(clock(page)).toHaveText("Simulated day 1 of 30", { timeout: 30_000 });
      await page.reload();
      await settle(page);
      await expect(clock(page)).toHaveText("Simulated day 1 of 30");
    });

    await step(page, "Next week: simulated day 8 of 30", async () => {
      await panel(page).getByRole("button", { name: "Next week" }).click();
      await expect(clock(page)).toHaveText("Simulated day 8 of 30", { timeout: 30_000 });
      for (const name of CONTROLS) await expect(panel(page).getByRole("button", { name })).toBeEnabled();
      await expectLabelledSimulated(page);
      await checkWidths(page, "simulation, day 8");
    });

    await step(page, "P9-2.5: Run to the end: simulated day 30 of 30, and the controls are disabled with the reason", async () => {
      await panel(page).getByRole("button", { name: "Run to the end" }).click();
      await expect(clock(page)).toHaveText("Simulated day 30 of 30", { timeout: 60_000 });
      for (const name of CONTROLS) await expect(panel(page).getByRole("button", { name })).toBeDisabled();
      await expect(panel(page).locator("[data-sim-at-end]")).toHaveText(AT_END);
      // Still so after a reload: the clock's day is stored, and it stays live until a person ends it.
      await page.reload();
      await settle(page);
      await expect(launchStatus(page)).toHaveText("Live (simulated)");
      await expect(clock(page)).toHaveText("Simulated day 30 of 30");
      for (const name of CONTROLS) await expect(panel(page).getByRole("button", { name })).toBeDisabled();
      await expect(panel(page).locator("[data-sim-at-end]")).toHaveText(AT_END);
      await expectLabelledSimulated(page);
      await checkWidths(page, "simulation, last day");
    });

    await step(page, "P9-1.7: End the launch: it ended on its last simulated day, 30 of 30, with who ended it, and the clock's controls are gone", async () => {
      await panel(page).getByRole("button", { name: "End the launch" }).click();
      await panel(page).getByRole("button", { name: "Yes, end the launch" }).click();
      await expect(launchStatus(page)).toHaveText("Ended", { timeout: 30_000 });
      await page.reload();
      await settle(page);
      await expect(panel(page).locator("[data-launch-ended]")).toHaveText(new RegExp(`^Ended by ${escape(DEV_EMAIL)} on simulated day 30 of 30\\.$`));
      for (const name of CONTROLS) await expect(panel(page).getByRole("button", { name })).toHaveCount(0);
      await checkWidths(page, "simulation, ended");
    });
  },
);
