// C8-1 Compliance checks through the UI, with the mock models. Two
// Fernhollow campaigns:
//
// 1. Cases 1, 8 and 9: a picked ad, translated, in its own layout (every
//    layout keeps clear of a 9:16 story's bands). Its Compliance view lists
//    each of the brand's don't rules once, for the whole ad, as Review;
//    Accept records the name and time and turns each green; then every rule
//    passes in all four sizes and every language, and the gallery's pill says
//    Passes. A second picked ad waits on its don't rules, so the launch pack
//    leaves it out with the reason; the downloaded manifest's compliance
//    matches the view and names who accepted. Then "Accept for every picked
//    ad" on the campaign accepts each rule for the second ad too, recording
//    its own decision with name and time. Drawing the first ad in another
//    layout (a redraw) makes its don't rules Review again.
// 2. Cases 2, 3 and 11: one ad seeded (through the database, as the case
//    says) with a near-limit palette shows Text contrast as Review with the
//    ratio and a palette colour; a German banned term added on the Languages
//    page makes the German ad fail with the term quoted, and is taken out
//    again; a 300-character don't rule with <script>, and a decision's note
//    with markup, render as plain text.
//
// Each page at 375 px and 1440 px: nothing scrolls sideways, AA contrast.
// SHOTS_DIR=<folder> saves screenshots. The Fernhollow kit is changed only
// for a moment (a German banned term, a don't rule) and put back in finally.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";
import {
  contrastViolations,
  DEV_EMAIL,
  demoBrandId,
  expectNoHorizontalScroll,
  makeCreative,
  newCampaign,
  saveShot,
  settle,
  signIn,
  signOffVersion,
  step,
  untilShown,
  drawInLayout,
} from "./helpers";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const ads = (page: Page) => page.locator("[data-gallery] > li");
const pack = (page: Page) => page.locator("[data-launch-pack]");
const dontRows = (page: Page) => page.locator("[data-compliance-ad] [data-rule=dont]");
const SOCIAL = ["1080x1080", "1080x1350", "1080x1920", "1200x628"];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/** Picks an ad from its card and waits for the shortlist to say so. */
async function pick(page: Page, n: number) {
  await ads(page).nth(n - 1).getByRole("button", { name: `Pick ad ${n}` }).click();
  await expect(toast(page, "Picked for the shortlist.").first()).toBeVisible({ timeout: 30_000 });
  await expect(ads(page).nth(n - 1)).toHaveAttribute("data-picked", "", { timeout: 30_000 });
}

/** Translate on one picked ad (mock Localise agent), and waits for its three translations. */
async function translate(page: Page, card: ReturnType<Page["locator"]>) {
  const button = card.getByRole("button", { name: /^Translate\s*\(/ });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await untilShown(page, () => expect(card.locator("[data-translation]")).toHaveCount(3, { timeout: 10_000 }), 180_000);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "C8-1 #1, #8, #9: a Fernhollow ad passes every rule once its don't rules are accepted, one by one or for every picked ad, the pack leaves out what waits, and a redraw makes them Review again",
  { annotation: [{ type: "case", description: "C8-1.1" }, { type: "case", description: "C8-1.8" }, { type: "case", description: "C8-1.9" }] },
  async ({ page }) => {
    test.setTimeout(900_000);
    let campaignPath = "";
    let first = "";
    let second = "";

    await step(page, "A signed-off Fernhollow brief and its ads (simulated pictures)", async () => {
      campaignPath = await newCampaign(page, "Fernhollow Outfitters", "Bring walkers back for the autumn range, every ad checked for compliance");
      await signOffVersion(page, 1);
      await makeCreative(page, 12);
    });

    await step(page, "Pick ad 1 and translate it into French, German and Spanish", async () => {
      await pick(page, 1);
      first = (await ads(page).first().getAttribute("data-ad"))!;
      await translate(page, ads(page).first());
    });

    await step(page, "Pick ad 2, whose don't rules no one has looked at yet", async () => {
      await pick(page, 2);
      second = (await ads(page).nth(1).getAttribute("data-ad"))!;
    });

    let rules = 0;
    await step(page, "C8-1.8: ad 1's Compliance view lists each don't rule once, for the whole ad, as Review", async () => {
      await page.goto(`${campaignPath}/ads/${first}/compliance`);
      await settle(page);
      await expect(page.getByRole("heading", { name: "The brand's don't rules" })).toBeVisible();
      rules = await dontRows(page).count();
      expect(rules).toBeGreaterThan(0);
      // Once per ad: not repeated in any size or language.
      await expect(page.locator("[data-rule=dont]")).toHaveCount(rules);
      for (const row of await dontRows(page).all()) {
        await expect(row).toHaveAttribute("data-status", "review");
        await expect(row.getByRole("button", { name: /^Accept/ })).toBeVisible();
        await expect(row.getByRole("button", { name: /^Not acceptable/ })).toBeVisible();
      }
      await expect(page.locator("[data-compliance-pill]")).toHaveText(`${rules} to review`);
    });

    await step(page, "C8-1.8: Accept on each records the name and the time, and turns it green", async () => {
      for (let i = 0; i < rules; i++) {
        const row = page.locator('[data-compliance-ad] [data-rule=dont][data-status="review"]').first();
        const key = (await row.getAttribute("data-key"))!;
        await row.getByRole("button", { name: /^Accept/ }).click();
        await expect(toast(page, /^Accepted: don't rule\./).first()).toBeVisible({ timeout: 30_000 });
        const done = page.locator(`[data-compliance-ad] [data-key="${key}"]`);
        await expect(done).toHaveAttribute("data-status", "accepted", { timeout: 30_000 });
        await expect(done.locator("[data-decision=accept]")).toHaveText(new RegExp(`^Accepted by ${escape(DEV_EMAIL)}, .*\\d{1,2}:\\d{2}`));
      }
      await expect(page.locator("[data-compliance-pill]")).toHaveText("Passes");
    });

    await step(page, "C8-1.1: every rule passes in all four sizes and in English, French, German and Spanish", async () => {
      await expect(page.locator("[data-compliance-lang]")).toHaveCount(4);
      await expect(page.locator("[data-compliance-lang] > h2")).toHaveText(["English", "French", "German", "Spanish"]);
      for (const lang of ["en-GB", "fr-FR", "de-DE", "es-ES"]) {
        const sizes = page.locator(`[data-compliance-lang="${lang}"] [data-compliance-size]`);
        await expect(sizes).toHaveCount(4);
        for (const size of SOCIAL) await expect(page.locator(`[data-compliance-lang="${lang}"] [data-compliance-size="${size}"]`)).toHaveAttribute("data-outcome", "pass");
      }
      // Six rules in every size, and the platform zones in each 9:16 story: 4 × 4 × 6 + 4. Every one is Pass.
      await expect(page.locator("[data-compliance-size] [data-rule]")).toHaveCount(100);
      await expect(page.locator('[data-compliance-size] [data-rule]:not([data-status="pass"])')).toHaveCount(0);
      for (const rule of ["contrast", "legal", "banned", "logo", "density", "simulated"]) await expect(page.locator(`[data-compliance-size] [data-rule=${rule}]`)).toHaveCount(16);
      await expect(page.locator('[data-compliance-size="1080x1920"] [data-rule=platform]')).toHaveCount(4);
      await expect(page.locator("[data-compliance-count]")).toContainText("16 drawn files: 16 pass, 0 to review, 0 fail.");
      await checkWidths(page, "compliance view, every rule passing");
    });

    let viewRules: string[][] = [];
    await step(page, "The gallery: ad 1 Passes, ad 2 waits on its don't rules, and the picked ads' summary line", async () => {
      viewRules = await page
        .locator('[data-compliance-lang="en-GB"] [data-compliance-size="1080x1080"] [data-rule]')
        .evaluateAll((rows) => rows.map((r) => [r.getAttribute("data-rule")!, r.getAttribute("data-status")!]));
      await page.goto(campaignPath);
      await settle(page);
      await expect(ads(page).first().locator("[data-compliance-pill]")).toHaveText("Passes");
      await expect(ads(page).nth(1).locator("[data-compliance-pill]")).toHaveText(`${rules} to review`);
      await expect(page.locator("[data-compliance-summary]")).toHaveText(/^Compliance of the picked ads: 16 ads pass, \d+ to review, 0 fail, over every size and language\./);
    });

    await step(page, "C8-1.9: the launch pack leaves ad 2 out with the reason, and downloads ad 1's 16 files with their compliance", async () => {
      await pack(page).locator("[data-pack-left-out] summary").click();
      const left = pack(page).locator("[data-pack-left-out] li");
      await expect(left.filter({ hasText: /^Ad 2, every size, English: Awaiting review: don't rule/ })).toHaveCount(1);
      await checkWidths(page, "launch pack with compliance left out");
      const download = pack(page).getByRole("link", { name: "Build launch pack (16 ads)" });
      const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
      const entries = unzipSync(new Uint8Array(await readFile(await file.path())));
      const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
      expect(manifest.files).toHaveLength(16);
      for (const f of manifest.files) {
        expect(f.ad.id, f.file).toBe(first);
        expect(f.compliance.outcome, f.file).toBe("accepted");
        const ad = f.compliance.rules.filter((r: { scope: string }) => r.scope === "ad");
        expect(ad, f.file).toHaveLength(rules);
        for (const r of ad) expect(r, f.file).toMatchObject({ status: "review", acceptedBy: DEV_EMAIL });
      }
      // The manifest's compliance is the Compliance view's, rule by rule.
      const square = manifest.files.find((f: { size: { id: string }; language: { tag: string } }) => f.size.id === "1080x1080" && f.language.tag === "en-GB");
      expect(square.compliance.rules.filter((r: { scope: string }) => r.scope === "file").map((r: { rule: string; status: string }) => [r.rule, r.status])).toEqual(viewRules);
      const reasons = manifest.leftOut.filter((l: { ad: { id: string } }) => l.ad.id === second).map((l: { reason: string }) => l.reason);
      expect(reasons.length).toBeGreaterThan(0);
      for (const r of reasons) expect(r).toMatch(/^Awaiting review: don't rule/);
      // The CSV names the person who accepted, and the README says what the rules are.
      const csv = strFromU8(entries["manifest.csv"]).replace(/^\uFEFF/, "").split("\r\n");
      expect(csv[0]).toContain('"compliance","reviewed_by"');
      const included = csv.filter((r) => r.startsWith('"included"'));
      expect(included).toHaveLength(16);
      for (const r of included) expect(r).toContain(`"Passes, ${rules} review ${rules === 1 ? "item" : "items"} accepted","${DEV_EMAIL}"`);
      expect(strFromU8(entries["README.txt"])).toContain("Compliance: every file passed Studio's compliance rules");
    });

    await step(page, "C8-1.8: on the campaign, Accept for every picked ad accepts each don't rule for ad 2, with its own decision", async () => {
      await page.goto(campaignPath);
      await settle(page);
      const bulk = page.locator("[data-bulk-dont-rule]");
      await expect(bulk).toHaveCount(rules);
      for (let i = 0; i < rules; i++) {
        // Ad 1's were accepted one by one: each rule waits on ad 2 alone.
        const row = page.locator('[data-bulk-dont-rule]:not([data-open="0"])').first();
        await expect(row.locator("[data-bulk-status]")).toHaveText("Waits on 1 of 2 picked ads.");
        await row.getByRole("button", { name: /^Accept for every picked ad/ }).click();
        await expect(toast(page, /^Accepted for 1 picked ad: don't rule\./).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('[data-bulk-dont-rule][data-open="0"]')).toHaveCount(i + 1, { timeout: 30_000 });
      }
      for (const row of await bulk.all()) {
        await expect(row.locator("[data-bulk-status]")).toHaveText("Decided on all 2 picked ads.");
        await expect(row.getByRole("button")).toHaveCount(0);
      }
      await expect(ads(page).nth(1).locator("[data-compliance-pill]")).toHaveText("Passes");
      // Nothing waits for review any more (a language ad 2 has no words in is still left out, as before C8-1).
      await expect(pack(page).locator("[data-pack-left-out] li", { hasText: "Awaiting review" })).toHaveCount(0);
      await checkWidths(page, "gallery, don't rules accepted for every picked ad");
      // Each of ad 2's rules has its own decision, with the name and the time.
      await page.goto(`${campaignPath}/ads/${second}/compliance`);
      await settle(page);
      for (const row of await dontRows(page).all()) {
        await expect(row).toHaveAttribute("data-status", "accepted");
        await expect(row.locator("[data-decision=accept]")).toHaveText(new RegExp(`^Accepted by ${escape(DEV_EMAIL)}, .*\\d{1,2}:\\d{2}`));
      }
    });

    await step(page, "C8-1.8: drawing ad 1 in another layout redraws it, and its don't rules are Review again", async () => {
      await page.goto(campaignPath);
      await settle(page);
      const own = await ads(page).first().locator('button[aria-pressed="true"]').getAttribute("aria-label");
      await drawInLayout(page, 1, own?.startsWith("Split") ? "Card" : "Split");
      await page.goto(`${campaignPath}/ads/${first}/compliance`);
      await settle(page);
      await expect(dontRows(page)).toHaveCount(rules);
      for (const row of await dontRows(page).all()) await expect(row).toHaveAttribute("data-status", "review");
    });
  },
);

test(
  "C8-1 #2, #3, #11: contrast near AA is Review with a palette colour, a German banned term added on the Languages page fails, and hostile words stay plain text",
  { annotation: [{ type: "case", description: "C8-1.2" }, { type: "case", description: "C8-1.3" }, { type: "case", description: "C8-1.11" }] },
  async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to seed an ad with a near-limit palette");
    test.setTimeout(900_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const brandId = await demoBrandId(page, "Fernhollow Outfitters");
    let campaignPath = "";
    let seeded = "";
    try {
      await step(page, "A signed-off Fernhollow brief and its ads (simulated pictures)", async () => {
        campaignPath = await newCampaign(page, "Fernhollow Outfitters", "Bring walkers back for the winter range, with a near-limit palette");
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
      });

      await step(page, "Seed one ad with a near-limit palette (Mist words on Slate, 4.67:1), picked, in Card", async () => {
        const original = (await ads(page).first().getAttribute("data-ad"))!;
        // Slate and Mist make 4.67:1; Pine is a palette colour that would do better as the panel.
        const palette = [
          { name: "Slate", hex: "#6B6B6B" },
          { name: "Mist", hex: "#F0F0F0" },
          { name: "Pine", hex: "#1E3A2B" },
        ];
        seeded = await sql.begin(async (tx) => {
          await tx`update public.ad_variants set discarded_at = now() where id = ${original}`;
          const [row] = await tx`
            insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by, picked_at)
            select workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, 'card', checks, jsonb_set(kit, '{palette}', ${tx.json(palette)}), 'composed', created_by, now()
            from public.ad_variants where id = ${original}
            returning id`;
          return row.id as string;
        });
        await page.reload();
        await settle(page);
        await translate(page, page.locator(`[data-gallery] > li[data-ad="${seeded}"]`));
      });

      await step(page, "C8-1.2: its Compliance view shows Text contrast as Review, with the ratio and a palette colour to use", async () => {
        await page.goto(`${campaignPath}/ads/${seeded}/compliance`);
        await settle(page);
        const row = page.locator('[data-compliance-lang="en-GB"] [data-compliance-size="1080x1080"] [data-rule=contrast]');
        await expect(row).toHaveAttribute("data-status", "review");
        await expect(row).toContainText("Words 4.67:1 on their panel");
        await expect(row).toContainText("passes AA (4.50:1) by less than 10%");
        await expect(row.locator("[data-fix]")).toHaveText(/^Suggested fix: Use Pine for the panel \(\d+\.\d\d:1 with the words\)\.$/);
        await expect(row.getByRole("button", { name: /^Accept/ })).toBeVisible();
        await checkWidths(page, "compliance view, contrast near AA");
      });

      const [{ rules: dontBefore }] = await sql`select dont_rules as rules from public.brands where id = ${brandId}`;
      const hostile = `<script>window.__c81 = 1</script> ${"Never promise a walk is safe in any weather, and say so plainly. ".repeat(6)}`.slice(0, 300).trim();
      try {
        await step(page, "C8-1.11: a 300-character don't rule with <script> shows as plain text, and a note with markup is kept as text, cut to 500 characters", async () => {
          await sql`update public.brands set dont_rules = array_append(dont_rules, ${hostile}) where id = ${brandId}`;
          await page.reload();
          await settle(page);
          const row = dontRows(page).filter({ hasText: "<script>window.__c81 = 1</script>" });
          await expect(row).toHaveCount(1);
          await expect(row.locator("[data-finding-title]")).toHaveText(hostile);
          await expect(page.locator("[data-compliance-ad] script")).toHaveCount(0);
          const note = `<img src="x" onerror="window.__c81 = 2">${"n".repeat(600)}`;
          await row.getByRole("textbox").fill(note);
          await row.getByRole("button", { name: /^Not acceptable/ }).click();
          await expect(toast(page, /^Marked not acceptable: don't rule\./)).toBeVisible({ timeout: 30_000 });
          const decided = dontRows(page).filter({ hasText: "<script>window.__c81 = 1</script>" });
          await expect(decided).toHaveAttribute("data-status", "fail", { timeout: 30_000 });
          await expect(decided.locator("[data-decision=reject]")).toContainText(`Marked not acceptable by ${DEV_EMAIL}`);
          const shown = decided.locator("[data-decision-note]");
          await expect(shown).toHaveText(note.slice(0, 500));
          await expect(shown.locator("img")).toHaveCount(0);
          expect(await page.evaluate(() => (window as unknown as { __c81?: number }).__c81)).toBeUndefined();
          await checkWidths(page, "compliance view, hostile rule and note");
        });
      } finally {
        await sql`update public.brands set dont_rules = ${dontBefore} where id = ${brandId}`;
      }

      const [{ cta }] = await sql`
        select t.set ->> 'cta' as cta from public.copy_sets t
        join public.ad_variants v on v.copy_set_id = t.translated_from
        where v.id = ${seeded} and t.lang = 'de-DE' and t.discarded_at is null`;
      const term = (cta as string).replace(/­/g, "");
      let before = "";
      try {
        await step(page, `C8-1.3: add "${term}" to Fernhollow's German banned terms on the Languages page`, async () => {
          await page.goto(`/brands/${brandId}/languages`);
          await settle(page);
          const field = page.getByLabel("German banned terms");
          before = await field.inputValue();
          await field.fill(`${before}\n${term}`.trim());
          await page.getByRole("button", { name: "Save languages" }).click();
          await expect(toast(page, /^Saved\./)).toBeVisible({ timeout: 30_000 });
        });

        await step(page, "C8-1.3: the German ad now fails Banned terms in every size, with the term quoted; English still passes", async () => {
          await page.goto(`${campaignPath}/ads/${seeded}/compliance`);
          await settle(page);
          const german = page.locator('[data-compliance-lang="de-DE"] [data-rule=banned]');
          await expect(german).toHaveCount(4);
          for (const row of await german.all()) {
            await expect(row).toHaveAttribute("data-status", "fail");
            await expect(row).toContainText(new RegExp(`The banned term "${escape(term)}" is in the German (headline|body|button)\\.`));
            await expect(row.locator("[data-fix]")).toHaveText(`Suggested fix: Remove "${term}".`);
          }
          await expect(page.locator('[data-compliance-lang="en-GB"] [data-rule=banned][data-status="pass"]')).toHaveCount(4);
          await expect(page.locator("[data-compliance-pill]")).toHaveText("Fails");
        });
      } finally {
        await step(page, "Take the German banned term out again", async () => {
          await page.goto(`/brands/${brandId}/languages`);
          await settle(page);
          await page.getByLabel("German banned terms").fill(before);
          await page.getByRole("button", { name: "Save languages" }).click();
          await expect(toast(page, /^Saved\./)).toBeVisible({ timeout: 30_000 });
        });
      }
      await step(page, "C8-1.3: with the term gone, the German ad passes Banned terms again", async () => {
        await page.goto(`${campaignPath}/ads/${seeded}/compliance`);
        await settle(page);
        await expect(page.locator('[data-compliance-lang="de-DE"] [data-rule=banned][data-status="pass"]')).toHaveCount(4);
      });
    } finally {
      await sql.end();
    }
  },
);
