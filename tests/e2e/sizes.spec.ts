// C7-1 Sizes through the UI, with the mock models. A Fernhollow brief with
// paid social and display (display added by hand, then signed off) gets its
// ads; Sizes on a social ad lists the four social sizes and Sizes on a display
// ad the three banners, each drawn full size with its checks and the
// "Simulated image" label (test cases 1, 2 and 5); an unknown size and a size
// from the other channel are 404s (test case 7). On a Quillmoor display ad the
// leaderboard is left out with the reason and the other banners still draw
// (test case 4). Each page at 375 px and 1440 px: nothing scrolls sideways, AA
// contrast. SHOTS_DIR=<folder> saves screenshots. The mock picture is
// simulated, and every ad says so.
import { expect, test, type Page } from "@playwright/test";
import {
  adTool,
  contrastViolations,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  overviewPath,
  saveShot,
  settle,
  signIn,
  signOffVersion,
  step,
} from "./helpers";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const ads = (page: Page, channel: "paid social" | "display") => page.locator(`[data-gallery] > li[data-channel="${channel}"]`);
const sizeCard = (page: Page, id: string) => page.locator(`[data-size="${id}"]`);

const SOCIAL = [
  ["1080x1080", "1:1 square", 1080, 1080],
  ["1080x1350", "4:5 portrait", 1080, 1350],
  ["1080x1920", "9:16 story", 1080, 1920],
  ["1200x628", "1.91:1 landscape", 1200, 628],
] as const;
const BANNERS = [
  ["300x250", "Medium rectangle", 300, 250],
  ["300x600", "Half page", 300, 600],
  ["728x90", "Leaderboard", 728, 90],
] as const;

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    await saveShot(page, `${what}-${width}`, { fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** A signed-off brief for the brand with display added to its channels, and its 24 ads (12 social, 12 display). */
async function campaignWithDisplay(page: Page, brand: "Fernhollow Outfitters" | "Quillmoor Money", objective: string) {
  await step(page, `Write a ${brand} brief with the mock Brief agent`, async () => {
    await newCampaign(page, brand, objective);
  });
  await step(page, "Add display to the brief's channels and sign version 2 off", async () => {
    await page.getByRole("button", { name: "Edit the channels" }).click();
    const channels = page.locator("[data-section=channels]").filter({ visible: true });
    await channels.getByRole("button", { name: "Add a channel" }).click();
    await channels.getByLabel("Channel 3", { exact: true }).selectOption({ label: "Display" });
    await channels.getByLabel("Role of channel 3").fill("Remind them on the sites they read.");
    await channels.getByRole("button", { name: "Save the channels" }).click();
    await expect(toast(page, "Saved as version 2.")).toBeVisible({ timeout: 30_000 });
    await signOffVersion(page, 2);
  });
  await step(page, "Make creative: 12 paid-social and 12 display ads (simulated pictures)", async () => {
    await makeCreative(page, 24);
    await expect(ads(page, "paid social")).toHaveCount(12);
    await expect(ads(page, "display")).toHaveCount(12);
  });
}

/** Every drawing on the Sizes page loaded at its own full size (the thumbnail is the full PNG, scaled down). */
async function drawnSizes(page: Page): Promise<string[]> {
  return page.locator("[data-size] img").evaluateAll(async (imgs) => {
    await Promise.all((imgs as HTMLImageElement[]).map((i) => ((i.loading = "eager"), i.decode().catch(() => undefined))));
    return (imgs as HTMLImageElement[]).map((i) => `${i.naturalWidth}x${i.naturalHeight}`);
  });
}

async function expectDrawnWithChecks(page: Page, id: string, name: string) {
  const card = sizeCard(page, id);
  await expect(card.getByRole("heading", { level: 3 })).toHaveText(name);
  await expect(card).toHaveAttribute("data-size-ok", "");
  await expect(card.locator("[data-badge=contrast]")).toHaveText(/^Contrast \d+(\.\d)?:1$/);
  await expect(card.locator("[data-badge=fit]")).toHaveText(`Fits ${name}`);
  await expect(card.locator("[data-badge=legal]")).toHaveText("Legal lines");
  await expect(card.locator("[data-badge=simulated]")).toHaveText("Simulated image");
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "C7-1 #1, #2, #5, #7: Sizes on a social ad and a display ad, every size listed with its checks and drawn full size",
  {
    annotation: [
      { type: "case", description: "C7-1.1" },
      { type: "case", description: "C7-1.2" },
      { type: "case", description: "C7-1.5" },
      { type: "case", description: "C7-1.7" },
    ],
  },
  async ({ page }) => {
    test.setTimeout(600_000);
    await campaignWithDisplay(page, "Fernhollow Outfitters", "Bring lapsed customers back for the winter range in every size");
    // The ads are on the Creative stage; their pages are under the campaign's overview path (U10-2).
    const campaignPath = overviewPath(page.url());
    const socialId = (await ads(page, "paid social").first().getAttribute("data-ad"))!;
    const displayId = (await ads(page, "display").first().getAttribute("data-ad"))!;

    await step(page, "C7-1.1: open Sizes on a paid-social ad: the four social sizes, each with contrast, fit, legal lines and the simulated label", async () => {
      // U10-3: Sizes is in the card's More menu.
      await (await adTool(ads(page, "paid social").first(), "sizes")).click();
      await page.waitForURL(new RegExp(`${campaignPath}/ads/${socialId}/sizes$`));
      await settle(page);
      await expect(page.getByRole("heading", { name: "Sizes", level: 2 })).toBeVisible();
      await expect(page.locator("[data-size]")).toHaveCount(4);
      await expect(page.locator("[data-size]")).toHaveText(SOCIAL.map(([, name]) => new RegExp(name.replace(/\./g, "\\."))));
      await expect(page.locator("[data-sizes-summary]")).toHaveText("Drawn in all 4 sizes of its channel, with the same words, logo and legal lines.");
      for (const [id, name] of SOCIAL) await expectDrawnWithChecks(page, id, name);
    });

    await step(page, "Every social size is drawn at its full size, and the 9:16 story opens full size in a new tab", async () => {
      expect(await drawnSizes(page)).toEqual(SOCIAL.map(([, , w, h]) => `${w}x${h}`));
      const [tab] = await Promise.all([page.waitForEvent("popup"), sizeCard(page, "1080x1920").getByRole("link").click()]);
      await tab.waitForLoadState();
      expect(new URL(tab.url()).pathname).toBe(`/ads/${socialId}/1080x1920.png`);
      expect(await tab.locator("img").evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([1080, 1920]);
      await tab.waitForTimeout(1500); // long enough to see in the recording
      await tab.close();
      await checkWidths(page, "sizes of a social ad");
    });

    await step(page, "C7-1.7: an unknown size, or a banner size of a social ad, is not found", async () => {
      for (const size of ["999x999", "728x90", "300x250"]) {
        expect((await page.request.get(`/ads/${socialId}/${size}.png`)).status(), size).toBe(404);
      }
      expect((await page.request.get(`/ads/${displayId}/1080x1920.png`)).status(), "a social size of a display ad").toBe(404);
    });

    await step(page, "C7-1.2 and C7-1.5: open Sizes on a display ad: the three banners, each drawn with its checks and the simulated label", async () => {
      await page.goto(`${campaignPath}/ads/${displayId}/sizes`);
      await settle(page);
      await expect(page.locator("[data-size]")).toHaveCount(3);
      await expect(page.locator("[data-sizes-summary]")).toHaveText("Drawn in all 3 sizes of its channel, with the same words, logo and legal lines.");
      for (const [id, name] of BANNERS) await expectDrawnWithChecks(page, id, name);
      expect(await drawnSizes(page)).toEqual(BANNERS.map(([, , w, h]) => `${w}x${h}`));
      await checkWidths(page, "sizes of a display ad");
    });
  },
);

test(
  "C7-1 #4: a size the legal lines don't fit is left out with the reason, and the other sizes still draw",
  { annotation: [{ type: "case", description: "C7-1.4" }] },
  async ({ page }) => {
    test.setTimeout(540_000);
    await campaignWithDisplay(page, "Quillmoor Money", "Bring lapsed savers back to the Plus plan on every site they read");
    // The ads are on the Creative stage; their pages are under the campaign's overview path (U10-2).
    const campaignPath = overviewPath(page.url());
    const displayId = (await ads(page, "display").first().getAttribute("data-ad"))!;

    await step(page, "C7-1.4: Sizes on a Quillmoor display ad: its three legal lines don't fit the 728 × 90 leaderboard, so it is left out with the reason", async () => {
      await page.goto(`${campaignPath}/ads/${displayId}/sizes`);
      await settle(page);
      await expect(page.locator("[data-size]")).toHaveCount(3);
      await expect(page.locator("[data-sizes-summary]")).toHaveText("Drawn in 2 of 3 sizes. One size is left out, with the reason below.");
      const leaderboard = sizeCard(page, "728x90");
      await expect(leaderboard).not.toHaveAttribute("data-size-ok", "");
      await expect(leaderboard.locator("[data-size-refused]")).toContainText("Left out");
      await expect(leaderboard.locator("[data-size-refused] p")).toHaveText("The legal lines don't fit a 728 × 90 leaderboard at a readable size.");
      await expect(leaderboard.getByRole("img", { name: "Leaderboard is not drawn" })).toBeVisible();
      const refused = await page.request.get(`/ads/${displayId}/728x90.png`);
      expect(refused.status()).toBe(422);
      expect(await refused.text()).toBe("This size can't be drawn: the legal lines don't fit a 728 × 90 leaderboard at a readable size.");
    });

    await step(page, "The medium rectangle and the half page still draw, with their checks", async () => {
      for (const [id, name] of BANNERS.slice(0, 2)) await expectDrawnWithChecks(page, id, name);
      expect(await drawnSizes(page)).toEqual(["300x250", "300x600"]);
      await checkWidths(page, "sizes with one left out");
    });
  },
);
