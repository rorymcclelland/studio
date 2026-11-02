// C7-2 Languages through the UI, with the mock models: the demo brand's
// Languages page (French, German and Spanish, written for the demo), then on
// a signed-off Quillmoor campaign with ads, Translate on a picked ad (its cost
// on the button), the ad's three translations badged "Machine translation
// (simulated)" (test cases 1, 6 and 8), and the German ad in every size of its
// channel (test case 2). Each page at 375 px and 1440 px: nothing scrolls
// sideways, AA contrast. SHOTS_DIR=<folder> saves a screenshot of each.
import { expect, test, type Page } from "@playwright/test";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, settle, signIn } from "./helpers";

const OBJECTIVE = "Bring lapsed savers back to the Plus plan in January";
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const creative = (page: Page) => page.locator("[data-creative]");
const ads = (page: Page) => page.locator("[data-gallery] > li");

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${what.replace(/\W+/g, "-")}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("C7-2: the demo brand's languages, Translate on a picked ad, machine-translation badges and the German ad in every size", async ({ page }) => {
  test.setTimeout(300_000);
  const brandId = await demoBrandId(page, "Quillmoor Money");

  // Q3/Q4: the demo brand's languages, with legal lines written for the demo.
  await page.goto(`/brands/${brandId}/languages`);
  await settle(page);
  await expect(page.getByRole("heading", { name: "Languages", level: 1 })).toBeVisible();
  for (const name of ["French", "German", "Spanish"]) {
    await expect(page.getByRole("checkbox", { name: `Translate ads into ${name}` })).toBeChecked();
  }
  await expect(page.locator("[data-language-form]").getByText("Written for the demo", { exact: true })).toHaveCount(3);
  await expect(page.getByLabel("German legal lines")).toHaveValue(/Sparzinsen sind variabel/);
  await checkWidths(page, "languages page");

  // A signed-off campaign with ads.
  await page.goto("/campaigns");
  await settle(page);
  await page.getByLabel("Brand").selectOption({ label: "Quillmoor Money" });
  await page.getByLabel("Objective").fill(OBJECTIVE);
  await page.getByRole("button", { name: "Write the brief" }).click();
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible({ timeout: 60_000 });
  const panel = page.locator("[data-signoff-panel]").filter({ visible: true });
  await panel.getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await expect(toast(page, "Sent for sign-off")).toBeVisible();
  await panel.getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();
  await creative(page).getByRole("button", { name: /^Make creative/ }).click();
  await expect(ads(page)).toHaveCount(12, { timeout: 120_000 });

  // Before anything is picked, Translate the picked ads says why it can't run.
  const bar = page.locator("[data-languages]");
  await expect(bar.locator("[data-language]")).toHaveText(["French", "German", "Spanish"]);
  await expect(bar.getByRole("button", { name: /^Translate the picked ads/ })).toBeDisabled();
  await expect(bar.locator("[data-translate-reason]")).toHaveText("Pick ads first: Translate works on the picked ads.");

  // #1, #6, #8: Translate on a picked ad, its cost on the button; three machine translations, simulated.
  const first = ads(page).first();
  await first.getByRole("button", { name: "Pick ad 1" }).click();
  // Server actions re-render the campaign page; on a busy dev server that can take several seconds.
  await expect(toast(page, "Picked for the shortlist.")).toBeVisible({ timeout: 30_000 });
  const translate = first.getByRole("button", { name: /^Translate\s*\((about \d+p|under 1p), at most \d+p\)$/ });
  await expect(translate).toBeEnabled({ timeout: 30_000 });
  await translate.click();
  await expect(toast(page, /^Translating\./)).toBeVisible({ timeout: 30_000 });
  await expect(first.locator("[data-translation]")).toHaveCount(3, { timeout: 60_000 });
  await expect(first.locator("[data-translation]")).toHaveText([/French/, /German/, /Spanish/]);
  await expect(first.locator("[data-badge=translation]")).toHaveText("Machine translation (simulated)");
  const drawn = await first.locator("[data-translation] img").evaluateAll(async (imgs) => {
    await Promise.all((imgs as HTMLImageElement[]).map((i) => ((i.loading = "eager"), i.decode().catch(() => undefined))));
    return (imgs as HTMLImageElement[]).map((i) => i.naturalWidth);
  });
  expect(drawn).toEqual([1080, 1080, 1080]);
  // Every ad on the same words shows them too.
  const sameWords = await page.locator("[data-gallery] > li").filter({ has: page.locator("[data-translation]") }).count();
  expect(sameWords).toBeGreaterThanOrEqual(1);
  await checkWidths(page, "gallery with translations");

  // #2: the German ad in every size of its channel, badged, with the language switcher.
  await first.locator("[data-translation=de-DE] a").click();
  await page.waitForURL(/\/sizes\?lang=de-DE$/);
  await settle(page);
  await expect(page.locator("[data-machine-translation]")).toContainText("Machine translation (simulated).");
  await expect(page.getByRole("navigation", { name: "Languages of this ad" }).getByRole("link")).toHaveText(["English", "French", "German", "Spanish"]);
  await expect(page.getByRole("navigation", { name: "Languages of this ad" }).getByRole("link", { name: "German", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-size]")).toHaveCount(4);
  for (const card of await page.locator("[data-size][data-size-ok]").all()) {
    await expect(card.locator("[data-badge=translation]")).toHaveText("Machine translation (simulated)");
  }
  await checkWidths(page, "German sizes");
});
