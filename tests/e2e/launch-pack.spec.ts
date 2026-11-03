// C7-3 Launch pack through the UI, with the mock models: on a signed-off
// Quillmoor campaign with ads, the pack says why there is none before anything
// is picked (test case 4); then the story's demo: pick four paid-social ads,
// translate them, and the gallery shows the pack's contents and file count
// (64 ads: four ads × four social sizes × four languages); Build launch pack
// downloads one zip, which is unzipped and checked entry by entry (test cases
// 1, 2, 5 and 6). The time from click to a complete download and the zip's size
// are recorded as the test's "measure" annotation, shown on the demo page, and
// must be under 120 s and 50 MB (test case 5). C8-1: before the pack, each of
// Quillmoor's don't rules is accepted for every picked ad on the campaign, so
// every file passes and the pack still holds all 64. Each page at 375 px and 1440 px:
// nothing scrolls sideways, AA contrast. SHOTS_DIR=<folder> saves screenshots.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { acceptDontRulesForPicked, caption, contrastViolations, expectNoHorizontalScroll, saveShot, settle, signIn, untilShown } from "./helpers";

const OBJECTIVE = "Bring lapsed savers back to the Plus plan with a launch pack";
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const creative = (page: Page) => page.locator("[data-creative]");
const ads = (page: Page) => page.locator("[data-gallery] > li");
const pack = (page: Page) => page.locator("[data-launch-pack]");

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    if (process.env.SHOTS_DIR) {
      await pack(page).scrollIntoViewIfNeeded();
      await saveShot(page, `${what}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("C7-3: the launch pack of four picked social ads in four languages downloads as one zip of 64 ads with its manifests", { annotation: [{ type: "case", description: "C7-3.1" }, { type: "case", description: "C7-3.2" }, { type: "case", description: "C7-3.4" }, { type: "case", description: "C7-3.5" }, { type: "case", description: "C7-3.6" }, { type: "case", description: "C7-2.6" }] }, async ({ page }) => {
  test.setTimeout(900_000);

  // A signed-off Quillmoor campaign with ads.
  await caption(page, "A signed-off Quillmoor brief, then Make creative (simulated pictures)");
  await page.goto("/campaigns");
  await settle(page);
  await page.getByLabel("Brand").selectOption({ label: "Quillmoor Money" });
  await page.getByLabel("Objective").fill(OBJECTIVE);
  await page.getByRole("button", { name: "Write the brief" }).click();
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  const campaignPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible({ timeout: 60_000 });
  const panel = page.locator("[data-signoff-panel]").filter({ visible: true });
  await panel.getByRole("button", { name: "Send version 1 for sign-off" }).click();
  await expect(toast(page, "Sent for sign-off")).toBeVisible();
  await panel.getByRole("button", { name: "Approve version 1" }).click();
  await expect(toast(page, "Version 1 signed off.")).toBeVisible();
  // Read the signed-off page afresh (as F-26 does): on a slow dev server the action's re-render can lag.
  await page.reload();
  await settle(page);
  await creative(page).getByRole("button", { name: /^Make creative/ }).click();
  await untilShown(page, () => expect(ads(page)).toHaveCount(12, { timeout: 10_000 }));

  await caption(page, "C7-3.4: nothing picked yet: the pack says why, and offers no download");
  // #4: nothing picked yet: the pack says why, and offers no download; the address refuses too.
  await expect(pack(page).locator("[data-pack-reason]")).toHaveText(
    "There's no launch pack yet: nothing is picked. Pick the ads to launch in the gallery, then build the pack.",
  );
  await expect(pack(page).locator("[data-pack-download]")).toHaveCount(0);
  const refused = await page.request.get(`${campaignPath}/pack.zip`);
  expect(refused.status()).toBe(409);
  await checkWidths(page, "launch pack, nothing picked");

  // The demo: pick four paid-social ads, then translate the pick.
  await caption(page, "The sprint demo: pick four paid-social ads and translate them into French, German and Spanish");
  const social = page.locator('[data-gallery] > li[data-channel="paid social"]');
  expect(await social.count()).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 4; i++) {
    const card = social.nth(i);
    const title = (await card.locator("h3, h4").first().textContent())!.trim();
    await card.getByRole("button", { name: `Pick ${title.toLowerCase()}` }).click();
    await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
  }
  const bar = page.locator("[data-languages]");
  await bar.getByRole("button", { name: /^Translate the picked ads/ }).click();
  await untilShown(
    page,
    async () => {
      for (let i = 0; i < 4; i++) await expect(social.nth(i).locator("[data-translation]")).toHaveCount(3, { timeout: 10_000 });
    },
    240_000,
  );

  // C8-1: no code can check the brand's don't rules, so a person accepts each, here for every picked ad at once.
  await caption(page, "C8-1: each of the brand's don't rules accepted for every picked ad");
  await page.reload();
  await acceptDontRulesForPicked(page);

  await caption(page, "C7-3.1: the gallery shows what the pack holds: 64 ads, 67 files");
  // #1: the gallery shows what the pack will hold and its file count before download.
  await page.reload();
  await settle(page);
  await expect(pack(page).locator("[data-pack-count]")).toContainText("64 ads from 4 picked ads");
  await expect(pack(page).locator("[data-pack-count]")).toContainText("67 files in one zip");
  await expect(pack(page).locator("[data-pack-language]")).toHaveText(["English: 16", "French: 16", "German: 16", "Spanish: 16"]);
  const download = pack(page).getByRole("link", { name: "Build launch pack (64 ads)" });
  await expect(download).toBeVisible();
  await checkWidths(page, "launch pack, four picked ads");

  await caption(page, "C7-3.5: Build launch pack downloads one zip; then every file, both manifests and the README are checked");
  // #5: the pack downloads completely; time and size measured.
  const started = Date.now();
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toMatch(/^quillmoor-money-launch-pack-\d{4}-\d\d-\d\d\.zip$/);
  const path = await file.path();
  const seconds = (Date.now() - started) / 1000;
  const bytes = await readFile(path);
  // The measurement (test case 5) goes on the demo page as this test's annotation, and has generous limits.
  const measured = `64-ad demo pack: ${seconds.toFixed(1)} s from click to complete download, ${(bytes.length / 1e6).toFixed(1)} MB`;
  test.info().annotations.push({ type: "measure", description: measured });
  console.log(`[pack] ${measured}`);
  expect(seconds, measured).toBeLessThan(120);
  expect(bytes.length, measured).toBeLessThan(50e6);

  // #1, #2, #6: the zip's entries, both manifests and the README.
  const entries = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(entries);
  const pngs = names.filter((n) => n.endsWith(".png"));
  expect(pngs).toHaveLength(64);
  expect(names.filter((n) => !n.endsWith(".png")).sort()).toEqual(["README.txt", "manifest.csv", "manifest.json"]);
  for (const lang of ["en-GB", "fr-FR", "de-DE", "es-ES"]) {
    for (const size of ["1080x1080", "1080x1350", "1080x1920", "1200x628"]) {
      expect(pngs.filter((p) => p.startsWith(`paid-social/${lang}/`) && p.includes(`-${size}`)), `${lang} ${size}`).toHaveLength(4);
    }
  }
  for (const p of pngs) {
    const png = entries[p];
    // The PNG signature, then the width and height from its header.
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const view = new DataView(png.buffer, png.byteOffset);
    const [w, h] = /-(\d+)x(\d+)/.exec(p)!.slice(1).map(Number);
    expect([view.getUint32(16), view.getUint32(20)], p).toEqual([w, h]);
  }
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  expect(manifest.files.map((f: { file: string }) => f.file).sort()).toEqual([...pngs].sort());
  expect(manifest.leftOut).toEqual([]);
  for (const f of manifest.files) {
    expect(f.labels, f.file).toContain("Simulated image");
    if (f.language.tag !== "en-GB") expect(f.labels, f.file).toContain("Machine translation (simulated)");
    expect(f.checks.fit.passed).toBe(true);
    expect(f.headline.length).toBeGreaterThan(0);
    // C8-1: every file passed its compliance rules, or a person accepted each review item.
    expect(f.compliance.outcome, f.file).toBe("accepted");
  }
  const csvRows = strFromU8(entries["manifest.csv"]).trim().split("\r\n");
  expect(csvRows).toHaveLength(65);
  const readme = strFromU8(entries["README.txt"]);
  expect(readme).toContain("Simulated images: 64 files");
  expect(readme).toContain("Machine translation: 48 files");
  // Review fixes 5 and 6: the demo's legal lines are marked, and the demo brand is said to be fictional.
  expect(readme).toContain("Legal lines written for the demo: 48 files");
  expect(readme).toContain("The brand in this pack is fictional.");
  for (const f of manifest.files) expect(f.legalLinesWrittenForDemo, f.file).toBe(f.language.tag !== "en-GB");
});
