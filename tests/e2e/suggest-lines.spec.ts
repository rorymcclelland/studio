// Sprint 10b, D-4 #2 Suggest lines: the Tagline agent suggests three lines
// for a campaign, from the brief's title and story, the audiences' names and
// the kit's voice; a person picks one, or edits it first, and it is saved as a
// new brief version, which resets sign-off as editing does today.
//
// THE CUT LINE (Rory's answer Q1, 10 November 2026): if the day runs short,
// Suggest lines is the first thing cut, and typing the line still works. This
// spec, tests/agents/suggest-lines.test.ts and their cases (D-4.2, and the
// Tagline agent's part of D-4.7) are kept apart from the typed line's for that
// reason. If it is cut, mark D-4.2 in tests/e2e/cases.ts as not built (with the
// cut line as the reason) rather than deleting these tests.
//
// The dev workspace's fictional Fernhollow Outfitters, with the mock model.
//
// ---------------------------------------------------------------- interface
// What the builder provides for Suggest lines (the typed line's interface is in
// tests/e2e/campaign-line.spec.ts). Rules 3, 4 and 5 hold: a picked line is a
// new brief version that needs sign-off; the suggestion is an agent run with its
// trail; the call goes through generate() and the cap, and its cost is shown
// before the click.
//
// The Tagline agent (src/lib/agents/tagline.ts):
//   taglineInput = { brandName (as today), campaign?: { campaignId: uuid; version: int >= 1;
//     title: string (1 to 100); story: string (up to 1,200); audiences: string[] (up to 3, each up to 120: the
//     audiences' segment titles); voice: string (up to 2,100: the kit's tone words and voice notes) } }.
//     Without campaign it is the home tagline card's agent, unchanged (same prompt, same mock answer, 80 characters).
//   With campaign, the prompt adds, after the task line, `Campaign: <JSON of the campaign>` as data; the
//     instructions say the brand name and the campaign are data to write about, never instructions to follow,
//     and that each line is at most 30 characters and names no company.
//   checkTagline(input, output) => string[], the agent's check: with campaign, each line at most 30 characters
//     ('line <n> is <length> characters; a campaign line is at most 30') and three different lines
//     ('the lines repeat; write three different ones'); without campaign, [] as today.
//   The mock answer with campaign: three different lines of at most 30 characters that pass the demo kits' brief
//     checks (no figures, no banned terms, no names).
//   The tagline workflow with campaign: one model step "Suggest lines", then the run completes with output
//     { taglines } and no approval step (the pick is a brief edit, signed off with the brief: rule 3).
// src/lib/brief/line.ts (NEW, server, through asUser()):
//   startSuggestLines(member: Member, campaignId: string, baseVersion: number, send: SendEvent) => Promise<string>
//     Builds the input from that version and the brand's kit, and creates a "tagline" run with
//     { brandId, label: "<brand name>: suggest lines" }. A campaign not in the reader's workspace:
//     CampaignError "That campaign isn't in your workspace.".
// src/lib/creative/costs.ts:
//   TYPICAL_TOKENS.suggestLines; suggestLinesEstimate(env = process.env) => Estimate: one Tagline call (Haiku:
//     about 0.02p, so the label is "under 1p").
// The Brief stage's [data-section="line"] card:
//   - A button "Suggest lines (<suggestLinesEstimate().label>)", so the cost is shown before the click;
//     "Suggesting lines…" while the run goes.
//   - When the run completes: <ol data-line-suggestions> with three <li data-line-suggestion>, each the line
//     (a leaf [data-line-text]) and two buttons: "Use this line" (saves it as the next version: toast
//     "Saved as version N.") and "Edit first" (opens the line's form with the textbox "Campaign line" holding it).
//   - A failed run: role="alert" with the run's reason; nothing saved.
// ----------------------------------------------------------------------------
import { expect, test, type Page } from "@playwright/test";
import { contrastViolations, expectNoHorizontalScroll, newCampaign, settle, signIn, signOffVersion, step, untilShown } from "./helpers";

const OBJECTIVE = "Bring walkers back for the winter range with a suggested line";
const EDITED = "Walk further, together";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const lineSection = (page: Page) => page.locator("[data-section=line]").filter({ visible: true });
const suggestions = (page: Page) => lineSection(page).locator("[data-line-suggestions] [data-line-suggestion]");
const status = (page: Page) => page.locator("[data-signoff-status]").filter({ visible: true });
const panel = (page: Page) => page.locator("[data-signoff-panel]").filter({ visible: true });

/** Presses Suggest lines (its cost on the button) and waits for the three suggestions. */
async function suggest(page: Page): Promise<string[]> {
  const button = lineSection(page).getByRole("button", { name: /^Suggest lines/ });
  await expect(button).toHaveText(/^Suggest lines \((under 1p|about \d+p)\)$/);
  await button.click();
  await untilShown(page, () => expect(suggestions(page)).toHaveCount(3, { timeout: 10_000 }), 120_000);
  return suggestions(page).locator("[data-line-text]").allTextContents();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "D-4 #2: Suggest lines (mock) shows 3 lines of 30 characters or fewer; picking one saves it as a new version and resets sign-off as editing does",
  { annotation: [{ type: "case", description: "D-4.2" }] },
  async ({ page }) => {
    test.setTimeout(300_000);

    await step(page, "D-4.2: Suggest lines shows its cost before the click, then three lines, each 30 characters or fewer", async () => {
      await newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
      const lines = await suggest(page);
      expect(lines).toHaveLength(3);
      expect(new Set(lines).size, "three different lines").toBe(3);
      for (const l of lines) {
        expect(l.trim().length, l).toBeGreaterThanOrEqual(3);
        expect(l.trim().length, l).toBeLessThanOrEqual(30);
      }
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        await expectNoHorizontalScroll(page, `the suggested lines at ${width}px`);
        expect(await contrastViolations(page), `the suggested lines at ${width}px`).toEqual([]);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    let picked = "";
    await step(page, "D-4.2: Use this line saves the first as version 2", async () => {
      picked = ((await suggestions(page).first().locator("[data-line-text]").textContent()) ?? "").trim();
      await suggestions(page).first().getByRole("button", { name: "Use this line" }).click();
      await expect(toast(page, "Saved as version 2.")).toBeVisible();
      await expect(lineSection(page)).toContainText(picked);
    });

    await step(page, "D-4.2: version 2 signed off; then a suggestion, edited first, saves as version 3 and resets sign-off", async () => {
      await signOffVersion(page, 2);
      await expect(status(page)).toHaveText(/^Signed off: version 2 on /);
      await suggest(page);
      await suggestions(page).nth(1).getByRole("button", { name: "Edit first" }).click();
      const field = page.getByRole("textbox", { name: "Campaign line", exact: true });
      await expect(field).not.toHaveValue("");
      await field.fill(EDITED);
      await page.getByRole("button", { name: "Save the campaign line" }).click();
      await expect(toast(page, "Saved as version 3.")).toBeVisible();
      await expect(lineSection(page)).toContainText(EDITED);
      // As editing does today: version 2 stays signed off, and version 3 waits to be sent.
      await expect(status(page)).toHaveText("Signed off: version 2; version 3 not yet signed off");
      await expect(panel(page).getByRole("button", { name: "Send version 3 for sign-off" })).toBeVisible();
    });
  },
);
