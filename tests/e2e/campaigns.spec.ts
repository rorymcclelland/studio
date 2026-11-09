// S3-2 and S3-3 through the UI, with the mock model: objective in, evidenced
// brief out; a hand edit, a revision with AI, a stale save from a second tab,
// a refused edit, and restoring an old version. Plus AA contrast and layout
// on /campaigns and the campaign's Brief stage (U10-2: the brief, its sign-off
// and its version history, collapsed to one line until opened, are there).
//
// Campaigns are created for Fernhollow. Pages left with Cache Components stay
// in the document, hidden, so locators that could match them are filtered to
// visible elements.
import { expect, test, type Page } from "@playwright/test";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, openHistory, openStage, settle, signIn, stagePath, untilShown } from "./helpers";

const OBJECTIVE = "Launch the winter range to lapsed customers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const section = (page: Page, name: string) => page.locator(`[data-section=${name}]`).filter({ visible: true });
const versionLabel = (page: Page) => page.locator("[data-version-label]").filter({ visible: true });
const version = (page: Page, n: number) => page.locator(`[data-version="${n}"]`).filter({ visible: true });

async function checkLayoutAndContrast(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Creates a Fernhollow campaign from /campaigns and waits for version 1 on its Brief stage. Returns its overview's path. */
async function newFernhollowCampaign(page: Page): Promise<string> {
  await demoBrandId(page, "Fernhollow Outfitters");
  await page.goto("/campaigns");
  await settle(page);
  await page.getByLabel("Brand").selectOption({ label: "Fernhollow Outfitters" });
  await page.getByLabel("Objective").fill(OBJECTIVE);
  await expect(page.getByText(`${OBJECTIVE.length} of 300 characters`)).toBeVisible();
  await page.getByRole("button", { name: "Write the brief" }).click();
  // It opens on the overview (U10-2); the brief is on the Brief stage.
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  const path = new URL(page.url()).pathname;
  await openStage(page, "brief", path);
  await untilShown(page, () => expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible({ timeout: 10_000 }), 60_000);
  return path;
}

test("S3-2 #1 and S3-3 #1, #3, #5, #7: brief, hand edit, revision, stale save and restore", async ({ page, context }) => {
  test.setTimeout(180_000);
  const path = await newFernhollowCampaign(page);
  await expect(versionLabel(page)).toHaveText("Version 1");
  await expect(page.getByRole("link", { name: "See the Brief agent's trail" })).toHaveAttribute("href", /^\/runs\//);

  // At least three insights, each with a source chip; opening one shows the item's text.
  const insights = section(page, "insights").locator("[data-insight]");
  expect(await insights.count()).toBeGreaterThanOrEqual(3);
  for (const ins of await insights.all()) await expect(ins.locator("[data-source-chip]").first()).toBeVisible();
  const chip = insights.first().locator("[data-source-chip]").first();
  await chip.locator("summary").click();
  await expect(chip.locator("p")).toBeVisible();
  await expect(chip.locator("p")).toContainText(/\S/);

  // The lapsed segment is an audience. Must include and Avoid come from the kit.
  await expect(section(page, "audiences")).toContainText("Lapsed customers (no order in 12 months)");
  await expect(page.getByText("From the brand kit; edit the kit to change these.").first()).toBeVisible();
  await expect(page.getByText("Simulated data").first()).toBeVisible();
  const originalStory = (await section(page, "story").locator("p").first().textContent())!.trim();

  // S3-3 #1: edit the story by hand: version 2, and history shows both.
  await page.getByRole("button", { name: "Edit the story" }).click();
  const story = page.getByRole("textbox", { name: "Story" });
  await expect(story).toBeFocused();
  await story.fill("We meet lapsed customers on the first cold morning of winter with a warm reason to come back.");
  await page.getByRole("button", { name: "Save the story" }).click();
  await expect(toast(page, "Saved as version 2.")).toBeVisible();
  await openHistory(page, "versions");
  await expect(version(page, 2)).toContainText("Edited by you");
  await expect(version(page, 1)).toContainText("Brief agent");
  await expect(section(page, "story")).toContainText("first cold morning of winter");

  // A second tab opens the title editor on version 2.
  const other = await context.newPage();
  await other.goto(stagePath(path, "brief"));
  await settle(other);
  await other.getByRole("button", { name: "Edit the title" }).click();

  // S3-3 #3: revise the summary with AI; only the summary changes; use it as version 3.
  await page.getByRole("button", { name: "Revise with AI: the summary" }).click();
  await page.getByLabel("What should change in the summary?").fill("Make it warmer");
  await page.getByRole("button", { name: "Ask the Brief agent" }).filter({ visible: true }).last().click();
  const proposal = page.locator("[data-proposal]").filter({ visible: true });
  await expect(proposal).toBeVisible({ timeout: 60_000 });
  await expect(proposal).toContainText("Make it warmer");
  await expect(proposal.locator("[data-changed-section]")).toHaveCount(1);
  await expect(proposal.locator("[data-changed-section=summary]")).toContainText("Revised as asked.");
  await checkLayoutAndContrast(page, "campaign page with a proposal");
  // Nothing changed yet.
  await expect(section(page, "summary")).not.toContainText("Revised as asked.");
  await proposal.getByRole("button", { name: "Use this version" }).click();
  await expect(toast(page, "Saved as version 3.")).toBeVisible();
  await openHistory(page, "versions");
  await expect(version(page, 3)).toContainText("Revision: Make it warmer");
  await expect(section(page, "summary")).toContainText("Revised as asked.");
  await expect(page.locator("[data-proposal]").filter({ visible: true })).toHaveCount(0);

  // S3-3 #7: the second tab saves from version 2 and is refused, with a reload.
  await other.getByRole("textbox", { name: "Title" }).fill("A title from a stale tab");
  await other.getByRole("button", { name: "Save the title" }).click();
  await expect(other.getByRole("alert").filter({ hasText: "This brief changed since you opened it" })).toBeVisible();
  await other.getByRole("button", { name: "Reload the latest version" }).click();
  await expect(versionLabel(other)).toHaveText("Version 3");
  await expect(other.getByText("A title from a stale tab")).toHaveCount(0);
  await other.close();

  // S3-3 #5: view version 1 read-only and make it current again: version 4.
  await openHistory(page, "versions");
  await version(page, 1).getByRole("link", { name: "View version 1" }).click();
  await expect(page).toHaveURL(/\?version=1$/);
  await expect(page.getByRole("heading", { name: "You are looking at version 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit the story" })).toHaveCount(0);
  await expect(section(page, "story")).toHaveCount(0);
  await checkLayoutAndContrast(page, "an old version");
  await page.getByRole("button", { name: "Make this the current version" }).click();
  await expect(toast(page, "Version 1 restored as version 4.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${stagePath(path, "brief")}$`));
  await openHistory(page, "versions");
  await expect(version(page, 4)).toContainText("Restored from version 1");
  await expect(section(page, "story")).toContainText(originalStory);
  await checkLayoutAndContrast(page, "the Brief stage");

  // The list shows the campaign as a draft again (U10-1's status labels: version 4 isn't signed off).
  await page.goto("/campaigns");
  await settle(page);
  const row = page.getByRole("link", { name: /Fernhollow Outfitters: campaign brief/ }).filter({ visible: true }).first();
  await expect(row).toContainText("Draft");
  await checkLayoutAndContrast(page, "/campaigns with campaigns");
});

test("S3-3 #2: a hand edit that removes every audience is refused and nothing is saved", async ({ page }) => {
  test.setTimeout(120_000);
  await newFernhollowCampaign(page);
  await page.getByRole("button", { name: "Edit the audiences" }).click();
  const audiences = section(page, "audiences");
  while ((await audiences.getByRole("button", { name: /^Remove audience/ }).count()) > 0) {
    await audiences.getByRole("button", { name: /^Remove audience/ }).first().click();
  }
  await audiences.getByRole("button", { name: "Save the audiences" }).click();
  await expect(audiences.getByRole("alert").filter({ hasText: "The brief wasn't saved" })).toContainText(
    "Choose at least one audience",
  );
  await audiences.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Edit the audiences" })).toBeFocused();
  await openHistory(page, "versions");
  await expect(page.locator("[data-version]").filter({ visible: true })).toHaveCount(1);
});

test("the objective is checked: too short is refused with the reason", async ({ page }) => {
  await demoBrandId(page, "Fernhollow Outfitters");
  await page.goto("/campaigns");
  await settle(page);
  const objective = page.getByLabel("Objective");
  // The browser's own minimum is bypassed, so the server's message shows.
  await objective.evaluate((el) => el.removeAttribute("minlength"));
  await objective.evaluate((el) => el.removeAttribute("required"));
  await objective.fill("Too short");
  await expect(page.getByText("9 of 300 characters, at least 10 needed")).toBeVisible();
  await page.getByRole("button", { name: "Write the brief" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at least 10 characters" })).toBeVisible();
  await expect(page).toHaveURL(/\/campaigns$/);
});

test("another workspace's campaign id, or a malformed one, shows not found", async ({ page }) => {
  for (const path of ["/campaigns/11111111-1111-4111-8111-111111111111", "/campaigns/not-a-uuid"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Not found" }), path).toBeVisible();
  }
});
