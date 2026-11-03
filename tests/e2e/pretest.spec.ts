// C8-4 Pre-test panel through the UI, with the mock models: on a signed-off
// Quillmoor campaign with ads (sign-off runs the persona review), the button
// says why before anything is picked; then pick four paid-social ads, and
// Pre-test picked ads, with its cost on the button, gives each picked ad its
// panel average and each of the four personas' scores and reasons, under
// "Synthetic panel, not real customers" (test case 1). Each page at 375 px and
// 1440 px: nothing scrolls sideways, AA contrast. SHOTS_DIR=<folder> saves
// screenshots.
import { expect, test, type Page } from "@playwright/test";
import { contrastViolations, expectNoHorizontalScroll, makeCreative, newCampaign, saveShot, settle, signIn, signOffVersion, step, untilShown } from "./helpers";

const OBJECTIVE = "Bring lapsed savers back to the Plus plan, pre-tested by the panel";
const SYNTHETIC_PANEL = "Synthetic panel, not real customers";
const SCALES = ["Stops the scroll", "Clear", "Believable", "On brand"];
const bar = (page: Page) => page.locator("[data-pretest-bar]");

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

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "C8-4 #1: Pre-test picked ads gives four picked ads each persona's scores with reasons, the panel average and the synthetic label",
  { annotation: [{ type: "case", description: "C8-4.1" }] },
  async ({ page }) => {
    test.setTimeout(600_000);

    await step(page, "A signed-off Quillmoor brief (sign-off runs the persona review), then Make creative with simulated pictures", async () => {
      await newCampaign(page, "Quillmoor Money", OBJECTIVE);
      await signOffVersion(page, 1);
      await makeCreative(page, 12);
    });

    await step(page, "Nothing is picked yet: Pre-test picked ads says why and can't be pressed", async () => {
      await expect(bar(page)).toContainText(SYNTHETIC_PANEL);
      await expect(bar(page).getByRole("button", { name: /^Pre-test picked ads/ })).toBeDisabled();
      await expect(bar(page).locator("[data-pretest-reason]")).toHaveText("Pick ads first: the panel scores the picked ads.");
    });

    const social = page.locator('[data-gallery] > li[data-channel="paid social"]');
    await step(page, "Pick four paid-social ads", async () => {
      expect(await social.count()).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < 4; i++) {
        const card = social.nth(i);
        const title = (await card.locator("h3, h4").first().textContent())!.trim();
        await card.getByRole("button", { name: `Pick ${title.toLowerCase()}` }).click();
        await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
      }
    });

    await step(page, "The button shows its cost before the click, once the panel is ready", async () => {
      // The persona review runs in the background after sign-off; the page shows the panel's names when it is done.
      const button = bar(page).getByRole("button", { name: /^Pre-test picked ads/ });
      await untilShown(page, () => expect(button).toBeEnabled({ timeout: 10_000 }), 180_000);
      await expect(button).toHaveText(/^Pre-test picked ads\s*\(about [\d.]+p an ad, [\d.]+p in all\)$/);
      await expect(bar(page)).toContainText(/The brief's synthetic personas \(.+\) score each picked ad from 1 to 5/);
      await checkWidths(page, "pre-test bar, four ads picked");
    });

    await step(page, "Pre-test picked ads: the panel scores each picked ad", async () => {
      await bar(page).getByRole("button", { name: /^Pre-test picked ads/ }).click();
      await expect(page.locator("[data-toast]").filter({ hasText: "Pre-testing the picked ads." })).toBeVisible();
      await untilShown(
        page,
        async () => {
          for (let i = 0; i < 4; i++) await expect(social.nth(i).locator("[data-pretest-average]")).toBeVisible({ timeout: 10_000 });
        },
        240_000,
      );
    });

    await step(page, "Each picked ad shows its panel average, four personas' scores and reasons, and the label", async () => {
      await page.reload();
      await settle(page);
      for (let i = 0; i < 4; i++) {
        const panel = social.nth(i).locator("[data-pretest]");
        await expect(panel.locator("[data-pretest-average]")).toHaveText(/^Panel average [1-5]\.\d out of 5$/);
        await expect(panel.locator("[data-pretest-label]")).toHaveText(`${SYNTHETIC_PANEL} (simulated scores)`);
        await panel.locator("summary").click();
        const personas = panel.locator("[data-pretest-persona]");
        await expect(personas).toHaveCount(4);
        for (let p = 0; p < 4; p++) {
          const persona = personas.nth(p);
          await expect(persona).toContainText(/[1-5]\.\d out of 5/);
          const scores = persona.locator("[data-pretest-score]");
          await expect(scores).toHaveCount(4);
          for (let s = 0; s < 4; s++) {
            await expect(scores.nth(s).locator("dt")).toHaveText(new RegExp(`^${SCALES[s]}: [1-5] out of 5\\.$`));
            // A reason, with a quote from the ad's own words.
            await expect(scores.nth(s).locator("dd")).toContainText(/\w.{9,}/);
            await expect(scores.nth(s).locator("q")).not.toBeEmpty();
          }
        }
        // Scores, never results or predictions.
        await expect(panel).not.toContainText(/result|click rate|%/i);
      }
      // Nothing was ranked or unpicked, and the button now says every picked ad has its scores.
      await expect(page.locator("[data-gallery] > li[data-picked]")).toHaveCount(4);
      await expect(bar(page).locator("[data-pretest-reason]")).toHaveText("Every picked ad has the panel's scores.");
      await social.first().scrollIntoViewIfNeeded();
      await checkWidths(page, "pre-test scores");
    });
  },
);
