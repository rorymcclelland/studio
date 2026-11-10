// U10-7 The brand page: campaigns first, reference data on request, through
// the UI. The brand page opens on the brand's campaigns, with their real status
// (U10-1) and objective, and a "New campaign" button that opens today's form;
// its reference data sits below in four tabs whose address is ?tab=<id>:
// Audience (segments and market notes), Voice and visual (the kit summary,
// linking to the kit editor), Legal and languages, and Products and data
// (products, charts). A segment card shows its name, size and one-line
// definition until it is opened, and nothing on it is said twice. Answer B1
// (9 November) folds in the kit editor and the brand languages page: compact
// list rows, with Save always on screen.
//
// 1. At 375 px (and 1440 px), the first screen shows the brand's campaigns with
//    their real status and objective, and "New campaign".
// 2. "New campaign" opens the form; submitting it works as today (the campaign
//    opens on its overview and its brief is written).
// 3. Each tab shows its own section and is in the URL; a shared link opens that
//    tab; an unknown tab (and no tab, and an old #segments link) shows the first.
//    Also the failure path: ?tab=nope never shows an empty page.
// 4. A segment card shows its name, size and one-line definition until opened;
//    nothing is shown twice. Rule 1: "Simulated data" once per section, not on
//    every card. Rule 2: market notes may still name real companies, with sources.
// 5. The tabs work by keyboard with the right roles; axe finds nothing.
// 6. With Quillmoor's 10 segments and market notes, every tab is within budget:
//    U10-6's tests in tests/e2e/page-length.spec.ts (keys brand-fernhollow,
//    brand-quillmoor and brand-quillmoor-<tab>), not this file.
// 7. (B1) The kit editor is within its length budget, and Save brand kit is on
//    screen without scrolling at 375 px and 1440 px, and still on screen at the
//    bottom of the form.
// 8. (B1) The same for the languages page, and saving still works.
//
// Cases 2 and 1 run in that order (serial): case 1 finds the campaign case 2
// made. Both use Quillmoor, as design-system.spec.ts compares Fernhollow's
// brand page between visits. Cases 3, 5 and 7 only read Fernhollow. Case 4 is
// tagged @brand-kit so it runs after audience.spec.ts (which removes one of
// Quillmoor's segments and finds them again) and market.spec.ts (which
// replaces Quillmoor's notes), never beside them; case 8 saves Quillmoor's
// languages and puts them back, so it is tagged @brand-kit too.
//
// ---------------------------------------------------------------- interface
// What the builder provides. This spec, tests/lib/brand-tabs.test.ts and
// U10-6's budgets (tests/e2e/page-budgets.ts) pin it.
//
// src/lib/brands/tabs.ts (NEW, PURE, no imports; tests/lib/brand-tabs.test.ts has it in full):
//   BRAND_TAB_PARAM = "tab"; BRAND_TABS = audience "Audience", voice "Voice and visual",
//   legal "Legal and languages", products "Products and data", in that order;
//   DEFAULT_BRAND_TAB = "audience"; parseBrandTab(value) => a known id, else "audience";
//   brandTabHref(brandId, tab) => "/brands/<brandId>?tab=<tab>".
//
// The brand page, /brands/<id>[?tab=<id>] (src/app/(app)/brands/[id]/page.tsx), top to bottom:
//   - The brand's header card as today (logo, <h1> name, "Simulated data" for a demo brand, Edit brand kit,
//     Check an ad).
//   - <section data-brand-campaigns> with <h2> "Campaigns": the brand's campaigns, newest first, each row
//     <li data-brand-campaign="<campaignId>"> holding a link to /campaigns/<id>, a leaf [data-campaign-status]
//     with campaignStatusLabel() (U10-1's words: "Draft", "Live (simulated day 14)" and so on, never
//     "Draft vN") and a leaf [data-campaign-objective] with the campaign's objective (as well as its title,
//     when it has one). No campaigns: "No campaigns for <brand> yet." as today.
//   - Beside the campaigns, [data-new-campaign]: a <button type="button"> named "New campaign", with
//     aria-expanded ("false" until pressed) and aria-controls naming the element that holds the form. The form
//     is today's NewCampaignForm (an "Objective" textbox and "Write the brief"), not shown until the button is
//     pressed; submitting it opens the new campaign's overview, as today.
//     [data-new-campaign] and the first [data-brand-campaign] row are wholly within the first screen at 375 px
//     (812 px tall) and 1440 px (900 px) (U10-6's main action for the brand pages).
//   - Below the campaigns, <div data-brand-tabs> holding the tabs, built on src/components/ui/tabs.tsx (U10-4):
//     one [role=tablist] with an accessible name (aria-labelledby a heading); per BRAND_TABS entry, in order,
//     a [role=tab] named by its label, with data-brand-tab="<id>" (TabItem.tabData), and a [role=tabpanel] with
//     data-brand-tabpanel="<id>" (TabItem.panelData), wired by aria-controls and aria-labelledby. Roving
//     tabindex (the selected tab 0, the others -1); ArrowLeft and ArrowRight move and select, wrapping; Home and
//     End go to the first and last; Tab moves from the selected tab into its panel. Only the selected panel is
//     shown; the others are hidden.
//     The selected tab is parseBrandTab() of ?tab= (server-rendered, so a shared link opens it). Selecting a tab
//     puts ?tab=<id> in the address without a full reload (history.replaceState or router.replace with
//     scroll: false), keeping any other parameters, so a reload or a shared link reopens it. With no ?tab=, an
//     unknown one, or an old run's link (/brands/<id>#segments, /brands/<id>#market), Audience is shown.
//     The tabs (Tabs) take the initial selection and report a change, so U10-4's chart and table tabs are
//     unchanged.
//   - Panel audience: the Segments section (<section aria-labelledby> its <h2> "Segments", so it is the
//     region "Segments", with Find audiences as today) and the Market notes section (<h2 id="market">
//     "Market notes", Refresh market notes and [data-market-note] cards as today: each with its source links,
//     opening in a new tab, and [data-real-names] "Names real companies: ..." where a note names one; rule 2).
//     Each segment is <li data-segment-card="<createdBy>"> (keep data-segment="<createdBy>" for audience.spec)
//     showing, until opened: an <h3> with its name, a leaf [data-segment-size] with its size ("1,234 of 5,000
//     customers (24.7%)" or "1,234 customers (24.7%)"), and a leaf [data-segment-definition] with its one-line
//     definition (one sentence, from the code's candidate definition or the summary's sentence). The rest
//     (the agent's description, regions, age bands, categories, median order, consent share, "As of", its
//     suggested use, and Remove for the agent's segments) is in [data-segment-details], hidden until the card's
//     [data-segment-open] (a <summary>, or a button with aria-expanded) is pressed, and opens in place. The
//     body's badge sentences ("Proposed by the Audience agent." and " Simulated data.") are not shown: on a
//     card, "Proposed by the Audience agent" or "From the customer summary" at most once, and "Simulated data"
//     never; the Segments section says "Simulated data" exactly once for a demo brand (rule 1, once per
//     section). The definition is not repeated in the details.
//   - Panel voice: the kit summary (tone words as the list "Tone words", the voice notes, Do and Don't, the
//     palette and fonts, as short as the builder makes them) and a link to /brands/<id>/edit.
//   - Panel legal: "Required legal lines" (a list named so), banned terms, claims that need evidence, and
//     [data-brand-languages] as today, with its link to /brands/<id>/languages.
//   - Panel products: a heading "Products" with the products, and the section <h2 id="customers"> "Customers
//     and orders" with its [data-figure] charts; for a demo brand the customers section says "Simulated data"
//     exactly once (rule 1, once per section rather than on every figure).
//   The refinement doesn't place "Search the context store" (?q=): it stays on the page, above the tabs or in
//   one of them, as the builder chooses; brands.spec.ts's search tests must still pass, and a tab keeps ?q=.
//
// The existing specs that read today's brand page are updated, not deleted (the sprint's "no behaviour lost"):
//   audience.spec.ts (a "Simulated data" and a "Proposed by" pill on every card: now once per section, and the
//   segments are on ?tab=audience), market.spec.ts and tests/e2e/fullest-data.ts ensureExtras() (open
//   ?tab=audience), brands.spec.ts (the figures' labels, once per section; the kit editor's save returns to the
//   brand page, where tone words and Don't are on the voice tab), logo-upload.spec.ts and upload.spec.ts where
//   they read a section now in a tab, and quick-fixes.spec.ts and design-system.spec.ts if their brand-page
//   checks move.
//
// The kit editor, /brands/<id>/edit (B1): compact list rows; the Save brand kit button inside a [data-save-bar]
//   that is on screen and uncovered at the top and at the bottom of the form, at 375 px and 1440 px (sticky, as
//   U10-1 made it, or anything else that keeps it there); the page within its length budget at both widths
//   (6 screens of 812 px, 4 of 900 px).
// The languages page, /brands/<id>/languages (B1): the same, for Save languages in a [data-save-bar]; saving
//   works as today (the toast "Saved. Ads can be translated into French and German." and so on).
// ----------------------------------------------------------------------------
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/campaigns/status";
import { lengthProblem, VIEWPORT_HEIGHT, type Width } from "./page-budgets";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, openStage, settle, signIn, step, untilShown } from "./helpers";

const PHONE = { width: 375, height: VIEWPORT_HEIGHT[375] };
const DESKTOP = { width: 1440, height: VIEWPORT_HEIGHT[1440] };
const SIZES: readonly [Width, { width: number; height: number }][] = [
  [375, PHONE],
  [1440, DESKTOP],
];
const TABS = [
  ["audience", "Audience"],
  ["voice", "Voice and visual"],
  ["legal", "Legal and languages"],
  ["products", "Products and data"],
] as const;
type TabId = (typeof TABS)[number][0];
const OBJECTIVE = "Bring new savers to the Plus plan before the spring, started from the brand page";
const STATUS_WORDS = new RegExp(`^(${[...Object.values(CAMPAIGN_STATUS_LABELS).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "Live \\(simulated day \\d+\\)", "Live \\(simulated, before day 1\\)"].join("|")})$`);
/** The facts the Audience agent's body adds after the definition (candidateFacts), which wait behind "open". */
const DETAIL_WORDS = ["Top regions", "Main age bands", "Most-bought categories", "Median order", "agreed to marketing", "As of"];

const visible = (page: Page, css: string) => page.locator(css).filter({ visible: true });
const tabsRoot = (page: Page) => visible(page, "[data-brand-tabs]");
const tablist = (page: Page) => tabsRoot(page).getByRole("tablist");
const tab = (page: Page, id: TabId) => tablist(page).locator(`[role="tab"][data-brand-tab="${id}"]`);
const panel = (page: Page, id: TabId) => tabsRoot(page).locator(`[role="tabpanel"][data-brand-tabpanel="${id}"]`);
const segments = (page: Page) => panel(page, "audience").getByRole("region", { name: "Segments" });
const market = (page: Page) => panel(page, "audience").locator("section:has(h2#market)");
const campaigns = (page: Page) => visible(page, "[data-brand-campaigns]");
const newButton = (page: Page) => visible(page, "[data-new-campaign]");
const objectiveBox = (page: Page) => page.getByRole("textbox", { name: "Objective" }).filter({ visible: true });
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });

/** How many times `text` appears in what a person sees of `loc` (innerText leaves out hidden and closed content). */
const said = (loc: Locator, text: string) => loc.evaluate((el, t) => (el as HTMLElement).innerText.split(t).length - 1, text);

/** Scrolled to the top: is the element wholly within the first screen? */
async function inFirstScreen(page: Page, loc: Locator): Promise<boolean> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
  });
}

/** Is the element on screen where it is now, and not covered by anything (a person can see and press it)? */
const onScreen = (loc: Locator) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const inView = r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return inView && !!hit && (hit === el || el.contains(hit));
  });

/** The page is within U10-6's length budget at this width (the same check and message as page-length.spec.ts). */
async function expectWithinLength(page: Page, name: string, width: Width) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(lengthProblem(name, { width, viewportHeight: VIEWPORT_HEIGHT[width], status: 200, notFound: false, height, mainActionTop: null })).toBeNull();
}

/** The Save button in its save bar is on screen, uncovered and enabled, at the top of the page and at the bottom. */
async function expectSaveAlwaysOnScreen(page: Page, name: string, where: string) {
  const bar = visible(page, "[data-save-bar]");
  await expect(bar).toHaveCount(1);
  const save = bar.getByRole("button", { name, exact: true });
  await expect(save).toHaveCount(1);
  await expect(page.getByRole("button", { name, exact: true }).filter({ visible: true })).toHaveCount(1);
  for (const [at, y] of [["the top, without scrolling", 0], ["the bottom of the form", Number.MAX_SAFE_INTEGER]] as const) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await expect.poll(() => onScreen(save), `${name} on screen at ${at} (${where})`).toBe(true);
    await expect(save).toBeEnabled();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** The selected tab is `id`: its tab selected and the one tab stop, its panel shown and every other hidden. */
async function expectSelected(page: Page, id: TabId) {
  for (const [other] of TABS) {
    const on = other === id;
    await expect(tab(page, other), other).toHaveAttribute("aria-selected", on ? "true" : "false");
    await expect(tab(page, other), other).toHaveAttribute("tabindex", on ? "0" : "-1");
    if (on) await expect(panel(page, other), other).toBeVisible();
    else await expect(panel(page, other), other).toBeHidden();
  }
}

const tabInUrl = (id: TabId) => new RegExp(`[?&]tab=${id}(?:[&#]|$)`);

async function openBrand(page: Page, path: string) {
  await page.goto(path);
  await settle(page);
}

/** Quillmoor's segments from the Audience agent and its market notes, made here only when missing (as ensureExtras does). */
async function ensureAudience(page: Page, quillmoor: string) {
  await openBrand(page, `/brands/${quillmoor}?tab=audience`);
  if ((await segments(page).locator('[data-segment-card="agent"]').count()) === 0) {
    await step(page, "Find audiences on Quillmoor (none from the agent yet)", async () => {
      await segments(page).getByRole("button", { name: "Find audiences" }).click();
      await expect(segments(page).getByText("Completed")).toBeVisible({ timeout: 90_000 });
    });
  }
  if ((await market(page).locator("[data-market-note]").count()) === 0) {
    await step(page, "Refresh Quillmoor's market notes (none yet)", async () => {
      await market(page).getByRole("button", { name: "Refresh market notes" }).click();
      const confirm = market(page).locator("[data-market-confirm]");
      await expect(confirm.or(toast(page, "The Market agent is searching the web")).first()).toBeVisible();
      if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Refresh anyway" }).click();
      await expect(market(page).getByRole("button", { name: "Refresh market notes" })).toBeEnabled({ timeout: 90_000 });
      await untilShown(page, () => expect(market(page).locator("[data-market-note]").first()).toBeVisible({ timeout: 10_000 }), 60_000);
    });
  }
}

let fernhollow = "";
let quillmoor = "";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  fernhollow = await demoBrandId(page, "Fernhollow Outfitters");
  quillmoor = await demoBrandId(page, "Quillmoor Money");
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.describe("U10-7 campaigns first", () => {
  test.describe.configure({ mode: "serial" });
  /** The campaign case 2 starts from Quillmoor's brand page. */
  let campaignId = "";

  test(
    "U10-7 #2: New campaign opens the form, and submitting it writes the brief as today",
    { annotation: [{ type: "case", description: "U10-7.2" }] },
    async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(DESKTOP);
      await openBrand(page, `/brands/${quillmoor}`);

      await step(page, "U10-7.2: the form is closed; New campaign is a button that says so", async () => {
        await expect(newButton(page)).toHaveCount(1);
        await expect(newButton(page)).toHaveAccessibleName("New campaign");
        await expect(newButton(page)).toHaveAttribute("aria-expanded", "false");
        await expect(objectiveBox(page)).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Write the brief" }).filter({ visible: true })).toHaveCount(0);
      });

      await step(page, "U10-7.2: New campaign opens the form in place", async () => {
        await newButton(page).click();
        await expect(newButton(page)).toHaveAttribute("aria-expanded", "true");
        const controls = (await newButton(page).getAttribute("aria-controls"))!;
        expect(controls, "aria-controls names the form's container").toBeTruthy();
        await expect(page.locator(`[id="${controls}"]`)).toBeVisible();
        await expect(page.locator(`[id="${controls}"]`).getByRole("textbox", { name: "Objective" })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}`));
      });

      await step(page, "U10-7.2: submitting it opens the new campaign on its overview, and the Brief agent writes version 1", async () => {
        await objectiveBox(page).fill(OBJECTIVE);
        await page.getByRole("button", { name: "Write the brief" }).filter({ visible: true }).click();
        await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        const path = new URL(page.url()).pathname;
        campaignId = path.split("/").pop()!;
        await openStage(page, "brief", path);
        await untilShown(page, () => expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible({ timeout: 10_000 }), 60_000);
      });
    },
  );

  test(
    "U10-7 #1: at 375 px the brand page's first screen shows its campaigns with their status and objective, and New campaign",
    { annotation: [{ type: "case", description: "U10-7.1" }] },
    async ({ page }) => {
      expect(campaignId, "the campaign from case 2's test").not.toBe("");
      for (const [width, size] of SIZES) {
        await step(page, `U10-7.1: Quillmoor's brand page at ${width} px opens on its campaigns and New campaign`, async () => {
          await page.setViewportSize(size);
          await openBrand(page, `/brands/${quillmoor}`);
          await expect(campaigns(page)).toHaveCount(1);
          await expect(campaigns(page).getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();

          // The first row: real status (U10-1) and objective, wholly on the first screen, with New campaign.
          const first = campaigns(page).locator("[data-brand-campaign]").first();
          await expect(first).toBeVisible();
          await expect(first.locator("[data-campaign-status]")).toHaveText(STATUS_WORDS);
          await expect(first.locator("[data-campaign-objective]")).toHaveText(/\S{3,}/);
          await expect(first.getByRole("link")).toHaveAttribute("href", /^\/campaigns\/[0-9a-f-]{36}$/);
          expect(await inFirstScreen(page, first), `the first campaign is wholly within the first screen at ${width} px`).toBe(true);
          expect(await inFirstScreen(page, newButton(page)), `New campaign is wholly within the first screen at ${width} px`).toBe(true);
          // The campaigns come before the reference data.
          const order = await page.evaluate(() => {
            const c = Array.from(document.querySelectorAll("[data-brand-campaigns]")).find((x) => (x as HTMLElement).offsetParent !== null);
            const t = Array.from(document.querySelectorAll("[data-brand-tabs]")).find((x) => (x as HTMLElement).offsetParent !== null);
            return c && t ? c.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
          });
          expect(order, "the campaigns are above the tabs").toBeTruthy();
          await expect(campaigns(page).locator('[role="tabpanel"]')).toHaveCount(0);

          // Case 2's campaign, with its brief written: Draft, never "Draft v1", with its objective.
          const ours = campaigns(page).locator(`[data-brand-campaign="${campaignId}"]`);
          await expect(ours).toHaveCount(1);
          await expect(ours.locator("[data-campaign-status]")).toHaveText(CAMPAIGN_STATUS_LABELS.draft);
          await expect(ours.locator("[data-campaign-objective]")).toContainText(OBJECTIVE);
          await expect(ours.getByRole("link")).toHaveAttribute("href", `/campaigns/${campaignId}`);
          await expect(campaigns(page)).not.toContainText(/Draft v\d/);

          await expectNoHorizontalScroll(page, `Quillmoor's brand page at ${width} px`);
          expect(await contrastViolations(page), `Quillmoor's brand page at ${width} px`).toEqual([]);
        });
      }
    },
  );
});

test(
  "U10-7 #3: each tab shows its own section and is in the URL; a shared link opens that tab, and an unknown tab shows the first",
  { annotation: [{ type: "case", description: "U10-7.3" }] },
  async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const what: Record<TabId, () => Promise<void>> = {
      audience: async () => {
        await expect(segments(page)).toBeVisible();
        await expect(segments(page).locator("[data-segment-card]").first()).toBeVisible();
        await expect(panel(page, "audience").getByRole("heading", { name: "Market notes", exact: true })).toBeVisible();
      },
      voice: async () => {
        await expect(panel(page, "voice").getByRole("list", { name: "Tone words" })).toBeVisible();
        await expect(panel(page, "voice").locator(`a[href="/brands/${fernhollow}/edit"]`).first()).toBeVisible();
      },
      legal: async () => {
        await expect(panel(page, "legal").getByRole("list", { name: "Required legal lines" })).toContainText("Prices include VAT.");
        await expect(panel(page, "legal").locator("[data-brand-languages]")).toBeVisible();
        await expect(panel(page, "legal").locator(`[data-brand-languages] a[href="/brands/${fernhollow}/languages"]`)).toBeVisible();
      },
      products: async () => {
        await expect(panel(page, "products").getByRole("heading", { name: "Products", exact: true })).toBeVisible();
        await expect(panel(page, "products").getByRole("heading", { name: "Customers and orders", exact: true })).toBeVisible();
        await expect(panel(page, "products").locator("[data-figure]").first()).toBeAttached();
      },
    };

    for (const [id, label] of TABS) {
      await step(page, `U10-7.3: a shared link to ?tab=${id} opens ${label}, with its section`, async () => {
        await openBrand(page, `/brands/${fernhollow}?tab=${id}`);
        await expect(tablist(page).getByRole("tab")).toHaveText(TABS.map(([, l]) => l));
        await expect(tab(page, id)).toHaveAccessibleName(label);
        await expectSelected(page, id);
        await what[id]();
        // Each section lives in its own tab only.
        for (const [other] of TABS) if (other !== id) await expect(panel(page, other)).toBeHidden();
      });
    }

    await step(page, "U10-7.3: choosing a tab puts it in the URL, and a reload keeps it", async () => {
      await openBrand(page, `/brands/${fernhollow}`);
      await expectSelected(page, "audience");
      await tab(page, "products").click();
      await expectSelected(page, "products");
      await expect(page).toHaveURL(tabInUrl("products"));
      await what.products();
      await tab(page, "legal").click();
      await expect(page).toHaveURL(tabInUrl("legal"));
      await page.reload();
      await settle(page);
      await expectSelected(page, "legal");
      await what.legal();
    });

    await step(page, "U10-7.3: a tab keeps the other parameters in the URL (a search)", async () => {
      await openBrand(page, `/brands/${fernhollow}?q=lapsed`);
      await tab(page, "voice").click();
      await expect(page).toHaveURL(tabInUrl("voice"));
      await expect(page).toHaveURL(/[?&]q=lapsed(?:[&#]|$)/);
    });

    for (const [why, path] of [
      ["no tab", `/brands/${fernhollow}`],
      ["an unknown tab (the failure path)", `/brands/${fernhollow}?tab=nope`],
      ["a tab in the wrong case", `/brands/${fernhollow}?tab=Voice`],
      ["an old run's link to the segments", `/brands/${fernhollow}#segments`],
      ["an old run's link to the market notes", `/brands/${fernhollow}#market`],
    ] as const) {
      await step(page, `U10-7.3: ${why} shows the first tab, Audience, never an empty page`, async () => {
        await openBrand(page, path);
        await expectSelected(page, "audience");
        await what.audience();
      });
    }

    await step(page, "U10-7.3 and rule 1: Products and data says Simulated data once for its customers and orders, not on every figure", async () => {
      await openBrand(page, `/brands/${fernhollow}?tab=products`);
      const customers = panel(page, "products").locator("section:has(h2#customers)");
      await expect(customers).toBeVisible();
      expect(await said(customers, "Simulated data")).toBe(1);
      for (const f of await customers.locator("[data-figure]").all()) {
        expect(await said(f, "Simulated data"), (await f.getAttribute("data-figure"))!).toBe(0);
      }
    });
  },
);

test(
  "U10-7 #4: a segment card shows its name, size and one-line definition until opened, and nothing is shown twice",
  { tag: "@brand-kit", annotation: [{ type: "case", description: "U10-7.4" }] },
  async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(PHONE);
    await ensureAudience(page, quillmoor);
    await openBrand(page, `/brands/${quillmoor}?tab=audience`);
    const cards = segments(page).locator("[data-segment-card]");
    const agentCards = segments(page).locator('[data-segment-card="agent"]');

    await step(page, "U10-7.4: closed, each card shows its name, size and one-line definition, and none of the rest", async () => {
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      expect(await agentCards.count()).toBeGreaterThanOrEqual(1);
      for (const card of await cards.all()) {
        const name = (await card.getByRole("heading", { level: 3 }).textContent())?.trim() ?? "";
        expect(name.length, "the card's name").toBeGreaterThan(2);
        await expect(card.getByRole("heading", { level: 3 }), name).toBeVisible();
        await expect(card.locator("[data-segment-size]"), name).toBeVisible();
        await expect(card.locator("[data-segment-size]"), name).toHaveText(/^[\d,]+ (of [\d,]+ )?customers\b/);
        const definition = card.locator("[data-segment-definition]");
        await expect(definition, name).toBeVisible();
        const text = ((await definition.textContent()) ?? "").trim();
        expect(text.length, `${name}: its definition`).toBeGreaterThan(10);
        expect(text.match(/[.!?](\s|$)/g)?.length ?? 0, `${name}: the definition is one sentence ("${text}")`).toBeLessThanOrEqual(1);
        for (const w of [...DETAIL_WORDS, "Simulated data", "Proposed by the Audience agent", "Suggested use"]) {
          expect(text, `${name}: the definition holds no "${w}"`).not.toContain(w);
        }
        // The rest waits until the card is opened; the section, not the card, says Simulated data (rule 1).
        for (const w of [...DETAIL_WORDS, "Simulated data", "Suggested use"]) expect(await said(card, w), `${name}: "${w}" on the closed card`).toBe(0);
        expect(await said(card, "Proposed by the Audience agent"), `${name}: who proposed it, at most once`).toBeLessThanOrEqual(1);
        const details = card.locator("[data-segment-details]");
        if ((await details.count()) > 0) await expect(details, name).toBeHidden();
      }
    });

    await step(page, "U10-7.4: an agent's card opens in place, with the rest of its facts and its Remove", async () => {
      const card = agentCards.first();
      const name = ((await card.getByRole("heading", { level: 3 }).textContent()) ?? "").trim();
      const open = card.locator("[data-segment-open]");
      await expect(open).toHaveCount(1);
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(card.locator("[data-segment-details]")).toBeVisible();
      await expect(card.locator("[data-segment-details]")).toContainText("agreed to marketing");
      await expect(card.getByRole("button", { name: `Remove the segment ${name}` })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}`));
    });

    await step(page, "U10-7.4 and rule 1: with every card open, nothing on a card is said twice, and Simulated data is said once for the section", async () => {
      for (const card of await cards.all()) {
        const open = card.locator("[data-segment-open]");
        if ((await open.count()) === 0) continue;
        const details = card.locator("[data-segment-details]");
        if (await details.isHidden()) await open.click();
        await expect(details).toBeVisible();
      }
      for (const card of await cards.all()) {
        const name = ((await card.getByRole("heading", { level: 3 }).textContent()) ?? "").trim();
        const definition = ((await card.locator("[data-segment-definition]").textContent()) ?? "").trim();
        const size = ((await card.locator("[data-segment-size]").textContent()) ?? "").trim();
        expect(await said(card, definition), `${name}: the definition once`).toBe(1);
        expect(await said(card, size), `${name}: the size once`).toBe(1);
        expect(await said(card, "Simulated data"), `${name}: no Simulated data on the card`).toBe(0);
        expect(await said(card, "Proposed by the Audience agent"), `${name}: who proposed it, at most once`).toBeLessThanOrEqual(1);
        expect(await said(card, "From the customer summary"), `${name}: where it came from, at most once`).toBeLessThanOrEqual(1);
      }
      expect(await said(segments(page), "Simulated data"), "the Segments section says Simulated data once").toBe(1);
    });

    await step(page, "Rule 2: market notes still name real companies, with their sources", async () => {
      const notes = market(page).locator("[data-market-note]");
      expect(await notes.count()).toBeGreaterThanOrEqual(1);
      for (const n of await notes.all()) {
        const links = n.getByRole("link");
        expect(await links.count()).toBeGreaterThanOrEqual(1);
        for (const l of await links.all()) {
          await expect(l).toHaveAttribute("href", /^https:\/\//);
          await expect(l).toHaveAttribute("target", "_blank");
          await expect(l).toHaveAttribute("rel", "noopener noreferrer");
        }
      }
      await expect(market(page).locator("[data-real-names]").first()).toContainText("Names real companies:");
    });

    await expectNoHorizontalScroll(page, "Quillmoor's Audience tab at 375 px");
    expect(await contrastViolations(page), "Quillmoor's Audience tab with every card open").toEqual([]);
  },
);

test(
  "U10-7 #5: the brand page's tabs work by keyboard with the right roles, and axe finds nothing",
  { annotation: [{ type: "case", description: "U10-7.5" }] },
  async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openBrand(page, `/brands/${fernhollow}?tab=audience`);
    const axe = async (what: string) => {
      const results = await new AxeBuilder({ page }).include("[data-brand-tabs]").analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(", ")}`), what).toEqual([]);
    };
    const arrive = async (id: TabId) => {
      await expectSelected(page, id);
      await expect(tab(page, id)).toBeFocused();
      await expect(page).toHaveURL(tabInUrl(id));
    };

    await step(page, "U10-7.5: one named tablist, four tabs in order, each wired to its panel", async () => {
      await expect(tabsRoot(page).getByRole("tablist")).toHaveCount(1);
      await expect(tablist(page)).toHaveAccessibleName(/\S/);
      await expect(tablist(page).getByRole("tab")).toHaveText(TABS.map(([, l]) => l));
      for (const [id] of TABS) {
        await expect(tab(page, id)).toHaveAttribute("aria-controls", (await panel(page, id).getAttribute("id"))!);
        await expect(panel(page, id)).toHaveAttribute("aria-labelledby", (await tab(page, id).getAttribute("id"))!);
      }
      await expectSelected(page, "audience");
      await axe("with Audience selected");
    });

    await step(page, "U10-7.5: ArrowRight and ArrowLeft move and select, and put the tab in the URL", async () => {
      await tab(page, "audience").focus();
      await page.keyboard.press("ArrowRight");
      await arrive("voice");
      await page.keyboard.press("ArrowRight");
      await arrive("legal");
      await page.keyboard.press("ArrowLeft");
      await arrive("voice");
      await page.keyboard.press("ArrowLeft");
      await arrive("audience");
    });

    await step(page, "U10-7.5: the arrows wrap, and Home and End go to the first and last tab", async () => {
      await page.keyboard.press("ArrowLeft");
      await arrive("products");
      await page.keyboard.press("ArrowRight");
      await arrive("audience");
      await page.keyboard.press("End");
      await arrive("products");
      await page.keyboard.press("Home");
      await arrive("audience");
    });

    for (const [id, label] of TABS) {
      await step(page, `U10-7.5: with ${label} selected, Tab moves from the tab into its panel; axe finds nothing`, async () => {
        await tab(page, id).click();
        await expectSelected(page, id);
        await tab(page, id).focus();
        await page.keyboard.press("Tab");
        expect(await panel(page, id).evaluate((p) => p === document.activeElement || p.contains(document.activeElement)), `focus in the ${label} panel`).toBe(true);
        await axe(`with ${label} selected`);
      });
    }

    for (const [width, size] of SIZES) {
      await step(page, `U10-7.5: at ${width} px the tabs fit without sideways scroll, with AA contrast`, async () => {
        await page.setViewportSize(size);
        for (const [id] of TABS) {
          await openBrand(page, `/brands/${fernhollow}?tab=${id}`);
          await expectNoHorizontalScroll(page, `Fernhollow's ${id} tab at ${width} px`);
          expect(await contrastViolations(page), `Fernhollow's ${id} tab at ${width} px`).toEqual([]);
        }
      });
    }
  },
);

test(
  "U10-7 #7: the kit editor is within its length budget, and Save brand kit is on screen without scrolling at 375 px and 1440 px",
  { annotation: [{ type: "case", description: "U10-7.7" }] },
  async ({ page }) => {
    for (const [width, size] of SIZES) {
      await step(page, `U10-7.7: Fernhollow's kit editor at ${width} px`, async () => {
        await page.setViewportSize(size);
        await openBrand(page, `/brands/${fernhollow}/edit`);
        await expect(page.getByRole("heading", { name: "Edit brand kit", level: 1 })).toBeVisible();
        await expectSaveAlwaysOnScreen(page, "Save brand kit", `kit editor at ${width} px`);
        await expectWithinLength(page, "Brand kit editor", width);
        await expectNoHorizontalScroll(page, `the kit editor at ${width} px`);
        expect(await contrastViolations(page), `the kit editor at ${width} px`).toEqual([]);
      });
    }
  },
);

test(
  "U10-7 #8: the languages page is within its length budget, Save languages is on screen without scrolling at 375 px and 1440 px, and saving still works",
  { tag: "@brand-kit", annotation: [{ type: "case", description: "U10-7.8" }] },
  async ({ page }) => {
    test.setTimeout(120_000);
    const languages = `/brands/${quillmoor}/languages`;
    const spanish = () => page.getByRole("checkbox", { name: "Translate ads into Spanish" });
    const save = () => visible(page, "[data-save-bar]").getByRole("button", { name: "Save languages", exact: true });

    await step(page, "Quillmoor has its three demo languages to start with", async () => {
      await openBrand(page, languages);
      const add = page.getByRole("button", { name: "Add the demo languages" });
      if (await add.isVisible()) {
        await add.click();
        await expect(toast(page, /^Added \d demo language/)).toBeVisible({ timeout: 30_000 });
        await openBrand(page, languages);
      }
      await expect(spanish()).toBeChecked();
    });

    for (const [width, size] of SIZES) {
      await step(page, `U10-7.8: Quillmoor's languages page at ${width} px`, async () => {
        await page.setViewportSize(size);
        await openBrand(page, languages);
        await expectSaveAlwaysOnScreen(page, "Save languages", `languages page at ${width} px`);
        await expectWithinLength(page, "Brand languages", width);
        await expectNoHorizontalScroll(page, `the languages page at ${width} px`);
        expect(await contrastViolations(page), `the languages page at ${width} px`).toEqual([]);
      });
    }

    try {
      await step(page, "U10-7.8: at 375 px, leave Spanish out: Save is on screen where the change was made, and saving works", async () => {
        await page.setViewportSize(PHONE);
        await openBrand(page, languages);
        await spanish().uncheck();
        await expect(spanish()).not.toBeChecked();
        // No scrolling back up: Save is on screen beside the change.
        await expect.poll(() => onScreen(save())).toBe(true);
        await save().click();
        await expect(toast(page, "Saved. Ads can be translated into French and German.")).toBeVisible({ timeout: 30_000 });
        await page.reload();
        await settle(page);
        await expect(spanish()).not.toBeChecked();
        await expect(page.getByRole("checkbox", { name: "Translate ads into French" })).toBeChecked();
        await expect(page.getByRole("checkbox", { name: "Translate ads into German" })).toBeChecked();
      });
    } finally {
      await step(page, "Put Quillmoor's Spanish back, with its lines written for the demo", async () => {
        await openBrand(page, languages);
        const add = page.getByRole("button", { name: "Add the demo languages" });
        if (await add.isVisible()) {
          await add.click();
          await expect(toast(page, /^Added 1 demo language/)).toBeVisible({ timeout: 30_000 });
          await page.reload();
          await settle(page);
        }
        await expect(spanish()).toBeChecked();
        await expect(page.locator("[data-language-form]").getByText("Written for the demo", { exact: true })).toHaveCount(3);
      });
    }
  },
);
