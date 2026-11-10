// S4-3 through the UI, with the mock model and its fixed sample pages:
// refreshing Quillmoor's market notes (Fernhollow stays unchanged for the
// design-system comparison), the notes with their source links and checked
// dates, and the 24-hour confirmation before another paid refresh.
import { expect, test, type Page } from "@playwright/test";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, settle, signIn } from "./helpers";

const section = (page: Page) => page.locator("section:has(h2#market)").filter({ visible: true });
const notes = (page: Page) => section(page).locator("[data-market-note]");
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });

/** Waits for the refresh in progress to finish and the notes to show. */
async function waitForNotes(page: Page) {
  await expect(section(page).getByRole("button", { name: "Refresh market notes" })).toBeEnabled({ timeout: 90_000 });
  await expect(notes(page).first()).toBeVisible();
}

test("S4-3: refresh market notes, see their sources and dates, and confirm a second refresh within a day", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  const quillmoor = await demoBrandId(page, "Quillmoor Money");
  // U10-7: the market notes are on the brand page's Audience tab.
  await page.goto(`/brands/${quillmoor}?tab=audience`);
  await settle(page);

  // First refresh. A re-run of this spec within a day is asked to confirm; it does.
  await section(page).getByRole("button", { name: "Refresh market notes" }).click();
  const confirm = section(page).locator("[data-market-confirm]");
  const started = toast(page, "The Market agent is searching the web");
  await expect(confirm.or(started).first()).toBeVisible();
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Refresh anyway" }).click();
  await expect(started).toBeVisible();
  await waitForNotes(page);
  await expect(section(page)).toContainText("Completed");

  // Every note has at least one source link, opening in a new tab, and a checked date.
  const count = await notes(page).count();
  expect(count).toBeGreaterThanOrEqual(1);
  for (const n of await notes(page).all()) {
    const links = n.getByRole("link");
    expect(await links.count()).toBeGreaterThanOrEqual(1);
    for (const l of await links.all()) {
      await expect(l).toHaveAttribute("href", /^https:\/\//);
      await expect(l).toHaveAttribute("target", "_blank");
      await expect(l).toHaveAttribute("rel", "noopener noreferrer");
    }
    await expect(n).toContainText(/From the web, checked \d{1,2} \w+ \d{4}/);
  }
  // Tagged by kind, and a note naming a real company says so.
  await expect(notes(page).filter({ hasText: "Trend" }).first()).toBeVisible();
  await expect(section(page).locator("[data-real-names]").first()).toContainText("Names real companies:");
  await expect(section(page).getByRole("link", { name: "See the run's trail" })).toHaveAttribute("href", /^\/runs\//);

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `brand page with market notes at ${width}px`);
    expect(await contrastViolations(page), `brand page with market notes at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Within 24 hours a refresh asks first. Keeping the notes starts nothing.
  await section(page).getByRole("button", { name: "Refresh market notes" }).click();
  await expect(confirm).toContainText("less than 24 hours ago");
  expect(await contrastViolations(page), "the refresh confirmation").toEqual([]);
  await confirm.getByRole("button", { name: "Keep the current notes" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(section(page).getByRole("button", { name: "Refresh market notes" })).toBeFocused();

  // Refresh anyway: the agent runs again and the notes are replaced, not added to.
  await section(page).getByRole("button", { name: "Refresh market notes" }).click();
  await confirm.getByRole("button", { name: "Refresh anyway" }).click();
  await expect(toast(page, "The Market agent is searching the web").last()).toBeVisible();
  await waitForNotes(page);
  await page.reload();
  await settle(page);
  await expect(notes(page)).toHaveCount(count);
});
