// F-27 Several audiences through the UI, with the mock models: a Quillmoor
// brief signed off with one audience shows a cost on Make creative; given a
// second audience by hand and signed off again, the cost is unchanged (test
// case 4); it gets 24 paid-social ads, 12 for each audience, grouped under a
// heading per audience (test case 1); New words on one of the second
// audience's ads waits beside the four ads on those words only, and keeping
// them redraws only those four (test case 2). Test case 3 (no named audience)
// is in tests/agents/creative.test.ts. Each page at 375 px and 1440 px: nothing
// scrolls sideways, AA contrast. The pictures and words are the mock model's.
import { expect, test, type Page } from "@playwright/test";
import { contrastViolations, expectNoHorizontalScroll, makeCreative, newCampaign, openAdMenu, openStage, saveShot, settle, signIn, signOffVersion, step, untilShown } from "./helpers";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const groups = (page: Page) => page.locator("[data-audience-group]");
const idsIn = (page: Page, group: number) =>
  groups(page).nth(group).locator("[data-gallery] > li").evaluateAll((els) => els.map((e) => e.getAttribute("data-ad")!));

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    await saveShot(page, `${what}-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "F-27 #1 and #2: a brief with two audiences gets 24 social ads grouped by audience, and New words on the second redraws only its ads",
  {
    annotation: [
      { type: "case", description: "F-27.1" },
      { type: "case", description: "F-27.2" },
      { type: "case", description: "F-27.4" },
    ],
  },
  async ({ page }) => {
    test.setTimeout(600_000);
    let titles: string[] = [];
    let oneAudienceCost = "";
    let path = "";
    const makeButton = () => page.locator("[data-creative]").getByRole("button", { name: /^Make creative/ });

    await step(page, "Write a Quillmoor brief with the mock Brief agent (one audience)", async () => {
      path = await newCampaign(page, "Quillmoor Money", "Bring lapsed savers and new savers to the Plus plan this spring");
      await expect(page.locator("[data-section=audiences]").filter({ visible: true }).locator("[data-audience]")).toHaveCount(1);
    });

    await step(page, "F-27.4: sign version 1 off and note the cost on Make creative with one audience", async () => {
      await signOffVersion(page, 1);
      // Make creative and its cost are on the Creative stage (U10-2).
      await openStage(page, "creative", path);
      oneAudienceCost = ((await makeButton().textContent()) ?? "").replace(/\s+/g, " ").trim();
      expect(oneAudienceCost).toMatch(/^Make creative ?\((about \d+p|under 1p), at most \d+p\)$/);
    });

    await step(page, "Add a second audience to the brief and sign version 2 off", async () => {
      await openStage(page, "brief", path);
      await page.getByRole("button", { name: "Edit the audiences" }).click();
      const section = page.locator("[data-section=audiences]").filter({ visible: true });
      await section.getByRole("button", { name: "Add an audience" }).click();
      const first = await section.getByLabel("Audience 1", { exact: true }).inputValue();
      const second = section.getByLabel("Audience 2", { exact: true });
      const other = await second.locator("option").evaluateAll(
        (opts, taken) => (opts as HTMLOptionElement[]).map((o) => o.value).find((v) => v && v !== taken)!,
        first,
      );
      await second.selectOption(other);
      await section.getByLabel("Why audience 2").fill("They already trust the app and may move up a plan.");
      await section.getByRole("button", { name: "Save the audiences" }).click();
      await expect(toast(page, "Saved as version 2.")).toBeVisible({ timeout: 30_000 });
      const shown = page.locator("[data-section=audiences]").filter({ visible: true }).locator("[data-audience]");
      await expect(shown).toHaveCount(2);
      await signOffVersion(page, 2);
    });

    await step(page, "F-27.4: with two audiences, the cost on Make creative is unchanged (pictures are shared, the words are one Copy run)", async () => {
      await openStage(page, "creative", path);
      const twoAudienceCost = ((await makeButton().textContent()) ?? "").replace(/\s+/g, " ").trim();
      expect(twoAudienceCost).toBe(oneAudienceCost);
    });

    await step(page, "F-27.1: Make creative gives 24 paid-social ads, 12 under each audience's heading", async () => {
      await makeCreative(page, 24);
      await expect(groups(page)).toHaveCount(2);
      for (let i = 0; i < 2; i++) {
        await expect(groups(page).nth(i).getByRole("heading", { level: 3 })).toHaveText(/^For .+ \(12 ads\)$/);
        await expect(groups(page).nth(i).locator('[data-gallery] > li[data-channel="paid social"]')).toHaveCount(12);
      }
      titles = await groups(page).getByRole("heading", { level: 3 }).allTextContents();
      expect(new Set(titles).size).toBe(2);
      await groups(page).nth(1).scrollIntoViewIfNeeded();
      await checkWidths(page, "ads grouped by audience");
    });

    await step(page, "F-27.2: New words on an ad of the second audience: the new words wait beside the four ads on those words only", async () => {
      const firstBefore = await idsIn(page, 0);
      const secondBefore = await idsIn(page, 1);
      const card = groups(page).nth(1).locator("[data-gallery] > li").first();
      await card.scrollIntoViewIfNeeded();
      // U10-3: New words is in the card's Edit menu.
      await openAdMenu(card, "edit");
      await card.getByRole("button", { name: /^New words for ad \d+, (about \d+p|under 1p)/ }).click();
      // The mock Copy agent writes them through Inngest; the page shows them when the run ends.
      await untilShown(page, () => expect(groups(page).nth(1).locator("[data-pending-words]")).toHaveCount(4, { timeout: 10_000 }), 180_000);
      await expect(groups(page).nth(0).locator("[data-pending-words]")).toHaveCount(0);

      await step(page, "Keep the new words: only those four ads are redrawn; the first audience's ads are untouched", async () => {
        await card.locator("[data-pending-words]").getByRole("button", { name: "Keep the new words" }).click();
        await expect(toast(page, "New words kept. 4 ads now use them.")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("[data-pending-words]")).toHaveCount(0);
        expect(await idsIn(page, 0)).toEqual(firstBefore);
        const secondAfter = await idsIn(page, 1);
        expect(secondAfter).toHaveLength(12);
        expect(secondAfter.filter((id) => !secondBefore.includes(id))).toHaveLength(4);
        expect(secondBefore.filter((id) => !secondAfter.includes(id))).toHaveLength(4);
        await expect(groups(page).getByRole("heading", { level: 3 })).toHaveText(titles);
      });
    });
  },
);
