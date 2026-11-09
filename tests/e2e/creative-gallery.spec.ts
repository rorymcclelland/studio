// U10-3 Ad cards that follow the ad's state, and a filterable gallery, through
// the UI with the mock models. One Fernhollow campaign is taken from sign-off
// to a live launch of two ads, a third ad picked after it (so it needs a
// compliance decision), and finally the launch ended; the cases run in the
// order that needs (serial): 2 (the launch, and a page opened before it whose
// Discard the server refuses), 1, 4, 5, 7, 8, then 3 (the launch ends). Case 6,
// an unknown filter value, is CI (tests/lib/gallery-filter.test.ts); case 5's
// test also opens one to show it. The server's refusals for each action, the
// launch states and another workspace are tests/flows/creative-lock.test.ts.
//
// 1. A launched ad's card offers no Discard, New picture, New words or Edit
//    words (nor Redraw), and says "Running in the launch (simulated)".
// 2. Discarding a launched ad through the server action (from a page opened
//    before the launch) is refused with the sentence below; the ad stays.
// 3. Once the launch ends, the tools come back and the line goes.
// 4. Picked shows only picked ads, Needs a decision only ads with an open
//    compliance review, Launched only ads in the live launch; counts match.
// 5. The filter survives a reload and a shared link (?show=picked).
// 7. A card at 375 px is at most about 450 px tall with its tools closed.
// 8. Every tool on today's card is reachable from the card's menus, by keyboard.
//
// ---------------------------------------------------------------- interface
// What the builder provides. The tests here, tests/lib/gallery-filter.test.ts and
// tests/flows/creative-lock.test.ts pin it.
//
// src/lib/creative/gallery-filter.ts (PURE: no server imports; types only from elsewhere):
//   GALLERY_SHOWS = ["all", "picked", "decide", "launched"]; type GalleryShow
//   SHOW_LABELS = { all: "All", picked: "Picked", decide: "Needs a decision", launched: "Launched" }
//   parseShow(value: string | string[] | null | undefined) => GalleryShow: an exact value, or the first
//     of a repeated parameter; anything else (case, spaces, unknown, empty) is "all" (case 6).
//     "decide" is the value U10-2's "Decide compliance" links already use (/creative?show=decide).
//   parseAudience(value, refs: readonly string[]) => string | null: one of the campaign's own segment
//     refs, else null (every audience).
//   type LaunchHold = "live" | "awaiting_approval" | null
//   type AdFacts = { id; picked; toDecide; launch: LaunchHold; segmentRef: string | null }
//   factsFor(variants, version, pills) => AdFacts[]: toDecide = picked, of the signed-off version, and its
//     compliance pill's tone "review" (galleryCompliance().pills), so the Needs a decision count is
//     U10-2's toDecide; launch = the variant's launch status.
//   matchesShow(ad, show); showCounts(ads) => Record<GalleryShow, number>; filterAds(ads, show, audience)
//     keeps the gallery's order. Picked: picked. Needs a decision: toDecide. Launched: launch "live" only
//     (a waiting launch isn't running).
//   emptyLine(show): picked "No ad is picked yet.", decide "No picked ad needs a compliance decision.",
//     launched "No ad is in a live launch (simulated).", all "No ads yet."
//   galleryHref(campaignId, { show, audience }) => "/campaigns/<id>/creative", then "?show=<show>" unless
//     all, then the audience ("&audience=<ref>", or "?audience=<ref>" for All), URI-encoded.
//   type AdState = "discarded" | "launched" | "decide" | "picked"; AD_STATE_LABELS = { discarded:
//     "Discarded", launched: "Launched", decide: "Needs a decision", picked: "Picked" }; adState(ad &
//     { discarded? }) => AdState | null, the first that applies in that order (a waiting launch's ad
//     shows what it otherwise is).
//   LOCK_LINES = { live: "Running in the launch (simulated)", awaiting_approval: "In a launch waiting for
//     approval (simulated)" }; lockLine(launch) => string | null
//   RUNNING_IN_LAUNCH = "That ad is running in a launch (simulated), so it can't change until the launch ends."
//   WAITING_FOR_LAUNCH = "That ad is in a launch waiting for approval (simulated), so it can't change until the
//     launch is decided." (Rory, 9 November 2026: a waiting launch gets its own refusal); lockRefusal(status,
//     shared?) => the sentence for the ad's own launch, or (shared) for another ad on the same words.
//   type AdTool = "layout" | "redraw" | "pick" | "discard" | "new-picture" | "new-words" | "edit-words"
//     | "translate" | "sizes" | "compliance" | "about"; LOCKED_TOOLS = layout, redraw, discard, new-picture,
//     new-words, edit-words (Rory, 9 November 2026: the layout switch too, as it changes what the running ad
//     shows); adTools({ picked, launch, olderKit, translate }) => AdTool[]: no locked tool
//     while launch is live or waiting; redraw only with olderKit; translate only when `translate`
//     (today's rule: a picked ad with translations to write).
//
// src/lib/creative/gallery.ts:
//   VariantView.launch: { launchId: string; status: "live" | "awaiting_approval" } | null: the live or
//     waiting launch of the same campaign and workspace whose ads hold this ad (launches.ads @>
//     [{variantId}]); ended and refused launches hold nothing; read through asUser() (rule 7), so another
//     workspace's launch naming this ad never locks it.
//   discardVariant, newPicture, redrawVariant, newWords, editWords, setLayout and keepWords(…, "new")
//     refuse, with CreativeError (RUNNING_IN_LAUNCH for a live launch, WAITING_FOR_LAUNCH for a waiting one,
//     both re-exported), an ad in a live or waiting launch, after the workspace check (another workspace
//     still gets "That ad isn't in your workspace.") and before anything is written or sent. newWords,
//     editWords and keepWords(…, "new") also refuse when another current ad on the same words is in such a
//     launch (they would re-word it), with a message containing "running in a launch (simulated)" (or "in a
//     launch waiting for approval (simulated)"). keepWords(…, "old") only discards the waiting words, so it
//     still works. Redraw all keeps a locked ad on its older kit, with the reason.
//   The server actions (src/app/(app)/campaigns/creative-actions.ts) return { error: <that sentence> }.
//
// The Creative stage (/campaigns/[id]/creative):
//   ?show= (parseShow) and ?audience= (parseAudience) choose what the gallery shows; the page reads them,
//     so a reload or a shared link opens the same view (case 5), and U10-2's ?show=decide link opens on
//     the ads needing a decision.
//   Filter row: <nav aria-label="Filter the ads" data-gallery-filter> above the gallery, whenever there are
//     ads; one link per GALLERY_SHOWS value, a[data-gallery-show="<value>"] with href galleryHref(...)
//     (keeping the audience), its label (SHOW_LABELS) and a leaf [data-gallery-count] holding the number
//     only (showCounts, over the chosen audience); aria-current="page" on the chosen one only. With several
//     audiences, also a[data-gallery-audience="<segmentRef>"] per audience and a[data-gallery-audience=""]
//     "Every audience", in the same nav, aria-current likewise. No ad under the filter: a leaf
//     [data-gallery-empty] with emptyLine(show) instead of an empty gallery.
//   Groups (several audiences): <details data-audience-group="<segmentRef>" open>, its <summary> holding
//     "For <title>" and a leaf [data-audience-count] with the number of ads it shows; it collapses to that
//     line. A group with no ad under the filter is left out. Each group's ads are a ul[data-gallery].
//   The compact card, <li data-ad="<id>"> in a ul[data-gallery] (data-channel, data-words and data-picked
//     as today), with its tools closed:
//     - the picture (a[data-ad-full], as today), the heading "Ad N", a leaf [data-ad-headline] with the
//       headline, a leaf [data-ad-state] with AD_STATE_LABELS[adState] (none when null), its checks and
//       scores (the compliance pill, the badges, the pre-test scores);
//     - for an ad in a live or waiting launch, a leaf [data-ad-locked] with lockLine(status);
//     - Pick / Unpick on the face ("Pick ad N" / "Unpick ad N", as today); new words waiting
//       (Keep the new words / Keep the old words) and "Drawing a new picture" / "Writing new words" stay
//       on the face too: they are what needs the person;
//     - two menu buttons, <button data-ad-menu-button="edit" aria-expanded aria-controls> named
//       "Edit ad N" showing "Edit", and <button data-ad-menu-button="more" ...> named "More for ad N"
//       showing "More". Each opens its panel [data-ad-menu="edit"|"more"] in place (in the card, so the
//       grid reflows; not a popover over other cards), closed by default, not rendered or hidden when
//       closed. A disclosure, not an ARIA menu: Enter or Space opens it and focus stays on its button; Tab
//       then reaches its tools in order; Escape (on the button or inside the panel) closes it and puts focus
//       on its button. A menu with no tool for the ad's state isn't shown.
//     - Edit holds the layout switch ("Full bleed layout for ad N" and the others), Redraw (F-26, older
//       kit only), New picture, New words and Edit words ("Edit the words for ad N"), each with today's
//       accessible name; More holds Translate (picked ads, as today), the ad's translations with their
//       Discard buttons, Sizes ("Sizes of ad N"), Compliance ("Compliance of ad N"), Discard ("Discard
//       ad N"), and "About ad N" ([data-ad-about], a details as today) with the runs' links.
//     - adTools() decides which tools appear: a locked ad has no Discard, New picture, New words, Edit
//       words or Redraw anywhere on its card.
//     tests/e2e/helpers.ts has AD_TOOLS (each tool's menu, role and name), adCard, openAdMenu and adTool,
//     for the specs that use a card's tools (creative, sizes, languages, compliance, pretest, vision,
//     launch-pack, several-audiences, campaign-stages, the fullest data): update them through adTool().
// ----------------------------------------------------------------------------
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  acceptDontRulesForPicked,
  AD_TOOLS,
  adCard,
  adTool,
  makeCreative,
  newCampaign,
  openAdMenu,
  openLaunch,
  openStage,
  settle,
  signIn,
  signOffVersion,
  stagePath,
  step,
  type AdMenu,
  type AdToolName,
} from "./helpers";

const OBJECTIVE = "Bring walkers back for the autumn range, one ad card at a time";
const SENTENCE = "That ad is running in a launch (simulated), so it can't change until the launch ends.";
const RUNNING = "Running in the launch (simulated)";
const SHOWS = ["all", "picked", "decide", "launched"] as const;
type Show = (typeof SHOWS)[number];
const LABELS: Record<Show, string> = { all: "All", picked: "Picked", decide: "Needs a decision", launched: "Launched" };
/** Case 7: "at most about 450 px". About: 450 px and 2%, for a line of text that wraps differently. */
const CARD_MAX_PX = 460;
const PHONE = { width: 375, height: 812 };
/** The tools a locked ad's card must not offer anywhere (case 1, and Rory's decision 1 of 9 November 2026: the layout switch). */
const LOCKED: AdToolName[] = ["discard", "new-picture", "new-words", "edit-words", "redraw", "layout"];

const visible = (page: Page, css: string) => page.locator(css).filter({ visible: true });
const cards = (page: Page) => visible(page, "[data-gallery] > li[data-ad]");
const filterRow = (page: Page) => visible(page, "nav[data-gallery-filter]");
const filterLink = (page: Page, show: Show) => filterRow(page).locator(`a[data-gallery-show="${show}"]`);
const count = async (page: Page, show: Show) => Number(((await filterLink(page, show).locator("[data-gallery-count]").textContent()) ?? "").trim());
const shownIds = async (page: Page) => (await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-ad")!))).sort();
const sorted = (ids: string[]) => [...ids].sort();

/** The creative stage, filtered (no ?show= for All), loaded afresh. */
async function openGallery(page: Page, show: Show | string = "all") {
  await page.goto(show === "all" ? stagePath(path, "creative") : `${stagePath(path, "creative")}?show=${show}`);
  await settle(page);
}

/** Every menu a card has, opened, so nothing on it is hidden. */
async function openEveryMenu(card: Locator) {
  for (const m of ["edit", "more"] as AdMenu[]) if ((await card.locator(`button[data-ad-menu-button="${m}"]`).count()) > 0) await openAdMenu(card, m);
}

/** Whether a card offers a tool anywhere on it (its menus opened first). */
async function offers(card: Locator, tool: AdToolName): Promise<number> {
  await openEveryMenu(card);
  return card.getByRole(AD_TOOLS[tool].role, { name: AD_TOOLS[tool].name }).count();
}

// The journey's state, shared by the serial tests below.
let path = "";
/** The two paid-social ads in the launch, and the third picked after it (open compliance review). */
let launchedIds: string[] = [];
let decideId = "";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.describe("U10-3 a Fernhollow campaign's gallery, from a live launch to its end", () => {
  test.describe.configure({ mode: "serial" });

  test(
    "U10-3 #2: discarding a launched ad from a page opened before the launch is refused by the server, and the ad stays",
    { annotation: [{ type: "case", description: "U10-3.2" }] },
    async ({ page }) => {
      test.setTimeout(900_000);
      await step(page, "A Fernhollow brief, signed off, with 12 ads; two paid-social ads picked and their compliance accepted", async () => {
        path = await newCampaign(page, "Fernhollow Outfitters", OBJECTIVE);
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
        const social = visible(page, '[data-gallery] > li[data-channel="paid social"]');
        launchedIds = [(await social.nth(0).getAttribute("data-ad"))!, (await social.nth(1).getAttribute("data-ad"))!];
        decideId = (await social.nth(2).getAttribute("data-ad"))!;
        for (const id of launchedIds) {
          await (await adTool(adCard(page, id), "pick")).click();
          await expect(adCard(page, id)).toHaveAttribute("data-picked", "", { timeout: 30_000 });
        }
        await acceptDontRulesForPicked(page);
      });

      const stale = await page.context().newPage();
      await step(page, "Another tab opens the gallery before the launch: the first ad still offers Discard there", async () => {
        await stale.goto(stagePath(path, "creative"));
        await settle(stale);
        await expect(await adTool(adCard(stale, launchedIds[0]), "discard")).toBeVisible();
      });

      await step(page, "Ask to launch the two ads, and approve it in the inbox: the launch is live (simulated)", async () => {
        await openLaunch(page, path);
        const panel = visible(page, "[data-launch-panel]");
        await panel.getByRole("button", { name: "Ask to launch" }).click();
        await expect(panel.locator("[data-launch-status]")).toHaveText("Waiting for approval", { timeout: 30_000 });
        await page.goto("/approvals");
        await settle(page);
        const card = page.locator("[data-inbox-item=launch]").filter({ has: page.locator(`a[href^="${path}"]`) });
        await expect(card.locator("[data-launch-ad]")).toHaveCount(2);
        await card.getByRole("button", { name: "Approve" }).click();
        await expect(card).toHaveCount(0, { timeout: 30_000 });
        await openLaunch(page, path);
        await expect(visible(page, "[data-launch-panel]").locator("[data-launch-status]")).toHaveText("Live (simulated)");
      });

      await step(page, "U10-3.2: Discard in the old tab is refused by the server with the sentence", async () => {
        await (await adTool(adCard(stale, launchedIds[0]), "discard")).click();
        await expect(stale.getByText(SENTENCE, { exact: true })).toBeVisible({ timeout: 30_000 });
      });

      await step(page, "U10-3.2: reloaded, the ad is still in the gallery, running, and not under Discarded", async () => {
        await stale.reload();
        await settle(stale);
        await expect(adCard(stale, launchedIds[0])).toBeVisible();
        await expect(adCard(stale, launchedIds[0]).locator("[data-ad-locked]")).toHaveText(RUNNING);
        await expect(stale.locator(`details[data-history="discarded"] [data-ad="${launchedIds[0]}"]`)).toHaveCount(0);
      });
      await stale.close();
    },
  );

  test(
    "U10-3 #1: a launched ad's card offers no Discard, New picture, New words or Edit words, and says it is running",
    { annotation: [{ type: "case", description: "U10-3.1" }] },
    async ({ page }) => {
      await openStage(page, "creative", path);
      for (const id of launchedIds) {
        const card = adCard(page, id);
        await step(page, `U10-3.1: the launched ad ${id.slice(0, 8)} says it is running, and has none of the tools that would change it`, async () => {
          await expect(card.locator("[data-ad-locked]")).toHaveText(RUNNING);
          await expect(card.locator("[data-ad-state]")).toHaveText("Launched");
          for (const tool of LOCKED) expect(await offers(card, tool), tool).toBe(0);
          // What doesn't change the running ad stays: its sizes and its compliance.
          await expect(await adTool(card, "sizes")).toBeVisible();
          await expect(await adTool(card, "compliance")).toBeVisible();
        });
      }
      await step(page, "U10-3.1: an ad outside the launch keeps every tool, and has no running line", async () => {
        const card = adCard(page, decideId);
        await expect(card.locator("[data-ad-locked]")).toHaveCount(0);
        for (const tool of ["discard", "new-picture", "new-words", "edit-words"] as AdToolName[]) expect(await offers(card, tool), tool).toBe(1);
      });
    },
  );

  test(
    "U10-3 #4: each filter shows only its ads, and its count matches",
    { annotation: [{ type: "case", description: "U10-3.4" }] },
    async ({ page }) => {
      await step(page, "A third paid-social ad is picked after the launch: its compliance needs a decision", async () => {
        await openStage(page, "creative", path);
        await (await adTool(adCard(page, decideId), "pick")).click();
        await expect(adCard(page, decideId)).toHaveAttribute("data-picked", "", { timeout: 30_000 });
      });

      await step(page, "U10-3.4: the filter row: All, Picked, Needs a decision and Launched, with their counts; All is chosen", async () => {
        await openGallery(page);
        await expect(filterRow(page)).toHaveAttribute("aria-label", "Filter the ads");
        for (const show of SHOWS) await expect(filterLink(page, show)).toContainText(LABELS[show]);
        await expect(filterLink(page, "all")).toHaveAttribute("aria-current", "page");
        expect({ all: await count(page, "all"), picked: await count(page, "picked"), decide: await count(page, "decide"), launched: await count(page, "launched") }).toEqual({
          all: 12,
          picked: 3,
          decide: 1,
          launched: 2,
        });
        await expect(cards(page)).toHaveCount(12);
      });

      const expected: Record<Exclude<Show, "all">, { ids: () => string[]; state: (id: string) => string }> = {
        picked: { ids: () => [...launchedIds, decideId], state: (id) => (id === decideId ? "Needs a decision" : "Launched") },
        decide: { ids: () => [decideId], state: () => "Needs a decision" },
        launched: { ids: () => launchedIds, state: () => "Launched" },
      };
      for (const show of ["picked", "decide", "launched"] as const) {
        await step(page, `U10-3.4: ${LABELS[show]} shows only its ads, as many as its count`, async () => {
          await openGallery(page);
          await filterLink(page, show).click();
          await page.waitForURL((u) => u.pathname === stagePath(path, "creative") && u.searchParams.get("show") === show);
          await settle(page);
          await expect(filterLink(page, show)).toHaveAttribute("aria-current", "page");
          for (const other of SHOWS.filter((s) => s !== show)) await expect(filterLink(page, other)).not.toHaveAttribute("aria-current", "page");
          expect(await shownIds(page)).toEqual(sorted(expected[show].ids()));
          expect(await cards(page).count()).toBe(await count(page, show));
          for (const id of expected[show].ids()) await expect(adCard(page, id).locator("[data-ad-state]")).toHaveText(expected[show].state(id));
        });
      }

      await step(page, "U10-3.4: the overview's Decide compliance link opens the gallery on the one ad that needs it", async () => {
        await page.goto(path);
        await settle(page);
        const need = visible(page, "[data-needs-you]").locator('[data-need="compliance"]');
        await expect(need).toHaveText("Decide compliance for 1 picked ad");
        await need.getByRole("link").click();
        await page.waitForURL((u) => u.pathname === stagePath(path, "creative") && u.searchParams.get("show") === "decide");
        await settle(page);
        expect(await shownIds(page)).toEqual([decideId]);
      });

      await step(page, "U10-3.4: All shows every ad again", async () => {
        await filterLink(page, "all").click();
        await page.waitForURL((u) => u.pathname === stagePath(path, "creative") && !u.searchParams.has("show"));
        await settle(page);
        await expect(cards(page)).toHaveCount(12);
      });
    },
  );

  test(
    "U10-3 #5: the filter survives a reload and a shared link",
    { annotation: [{ type: "case", description: "U10-3.5" }] },
    async ({ page, browser }) => {
      const picked = sorted([...launchedIds, decideId]);
      await step(page, "U10-3.5: ?show=picked opens on Picked", async () => {
        await openGallery(page, "picked");
        await expect(filterLink(page, "picked")).toHaveAttribute("aria-current", "page");
        expect(await shownIds(page)).toEqual(picked);
      });
      await step(page, "U10-3.5: a reload keeps it", async () => {
        await page.reload();
        await settle(page);
        expect(new URL(page.url()).searchParams.get("show")).toBe("picked");
        await expect(filterLink(page, "picked")).toHaveAttribute("aria-current", "page");
        expect(await shownIds(page)).toEqual(picked);
      });
      await step(page, "U10-3.5: the link opened in another browser, signed in, shows the same", async () => {
        const url = page.url();
        const other = await browser.newContext();
        try {
          const shared = await other.newPage();
          await signIn(shared);
          await shared.goto(url);
          await settle(shared);
          await expect(filterLink(shared, "picked")).toHaveAttribute("aria-current", "page");
          expect(await shownIds(shared)).toEqual(picked);
        } finally {
          await other.close();
        }
      });
      await step(page, "U10-3.6 (CI's case, shown here too): an unknown value shows All", async () => {
        await openGallery(page, "everything");
        await expect(filterLink(page, "all")).toHaveAttribute("aria-current", "page");
        await expect(cards(page)).toHaveCount(12);
      });
    },
  );

  test(
    "U10-3 #7: a gallery card at 375 px is at most about 450 px tall with its tools closed",
    { annotation: [{ type: "case", description: "U10-3.7" }] },
    async ({ page }) => {
      await page.setViewportSize(PHONE);
      await openGallery(page);
      await expect(cards(page)).toHaveCount(12);
      await expect(visible(page, "[data-ad-menu]")).toHaveCount(0);
      const heights = await cards(page).evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-ad")!, height: Math.round(e.getBoundingClientRect().height) })));
      for (const { id, height } of heights) {
        const which = launchedIds.includes(id) ? "launched" : id === decideId ? "needs a decision" : "not picked";
        expect(height, `ad ${id.slice(0, 8)} (${which}) is ${height} px tall at 375 px; the most is about 450 px (${CARD_MAX_PX})`).toBeLessThanOrEqual(CARD_MAX_PX);
      }
      // The launched cards, with their running line, are among those measured.
      expect(heights.map((h) => h.id)).toEqual(expect.arrayContaining([...launchedIds, decideId]));
    },
  );

  test(
    "U10-3 #8: every tool on today's card is reachable from the card's menus, by keyboard",
    { annotation: [{ type: "case", description: "U10-3.8" }] },
    async ({ page }) => {
      await openGallery(page);
      const card = adCard(page, decideId);
      const n = Number(((await card.getByRole("heading").first().textContent()) ?? "").replace(/\D/g, ""));
      /** What has focus: its name as the tests know it (aria-label, else its visible text). */
      const focused = () =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return "";
          const label = el.getAttribute("aria-label");
          if (label) return label.trim();
          // Its text without what is hidden from assistive technology (the disclosure's arrow).
          const copy = el.cloneNode(true) as HTMLElement;
          for (const h of Array.from(copy.querySelectorAll('[aria-hidden="true"]'))) h.remove();
          return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
        });
      /** Tabs from where focus is until `stop` matches, at most `max` presses; returns every name on the way. */
      async function tabUntil(stop: (name: string) => boolean, max = 40): Promise<string[]> {
        const seen: string[] = [];
        for (let i = 0; i < max; i++) {
          await page.keyboard.press("Tab");
          const name = await focused();
          seen.push(name);
          if (stop(name)) return seen;
        }
        return seen;
      }

      await step(page, "U10-3.8: Pick is on the card; Tab from the picture reaches Edit, and Enter opens it", async () => {
        await expect(card.getByRole("button", { name: `Unpick ad ${n}` })).toBeVisible();
        await card.locator("a[data-ad-full]").focus();
        const seen = await tabUntil((x) => x === `Edit ad ${n}`);
        expect(seen.at(-1), `tabbing from the picture: ${seen.join(" | ")}`).toBe(`Edit ad ${n}`);
        const trigger = card.locator('button[data-ad-menu-button="edit"]');
        await expect(trigger).toHaveText("Edit");
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await page.keyboard.press("Enter");
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(card.locator('[data-ad-menu="edit"]')).toBeVisible();
      });

      await step(page, "U10-3.8: Tab reaches each of Edit's tools: the layouts, New picture, New words, Edit words", async () => {
        const seen = await tabUntil((x) => AD_TOOLS["edit-words"].name.test(x));
        for (const tool of ["layout", "new-picture", "new-words", "edit-words"] as AdToolName[]) {
          expect(seen.some((x) => AD_TOOLS[tool].name.test(x)), `${tool} in ${seen.join(" | ")}`).toBe(true);
        }
        // The card's own layout is pressed and the other two aren't; all three are reached.
        expect(seen.filter((x) => AD_TOOLS.layout.name.test(x))).toHaveLength(3);
      });

      await step(page, "U10-3.8: Enter on Edit words opens its dialog; Escape closes it", async () => {
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: `Edit the words for ad ${n}` });
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      });

      await step(page, "U10-3.8: Escape closes the menu and puts focus back on Edit", async () => {
        await card.locator('button[data-ad-menu-button="edit"]').focus();
        await page.keyboard.press("Escape");
        // Escape on an open menu's button or inside it closes it.
        await expect(card.locator('button[data-ad-menu-button="edit"]')).toHaveAttribute("aria-expanded", "false");
        await expect(card.locator('[data-ad-menu="edit"]')).toBeHidden();
        expect(await focused()).toBe(`Edit ad ${n}`);
      });

      await step(page, "U10-3.8: More opens with Enter; Tab reaches Sizes, Compliance, Discard and About the ad", async () => {
        const trigger = card.locator('button[data-ad-menu-button="more"]');
        await trigger.focus();
        expect(await focused()).toBe(`More for ad ${n}`);
        await expect(trigger).toHaveText("More");
        await page.keyboard.press("Enter");
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        const seen = await tabUntil((x) => x === `About ad ${n}`);
        for (const tool of ["sizes", "compliance", "discard"] as AdToolName[]) {
          expect(seen.some((x) => AD_TOOLS[tool].name.test(x)), `${tool} in ${seen.join(" | ")}`).toBe(true);
        }
        expect(seen.at(-1)).toBe(`About ad ${n}`);
        // Translate is on a picked ad as today, when it has languages to write; disabled (so not a Tab stop) when it can't run.
        const translate = card.locator('[data-ad-menu="more"]').getByRole("button", { name: AD_TOOLS.translate.name });
        if ((await translate.count()) > 0 && (await translate.isEnabled())) expect(seen.some((x) => AD_TOOLS.translate.name.test(x)), `translate in ${seen.join(" | ")}`).toBe(true);
        // About the ad opens in place with Enter, with what it is made of.
        await page.keyboard.press("Enter");
        await expect(card.locator("[data-ad-about]")).toHaveAttribute("open", "");
      });

      await step(page, "U10-3.8: no tool of today's card is lost: each is on the card or in one of its menus", async () => {
        await openEveryMenu(card);
        for (const tool of ["pick", "layout", "new-picture", "new-words", "edit-words", "discard", "sizes", "compliance"] as AdToolName[]) {
          expect(await card.getByRole(AD_TOOLS[tool].role, { name: AD_TOOLS[tool].name }).count(), tool).toBeGreaterThan(0);
        }
        await expect(card.locator("a[data-ad-full]")).toBeVisible();
      });

      await step(page, "U10-3.8: axe finds nothing on the gallery with a card's menus open", async () => {
        const results = await new AxeBuilder({ page }).include("[data-gallery]").analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(", ")}`)).toEqual([]);
      });
    },
  );

  test(
    "U10-3 #3: once the launch ends, the tools come back",
    { annotation: [{ type: "case", description: "U10-3.3" }] },
    async ({ page }) => {
      await step(page, "End the launch on the Launch stage", async () => {
        await openLaunch(page, path);
        const panel = visible(page, "[data-launch-panel]");
        await panel.getByRole("button", { name: "End the launch" }).click();
        await panel.getByRole("button", { name: "Yes, end the launch" }).click();
        await expect(panel.locator("[data-launch-status]")).toHaveText("Ended", { timeout: 30_000 });
      });
      await step(page, "U10-3.3: the launched ads' cards have their tools again, and no running line", async () => {
        await openGallery(page);
        for (const id of launchedIds) {
          const card = adCard(page, id);
          await expect(card.locator("[data-ad-locked]")).toHaveCount(0);
          // Picked, with its compliance accepted: Picked again, not Launched.
          await expect(card.locator("[data-ad-state]")).toHaveText("Picked");
          for (const tool of ["discard", "new-picture", "new-words", "edit-words"] as AdToolName[]) expect(await offers(card, tool), tool).toBe(1);
        }
      });
      await step(page, "U10-3.3: Launched now shows none, and says so in one line", async () => {
        await openGallery(page, "launched");
        expect(await count(page, "launched")).toBe(0);
        await expect(cards(page)).toHaveCount(0);
        await expect(visible(page, "[data-gallery-empty]")).toHaveText("No ad is in a live launch (simulated).");
      });
      await step(page, "U10-3.3: Discard works on the ad the server refused before", async () => {
        await openGallery(page);
        await (await adTool(adCard(page, launchedIds[0]), "discard")).click();
        await expect(page.locator("[data-toast]").filter({ hasText: "Ad discarded." })).toBeVisible({ timeout: 30_000 });
        await openGallery(page);
        await expect(adCard(page, launchedIds[0])).toHaveCount(0);
      });
    },
  );
});
