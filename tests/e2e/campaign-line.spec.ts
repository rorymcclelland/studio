// Sprint 10b, D-4 The campaign's line, typed: a campaign carries one line,
// such as "Walk further this winter", that every paid-social and display ad
// uses as its headline. A person types it on the Brief stage (a new brief
// version, signed off with the brief), then Make creative (mock) gives every
// social and display ad that headline exactly.
//
// Suggest lines (the Tagline agent suggests three lines to pick from) is D-4's
// cut line (Rory's answer Q1, 10 November 2026), so its browser test is
// tests/e2e/suggest-lines.spec.ts, on its own, and can be marked as not built.
//
// The dev workspace's fictional Fernhollow Outfitters, as creative.spec.ts uses
// it; nothing here changes its kit, so it runs in the main project.
//
// 1. (D-4 #1) Type a line, save it (a new version), send for sign-off, approve,
//    Make creative (mock): every social and display ad's headline is the line.
//    On the way, a line of 31 characters is refused with the field error.
// Cases 3 to 7 are Vitest: tests/lib/campaign-line.test.ts (3, 4, 5),
// tests/agents/campaign-line.test.ts (5, 7) and tests/flows/campaign-line.test.ts
// (1, 4, 6). Case 4's browser part is the existing creative specs, unchanged.
//
// ---------------------------------------------------------------- interface
// What the builder provides for D-4 (typed line). Rules 1, 3, 5 and 7 hold: the
// line is the person's words, checked like the rest of the brief; a new line is a
// new version that needs sign-off before Make creative uses it; Copy and Localise
// still go through generate(); every read and write goes through asUser().
//
// src/lib/brief/schema.ts:
//   CAMPAIGN_LINE_MIN = 3; CAMPAIGN_LINE_MAX = 30 (fits every headline limit: paid social 40, display 30, search 30).
//   briefCore gains line: an optional string, trimmed, 3 to 30 characters. Field key "line"; messages
//     "The campaign line must be at least 3 characters." and "The campaign line must be 30 characters or fewer."
//     A brief without a line parses as today (old versions have none). storedBrief carries it.
//   BRIEF_SECTIONS gains "line" (after "title"); changedSections() compares it like the other sections.
// src/lib/brief/checks.ts:
//   evidenceProblems() checks the line like any other text field, as "the campaign line": banned terms
//     ('the campaign line uses the banned term "<term>"'), claims that need evidence, and companies the market
//     notes name ("the campaign line names <name>, a real company from the market notes; ..."), the brand's own
//     names excepted (D-2).
// The Brief stage (src/app/(app)/campaigns/[id]/brief/page.tsx, brief-editor.tsx, brief-view.tsx):
//   - A section card [data-section="line"] titled "Campaign line" (SECTION_LABEL.line), first in the brief, with
//     the line, or "No campaign line yet." when the version has none. sectionPhrase("line") = "the campaign line".
//   - Its button "Edit the campaign line" opens a form with the textbox "Campaign line" (focused), the hint
//     "3 to 30 characters. Every paid-social and display headline uses it.", and the button
//     "Save the campaign line". Saving makes the next version (toast "Saved as version N."), after the brief
//     checks (saveBriefEdit with the brief's other parts unchanged); a refusal shows the field's message beside
//     the textbox (aria-invalid, aria-describedby "<id>-error").
//   - The line is versioned and signed off with the brief: a new line after sign-off leaves the earlier version
//     signed off ("Signed off: version N; version N+1 not yet signed off"), as any edit does today.
// Copy (src/lib/agents/copy.ts, src/lib/creative/copy-rules.ts, copy-workflow.ts):
//   - copyInput gains line: string | null (default null), the signed-off version's line. The prompt gives it
//     after the task line as `Campaign line (every paid-social and display headline is exactly this): "<line>"`,
//     JSON-encoded, as data.
//   - CopyRules gains line?: string | null. setProblems() refuses a paid-social or display set whose headline
//     isn't the line exactly: '<where> headline is "<headline>"; every paid-social and display headline is the
//     campaign line, "<line>", exactly'. The line's own words count as the brand's for the name check (the line
//     passed the brief checks). Search keeps its own headlines; email and app push are unchanged.
//   - With a line, alternatives for one audience share the headline, so checkCopy's "repeat a headline" check
//     reads the body for paid social and display instead ("repeat a body").
//   - The mock Copy answer uses the line as every paid-social and display headline, with different bodies.
//   - Without a line, everything is as today.
// Localise (src/lib/agents/localise.ts, localise-workflow.ts):
//   - localiseInput gains line: { english: string; translated: string | null } | null (default null), given when
//     the English set's headline is the campaign line. translated is the line already translated into that
//     language for this campaign and brief version (a current translated set whose English headline is the
//     line, or an earlier job in the same run), else null and this call translates it.
//   - TranslationRules gains line?: string | null (the translated line); translationProblems() refuses a
//     headline that isn't it: '<where> headline is "<headline>"; the campaign line in <Language> is
//     "<translated>", so use it exactly'.
//   - The mock Localise answer: with line.translated, that headline; with a line not yet translated, one fixed
//     translation of the line per language, the same for paid social and display.
//
// Gallery hooks used here (as today): [data-gallery] > li[data-channel] with a leaf [data-ad-headline].
// ----------------------------------------------------------------------------
import { expect, test, type Page } from "@playwright/test";
import { FERNHOLLOW_LINE, LINE_31 } from "../fixtures/new-brand";
import { contrastViolations, expectNoHorizontalScroll, newCampaign, openStage, settle, showAllAds, signIn, signOffVersion, step, untilShown } from "./helpers";

const OBJECTIVE = "Bring walkers back for the winter range with one clear line";
const SHY = "­";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const lineSection = (page: Page) => page.locator("[data-section=line]").filter({ visible: true });

/** The text of the error message a control points at with aria-describedby. */
async function errorOf(page: Page, name: string): Promise<string | null> {
  const control = page.getByRole("textbox", { name, exact: true });
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter((x) => x.endsWith("-error"));
  if (ids.length !== 1) return null;
  return page.locator(`[id="${ids[0]}"]`).filter({ visible: true }).textContent();
}

/** Every shown ad's channel and headline, soft hyphens removed. */
const headlines = (page: Page) =>
  page.locator("[data-gallery] > li[data-channel]").evaluateAll((els, shy) =>
    els.map((el) => ({ channel: el.getAttribute("data-channel"), headline: (el.querySelector("[data-ad-headline]")?.textContent ?? "").split(shy as string).join("").trim() })),
  SHY);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "D-4 #1: a typed line, saved as a new version and signed off, is the headline of every social and display ad Make creative makes",
  { annotation: [{ type: "case", description: "D-4.1" }] },
  async ({ page }) => {
    test.setTimeout(420_000);
    let path = "";

    await step(page, "D-4.1: a new Fernhollow brief has no campaign line yet", async () => {
      path = await newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
      await expect(lineSection(page).getByRole("heading", { name: "Campaign line", exact: true })).toBeVisible();
      await expect(lineSection(page)).toContainText("No campaign line yet.");
    });

    await step(page, "D-4.1: a line of 31 characters is refused beside the field; nothing is saved", async () => {
      await page.getByRole("button", { name: "Edit the campaign line" }).click();
      const field = page.getByRole("textbox", { name: "Campaign line", exact: true });
      await expect(field).toBeFocused();
      await expect(page.getByText("3 to 30 characters. Every paid-social and display headline uses it.")).toBeVisible();
      await field.fill(LINE_31);
      await page.getByRole("button", { name: "Save the campaign line" }).click();
      expect(await errorOf(page, "Campaign line")).toBe("The campaign line must be 30 characters or fewer.");
      await expect(toast(page, /Saved as version/)).toHaveCount(0);
    });

    await step(page, `D-4.1: "${FERNHOLLOW_LINE}" saves as version 2`, async () => {
      await page.getByRole("textbox", { name: "Campaign line", exact: true }).fill(FERNHOLLOW_LINE);
      await page.getByRole("button", { name: "Save the campaign line" }).click();
      await expect(toast(page, "Saved as version 2.")).toBeVisible();
      await expect(lineSection(page)).toContainText(FERNHOLLOW_LINE);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        await expectNoHorizontalScroll(page, `the Brief stage with its line at ${width}px`);
        expect(await contrastViolations(page), `the Brief stage with its line at ${width}px`).toEqual([]);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    await step(page, "D-4.1: display as well as paid social (version 3), then sign-off of version 3", async () => {
      await page.getByRole("button", { name: "Edit the channels" }).click();
      await page.getByLabel("Channel 1", { exact: true }).selectOption("display");
      await page.getByRole("button", { name: "Save the channels" }).click();
      await expect(toast(page, "Saved as version 3.")).toBeVisible();
      // The line is carried into the new version.
      await expect(lineSection(page)).toContainText(FERNHOLLOW_LINE);
      await signOffVersion(page, 3);
    });

    await step(page, "D-4.1: Make creative (mock): every paid-social and display ad's headline is the line", async () => {
      await openStage(page, "creative", path);
      await page.locator("[data-creative]").getByRole("button", { name: /^Make creative/ }).click();
      await expect(page.locator("[data-creative]").getByRole("button", { name: /^Making creative/ })).toBeVisible({ timeout: 30_000 });
      await untilShown(page, async () => {
        await expect(page.locator("[data-creative]").getByRole("button", { name: /^Making creative/ })).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('[data-gallery] > li[data-channel="paid social"]').first()).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-gallery] > li[data-channel="display"]').first()).toBeVisible({ timeout: 10_000 });
      });
      await showAllAds(page);
      const ads = await headlines(page);
      const social = ads.filter((a) => a.channel === "paid social");
      const display = ads.filter((a) => a.channel === "display");
      expect(social.length, "paid-social ads").toBeGreaterThanOrEqual(12);
      expect(display.length, "display ads").toBeGreaterThan(0);
      for (const [i, a] of ads.entries()) expect(a.headline, `ad ${i + 1} (${a.channel})`).toBe(FERNHOLLOW_LINE);
    });
  },
);
