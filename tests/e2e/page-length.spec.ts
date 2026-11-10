// U10-6 Length budgets, checked in CI: every page within its budget at 375 px
// and 1440 px (case 1), each page's main action within its first 1.5 screens
// at 375 px (case 2), and the check's own failure message, on a deliberately
// long fixture page (case 3; also tests/lib/page-budgets.test.ts).
//
// The budgets, the pages and their main actions are one table,
// tests/e2e/page-budgets.ts, which also says what later stories must provide
// (its interface comment). The data is the audit's fullest
// (tests/e2e/fullest-data.ts): built beside the other specs by the
// page-length-data project, and measured here, in the page-length project,
// once every other spec has run, so every list is as long as the suite makes
// it. Run on its own, this spec builds what is missing first (about twenty
// minutes with the mock models).
//
// A page over budget that a later Sprint 10 story fixes is skipped with
// "Over budget until <story>" and its numbers, so the demo page shows the case
// as not run, never as passed; once it fits, its test fails until the marker
// is removed. Each test records what it measured ({ type: "measure" }), which
// the demo page shows.
//
// One test per page and case, each titled with the page's key from
// page-budgets.ts, so tests/e2e/cases.ts can name every one
// (tests/lib/cases.test.ts checks that every page has both). The length tests
// of U10-2's overview and stage pages carry U10-2.6 too (U10-2 case 6: each
// stage page within its budget with the audit's fullest data), the Creative
// stages' and Performance's among them (QA finding 3, 10 November). The brand
// page's and its tabs' tests carry U10-7.6 (U10-7 case 6), and the kit
// editor's and the languages page's carry U10-7.7 and U10-7.8 (answer B1).
// The campaigns list's carry U10-8.6 (answer B1 gave the list to U10-8).
import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { ensureExtras, fullestData } from "./fullest-data";
import { settle, signIn } from "./helpers";
import {
  BUDGET_SCREENS,
  budgetFor,
  lengthProblem,
  mainActionProblem,
  screensOf,
  verdict,
  VIEWPORT_HEIGHT,
  WIDTHS,
  type FullestData,
  type MainAction,
  type Measurement,
  type PageBudget,
  type Width,
} from "./page-budgets";

let data: FullestData | null = null;
const measured = new Map<string, Measurement>();

/**
 * Measures the page that is open, the audit's way: scrolled through so lazy
 * pictures load, back to the top, then its height, whether it is the not-found
 * screen, and the top of the main action's first visible match.
 */
async function measureOpenPage(page: Page, width: Width, action: MainAction | null, status: number): Promise<Measurement> {
  const viewportHeight = VIEWPORT_HEIGHT[width];
  for (let y = 0; y < (await page.evaluate(() => document.documentElement.scrollHeight)); y += viewportHeight) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const r = await page.evaluate((a) => {
    const vis = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    let top: number | null = null;
    if (a) {
      const el = Array.from(document.querySelectorAll(a.css)).find((e) => vis(e) && (!a.text || (e.textContent ?? "").includes(a.text)));
      if (el) top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    }
    const notFound = Array.from(document.querySelectorAll("h1")).some((h) => vis(h) && (h.textContent ?? "").trim() === "Not found");
    return { height: document.documentElement.scrollHeight, top, notFound };
  }, action);
  return { width, viewportHeight, status, notFound: status >= 400 || r.notFound, height: r.height, mainActionTop: r.top };
}

/** A page measured at a width, once per run (case 1's test measures; case 2's reads the same 375 px measurement). */
async function measure(page: Page, browser: Browser, b: PageBudget, width: Width): Promise<Measurement> {
  const key = `${b.key}@${width}`;
  const known = measured.get(key);
  if (known) return known;
  if (!data) throw new Error("No fullest data: the beforeAll hook didn't finish");
  const ctx = b.signedIn ? null : await browser.newContext();
  const target = ctx ? await ctx.newPage() : page;
  try {
    await target.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] });
    const res = await target.goto(b.path(data));
    await settle(target);
    const m = await measureOpenPage(target, width, b.mainAction, res?.status() ?? 0);
    measured.set(key, m);
    return m;
  } finally {
    await ctx?.close();
  }
}

function record(b: PageBudget, m: Measurement, what: string) {
  test.info().annotations.push({ type: "measure", description: `${b.name} at ${m.width}px: ${what}` });
}

/** Passes, fails or skips as page-budgets.ts's verdict() says. */
function apply(v: ReturnType<typeof verdict>) {
  if (v.kind === "fail") throw new Error(v.message);
  if (v.kind === "skip") test.skip(true, v.message);
}

async function checkLength(page: Page, browser: Browser, key: string) {
  const b = budgetFor(key);
  const problems: string[] = [];
  for (const width of WIDTHS) {
    const m = await measure(page, browser, b, width);
    record(b, m, `${m.height.toLocaleString("en-GB")} px, ${screensOf(m.height, m.viewportHeight)} screens (budget ${BUDGET_SCREENS[width]})${m.notFound && !b.notFoundPage ? ", the not-found screen" : ""}`);
    const p = lengthProblem(b.name, m, b);
    if (p) problems.push(p);
  }
  apply(verdict(b.name, problems, b.lengthUntil, "lengthUntil"));
}

async function checkMainAction(page: Page, browser: Browser, key: string) {
  const b = budgetFor(key);
  if (!b.mainAction) throw new Error(`${b.name} has no main action in tests/e2e/page-budgets.ts`);
  const m = await measure(page, browser, b, 375);
  record(b, m, m.mainActionTop === null ? `main action (${b.mainAction.what}) not found` : `main action (${b.mainAction.what}) at ${m.mainActionTop.toLocaleString("en-GB")} px, ${screensOf(m.mainActionTop, m.viewportHeight)} screens`);
  const p = mainActionProblem(b.name, b.mainAction, m, b);
  apply(verdict(b.name, p ? [p] : [], b.mainActionUntil, "mainActionUntil"));
}

test.describe("U10-6 every page, with the audit's fullest data", () => {
  test.beforeAll(async ({ browser }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to find, build and check the fullest data");
    test.setTimeout(1_800_000);
    const page = await browser.newPage();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await signIn(page);
      data = await fullestData(page, sql, { build: true });
      await ensureExtras(page, sql, data);
    } finally {
      await sql.end();
      await page.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  // ---------------------------------------------------------------- case 1: every page within its budget at both widths
  test("U10-6 #1: welcome is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "welcome");
  });
  test("U10-6 #1: home is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "home");
  });
  test("U10-6 #1: brands is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brands");
  });
  test("U10-6 #1: brand-fernhollow is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-fernhollow");
  });
  test("U10-6 #1: brand-quillmoor is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-quillmoor");
  });
  test("U10-6 #1: brand-quillmoor-audience is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-quillmoor-audience");
  });
  test("U10-6 #1: brand-quillmoor-voice is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-quillmoor-voice");
  });
  test("U10-6 #1: brand-quillmoor-legal is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-quillmoor-legal");
  });
  test("U10-6 #1: brand-quillmoor-products is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-quillmoor-products");
  });
  test("U10-6 #1: brand-kit-editor is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.7" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-kit-editor");
  });
  test("U10-6 #1: brand-languages is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-7.8" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "brand-languages");
  });
  test("U10-6 #1: campaigns is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-8.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaigns");
  });
  test("U10-6 #1: campaign-live is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-live");
  });
  test("U10-6 #1: campaign-live-brief is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-live-brief");
  });
  test("U10-6 #1: campaign-live-audience is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-live-audience");
  });
  test("U10-6 #1: campaign-live-creative is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-live-creative");
  });
  test("U10-6 #1: campaign-live-launch is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-live-launch");
  });
  test("U10-6 #1: performance is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "performance");
  });
  test("U10-6 #1: campaign-two-audiences is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-two-audiences");
  });
  test("U10-6 #1: campaign-two-audiences-creative is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-two-audiences-creative");
  });
  test("U10-6 #1: campaign-waiting is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-waiting");
  });
  test("U10-6 #1: campaign-waiting-brief is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-waiting-brief");
  });
  test("U10-6 #1: campaign-early is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-early");
  });
  test("U10-6 #1: campaign-early-brief is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }, { type: "case", description: "U10-2.6" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "campaign-early-brief");
  });
  test("U10-6 #1: approvals is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "approvals");
  });
  test("U10-6 #1: runs is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "runs");
  });
  test("U10-6 #1: run-trail is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "run-trail");
  });
  test("U10-6 #1: run-awaiting is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "run-awaiting");
  });
  test("U10-6 #1: invites is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "invites");
  });
  test("U10-6 #1: not-found-app is within its length budget at 375 px and 1440 px", { annotation: [{ type: "case", description: "U10-6.1" }] }, async ({ page, browser }) => {
    await checkLength(page, browser, "not-found-app");
  });

  // ---------------------------------------------------------------- case 2: each page's main action within 1.5 screens at 375 px
  test("U10-6 #2: the main action of welcome is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "welcome");
  });
  test("U10-6 #2: the main action of home is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "home");
  });
  test("U10-6 #2: the main action of brands is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brands");
  });
  test("U10-6 #2: the main action of brand-fernhollow is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-fernhollow");
  });
  test("U10-6 #2: the main action of brand-quillmoor is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-quillmoor");
  });
  test("U10-6 #2: the main action of brand-quillmoor-audience is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-quillmoor-audience");
  });
  test("U10-6 #2: the main action of brand-quillmoor-voice is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-quillmoor-voice");
  });
  test("U10-6 #2: the main action of brand-quillmoor-legal is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-quillmoor-legal");
  });
  test("U10-6 #2: the main action of brand-quillmoor-products is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.6" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-quillmoor-products");
  });
  test("U10-6 #2: the main action of brand-kit-editor is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.7" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-kit-editor");
  });
  test("U10-6 #2: the main action of brand-languages is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-7.8" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "brand-languages");
  });
  test("U10-6 #2: the main action of campaigns is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }, { type: "case", description: "U10-8.6" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaigns");
  });
  test("U10-6 #2: the main action of campaign-live is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-live");
  });
  test("U10-6 #2: the main action of campaign-live-brief is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-live-brief");
  });
  test("U10-6 #2: the main action of campaign-live-audience is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-live-audience");
  });
  test("U10-6 #2: the main action of campaign-live-creative is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-live-creative");
  });
  test("U10-6 #2: the main action of campaign-live-launch is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-live-launch");
  });
  test("U10-6 #2: the main action of performance is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "performance");
  });
  test("U10-6 #2: the main action of campaign-two-audiences is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-two-audiences");
  });
  test("U10-6 #2: the main action of campaign-two-audiences-creative is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-two-audiences-creative");
  });
  test("U10-6 #2: the main action of campaign-waiting is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-waiting");
  });
  test("U10-6 #2: the main action of campaign-waiting-brief is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-waiting-brief");
  });
  test("U10-6 #2: the main action of campaign-early is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-early");
  });
  test("U10-6 #2: the main action of campaign-early-brief is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "campaign-early-brief");
  });
  test("U10-6 #2: the main action of approvals is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "approvals");
  });
  test("U10-6 #2: the main action of runs is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "runs");
  });
  test("U10-6 #2: the main action of run-trail is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "run-trail");
  });
  test("U10-6 #2: the main action of run-awaiting is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "run-awaiting");
  });
  test("U10-6 #2: the main action of invites is within 1.5 screens at 375 px", { annotation: [{ type: "case", description: "U10-6.2" }] }, async ({ page, browser }) => {
    await checkMainAction(page, browser, "invites");
  });
});

// ---------------------------------------------------------------- case 3: the check's own failure message
test(
  "U10-6 #3: a page over its budget fails with its measured height and the budget in the message",
  { annotation: [{ type: "case", description: "U10-6.3" }] },
  async ({ page }) => {
    // A deliberately long fixture page: 10,000 px tall, its one button 9,000 px down.
    await page.setViewportSize({ width: 375, height: VIEWPORT_HEIGHT[375] });
    await page.setContent(
      '<!doctype html><html><head><style>html,body,h1{margin:0}main{position:relative;height:10000px}button{position:absolute;top:9000px}</style></head>' +
        "<body><main><h1>Deliberately long fixture</h1><button>Save the long form</button></main></body></html>",
    );
    const action: MainAction = { css: "button", text: "Save the long form", what: "Save the long form" };
    const m = await measureOpenPage(page, 375, action, 200);
    expect(m).toMatchObject({ height: 10_000, mainActionTop: 9_000, notFound: false });

    const length = verdict("Deliberately long fixture", [lengthProblem("Deliberately long fixture", m)!], undefined, "lengthUntil");
    expect(() => apply(length)).toThrow(
      "Deliberately long fixture at 375px is 10,000 px tall, 12.3 screens of 812 px; its budget is 6 screens (4,872 px).",
    );
    const main = verdict("Deliberately long fixture", [mainActionProblem("Deliberately long fixture", action, m)!], undefined, "mainActionUntil");
    expect(() => apply(main)).toThrow(
      'Deliberately long fixture at 375px: its main action, Save the long form (button with "Save the long form"), is 9,000 px down, 11.1 screens; it must start within 1.5 screens (1,218 px).',
    );

    // The same page cut to fit passes both.
    await page.setContent('<!doctype html><html><head><style>html,body,h1{margin:0}main{height:3000px}</style></head><body><main><h1>Short</h1><button>Save the long form</button></main></body></html>');
    const short = await measureOpenPage(page, 375, action, 200);
    expect(lengthProblem("Short fixture", short)).toBeNull();
    expect(mainActionProblem("Short fixture", action, short)).toBeNull();
  },
);
