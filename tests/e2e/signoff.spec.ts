// S4-1, S4-2 and S4-4 through the UI, with the mock model: a Fernhollow brief
// is sent for sign-off, appears in the approvals inbox with the nav count, gets
// a persona review and a test plan, is rejected with a reason, sent again and
// approved, then edited ("version 2 not yet signed off"). Plus AA contrast and
// layout on /approvals and the campaign's stages (U10-2: the sign-off is on the
// Brief stage, the persona review and the test plan on the Audience stage).
//
// Other specs leave tagline approvals waiting while this runs, so the nav
// count is checked against the inbox it heads, not against a fixed number.
import { expect, test, type Page } from "@playwright/test";
import { contrastViolations, expectNoHorizontalScroll, inboxCard as cardFor, newCampaign, openSignoffReviews, openStage, settle, signIn } from "./helpers";

const OBJECTIVE = "Launch the winter range to lapsed customers";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });
const status = (page: Page) => visible(page, "[data-signoff-status]");
const panel = (page: Page) => visible(page, "[data-signoff-panel]");

async function checkLayoutAndContrast(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** A Fernhollow brief, version 1, open on its Brief stage. Returns the campaign's overview path. */
async function newFernhollowCampaign(page: Page): Promise<string> {
  return newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
}

/** Our campaign's card in the inbox (U10-5: found by its campaign, as its link now goes to the Brief stage). */
const inboxCard = (page: Page, path: string) => cardFor(page, "brief_signoff", path);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("S4-1 #1-#3, S4-2 and S4-4: sign-off through the inbox, with personas and a test plan", async ({ page }) => {
  test.setTimeout(240_000);
  const path = await newFernhollowCampaign(page);
  await expect(status(page)).toHaveText("Draft");

  // Send version 1: it waits for sign-off, and the personas and test plan start.
  await panel(page).getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await expect(toast(page, "Sent for sign-off")).toBeVisible();
  await expect(status(page)).toHaveText(/^Waiting for sign-off, closes \d{1,2} \w+ \d{4}$/);

  await checkLayoutAndContrast(page, "the Brief stage waiting for sign-off");

  // The persona review and the test plan appear on the campaign's Audience stage (Q4).
  await openStage(page, "audience", path);
  const personas = visible(page, "[data-persona]");
  await expect(personas.first()).toBeVisible({ timeout: 60_000 });
  expect(await personas.count()).toBeGreaterThanOrEqual(1);
  for (const p of await personas.all()) {
    await expect(p).toContainText("Synthetic persona, not a real customer");
    await expect(p.locator("blockquote")).toHaveCount(2);
  }
  await expect(visible(page, "[data-persona-overall]").first()).toContainText("out of 5 overall");
  const hypotheses = visible(page, "[data-hypothesis]");
  await expect(hypotheses.first()).toBeVisible({ timeout: 60_000 });
  expect(await hypotheses.count()).toBeGreaterThanOrEqual(2);
  await expect(hypotheses.first()).toContainText("Decision rule");
  await expect(page.getByText(/no sample sizes or run lengths on purpose/).first()).toBeVisible();
  await checkLayoutAndContrast(page, "the Audience stage waiting for sign-off");

  // The inbox lists it, with the review and the plan; the nav count matches the inbox.
  await page.getByRole("link", { name: /^Approvals/ }).click();
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
  const card = inboxCard(page, path);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Version 1: Fernhollow Outfitters: campaign brief");
  await expect(card).toContainText(OBJECTIVE);
  await expect(card).toContainText(/Closes \d{1,2} \w+ \d{4}/);
  // U10-5 (answer B1): the personas and test plan are on request, in place.
  await openSignoffReviews(card);
  await expect(card).toContainText("out of 5 overall");
  await expect(card.getByRole("list", { name: "Hypotheses" })).toBeVisible();
  // The nav count and the list are compared from one full page load: a link click can keep the layout's earlier
  // count, and parallel specs (home-work U10-5.7) add run choices to this workspace while this one runs.
  await expect
    .poll(async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
      const items = await visible(page, "[data-inbox-item]").count();
      const shown = ((await visible(page, "[data-nav-count]").textContent()) ?? "").trim();
      return shown === `${items > 99 ? "99+" : items} ${items === 1 ? "item" : "items"} waiting`;
    }, { message: "the nav count matches the inbox", timeout: 30_000 })
    .toBe(true);
  await openSignoffReviews(card);
  await checkLayoutAndContrast(page, "/approvals with a sign-off");

  // Reject: a reason is required, then the brief is a draft again with the reason shown.
  await card.getByRole("button", { name: "Reject" }).click();
  const reason = card.getByRole("textbox", { name: "Why isn't version 1 ready?" });
  await expect(reason).toBeFocused();
  await card.getByRole("button", { name: "Reject with this reason" }).click();
  await expect(card.getByRole("alert").filter({ hasText: "Say why" })).toBeVisible();
  await reason.fill("The story needs a clearer reason to come back now.");
  await card.getByRole("button", { name: "Reject with this reason" }).click();
  await expect(toast(page, "Not signed off")).toBeVisible();
  await expect(inboxCard(page, path)).toHaveCount(0);

  await openStage(page, "brief", path);
  await expect(status(page)).toHaveText("Draft");
  await expect(visible(page, "[data-signoff-note]")).toHaveText("Not signed off: The story needs a clearer reason to come back now.");

  // Send again: a new approval. Approve it on the campaign's Brief stage.
  await panel(page).getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await expect(status(page)).toHaveText(/^Waiting for sign-off/);
  await panel(page).getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();
  await expect(status(page)).toHaveText(/^Signed off: version 1 on \d{1,2} \w+ \d{4}$/);
  await expect(panel(page).getByRole("button", { name: /for sign-off/ })).toHaveCount(0);
  await page.goto("/approvals");
  await settle(page);
  await expect(inboxCard(page, path)).toHaveCount(0);

  // Edit after approval: version 2 is a draft; version 1 stays signed off.
  await openStage(page, "brief", path);
  await page.getByRole("button", { name: "Edit the story" }).click();
  await page.getByRole("textbox", { name: "Story" }).fill("We meet lapsed customers on the first cold morning of winter with a warm reason to come back.");
  await page.getByRole("button", { name: "Save the story" }).click();
  await expect(toast(page, "Saved as version 2.")).toBeVisible();
  await expect(status(page)).toHaveText("Signed off: version 1; version 2 not yet signed off");
  await expect(panel(page).getByRole("button", { name: "Send version 2 for sign-off" })).toBeVisible();
  // The review and plan were for version 1, and say so on the Audience stage.
  await openStage(page, "audience", path);
  await expect(visible(page, "[data-older-version]").first()).toContainText("For version 1.");
});

test("the inbox says when nothing is waiting, or lists what is", async ({ page }) => {
  await page.goto("/approvals");
  await settle(page);
  const items = await visible(page, "[data-inbox-item]").count();
  if (items === 0) {
    await expect(page.getByRole("heading", { name: "Nothing is waiting for you" })).toBeVisible();
    await expect(visible(page, "[data-nav-count]")).toHaveCount(0);
  } else {
    // Rory's decision (9 November 2026): sign-offs and launches in one list, then the run choices in their own group.
    const approve = await visible(page, '[data-inbox-item="brief_signoff"], [data-inbox-item="launch"]').count();
    const choices = items - approve;
    if (approve) await expect(page.getByRole("list", { name: `Waiting for your approval (${approve})` })).toBeVisible();
    if (choices) await expect(page.getByRole("list", { name: `Runs waiting for your choice (${choices})` })).toBeVisible();
  }
  await checkLayoutAndContrast(page, "/approvals");
});
