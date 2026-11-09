// C7-2 Languages through the UI, with the mock models: the demo brand's
// Languages page (French, German and Spanish, written for the demo), then on
// a signed-off Quillmoor campaign with ads, Translate on a picked ad (its cost
// on the button), the ad's three translations on every ad with the same words,
// badged "Machine translation (simulated)", with the German translation's own
// legal lines in the ad's details (test cases 1, 6 and 8), and the German ad
// drawn in all four sizes of its channel, each with its fit, contrast and
// legal-line checks (test case 2). Then, on Fernhollow, German legal lines
// cleared on the Languages page leave German out with the reason beside
// Translate, and are put back (test case 5; tagged @brand-kit, so it runs in the
// brand-kit project, after every other spec and one at a time). Each
// page at 375 px and 1440 px: nothing scrolls sideways, AA contrast.
// SHOTS_DIR=<folder> saves a screenshot of each.
import { expect, test, type Page } from "@playwright/test";
import {
  caption,
  contrastViolations,
  demoBrandId,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  openStage,
  saveShot,
  settle,
  signIn,
  signOffVersion,
  stagePath,
  step,
  untilShown,
} from "./helpers";

const OBJECTIVE = "Bring lapsed savers back to the Plus plan in January";
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const creative = (page: Page) => page.locator("[data-creative]");
const ads = (page: Page) => page.locator("[data-gallery] > li");

/** The four paid-social sizes: id, name, width and height. */
const SOCIAL = [
  ["1080x1080", "1:1 square", 1080, 1080],
  ["1080x1350", "4:5 portrait", 1080, 1350],
  ["1080x1920", "9:16 story", 1080, 1920],
  ["1200x628", "1.91:1 landscape", 1200, 628],
] as const;

/** Quillmoor's German legal lines, written for the demo (src/lib/creative/languages.ts). */
const GERMAN_LEGAL = [
  "Sparzinsen sind variabel und können sich ändern.",
  "Gebühren für Plus und Premium: siehe Preisliste in der App.",
  "Quillmoor Money ist ein fiktives Unternehmen für die Demo.",
];

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

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("C7-2: the demo brand's languages, Translate on a picked ad, machine-translation badges and the German ad in every size", { annotation: [{ type: "case", description: "C7-2.1" }, { type: "case", description: "C7-2.2" }, { type: "case", description: "C7-2.6" }, { type: "case", description: "C7-2.8" }] }, async ({ page }) => {
  test.setTimeout(600_000);
  const brandId = await demoBrandId(page, "Quillmoor Money");

  // Q3/Q4: the demo brand's languages, with legal lines written for the demo.
  await caption(page, "The demo brand's languages: French, German and Spanish, legal lines written for the demo");
  await page.goto(`/brands/${brandId}/languages`);
  await settle(page);
  await expect(page.getByRole("heading", { name: "Languages", level: 1 })).toBeVisible();
  for (const name of ["French", "German", "Spanish"]) {
    await expect(page.getByRole("checkbox", { name: `Translate ads into ${name}` })).toBeChecked();
  }
  await expect(page.locator("[data-language-form]").getByText("Written for the demo", { exact: true })).toHaveCount(3);
  await expect(page.getByLabel("German legal lines")).toHaveValue(GERMAN_LEGAL.join("\n"));
  await checkWidths(page, "languages page");

  // A signed-off campaign with ads.
  await caption(page, "A signed-off Quillmoor brief, then Make creative (simulated pictures)");
  await page.goto("/campaigns");
  await settle(page);
  await page.getByLabel("Brand").selectOption({ label: "Quillmoor Money" });
  await page.getByLabel("Objective").fill(OBJECTIVE);
  await page.getByRole("button", { name: "Write the brief" }).click();
  // It opens on the overview (U10-2); the brief and its sign-off are on the Brief stage.
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  const path = new URL(page.url()).pathname;
  await openStage(page, "brief", path);
  await untilShown(page, () => expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible({ timeout: 10_000 }), 60_000);
  const panel = page.locator("[data-signoff-panel]").filter({ visible: true });
  await panel.getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await expect(toast(page, "Sent for sign-off")).toBeVisible();
  await panel.getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();
  // The ads are made on the Creative stage, opened afresh after the sign-off.
  await openStage(page, "creative", path);
  await creative(page).getByRole("button", { name: /^Make creative/ }).click();
  await untilShown(page, () => expect(ads(page)).toHaveCount(12, { timeout: 10_000 }));

  // Before anything is picked, Translate the picked ads says why it can't run.
  await caption(page, "Before anything is picked, Translate says why it can't run");
  const bar = page.locator("[data-languages]");
  await expect(bar.locator("[data-language]")).toHaveText(["French", "German", "Spanish"]);
  await expect(bar.getByRole("button", { name: /^Translate the picked ads/ })).toBeDisabled();
  await expect(bar.locator("[data-translate-reason]")).toHaveText("Pick ads first: Translate works on the picked ads.");

  // #1, #6, #8: Translate on a picked ad, its cost on the button; three machine translations, simulated.
  await caption(page, "C7-2.1, C7-2.6, C7-2.8: pick an ad and Translate it: three machine translations, labelled simulated");
  const first = ads(page).first();
  const words = (await first.getAttribute("data-words"))!;
  expect(words).toMatch(/^[0-9a-f-]{36}$/);
  await first.getByRole("button", { name: "Pick ad 1" }).click();
  // Server actions re-render the campaign page; on a busy dev server that can take several seconds.
  await expect(toast(page, "Picked for the shortlist.")).toBeVisible({ timeout: 30_000 });
  const translate = first.getByRole("button", { name: /^Translate\s*\((about \d+p|under 1p), at most \d+p\)$/ });
  await expect(translate).toBeEnabled({ timeout: 30_000 });
  await translate.click();
  await expect(toast(page, /^Translating\./)).toBeVisible({ timeout: 30_000 });
  await untilShown(page, () => expect(first.locator("[data-translation]")).toHaveCount(3, { timeout: 10_000 }), 180_000);
  await expect(first.locator("[data-translation]")).toHaveText([/French/, /German/, /Spanish/]);
  await expect(first.locator("[data-badge=translation]")).toHaveText("Machine translation (simulated)");
  const drawn = await first.locator("[data-translation] img").evaluateAll(async (imgs) => {
    await Promise.all((imgs as HTMLImageElement[]).map((i) => ((i.loading = "eager"), i.decode().catch(() => undefined))));
    return (imgs as HTMLImageElement[]).map((i) => i.naturalWidth);
  });
  expect(drawn).toEqual([1080, 1080, 1080]);

  // Every ad on the same words shows the three translations too; ads on other words show none.
  const sameWords = page.locator(`[data-gallery] > li[data-words="${words}"]`);
  await expect(sameWords).toHaveCount(4);
  for (const card of await sameWords.all()) {
    await expect(card.locator("[data-translation]")).toHaveText([/French/, /German/, /Spanish/]);
    await expect(card.locator("[data-badge=translation]")).toHaveText("Machine translation (simulated)");
  }
  await expect(page.locator(`[data-gallery] > li:not([data-words="${words}"]) [data-translation]`)).toHaveCount(0);

  // #1: the German translation carries the kit's German legal lines (never machine-translated), shown in the ad's details.
  await caption(page, "C7-2.1: the German translation carries the brand's German legal lines");
  await first.locator("summary").filter({ hasText: "About ad 1" }).click();
  const german = first.locator("[data-translation-words=de-DE]");
  await expect(german).toBeVisible();
  await expect(german).toContainText("German (machine translation (simulated)):");
  await expect(german).toContainText(`Legal lines: ${GERMAN_LEGAL.join(" ")}`);
  await checkWidths(page, "gallery with translations");

  // #2: the German ad in every size of its channel, badged, with the language switcher.
  await caption(page, "C7-2.2: the German ad drawn in all four sizes of its channel, each with its checks");
  await first.locator("[data-translation=de-DE] a").click();
  await page.waitForURL(/\/sizes\?lang=de-DE$/);
  await settle(page);
  await expect(page.locator("[data-machine-translation]")).toContainText("Machine translation (simulated).");
  await expect(page.getByRole("navigation", { name: "Languages of this ad" }).getByRole("link")).toHaveText(["English", "French", "German", "Spanish"]);
  await expect(page.getByRole("navigation", { name: "Languages of this ad" }).getByRole("link", { name: "German", exact: true })).toHaveAttribute("aria-current", "page");
  // The mock's German fits every social size: all four are drawn, none is left out.
  await expect(page.locator("[data-size]")).toHaveCount(4);
  await expect(page.locator("[data-size][data-size-ok]")).toHaveCount(4);
  await expect(page.locator("[data-sizes-summary]")).toHaveText("Drawn in all 4 sizes of its channel, with the same words, logo and legal lines.");
  for (const [id, name] of SOCIAL) {
    const card = page.locator(`[data-size="${id}"]`);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(name);
    await expect(card.locator("[data-badge=fit]")).toHaveText(`Fits ${name}`);
    await expect(card.locator("[data-badge=contrast]")).toHaveText(/^Contrast \d+(\.\d)?:1$/);
    await expect(card.locator("[data-badge=contrast]")).toHaveAttribute("title", /\(AA\)\.$/);
    // Every one of the German legal lines is drawn in this size.
    await expect(card.locator("[data-badge=legal]")).toHaveText("Legal lines");
    await expect(card.locator("[data-badge=legal]")).toHaveAttribute("title", `Every legal line is drawn (${GERMAN_LEGAL.length} lines).`);
    await expect(card.locator("[data-badge=translation]")).toHaveText("Machine translation (simulated)");
    await expect(card.locator("img")).toHaveAttribute("src", new RegExp(`/${id}\\.png\\?lang=de-DE$`));
  }
  // Each size is drawn at its own full size (the thumbnail is the full PNG, scaled down).
  const natural = await page.locator("[data-size] img").evaluateAll(async (imgs) => {
    await Promise.all((imgs as HTMLImageElement[]).map((i) => ((i.loading = "eager"), i.decode().catch(() => undefined))));
    return (imgs as HTMLImageElement[]).map((i) => `${i.naturalWidth}x${i.naturalHeight}`);
  });
  expect(natural).toEqual(SOCIAL.map(([, , w, h]) => `${w}x${h}`));
  await checkWidths(page, "German sizes");
});

test(
  "C7-2 #5: a brand with no German legal lines leaves German out, and the Languages bar says why",
  { tag: "@brand-kit", annotation: [{ type: "case", description: "C7-2.5" }] },
  async ({ page }) => {
    test.setTimeout(480_000);
    // Clearing Fernhollow's German legal lines for a moment: compliance.spec also translates Fernhollow, so this test is
    // tagged @brand-kit and runs in the brand-kit project, after every other spec and never beside another kit change.
    const brandId = await demoBrandId(page, "Fernhollow Outfitters");
    const bar = page.locator("[data-languages]");
    let campaignPath = "";

    await step(page, "A signed-off Fernhollow brief and its ads (simulated pictures)", async () => {
      campaignPath = stagePath(await newCampaign(page, "Fernhollow Outfitters", "Win back lapsed customers for the winter range in three more languages"), "creative");
      await signOffVersion(page, 1);
      await makeCreative(page, 12);
    });

    await step(page, "Pick an ad: French, German and Spanish are all offered", async () => {
      await ads(page).first().getByRole("button", { name: "Pick ad 1" }).click();
      await expect(toast(page, "Picked for the shortlist.")).toBeVisible({ timeout: 30_000 });
      await expect(bar.locator("[data-language]")).toHaveText(["French", "German", "Spanish"]);
      await expect(bar.getByRole("button", { name: /^Translate the picked ads/ })).toBeEnabled({ timeout: 30_000 });
      await expect(bar.locator("[data-translate-note]")).toHaveCount(0);
    });

    try {
      await step(page, "Clear Fernhollow's German legal lines on its Languages page and save", async () => {
        await page.goto(`/brands/${brandId}/languages`);
        await settle(page);
        await expect(page.getByLabel("German legal lines")).not.toHaveValue("");
        await page.getByLabel("German legal lines").fill("");
        await expect(page.locator("[data-language-form=de-DE] [data-no-legal]")).toHaveText("Without German legal lines, ads can't be translated into German.");
        await page.getByRole("button", { name: "Save languages" }).click();
        await expect(toast(page, /^Saved\./)).toBeVisible({ timeout: 30_000 });
      });

      await step(page, "C7-2.5: back on the campaign, German is left out and the reason shows beside Translate", async () => {
        await page.goto(campaignPath);
        await settle(page);
        await expect(bar.locator("[data-language=de-DE]")).toHaveText("German: no legal lines");
        const note = bar.locator("[data-translate-note]");
        await expect(note).toHaveText(/^German is left out: .*no German legal lines, so its ads can't go out in German/);
        // French and Spanish still have their legal lines, so Translate still works for them.
        await expect(bar.getByRole("button", { name: /^Translate the picked ads/ })).toBeEnabled();
        await expect(bar.getByRole("button", { name: /^Translate the picked ads/ })).toHaveAttribute("aria-describedby", (await note.getAttribute("id"))!);
        await bar.scrollIntoViewIfNeeded();
        await checkWidths(page, "German left out");
      });
    } finally {
      await step(page, "Put Fernhollow's German back, with the legal lines written for the demo", async () => {
        await page.goto(`/brands/${brandId}/languages`);
        await settle(page);
        // Leaving German out and adding the demo languages again restores its lines, marked as written for the demo.
        const german = page.getByRole("checkbox", { name: "Translate ads into German" });
        if (await german.isChecked()) {
          await german.uncheck();
          await page.getByRole("button", { name: "Save languages" }).click();
          await expect(toast(page, "Saved. Ads can be translated into French and Spanish.")).toBeVisible({ timeout: 30_000 });
        }
        await page.getByRole("button", { name: "Add the demo languages" }).click();
        await expect(toast(page, /^Added 1 demo language/)).toBeVisible({ timeout: 30_000 });
        await page.reload();
        await settle(page);
        await expect(page.getByRole("checkbox", { name: "Translate ads into German" })).toBeChecked();
        await expect(page.getByLabel("German legal lines")).not.toHaveValue("");
        await expect(page.locator("[data-language-form]").getByText("Written for the demo", { exact: true })).toHaveCount(3);
      });
    }
  },
);
