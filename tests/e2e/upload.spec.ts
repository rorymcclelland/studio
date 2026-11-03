// C8-3 Check an uploaded ad through the UI, with the mock models. The fixture
// ads are made in code for the fictional Fernhollow brand
// (tests/fixtures/uploaded-ads.ts), and the mock reads fixed words for them,
// chosen by the picture's size. Case 1: a clean ad, uploaded from the brand's
// Check an ad page with the cost on the button, gets every rule Pass or
// Review as the table says, each saying how it was found, and the words read
// by AI in full. Case 2: a banned term fails with the term, and no legal
// lines fails with the fix. Case 4 (one refusal shown): an SVG and a script
// named .png are refused with the reason, and nothing is stored. Each page at
// 375 px and 1440 px: nothing scrolls sideways, AA contrast. SHOTS_DIR=<folder>
// saves screenshots.
import { expect, test, type Page } from "@playwright/test";
import { fixtureAd } from "../fixtures/uploaded-ads";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, saveShot, settle, signIn, step, untilShown } from "./helpers";

const form = (page: Page) => page.locator("[data-upload-form]");
const finding = (page: Page, rule: string) => page.locator(`[data-upload-findings] > li[data-rule="${rule}"]`);

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    await saveShot(page, `${what}-${width}`, { fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Opens the brand's Check an ad page from the brand page. */
async function openCheckAnAd(page: Page): Promise<string> {
  const id = await demoBrandId(page, "Fernhollow Outfitters");
  await page.goto(`/brands/${id}`);
  await settle(page);
  await page.getByRole("link", { name: "Check an ad" }).click();
  await expect(page.getByRole("heading", { name: "Check an ad", level: 1 })).toBeVisible();
  await settle(page);
  return id;
}

/** Uploads a file from the form and waits for its check to show on the upload's page. */
async function uploadAndWait(page: Page, name: string, buffer: Buffer) {
  await form(page).getByLabel("The ad").setInputFiles({ name, mimeType: "image/png", buffer });
  await form(page).getByRole("button", { name: /^Upload and check/ }).click();
  await page.waitForURL(/\/check\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await untilShown(page, () => expect(page.locator("[data-upload-findings]")).toBeVisible({ timeout: 10_000 }), 120_000);
  await settle(page);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "C8-3 #1: a clean fictional Fernhollow ad, uploaded on Check an ad with the cost shown, gets every rule Pass or Review, each saying how it was found, with the words read by AI in full",
  { annotation: [{ type: "case", description: "C8-3.1" }] },
  async ({ page }) => {
    test.setTimeout(240_000);

    await step(page, "The brand's Check an ad page: the cost is on the button before anything runs", async () => {
      await openCheckAnAd(page);
      await expect(form(page).getByRole("button", { name: /^Upload and check/ })).toHaveText(/^Upload and check \(about [\d.]+p\)$/);
      await expect(form(page)).toContainText("A PNG or JPEG up to 5 MB and 4096 pixels on each side.");
      await expect(form(page).getByLabel("Channel")).toHaveValue("paid social");
      await expect(form(page).getByLabel("Language")).toHaveValue("en-GB");
      await checkWidths(page, "check an ad");
    });

    await step(page, "Upload a clean Fernhollow ad (a fixture made in code); the Read ad agent reads it", async () => {
      await uploadAndWait(page, "fernhollow-clean.png", await fixtureAd());
      await expect(page.getByRole("img", { name: "The uploaded ad, fernhollow-clean.png" })).toBeVisible();
      await expect(page.locator("h1 + [data-outcome]")).toHaveAttribute("data-outcome", "review");
      await expect(page.getByText("Simulated reading from the mock model")).toBeVisible();
    });

    await step(page, "Checked in code on the words read: banned terms, legal lines and real company names pass", async () => {
      for (const rule of ["banned", "legal", "realName"]) {
        await expect(finding(page, rule)).toHaveAttribute("data-status", "pass");
        await expect(finding(page, rule).locator("[data-how]")).toHaveText("Checked in code, on the words read by AI");
        await expect(finding(page, rule).getByText("Pass", { exact: true })).toBeVisible();
      }
      await expect(finding(page, "legal").locator("[data-reason]")).toHaveText("Every legal line for English is in the ad (2).");
    });

    await step(page, "Estimates are Review: contrast from the pixels under the AI's boxes, and text density", async () => {
      for (const rule of ["contrast", "density"]) {
        await expect(finding(page, rule)).toHaveAttribute("data-status", "review");
        await expect(finding(page, rule).locator("[data-how]")).toHaveText("Estimated");
      }
      await expect(finding(page, "contrast").locator("[data-reason]")).toContainText("Every line looks to pass AA (4.5:1 for words).");
      await expect(finding(page, "density").locator("[data-reason]")).toContainText("within the 25% that passes for Studio's own ads");
    });

    await step(page, "The AI's own findings are Review at most: the logo, and each don't rule with No issues found by AI", async () => {
      await expect(finding(page, "logo")).toHaveAttribute("data-status", "review");
      await expect(finding(page, "logo").locator("[data-how]")).toHaveText("Checked by AI");
      await expect(finding(page, "face")).toHaveAttribute("data-status", "na");
      const dont = finding(page, "dont");
      expect(await dont.count()).toBeGreaterThan(0);
      for (const d of await dont.all()) {
        await expect(d).toHaveAttribute("data-status", "review");
        await expect(d.locator("[data-reason]")).toContainText("No issues found by AI");
      }
      await expect(page.locator('[data-upload-findings] > li[data-status="pass"]').filter({ has: page.locator('[data-how="ai"]') })).toHaveCount(0);
    });

    await step(page, "The words read by AI, in full", async () => {
      await expect(page.getByText("Read by AI", { exact: true })).toBeVisible();
      const words = page.locator("[data-words-read] [data-word]");
      await expect(words).toHaveText([
        "Walk the long way home",
        "Merino layers made to be mended,",
        "for ridges, bogs and coast paths.",
        "Shop the layers",
        "Prices include VAT.",
        "Free returns within 30 days on unworn items.",
      ]);
      await checkWidths(page, "uploaded ad check");
    });

    await step(page, "The upload is listed on Check an ad with its outcome", async () => {
      await page.getByRole("link", { name: /^Check an ad for Fernhollow Outfitters/ }).click();
      await settle(page);
      await expect(page.locator("[data-uploads] li").filter({ hasText: "fernhollow-clean.png" }).first().locator("[data-outcome]")).toHaveAttribute("data-outcome", "review");
    });
  },
);

test(
  "C8-3 #2 and #4: a banned term fails with the term, no legal lines fails with the fix, and an SVG or a script named .png is refused with the reason and nothing stored",
  { annotation: [{ type: "case", description: "C8-3.2" }, { type: "case", description: "C8-3.4" }] },
  async ({ page }) => {
    test.setTimeout(300_000);
    await openCheckAnAd(page);
    const uploads = page.locator("[data-uploads] li");

    await step(page, "An SVG is refused with the reason, and nothing is stored", async () => {
      const before = await uploads.count();
      await form(page).getByLabel("The ad").setInputFiles({ name: "ad.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
      await form(page).getByRole("button", { name: /^Upload and check/ }).click();
      await expect(form(page).locator("[data-upload-error]")).toHaveText("An SVG can't be checked. Upload the ad as a PNG or JPEG. Nothing was stored.");
      await expect(form(page).getByLabel("The ad")).toHaveAttribute("aria-invalid", "true");

      // A script named .png gets past the page's own check, and the server refuses it by its contents.
      await form(page).getByLabel("The ad").setInputFiles({ name: "ad.png", mimeType: "image/png", buffer: Buffer.from("<script>fetch('/api')</script>") });
      await form(page).getByRole("button", { name: /^Upload and check/ }).click();
      await expect(form(page).locator("[data-upload-error]")).toHaveText("This file isn't a PNG or JPEG picture, so it can't be checked. Nothing was stored.");
      expect(await contrastViolations(page), "check an ad with a refusal").toEqual([]);
      await saveShot(page, "check-an-ad-refused");
      await page.reload();
      await settle(page);
      await expect(uploads).toHaveCount(before);
    });

    await step(page, "An upload whose words include a banned term fails, with the term", async () => {
      await uploadAndWait(page, "fernhollow-banned.png", await fixtureAd({ kind: "banned" }));
      await expect(page.locator("h1 + [data-outcome]")).toHaveAttribute("data-outcome", "fails");
      await expect(finding(page, "banned")).toHaveAttribute("data-status", "fail");
      await expect(finding(page, "banned").locator("[data-reason]")).toHaveText('The banned term "indestructible" is in the English body.');
      await expect(finding(page, "banned").locator("[data-fix]")).toHaveText('Suggested fix: Remove "indestructible".');
      await expect(page.locator("[data-words-read] [data-word]").filter({ hasText: "An indestructible shell for every ridge." })).toHaveCount(1);
    });

    await step(page, "An upload with no legal lines fails, with the fix", async () => {
      await page.getByRole("link", { name: /^Check an ad for Fernhollow Outfitters/ }).click();
      await settle(page);
      await uploadAndWait(page, "fernhollow-no-legal.png", await fixtureAd({ kind: "noLegal" }));
      await expect(page.locator("h1 + [data-outcome]")).toHaveAttribute("data-outcome", "fails");
      await expect(finding(page, "legal")).toHaveAttribute("data-status", "fail");
      await expect(finding(page, "legal").locator("[data-reason]")).toHaveText(/^2 legal lines are missing in English: "Prices include VAT\." and "Free returns within 30 days on unworn items\."\.$/);
      await expect(finding(page, "legal").locator("[data-fix]")).toHaveText(
        'Suggested fix: Add "Prices include VAT." and "Free returns within 30 days on unworn items." to the ad, as the kit writes them.',
      );
      await checkWidths(page, "uploaded ad fails");
    });
  },
);
