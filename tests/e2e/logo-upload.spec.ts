// F-10 through the UI: the brand editor's logo upload. An SVG with harmless
// "https" and "data:" text and no xmlns is accepted and shown on a light and a
// dark background; hostile files are refused with the reason and nothing
// changes; a PNG is accepted (re-encoded); Remove logo removes it. The brand
// page shows each brand font's open-font mapping (S5-3, Q7). Fernhollow ends
// with its own logo uploaded again, so later specs see it as before.
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, settle, signIn } from "./helpers";

const GOOD_SVG = `<svg viewBox="0 0 120 40" id="https-badge" aria-label="data: chart"><rect width="120" height="40" rx="8" fill="#3F5B3A"/><circle cx="20" cy="20" r="10" fill="#F2C14E"/></svg>`;
const SCRIPT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>`;
const ONLOAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10"/></svg>`;
const LINKED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.test/x.png" width="10" height="10"/></svg>`;

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const section = (page: Page) => page.locator("[data-logo-upload]");
const fileInput = (page: Page) => section(page).getByLabel(/^(Upload a logo|Replace the logo)$/);
const upload = (page: Page) => section(page).getByRole("button", { name: "Upload logo" });

async function choose(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await fileInput(page).setInputFiles({ name, mimeType, buffer });
  await upload(page).click();
}

async function expectRefused(page: Page, reason: string | RegExp) {
  const err = section(page).locator("[data-logo-error]");
  await expect(err).toContainText(reason);
  await expect(err).toContainText("Nothing was changed.");
  await expect(fileInput(page)).toHaveAttribute("aria-invalid", "true");
}

/** The two previews' image addresses (light and dark). */
const previews = (page: Page) => section(page).locator("[data-logo-preview] img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("F-10: logo upload accepts SVG and PNG, refuses hostile files with the reason, and removes", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await demoBrandId(page, "Fernhollow Outfitters");
  let original = GOOD_SVG;
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    const [b] = await sql`select logo_svg from public.brands where id = ${id}`;
    await sql.end();
    if (b?.logo_svg) original = b.logo_svg as string;
  }
  await page.goto(`/brands/${id}/edit`);
  await settle(page);
  await expect(section(page).getByRole("heading", { name: "Logo" })).toBeVisible();
  await expect(section(page).getByText("On a light background")).toBeVisible();
  await expect(section(page).getByText("On a dark background")).toBeVisible();

  // F-10 #1 and #3: harmless "https" and "data:" text is accepted; the missing xmlns is added, so it displays.
  await choose(page, "badge.svg", "image/svg+xml", Buffer.from(GOOD_SVG));
  await expect(toast(page, "Logo uploaded. New ads will use it.")).toBeVisible();
  const svgSrcs = await previews(page);
  expect(svgSrcs).toHaveLength(2);
  expect(decodeURIComponent(svgSrcs[0])).toContain('xmlns="http://www.w3.org/2000/svg"');
  for (const img of await section(page).locator("[data-logo-preview] img").all()) {
    await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }

  // F-10 #2 and #5: hostile files are refused with the reason, and the logo stays as it was.
  await choose(page, "script.svg", "image/svg+xml", Buffer.from(SCRIPT_SVG));
  await expectRefused(page, "This logo can't be used: it contains a script.");
  await choose(page, "onload.svg", "image/svg+xml", Buffer.from(ONLOAD_SVG));
  await expectRefused(page, "it contains an event handler (such as onload)");
  await choose(page, "linked.svg", "image/svg+xml", Buffer.from(LINKED_SVG));
  await expectRefused(page, "it contains an embedded or linked picture");
  await choose(page, "logo.png", "image/png", Buffer.from("#!/bin/sh\necho hello\n"));
  await expectRefused(page, "This file is named .png but isn't a PNG picture");
  await choose(page, "huge.png", "image/png", Buffer.alloc(5 * 1024 * 1024, 1));
  await expectRefused(page, "The PNG is too large (1 MB at most).");
  expect(await contrastViolations(page), "logo upload with a refusal").toEqual([]);
  expect(await previews(page)).toEqual(svgSrcs);
  await page.reload();
  await settle(page);
  expect(await previews(page)).toEqual(svgSrcs);

  // A PNG is accepted, re-encoded and served from the asset store.
  const png = await sharp({ create: { width: 300, height: 100, channels: 4, background: "#3F5B3A" } }).png().toBuffer();
  await choose(page, "logo.png", "image/png", png);
  await expect(toast(page, "Logo uploaded (300 × 100 PNG). New ads will use it.")).toBeVisible();
  const pngSrcs = await previews(page);
  expect(pngSrcs[0]).toMatch(/\/assets\/[0-9a-f-]{36}$/);
  await expect.poll(() => section(page).locator("[data-logo-preview] img").first().evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(300);

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `brand editor at ${width}px`);
    expect(await contrastViolations(page), `brand editor at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // The brand page shows the PNG logo.
  await page.goto(`/brands/${id}`);
  await settle(page);
  await expect(page.getByRole("img", { name: "Fernhollow Outfitters logo" })).toHaveAttribute("src", pngSrcs[0].replace(/^https?:\/\/[^/]+/, ""));

  // Remove logo: both previews say there is none.
  await page.goto(`/brands/${id}/edit`);
  await settle(page);
  await section(page).getByRole("button", { name: "Remove logo" }).click();
  await expect(toast(page, "Logo removed.")).toBeVisible();
  await expect(section(page).getByText("No logo yet")).toHaveCount(2);
  await expect(section(page).getByRole("button", { name: "Remove logo" })).toHaveCount(0);

  // Leave Fernhollow with its own logo again.
  await choose(page, "fernhollow.svg", "image/svg+xml", Buffer.from(original));
  await expect(toast(page, "Logo uploaded.")).toBeVisible();
});

test("S5-3 Q7: the brand page says which open font draws each brand font", async ({ page }) => {
  const id = await demoBrandId(page, "Fernhollow Outfitters");
  // U10-7: the fonts are on the brand page's Voice and visual tab.
  await page.goto(`/brands/${id}?tab=voice`);
  await settle(page);
  const notes = page.locator("[data-font-note]");
  await expect(notes).toHaveText([
    "In ads: drawn with Source Serif 4, the nearest open font to Georgia.",
    "In ads: drawn with Inter, the nearest open font to Helvetica.",
  ]);
});
