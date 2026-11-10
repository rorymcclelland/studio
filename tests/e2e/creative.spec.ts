// S5-4 test cases 1 to 6 through the UI, with the mock models: a Quillmoor
// brief's Creative stage is locked until it is signed off (U10-2: "Creative is
// made only from a signed-off brief.", with a link to the sign-off);
// then Make creative gives 12 ads with their badges and the "Simulated image"
// label, New picture replaces one ad's picture, Edit words with a banned term
// is refused inline and saves nothing, and Pick and Discard survive a reload
// with an undo. The grid is one column at 375 px and four at 1440 px, with AA
// contrast. Plus S5-3 #6: a layout switch draws the ad in another layout.
// F-26: on a Fernhollow campaign, after a palette change in the brand editor
// the ads say they were made with an older kit, and Redraw with current kit
// (one ad, or all) redraws them, with undo; the palette is put back in the
// editor. That the redrawn ads are in the new colours is tested in
// tests/agents/creative.test.ts.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  adTool,
  caption,
  contrastViolations,
  demoBrandId,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  openAdMenu,
  openHistory,
  openStage,
  settle,
  showAllAds,
  signIn,
  signOffVersion,
  stagePath,
} from "./helpers";

const OBJECTIVE = "Bring lapsed savers back to the Plus plan in January";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });
const creative = (page: Page) => page.locator("[data-creative]");
const ads = (page: Page) => page.locator("[data-gallery] > li");

/** A Quillmoor brief, version 1, open on its Brief stage. Returns the campaign's overview path. */
async function newQuillmoorCampaign(page: Page): Promise<string> {
  return newCampaign(page, "Quillmoor Money", OBJECTIVE);
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
    // R2 (10 November): 3 columns at 1440 px, so rows are always full.
    [1440, 3],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await columns(page), `${what}: columns at ${width}px`).toBe(cols);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

// U10-3: by its number, not its place: the gallery now shows launched, needing a decision and picked ads first, newest first.
const ad = (page: Page, n: number): Locator => ads(page).filter({ has: page.getByRole("heading", { name: `Ad ${n}`, exact: true }) });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("S5-4 #1 to #6: make creative, new picture, edit words, pick and discard, through the UI", async ({ page }) => {
  test.setTimeout(300_000);
  const path = await newQuillmoorCampaign(page);

  // #5: before sign-off the Creative stage says why it is locked, links to the sign-off, and has no button.
  await openStage(page, "creative", path);
  await expect(visible(page, "[data-stage-locked]:not([data-stage])")).toContainText("Creative is made only from a signed-off brief.");
  await expect(visible(page, "[data-stage-locked]:not([data-stage])").getByRole("link", { name: "Sign off the brief" })).toHaveAttribute("href", stagePath(path, "brief"));
  await expect(page.getByRole("button", { name: /Make creative/ })).toHaveCount(0);

  await openStage(page, "brief", path);
  const panel = visible(page, "[data-signoff-panel]");
  await panel.getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await expect(toast(page, "Sent for sign-off")).toBeVisible();
  await panel.getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();

  // #1: Make creative says what it costs, then gives 12 ads with their badges, labelled simulated.
  await openStage(page, "creative", path);
  const make = creative(page).getByRole("button", { name: /^Make creative \(about \d+p, at most \d+p\)$/ });
  await expect(make).toBeEnabled();
  await make.click();
  await expect(creative(page).getByRole("status").filter({ hasText: "Drawing four pictures" })).toBeVisible({ timeout: 15_000 });
  await expect(ads(page)).toHaveCount(12, { timeout: 120_000 });
  // U10-3: the gallery shows six until Show all.
  await showAllAds(page);
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
  // The cost so far and the runs, with the Make creative run and its children (one line until opened).
  await openHistory(page, "runs");
  await expect(page.locator("[data-creative-cost]")).toContainText("AI cost of the creative so far:");
  const runs = page.getByRole("list", { name: "Creative runs, newest first" });
  await expect(runs.getByRole("link", { name: "Make creative" })).toBeVisible();
  await expect(runs.getByRole("link", { name: "Imagery agent" })).toBeVisible();
  // The email words (a text-only channel in the mock brief) are listed beside the gallery.
  await expect(page.getByRole("list", { name: "Words for other channels" }).locator("[data-copy-set=email]")).toHaveCount(1);
  await expectAdsDrawn(page);

  // #6: one column at 375 px, four at 1440 px; nothing scrolls sideways; AA contrast.
  await checkLayout(page, "the gallery");

  // S5-3 #6: a layout switch draws the ad in that layout, or says why not (U10-3: from the card's Edit menu).
  const first = ad(page, 1);
  await openAdMenu(first, "edit");
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
  await openAdMenu(ad(page, 1), "edit");
  const newPicture = ad(page, 1).getByRole("button", { name: /^New picture for ad 1, (about \d+p|under 1p)$/ });
  await newPicture.click();
  await expect(toast(page, "Drawing a new picture")).toBeVisible();
  await expect(page.locator(`[data-ad="${beforeId}"]`)).toHaveCount(0, { timeout: 60_000 });
  await expect(ads(page)).toHaveCount(12);
  await expect(page.locator(`[data-ad="${sibling}"]`)).toHaveCount(1);
  await expect(runs.getByRole("link", { name: "New picture" })).toBeVisible();
  await openHistory(page, "discarded");
  await expect(page.locator("[data-discarded-ad]").first()).toBeVisible();
  await expectAdsDrawn(page);

  // #3: Edit words with a banned term is refused inline, and nothing is saved.
  const headline = (await ad(page, 3).locator("img").getAttribute("alt"))!.match(/Headline: (.*?)\. /)![1];
  await (await adTool(ad(page, 3), "edit-words")).click();
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
  await showAllAds(page);
  await expect(ad(page, 3).locator("img")).toHaveAttribute("alt", new RegExp(`Headline: ${headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
  await expect(page.locator("[data-copy-set]").filter({ hasText: "Edited by a person" })).toHaveCount(0);

  // #4: Pick and Discard survive a reload; a discarded ad is listed with an undo.
  const pickedId = await ad(page, 4).getAttribute("data-ad");
  const pick4 = await adTool(ad(page, 4), "pick");
  await expect(pick4).toHaveAccessibleName("Pick ad 4");
  await pick4.click();
  await expect(toast(page, "Picked for the shortlist.")).toBeVisible();
  const discardedId = await ad(page, 5).getAttribute("data-ad");
  await (await adTool(ad(page, 5), "discard")).click();
  await expect(toast(page, "Ad discarded.")).toBeVisible();
  await page.reload();
  await settle(page);
  await showAllAds(page);
  await expect(page.locator(`[data-ad="${pickedId}"]`)).toHaveAttribute("data-picked", "");
  await expect(page.locator(`[data-ad="${pickedId}"]`).getByText("Picked", { exact: true })).toBeVisible();
  await expect(page.locator(`[data-gallery] [data-ad="${discardedId}"]`)).toHaveCount(0);
  await expect(ads(page)).toHaveCount(11);
  const gone = page.locator(`[data-discarded-ad="${discardedId}"]`);
  await openHistory(page, "discarded");
  await expect(gone).toBeVisible();
  await gone.getByRole("button", { name: /^Restore the ad/ }).click();
  await expect(toast(page, "Ad restored to the gallery.")).toBeVisible();
  await expect(ads(page)).toHaveCount(12);
  await expect(page.locator(`[data-gallery] [data-ad="${discardedId}"]`)).toHaveCount(1);
  await page.locator(`[data-ad="${pickedId}"]`).getByRole("button", { name: /^Unpick ad/ }).click();
  await expect(toast(page, "Taken off the shortlist.")).toBeVisible();

  // The Make creative run's page lists the runs inside it with the cost including them.
  await openHistory(page, "runs");
  await runs.getByRole("link", { name: "Make creative" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /make creative/ })).toBeVisible();
  await expect(page.locator("[data-child-runs]")).toContainText("With the runs inside it:");
  await expect(page.getByRole("list", { name: "Runs inside this run" }).getByRole("link", { name: "Imagery agent" })).toBeVisible();
  await page.getByRole("list", { name: "Runs inside this run" }).getByRole("link", { name: "Imagery agent" }).click();
  await expect(page.getByText("Part of a Make creative run.")).toBeVisible();

  // The run list names the Make creative run by its workflow name, not its key (U10-8: filtered to Make creative
  // runs, as the list shows 50 a page).
  await page.goto("/runs?agent=creative");
  await settle(page);
  await expect(page.getByRole("cell", { name: "Make creative", exact: true }).first()).toBeVisible();
  await page.goto(path);
});

test("S5-4 #6: every action on an ad is reachable by keyboard at 375 px", async ({ page }) => {
  test.setTimeout(240_000);
  const path = await newQuillmoorCampaign(page);
  const panel = visible(page, "[data-signoff-panel]");
  await panel.getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await panel.getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();
  await openStage(page, "creative", path);
  await creative(page).getByRole("button", { name: /^Make creative/ }).click();
  await expect(ads(page)).toHaveCount(12, { timeout: 120_000 });
  // U10-3: the gallery shows six until Show all.
  await showAllAds(page);

  await page.setViewportSize({ width: 375, height: 800 });
  await settle(page);
  const card = ad(page, 1);
  // U10-3: the tools are in the card's Edit and More menus; opened, every one is a Tab stop.
  await openAdMenu(card, "edit");
  await openAdMenu(card, "more");
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

type Colour = { name: string; hex: string };
const hexFields = (page: Page) => page.getByRole("textbox", { name: /^Colour \d+ hex value$/ });

/** The brand's palette, read from its brand editor. */
async function paletteInEditor(page: Page, brandId: string): Promise<Colour[]> {
  await page.goto(`/brands/${brandId}/edit`);
  await settle(page);
  const n = await hexFields(page).count();
  const colours: Colour[] = [];
  for (let i = 1; i <= n; i++) {
    colours.push({
      name: await page.getByLabel(`Colour ${i} name`, { exact: true }).inputValue(),
      hex: await page.getByLabel(`Colour ${i} hex value`, { exact: true }).inputValue(),
    });
  }
  return colours;
}

/** Saves a palette of the same length through the brand editor, as a person would. */
async function savePaletteInEditor(page: Page, brandId: string, brandName: string, colours: Colour[]) {
  await page.goto(`/brands/${brandId}/edit`);
  await settle(page);
  await expect(hexFields(page)).toHaveCount(colours.length);
  for (const [i, c] of colours.entries()) {
    await page.getByLabel(`Colour ${i + 1} name`, { exact: true }).fill(c.name);
    await page.getByLabel(`Colour ${i + 1} hex value`, { exact: true }).fill(c.hex);
  }
  await page.getByRole("button", { name: "Save brand kit" }).click();
  await expect(toast(page, `Brand kit saved for ${brandName}.`)).toBeVisible({ timeout: 30_000 });
}

// On Fernhollow, whose palette other specs read (compliance.spec's contrast, design-system.spec's screens): the
// test is tagged @brand-kit, so it runs in the brand-kit project, after every other spec and one at a time.
test("F-26 #1 to #4: ads made with an older kit say so; Redraw with current kit redraws one or all at no AI cost, with undo", { tag: "@brand-kit", annotation: [{ type: "case", description: "F-26.1" }, { type: "case", description: "F-26.2" }, { type: "case", description: "F-26.3" }, { type: "case", description: "F-26.4" }] }, async ({ page }) => {
  test.setTimeout(600_000);
  const brandName = "Fernhollow Outfitters";
  const brandId = await demoBrandId(page, brandName);
  const campaignPath = stagePath(await newCampaign(page, brandName, "Bring lapsed customers back for the winter range, redrawn with the current kit"), "creative");
  await signOffVersion(page, 1);
  // Read the signed-off page afresh: this spec is about redrawing, not the sign-off panel's refresh.
  await makeCreative(page, 12);
  // #3: on the current kit, no ad offers a redraw.
  await caption(page, "F-26.3: every ad is on the current kit, so none offers a redraw");
  await expect(page.locator("[data-older-kit]")).toHaveCount(0);
  await expect(creative(page).getByRole("button", { name: /^Redraw/ })).toHaveCount(0);

  const palette = await paletteInEditor(page, brandId);
  expect(palette.length, "a palette with colours to reorder").toBeGreaterThan(1);
  try {
    await caption(page, "The brand's palette changes in the brand editor: every ad says it was made with an older kit");
    // A palette change (the same colours in another order changes which panel colour each layout prefers).
    await savePaletteInEditor(page, brandId, brandName, [...palette].reverse());
    await page.goto(campaignPath);
    await settle(page);
    await showAllAds(page);
    const bar = page.locator("[data-older-kit]");
    await expect(bar).toContainText("All 12 ads were made with an older kit.");
    await expect(page.locator("[data-gallery] [data-badge=kit]")).toHaveCount(12);
    await expect(page.locator("[data-gallery] [data-badge=kit]").first()).toHaveText("Made with an older kit");
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      await expectNoHorizontalScroll(page, `older-kit ads at ${width}px`);
      expect(await contrastViolations(page), `older-kit ads at ${width}px`).toEqual([]);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    await caption(page, "F-26.1, F-26.4: pick ad 1 and redraw it with the current kit: the pick carries over");
    // #1 and #4: one ad redrawn; the pick carries over to the redrawn ad.
    const firstId = (await ad(page, 1).getAttribute("data-ad"))!;
    const pick1 = await adTool(ad(page, 1), "pick");
    await expect(pick1).toHaveAccessibleName("Pick ad 1");
    await pick1.click();
    await expect(toast(page, "Picked for the shortlist.")).toBeVisible();
    await openAdMenu(ad(page, 1), "edit");
    await ad(page, 1).getByRole("button", { name: "Redraw ad 1 with the current kit, no AI cost" }).click();
    await expect(toast(page, "Ad redrawn with the current kit.")).toBeVisible();
    await expect(page.locator(`[data-gallery] [data-ad="${firstId}"]`)).toHaveCount(0);
    await expect(ads(page)).toHaveCount(12);
    const picked = page.locator("[data-gallery] > li[data-picked]");
    await expect(picked).toHaveCount(1);
    await expect(picked.locator("[data-badge=kit]")).toHaveCount(0);
    await expect(bar).toContainText("11 ads were made with an older kit.");

    await caption(page, "F-26.2: undo brings the old ad back, with its pick");
    // #2: undo brings the old ad back (with the pick) and discards the redrawn one.
    const old = page.locator(`[data-discarded-ad="${firstId}"]`);
    await openHistory(page, "discarded");
    await expect(old).toContainText("Restoring it brings back the older kit");
    await old.getByRole("button", { name: /^Restore the ad/ }).click();
    await expect(toast(page, "Ad restored to the gallery.")).toBeVisible();
    await expect(page.locator(`[data-gallery] [data-ad="${firstId}"]`)).toHaveAttribute("data-picked", "");
    await expect(bar).toContainText("All 12 ads were made with an older kit.");

    // Redraw all.
    await caption(page, "Redraw all 12 older ads with the current kit, at no AI cost");
    await bar.getByRole("button", { name: /^Redraw all 12 older ads/ }).click();
    // Twelve drawings in code: a few seconds.
    await expect(toast(page, "12 ads redrawn with the current kit.")).toBeVisible({ timeout: 30_000 });
    await expect(bar).toHaveCount(0);
    await expect(page.locator("[data-gallery] [data-badge=kit]")).toHaveCount(0);
    await expect(ads(page)).toHaveCount(12);
    await expectAdsDrawn(page);
  } finally {
    await caption(page, "Put the brand's palette back in the brand editor");
    await savePaletteInEditor(page, brandId, brandName, palette);
    expect(await paletteInEditor(page, brandId)).toEqual(palette);
  }
});
