// U10-6 Length budgets (Sprint 10, answer Q7): every page at most 6 screens
// at 375 px (an 812 px viewport) and 4 at 1440 px (900 px), with the audit's
// fullest data, and each page's main action within its first 1.5 screens at
// 375 px. The one table of budgets, read by tests/e2e/page-length.spec.ts
// (which measures) and tests/lib/page-budgets.test.ts (which checks the
// messages and this table). Pure: no Playwright, no database, no app code.
//
// A screen is the page's height (document.documentElement.scrollHeight)
// divided by the viewport's height; a main action's depth is the distance from
// the top of the document to the top of its first visible match (the audit's
// measure, 8 November 2026).
//
// Pages built or reshaped by a later Sprint 10 story carry `lengthUntil` or
// `mainActionUntil` with that story's id. Their tests measure and then:
// - over budget: skip, saying "Over budget until <story>" with the numbers,
//   so the demo page shows the case as not run rather than passed;
// - within budget: fail, telling the builder to remove the marker, so the
//   budget holds from the day the story makes the page fit.
// `unassigned` marks a page over budget today that no Sprint 10 story
// shortens: it skips while over and passes when within, with no marker to
// remove; Rory decides whether it gets a story or an exception. The guard in
// tests/lib/page-budgets.test.ts lists them, so a new one needs a deliberate change.
//
// ---------------------------------------------------------------- interface
// The selectors and addresses later stories provide (their own cases point here):
// - U10-2: /campaigns/[id] is the overview, with a "Needs you" list at
//   [data-needs-you] (also when there is nothing: "Nothing needs you" inside it);
//   the stage pages /campaigns/[id]/brief, /audience, /creative and /launch.
//   The brief page keeps [data-signoff-panel]; the audience page keeps
//   [data-persona-review]; the launch page keeps [data-launch-panel].
// - U10-3: the creative page's filter row at [data-gallery-filter], measured
//   with its default filter.
// - U10-4: the Performance page's ads below threshold or tiring now at
//   [data-perf-attention], above the alerts and the chart.
// - U10-5: home's "Needs you" list at [data-needs-you].
// - U10-7: the brand page's "New campaign" button at [data-new-campaign], near
//   its campaigns; its sections as tabs whose address is ?tab=<id>, with ids
//   audience (segments and market notes), voice (voice and visual), legal
//   (legal and languages) and products (products and data), each tab's
//   content in [role=tabpanel]. If U10-7 names them differently, change the
//   paths here with it.
// - U10-8: the runs list shows at most one page of runs, with "Older runs".
// ----------------------------------------------------------------------------

export type Width = 375 | 1440;
export const WIDTHS: readonly Width[] = [375, 1440];
/** The viewport each width is measured in (the audit's). */
export const VIEWPORT_HEIGHT: Record<Width, number> = { 375: 812, 1440: 900 };
/** Q7: at most this many screens. */
export const BUDGET_SCREENS: Record<Width, number> = { 375: 6, 1440: 4 };
/** Q7: the main action starts within this many screens at 375 px. */
export const MAIN_ACTION_SCREENS = 1.5;

/** The ids the fullest data gives (tests/e2e/fullest-data.ts). */
export type FullestData = {
  fernhollow: string;
  quillmoor: string;
  /** Fernhollow, signed off, personas and test plan, 12 ads, 4 picked, ad 1 in three languages, pre-tested, live on simulated day 14 with alerts (one seen) and two questions. */
  live: string;
  /** Quillmoor, two audiences, 24 ads, not launched. */
  twoAudiences: string;
  /** Fernhollow, version 1 waiting for sign-off, with personas and a test plan. */
  waiting: string;
  /** Quillmoor, version 1, a draft. */
  early: string;
  /** The live campaign's Imagery run (a trail with many steps). */
  imageryRun: string;
  /** A tagline run waiting for a choice. */
  taglineRun: string;
};

export type Sprint10Story = "U10-1" | "U10-2" | "U10-3" | "U10-4" | "U10-5" | "U10-7" | "U10-8";
export type Until = { story: Sprint10Story | "unassigned"; why: string };
export type MainAction = { css: string; text?: string; what: string };

export type PageBudget = {
  /** Stable, used in the test titles. */
  key: string;
  name: string;
  path: (d: FullestData) => string;
  signedIn: boolean;
  mainAction: MainAction | null;
  lengthUntil?: Until;
  mainActionUntil?: Until;
  /** The page is the not-found screen on purpose. */
  notFoundPage?: boolean;
};


export const PAGE_BUDGETS: PageBudget[] = [
  { key: "welcome", name: "Welcome (signed out)", path: () => "/", signedIn: false, mainAction: { css: 'header a[href="/signin"]', what: "Sign in" } },
  {
    key: "home",
    name: "Home",
    path: () => "/",
    signedIn: true,
    mainAction: { css: "[data-needs-you]", what: "the Needs you list" },
    mainActionUntil: { story: "U10-5", why: "home leads with the Sprint 1 tagline demo; U10-5 puts Needs you first" },
  },
  { key: "brands", name: "Brands list", path: () => "/brands", signedIn: true, mainAction: { css: 'main a[href^="/brands/"]', what: "the first brand" } },
  {
    key: "brand-fernhollow",
    name: "Brand page (Fernhollow)",
    path: (d) => `/brands/${d.fernhollow}`,
    signedIn: true,
    mainAction: { css: "[data-new-campaign]", what: "New campaign, beside the brand's campaigns" },
    lengthUntil: { story: "U10-7", why: "products, charts and the open new-campaign form are shown in full (audit: 11.7 screens at 375 px)" },
    mainActionUntil: { story: "U10-7", why: "the campaign form is always open; Write the brief is 1.65 screens down" },
  },
  {
    key: "brand-quillmoor",
    name: "Brand page (Quillmoor, segments and market notes)",
    path: (d) => `/brands/${d.quillmoor}`,
    signedIn: true,
    mainAction: { css: "[data-new-campaign]", what: "New campaign, beside the brand's campaigns" },
    lengthUntil: { story: "U10-7", why: "10 segment cards and market notes in full (audit: 18.2 screens at 375 px)" },
    mainActionUntil: { story: "U10-7", why: "there is no New campaign button yet" },
  },
  ...(["audience", "voice", "legal", "products"] as const).map(
    (tab): PageBudget => ({
      key: `brand-quillmoor-${tab}`,
      name: `Brand page (Quillmoor), ${tab} tab`,
      path: (d) => `/brands/${d.quillmoor}?tab=${tab}`,
      signedIn: true,
      mainAction: { css: "[role=tabpanel]", what: `the ${tab} tab's content` },
      lengthUntil: { story: "U10-7", why: "the brand page has no tabs yet" },
      mainActionUntil: { story: "U10-7", why: "the brand page has no tabs yet" },
    }),
  ),
  {
    key: "brand-kit-editor",
    name: "Brand kit editor",
    path: (d) => `/brands/${d.fernhollow}/edit`,
    signedIn: true,
    mainAction: { css: "main button", text: "Save brand kit", what: "Save brand kit" },
    lengthUntil: {
      story: "unassigned",
      why: "7.2 screens at 375 px and 5.2 at 1440 px in the audit (75 controls, a full-width input and Remove button per list item); U10-1 only makes Save sticky, and no Sprint 10 story shortens the form",
    },
  },
  {
    key: "brand-languages",
    name: "Brand languages",
    path: (d) => `/brands/${d.fernhollow}/languages`,
    signedIn: true,
    mainAction: { css: "main button", text: "Save languages", what: "Save languages" },
    mainActionUntil: { story: "unassigned", why: "Save languages is at the end of the form, 3.4 screens down at 375 px (audit), and no Sprint 10 story moves it" },
  },
  {
    key: "campaigns",
    name: "Campaigns list",
    path: () => "/campaigns",
    signedIn: true,
    mainAction: { css: "[data-campaign-list]", what: "the list of campaigns" },
    lengthUntil: {
      story: "unassigned",
      why: "1.8 screens with the audit's 4 campaigns, but after the whole suite there are about 35, at roughly 110 px a row on a phone, and the list has no paging; no Sprint 10 story pages or shortens it",
    },
  },
  {
    key: "campaign-live",
    name: "Campaign overview, live on day 14",
    path: (d) => `/campaigns/${d.live}`,
    signedIn: true,
    mainAction: { css: "[data-needs-you]", what: "Needs you" },
  },
  {
    key: "campaign-live-brief",
    name: "Brief stage, live campaign",
    path: (d) => `/campaigns/${d.live}/brief`,
    signedIn: true,
    mainAction: { css: "[data-signoff-panel]", what: "the sign-off panel" },
  },
  {
    key: "campaign-live-audience",
    name: "Audience stage, live campaign",
    path: (d) => `/campaigns/${d.live}/audience`,
    signedIn: true,
    mainAction: { css: "[data-persona-review]", what: "the persona review" },
  },
  {
    key: "campaign-live-creative",
    name: "Creative stage, live campaign (default filter)",
    path: (d) => `/campaigns/${d.live}/creative`,
    signedIn: true,
    mainAction: { css: "[data-gallery-filter]", what: "the gallery's filters" },
  },
  {
    key: "campaign-live-launch",
    name: "Launch stage, live campaign",
    path: (d) => `/campaigns/${d.live}/launch`,
    signedIn: true,
    mainAction: { css: "[data-launch-panel]", what: "the launch panel and clock" },
  },
  {
    key: "performance",
    name: "Performance, day 14",
    path: (d) => `/campaigns/${d.live}/performance`,
    signedIn: true,
    mainAction: { css: "[data-perf-attention]", what: "the ads below threshold or tiring now" },
    lengthUntil: { story: "U10-4", why: "alerts in full, the chart, then the table, then every answer in full (audit: 7.6 screens at 375 px, 5.0 at 1440 px)" },
    mainActionUntil: { story: "U10-4", why: "the ads below threshold are in the table, 4.2 screens down" },
  },
  {
    key: "campaign-two-audiences",
    name: "Campaign overview, two audiences",
    path: (d) => `/campaigns/${d.twoAudiences}`,
    signedIn: true,
    mainAction: { css: "[data-needs-you]", what: "Needs you" },
  },
  {
    key: "campaign-two-audiences-creative",
    name: "Creative stage, two audiences (default filter)",
    path: (d) => `/campaigns/${d.twoAudiences}/creative`,
    signedIn: true,
    mainAction: { css: "[data-gallery-filter]", what: "the gallery's filters" },
    lengthUntil: {
      story: "U10-3",
      why: "two audiences of six compact cards each, with the checks folded and Show all for the rest (Rory's choices a and b, 9 November 2026): 6,062 px at 375 px (7.5 screens) and 3,590 px at 1440 px (within) on 9 November; twelve cards at about 290 px each on a phone don't fit in six screens",
    },
  },
  {
    key: "campaign-waiting",
    name: "Campaign overview, waiting for sign-off",
    path: (d) => `/campaigns/${d.waiting}`,
    signedIn: true,
    mainAction: { css: "[data-needs-you]", what: "Needs you" },
  },
  {
    key: "campaign-waiting-brief",
    name: "Brief stage, waiting for sign-off",
    path: (d) => `/campaigns/${d.waiting}/brief`,
    signedIn: true,
    mainAction: { css: "[data-signoff-panel] button", text: "Approve version", what: "Approve version 1" },
  },
  {
    key: "campaign-early",
    name: "Campaign overview, brief only",
    path: (d) => `/campaigns/${d.early}`,
    signedIn: true,
    mainAction: { css: "[data-needs-you]", what: "Needs you" },
  },
  {
    key: "campaign-early-brief",
    name: "Brief stage, brief only",
    path: (d) => `/campaigns/${d.early}/brief`,
    signedIn: true,
    mainAction: { css: "[data-signoff-panel] button", text: "for sign-off", what: "Send version 1 for sign-off" },
  },
  {
    key: "approvals",
    name: "Approvals inbox",
    path: () => "/approvals",
    signedIn: true,
    mainAction: { css: "[data-inbox-item] button", text: "Approve", what: "the first Approve" },
    lengthUntil: {
      story: "unassigned",
      why: "2.4 screens with the audit's 2 items, but a sign-off card embeds its personas and test plan, and after the whole suite several are waiting; no Sprint 10 story shortens the inbox",
    },
    mainActionUntil: { story: "unassigned", why: "a sign-off card embeds its personas and test plan, so Approve is 1.9 screens down at 375 px (audit), and no Sprint 10 story changes the inbox" },
  },
  {
    key: "runs",
    name: "Runs list (60 runs)",
    path: () => "/runs",
    signedIn: true,
    mainAction: { css: 'main a[href^="/runs/"]', what: "the first run" },
    lengthUntil: { story: "U10-8", why: "the list shows 50 runs at once with every cost labelled (about 7 screens at 375 px); U10-8 pages it" },
  },
  { key: "run-trail", name: "A run's trail (Imagery)", path: (d) => `/runs/${d.imageryRun}`, signedIn: true, mainAction: { css: "h2", text: "Result", what: "the result" } },
  { key: "run-awaiting", name: "Run waiting for a choice (tagline)", path: (d) => `/runs/${d.taglineRun}`, signedIn: true, mainAction: { css: 'input[type="radio"]', what: "the choice" } },
  { key: "invites", name: "Invites", path: () => "/invites", signedIn: true, mainAction: { css: "main button", text: "Create invite link", what: "Create invite link" } },
  { key: "not-found-app", name: "Not found in the app", path: () => "/runs/11111111-1111-4111-8111-111111111111", signedIn: true, mainAction: null, notFoundPage: true },
];

export function budgetFor(key: string): PageBudget {
  const b = PAGE_BUDGETS.find((x) => x.key === key);
  if (!b) throw new Error(`No page "${key}" in tests/e2e/page-budgets.ts`);
  return b;
}

/** What the spec measured on one page at one width. */
export type Measurement = {
  width: Width;
  viewportHeight: number;
  /** The page's HTTP status. */
  status: number;
  /**
   * The page is the not-found screen: a 4xx status, or the "Not found" heading (a well-formed id that isn't in
   * the workspace streams the screen with 200, F-12). A stage page that isn't built yet is one.
   */
  notFound: boolean;
  /** document.documentElement.scrollHeight, in CSS pixels. */
  height: number;
  /** The main action's distance from the top of the document, or null when it isn't on the page. */
  mainActionTop: number | null;
};

const px = (n: number) => `${Math.round(n).toLocaleString("en-GB")} px`;
export const screensOf = (height: number, viewportHeight: number) => Math.round((height / viewportHeight) * 10) / 10;

type Opts = { notFoundPage?: boolean };

function notMeasurable(name: string, m: Measurement, opts: Opts): string | null {
  if (opts.notFoundPage || !m.notFound) return null;
  return `${name} at ${m.width}px is the not-found screen (status ${m.status}), so it can't be within its budget (is the page built?).`;
}

/** Why a page is over its length budget at a width, with its measured height and the budget; null when it is within. */
export function lengthProblem(name: string, m: Measurement, opts: Opts = {}): string | null {
  const broken = notMeasurable(name, m, opts);
  if (broken) return broken;
  const budget = BUDGET_SCREENS[m.width];
  if (m.height <= budget * m.viewportHeight) return null;
  return `${name} at ${m.width}px is ${px(m.height)} tall, ${screensOf(m.height, m.viewportHeight)} screens of ${m.viewportHeight} px; its budget is ${budget} screens (${px(budget * m.viewportHeight)}).`;
}

/** Why a page's main action isn't within its first 1.5 screens at 375 px; null when it is. */
export function mainActionProblem(name: string, action: MainAction, m: Measurement, opts: Opts = {}): string | null {
  const broken = notMeasurable(name, m, opts);
  if (broken) return broken;
  const limit = MAIN_ACTION_SCREENS * m.viewportHeight;
  const what = `${action.what} (${action.css}${action.text ? ` with "${action.text}"` : ""})`;
  if (m.mainActionTop === null) return `${name} at ${m.width}px has no main action: ${what} isn't on the page.`;
  if (m.mainActionTop <= limit) return null;
  return `${name} at ${m.width}px: its main action, ${what}, is ${px(m.mainActionTop)} down, ${screensOf(m.mainActionTop, m.viewportHeight)} screens; it must start within ${MAIN_ACTION_SCREENS} screens (${px(limit)}).`;
}

/**
 * What a test does with its problems, given the page's marker (see the top of this file):
 * "pass", "fail" (with the message to show) or "skip" (with the reason).
 */
export function verdict(name: string, problems: string[], until: Until | undefined, marker: "lengthUntil" | "mainActionUntil"): { kind: "pass" } | { kind: "fail" | "skip"; message: string } {
  if (!until) return problems.length ? { kind: "fail", message: problems.join("\n") } : { kind: "pass" };
  if (problems.length) {
    const label = until.story === "unassigned" ? "Over budget, and no Sprint 10 story shortens it" : `Over budget until ${until.story}`;
    return { kind: "skip", message: `${label} (${until.why}): ${problems.join(" ")}` };
  }
  if (until.story === "unassigned") return { kind: "pass" };
  return {
    kind: "fail",
    message: `${name} is within its budget now: remove its ${marker} (${until.story}) from tests/e2e/page-budgets.ts, so the budget holds from here on.`,
  };
}
