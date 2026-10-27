// S5-4 test cases 1 to 6 through the UI, with the mock models: a Quillmoor
// brief shows "Sign off the brief to make creative" until it is signed off;
// then Make creative gives 12 ads with their badges and the "Simulated image"
// label, New picture replaces one ad's picture, Edit words with a banned term
// is refused inline and saves nothing, and Pick and Discard survive a reload
// with an undo. The grid is one column at 375 px and four at 1440 px, with AA
// contrast. Plus S5-3 #6: a layout switch draws the ad in another layout.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, settle, signIn } from "./helpers";

const OBJECTIVE = "Bring lapsed savers back to the Plus plan in January";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });
const creative = (page: Page) => page.locator("[data-creative]");
const ads = (page: Page) => page.locator("[data-gallery] > li");

async function newQuillmoorCampaign(page: Page): Promise<string> {
  await demoBrandId(page, "Quillmoor Money");
  await page.goto("/campaigns");
  await settle(page);
  await page.getByLabel("Brand").selectOption({ label: "Quillmoor Money" });
  await page.getByLabel("Objective").fill(OBJECTIVE);
  await page.getByRole("button", { name: "Write the brief" }).click();
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible({ timeout: 60_000 });
  return new URL(page.url()).pathname;
}

/** The number of columns the gallery shows: distinct left edges in its first rows. */
async function columns(page: Page): Promise<number> {
  return page.locator("[data-gallery] > li").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
}

/** Every drawn ad on the page has loaded as a picture (the /ads route answered with a PNG). */
async function expectAdsDrawn(page: Page) {
  const broken = await page.locator("[data-gallery] img").evaluateAll(async (imgs) => {
    await Promise.all((imgs as HTMLImageElement[]).map((i) => (i.loading = "eager", i.decode().catch(() => undefined))));
    return (imgs as HTMLImageElement[]).filter((i) => !i.complete || i.naturalWidth !== 1080).map((i) => i.src);
  });
  expect(broken, "ads that didn't draw").toEqual([]);
}

async function checkLayout(page: Page, what: string) {
  for (const [width, cols] of [
    [375, 1],
    [1440, 4],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await columns(page), `${what}: columns at ${width}px`).toBe(cols);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

const ad = (page: Page, n: number): Locator => ads(page).nth(n - 1);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("S5-4 #1 to #6: make creative, new picture, edit words, pick and discard, through the UI", async ({ page }) => {
  test.setTimeout(300_000);
  const path = await newQuillmoorCampaign(page);

  // #5: before sign-off there is the message and no button.
  await expect(creative(page).getByText("Sign off the brief to make creative")).toBeVisible();
  await expect(creative(page).getByRole("button", { name: /Make creative/ })).toHaveCount(0);

  const panel = visible(page, "[data-signoff-panel]");
  await panel.getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await expect(toast(page, "Sent for sign-off")).toBeVisible();
  await panel.getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();

  // #1: Make creative says what it costs, then gives 12 ads with their badges, labelled simulated.
  const make = creative(page).getByRole("button", { name: /^Make creative \(about \d+p, at most \d+p\)$/ });
  await expect(make).toBeEnabled();
  await make.click();
  await expect(creative(page).getByRole("status").filter({ hasText: "Drawing four pictures" })).toBeVisible({ timeout: 15_000 });
  await expect(ads(page)).toHaveCount(12, { timeout: 120_000 });
  await expect(page.locator("[data-simulated-note]")).toContainText("Simulated images.");
  for (const card of await ads(page).all()) {
    await expect(card.locator("[data-badge=contrast]")).toContainText(/^Contrast \d+\.\d:1$/);
    await expect(card.locator("[data-badge=fit]")).toContainText(/^Fits (Full bleed|Split|Card)$/);
    await expect(card.locator("[data-badge=legal]")).toBeVisible();
    await expect(card.locator("[data-badge=simulated]")).toHaveText("Simulated image");
  }
  // Rory's test, 27 Oct: clicking an ad opens it full size (the 1080 × 1080 PNG) in a new tab.
  const full = ads(page).first().locator("a[data-ad-full]");
  await expect(full).toHaveAttribute("target", "_blank");
  const [tab] = await Promise.all([page.context().waitForEvent("page"), full.click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/\/ads\/[0-9a-f-]{36}/);
  const size = await tab.evaluate(() => { const i = document.querySelector("img"); return i ? [i.naturalWidth, i.naturalHeight] : null; });
  expect(size).toEqual([1080, 1080]);
  await tab.close();
  // Once there are ads, Make creative is disabled and says why.
  await expect(creative(page).getByRole("button", { name: /Make creative/ })).toBeDisabled();
  await expect(page.locator("[data-make-creative-reason]")).not.toBeEmpty();
  // The cost so far and the runs, with the Make creative run and its children.
  await expect(page.locator("[data-creative-cost]")).toContainText("AI cost of the creative so far:");
  const runs = page.getByRole("list", { name: "Creative runs, newest first" });
  await expect(runs.getByRole("link", { name: "Make creative" })).toBeVisible();
  await expect(runs.getByRole("link", { name: "Imagery agent" })).toBeVisible();
  // The email words (a text-only channel in the mock brief) are listed beside the gallery.
  await expect(page.getByRole("list", { name: "Words for other channels" }).locator("[data-copy-set=email]")).toHaveCount(1);
  await expectAdsDrawn(page);

  // #6: one column at 375 px, four at 1440 px; nothing scrolls sideways; AA contrast.
  await checkLayout(page, "the gallery");

  // S5-3 #6: a layout switch draws the ad in that layout, or says why not.
  const first = ad(page, 1);
  const firstLayout = (await first.getByRole("button", { pressed: true }).textContent())!.trim();
  const other = firstLayout === "Split" ? "Full bleed" : "Split";
  await first.getByRole("button", { name: `${other} layout for ad 1` }).click();
  const switched = toast(page, "Layout changed.");
  const refused = first.getByRole("alert").filter({ hasText: "can't be used for this ad" });
  await expect(switched.or(refused)).toBeVisible();
  if (await switched.isVisible()) {
    await expect(first.getByRole("button", { name: `${other} layout for ad 1` })).toHaveAttribute("aria-pressed", "true");
    await expect(first.locator("[data-badge=fit]")).toHaveText(`Fits ${other}`);
    await expect(first.locator("img")).toHaveAttribute("src", /\?layout=/);
  }

  // #2: New picture says its cost, replaces only that ad's picture, and the cost is shown.
  const beforeId = await ad(page, 1).getAttribute("data-ad");
  const sibling = await ad(page, 2).getAttribute("data-ad");
  const newPicture = ad(page, 1).getByRole("button", { name: /^New picture for ad 1, (about \d+p|under 1p)$/ });
  await newPicture.click();
  await expect(toast(page, "Drawing a new picture")).toBeVisible();
  await expect(page.locator(`[data-ad="${beforeId}"]`)).toHaveCount(0, { timeout: 60_000 });
  await expect(ads(page)).toHaveCount(12);
  await expect(page.locator(`[data-ad="${sibling}"]`)).toHaveCount(1);
  await expect(runs.getByRole("link", { name: "New picture" })).toBeVisible();
  await expect(page.locator("[data-discarded-ad]").first()).toBeVisible();
  await expectAdsDrawn(page);

  // #3: Edit words with a banned term is refused inline, and nothing is saved.
  const headline = (await ad(page, 3).locator("img").getAttribute("alt"))!.match(/Headline: (.*?)\. /)![1];
  await ad(page, 3).getByRole("button", { name: "Edit the words for ad 3" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit the words for ad 3" });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("textbox", { name: "Headline" });
  await expect(field).toHaveValue(headline);
  // The limit is live: over 40 characters is counted and refused before anything is sent.
  await field.fill("x".repeat(45));
  await expect(dialog.locator("[data-count=headline]")).toHaveText("45 of 40 characters, 5 over");
  await dialog.getByRole("button", { name: "Save the words" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Keep this to 40 characters or fewer." })).toBeVisible();
  await field.fill("Guaranteed returns, every single week");
  await dialog.getByRole("button", { name: "Save the words" }).click();
  // Named in the summary and on the headline field itself.
  await expect(dialog.getByRole("alert").filter({ hasText: "The words weren't saved." })).toContainText(/guaranteed returns/i);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/banned term "guaranteed returns"/i);
  await expect(dialog).toBeVisible();
  expect(await contrastViolations(page), "the words editor with a refusal").toEqual([]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await settle(page);
  await expect(ad(page, 3).locator("img")).toHaveAttribute("alt", new RegExp(`Headline: ${headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
  await expect(page.locator("[data-copy-set]").filter({ hasText: "Edited by a person" })).toHaveCount(0);

  // #4: Pick and Discard survive a reload; a discarded ad is listed with an undo.
  const pickedId = await ad(page, 4).getAttribute("data-ad");
  await ad(page, 4).getByRole("button", { name: "Pick ad 4" }).click();
  await expect(toast(page, "Picked for the shortlist.")).toBeVisible();
  const discardedId = await ad(page, 5).getAttribute("data-ad");
  await ad(page, 5).getByRole("button", { name: "Discard ad 5" }).click();
  await expect(toast(page, "Ad discarded.")).toBeVisible();
  await page.reload();
  await settle(page);
  await expect(page.locator(`[data-ad="${pickedId}"]`)).toHaveAttribute("data-picked", "");
  await expect(page.locator(`[data-ad="${pickedId}"]`).getByText("Picked", { exact: true })).toBeVisible();
  await expect(page.locator(`[data-gallery] [data-ad="${discardedId}"]`)).toHaveCount(0);
  await expect(ads(page)).toHaveCount(11);
  const gone = page.locator(`[data-discarded-ad="${discardedId}"]`);
  await expect(gone).toBeVisible();
  await gone.getByRole("button", { name: /^Restore the ad/ }).click();
  await expect(toast(page, "Ad restored to the gallery.")).toBeVisible();
  await expect(ads(page)).toHaveCount(12);
  await expect(page.locator(`[data-gallery] [data-ad="${discardedId}"]`)).toHaveCount(1);
  await page.locator(`[data-ad="${pickedId}"]`).getByRole("button", { name: /^Unpick ad/ }).click();
  await expect(toast(page, "Taken off the shortlist.")).toBeVisible();

  // The Make creative run's page lists the runs inside it with the cost including them.
  await runs.getByRole("link", { name: "Make creative" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /make creative/ })).toBeVisible();
  await expect(page.locator("[data-child-runs]")).toContainText("With the runs inside it:");
  await expect(page.getByRole("list", { name: "Runs inside this run" }).getByRole("link", { name: "Imagery agent" })).toBeVisible();
  await page.getByRole("list", { name: "Runs inside this run" }).getByRole("link", { name: "Imagery agent" }).click();
  await expect(page.getByText("Part of a Make creative run.")).toBeVisible();

  // The run list names the Make creative run by its workflow name, not its key.
  await page.goto("/runs");
  await settle(page);
  await expect(page.getByRole("cell", { name: "Make creative", exact: true }).first()).toBeVisible();
  await page.goto(path);
});

test("S5-4 #6: every action on an ad is reachable by keyboard at 375 px", async ({ page }) => {
  test.setTimeout(240_000);
  await newQuillmoorCampaign(page);
  const panel = visible(page, "[data-signoff-panel]");
  await panel.getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await panel.getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();
  await creative(page).getByRole("button", { name: /^Make creative/ }).click();
  await expect(ads(page)).toHaveCount(12, { timeout: 120_000 });

  await page.setViewportSize({ width: 375, height: 800 });
  await settle(page);
  const card = ad(page, 1);
  for (const name of [/layout for ad 1$/, /^Pick ad 1$/, /^Discard ad 1$/, /^New picture for ad 1/, /^New words for ad 1/, /^Edit the words for ad 1$/]) {
    const b = card.getByRole("button", { name }).first();
    await b.focus();
    await expect(b).toBeFocused();
    await expect(b).toBeInViewport();
  }
  // The words editor opens from the keyboard, holds focus, and closes with Escape back to its button.
  const edit = card.getByRole("button", { name: "Edit the words for ad 1" });
  await edit.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit the words for ad 1" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Headline" })).toBeFocused();
  await expectNoHorizontalScroll(page, "the words editor at 375px");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
});
