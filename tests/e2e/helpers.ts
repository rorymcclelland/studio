// Shared steps for the end-to-end specs.
import { existsSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";

/**
 * Captions in the recordings (decision 0021): when videos are recorded (in CI,
 * or with E2E_VIDEO=1), the current step is shown in a strip along the bottom
 * of the page, so a person watching the recording can follow it. The strip is
 * in a closed shadow root, so no locator, text search or contrast check sees
 * it, and it takes no clicks. Without recording it does nothing.
 */
export const RECORDING = Boolean(process.env.CI || process.env.E2E_VIDEO);

const captioned = new WeakSet<Page>();

function drawCaption(text: string) {
  const KEY = "e2e-caption";
  try {
    if (text) sessionStorage.setItem(KEY, text);
  } catch {
    // about:blank has no storage; the caption shows from the next page on.
  }
  const draw = () => {
    let t = text;
    try {
      t = text || sessionStorage.getItem(KEY) || "";
    } catch {}
    if (!t || !document.documentElement) return;
    const w = window as unknown as { __e2eCaption?: HTMLElement };
    if (!w.__e2eCaption || !w.__e2eCaption.isConnected) {
      const host = document.createElement("e2e-caption");
      host.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;display:block";
      const root = host.attachShadow({ mode: "closed" });
      const box = document.createElement("div");
      box.style.cssText =
        "margin:0 auto 8px;width:fit-content;max-width:calc(100vw - 16px);box-sizing:border-box;padding:6px 12px;border-radius:6px;" +
        "background:rgba(17,17,17,.88);color:#fff;font:600 15px/1.35 system-ui,sans-serif;text-align:center";
      root.append(box);
      document.documentElement.append(host);
      w.__e2eCaption = host;
      (host as unknown as { box: HTMLElement }).box = box;
    }
    (w.__e2eCaption as unknown as { box: HTMLElement }).box.textContent = t;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw, { once: true });
  else draw();
}

/** Shows a caption in the recording (see RECORDING); it stays on the pages that follow until the next one. */
export async function caption(page: Page, text: string) {
  if (!RECORDING) return;
  if (!captioned.has(page)) {
    captioned.add(page);
    await page.addInitScript(drawCaption, "");
  }
  await page.evaluate(drawCaption, text).catch(() => undefined);
}

/**
 * Saves a screenshot to SHOTS_DIR, when it is set, as <name>.png. The
 * recording's caption strip is hidden while it is taken, so it never covers
 * the bottom of the page in a screenshot.
 */
export async function saveShot(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  if (!process.env.SHOTS_DIR) return;
  await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name.replace(/\W+/g, "-")}.png`, ...options, style: "e2e-caption { display: none !important; }" });
}

/** A test step with a plain-English name: in the report, and as the recording's caption. */
export async function step<T>(page: Page, title: string, body: () => Promise<T>): Promise<T> {
  return test.step(title, async () => {
    await caption(page, title);
    return body();
  });
}

export const DEV_EMAIL = "dev@example.test";

/** What the sign-in page says for every valid address (src/lib/auth/sign-in.ts). */
export const SIGN_IN_REPLY = "If that address has access, we've sent a sign-in link. It works once, for 15 minutes.";

/**
 * The owner's signed-in browser state, saved once per run by the sign-in
 * setup project (sign-in.setup.ts), which signs in by email like a person.
 * Reusing it keeps the suite inside the sign-in limit of 3 links per address
 * per hour. Gitignored.
 */
export const DEV_STATE = "playwright/.auth/dev.json";

/** Signs in as the owner (dev@example.test): reuses the saved session, or signs in by email if there is none. */
export async function signIn(page: Page) {
  if (existsSync(DEV_STATE)) {
    const state = JSON.parse(readFileSync(DEV_STATE, "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
    await page.context().addCookies(state.cookies);
    await page.goto("/");
  } else {
    await signInByEmail(page, DEV_EMAIL);
  }
  await expect(page.getByRole("heading", { name: "Try the tagline agent" })).toBeVisible();
}

/**
 * How many sign-in links the console mailer has sent to an address, and the
 * newest, read through /api/dev/last-sign-in-link (only off Vercel, with the
 * console mailer).
 */
export async function sentLinks(request: APIRequestContext, email: string): Promise<{ link: string | null; count: number }> {
  const res = await request.get(`/api/dev/last-sign-in-link?email=${encodeURIComponent(email)}`);
  expect(res.status(), "the console mailer route (is the app running off Vercel, without RESEND_API_KEY?)").toBe(200);
  return res.json();
}

/** Asks for a sign-in link on /signin and returns it once the console mailer has sent it. */
export async function requestLink(page: Page, email: string): Promise<string> {
  const before = (await sentLinks(page.request, email)).count;
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(SIGN_IN_REPLY);
  // The link is sent just after the reply (after()), so wait for it.
  await expect.poll(async () => (await sentLinks(page.request, email)).count, { timeout: 15_000 }).toBeGreaterThan(before);
  const { link } = await sentLinks(page.request, email);
  return new URL(link!).pathname;
}

/** Signs in by email the way a person does: ask for a link, open it, press Continue. */
export async function signInByEmail(page: Page, email: string) {
  const path = await requestLink(page, email);
  await page.goto(path);
  await page.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(page.getByRole("heading", { name: "Try the tagline agent" })).toBeVisible();
}

/** Starts a tagline run from the home page and waits for its approval. Returns the run's path. */
export async function startRunAwaitingApproval(page: Page, brandName: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Brand name").fill(brandName);
  await page.getByRole("button", { name: "Propose taglines" }).click();
  await expect(page.getByRole("heading", { name: "Which tagline should we use?" })).toBeVisible({ timeout: 30_000 });
  return new URL(page.url()).pathname;
}

export async function expectNoHorizontalScroll(page: Page, what: string) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${what} scrolls sideways`).toBeLessThanOrEqual(client);
}

/** WCAG AA colour-contrast failures on the page, as readable strings. */
export async function contrastViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  return results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`));
}

/** Tabs through the page and returns what took focus, with whether its focus ring shows. */
export async function tabThrough(page: Page, max = 80) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const seen: { key: string; ring: boolean }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      if (!el.dataset.kb) el.dataset.kb = String(document.querySelectorAll("[data-kb]").length);
      const cs = getComputedStyle(el);
      const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
      return { key: el.dataset.kb, ring };
    });
    if (!info) break;
    if (seen.some((x) => x.key === info.key)) break;
    seen.push(info);
  }
  return seen;
}

/** Every control a keyboard user should reach: one stop per radio group. */
export async function expectedStops(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sel = "a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, summary, [tabindex='0']";
    const radioGroups = new Set<string>();
    let n = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.getClientRects().length === 0) continue; // not rendered
      const closed = el.closest("details:not([open])");
      if (closed && el.tagName !== "SUMMARY") continue;
      if (el.closest("[popover]:not(:popover-open)")) continue;
      if (el instanceof HTMLInputElement && el.type === "radio") {
        if (radioGroups.has(el.name)) continue;
        radioGroups.add(el.name);
      }
      n++;
    }
    return n;
  });
}

/**
 * The id of a demo brand, by name. The demo-brands setup project loads them
 * before any spec runs; this also adds them if a spec runs on its own.
 */
export async function demoBrandId(page: Page, name: "Fernhollow Outfitters" | "Quillmoor Money"): Promise<string> {
  await page.goto("/brands");
  await settle(page);
  const link = page.getByRole("link", { name: new RegExp(`^${name}`) });
  if ((await link.count()) === 0) {
    await page.getByRole("button", { name: "Add demo brands" }).click();
    await expect(link).toBeVisible({ timeout: 60_000 });
  }
  const href = await link.getAttribute("href");
  return href!.split("/").pop()!;
}

/** Waits until a page has settled: content shown, fonts loaded, no requests in flight. */
export async function settle(page: Page) {
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

// ---------------------------------------------------------------- U10-2: the campaign in stages
// A campaign is an overview (/campaigns/<id>) and five stage pages, reached
// through the stage bar ([data-stage-bar], tests/e2e/campaign-stages.spec.ts
// has the interface). The helpers below take a campaign's path (the overview's,
// as newCampaign returns it, or any of its stage pages') and go through the bar,
// so the specs that walk a campaign change here, in one place.

export type Stage = "brief" | "audience" | "creative" | "launch" | "performance";

const CAMPAIGN_PATH = /^\/campaigns\/([0-9a-f-]{36})(?:\/(brief|audience|creative|launch|performance))?\/?$/;

/** The campaign's overview path from any of its pages' paths or URLs (query and fragment dropped). */
export function overviewPath(pathOrUrl: string): string {
  const path = new URL(pathOrUrl, "http://x").pathname;
  const m = CAMPAIGN_PATH.exec(path);
  if (!m) throw new Error(`${pathOrUrl} isn't a campaign's page`);
  return `/campaigns/${m[1]}`;
}

/** A stage page's path: /campaigns/<id>/<stage>. */
export function stagePath(path: string, stage: Stage): string {
  return `${overviewPath(path)}/${stage}`;
}

/**
 * Opens a stage of a campaign through the stage bar, as a person does: from the
 * page that is open when it is one of the campaign's, else from its overview
 * (`path` names the campaign; without it, the open page must be one of its).
 * Always a fresh load of the stage, so its controls are current.
 */
export async function openStage(page: Page, stage: Stage, path?: string) {
  const open = new URL(page.url()).pathname;
  const target = stagePath(path ?? open, stage);
  if (open === target) {
    await page.reload();
    await settle(page);
    return;
  }
  if (!CAMPAIGN_PATH.test(open) || overviewPath(open) !== overviewPath(target)) {
    await page.goto(overviewPath(target));
    await settle(page);
  }
  await page.locator("[data-stage-bar]").filter({ visible: true }).locator(`a[data-stage="${stage}"]`).click();
  await page.waitForURL((u) => u.pathname === target);
  await settle(page);
}

// ---------------------------------------------------------------- U10-5: the approvals inbox
// Each inbox card carries data-campaign (sign-offs and launches) and links to
// the stage where its decision is made, not the overview; a sign-off card keeps
// its personas and test plan in a closed <details data-signoff-reviews>
// (tests/e2e/home-work.spec.ts has the interface). Specs find a campaign's card
// and open its reviews here, so they change in one place.

/** A campaign's card in the approvals inbox, by kind; `path` is any of the campaign's pages. */
export function inboxCard(page: Page, kind: "brief_signoff" | "launch", path: string): Locator {
  const id = overviewPath(path).split("/").pop()!;
  return page.locator(`[data-inbox-item="${kind}"][data-campaign="${id}"]`).filter({ visible: true });
}

/** Opens a sign-off card's personas and test plan in place (a no-op when they are open). */
export async function openSignoffReviews(card: Locator) {
  const details = card.locator("details[data-signoff-reviews]");
  if ((await details.getAttribute("open")) === null) await details.locator(":scope > summary").click();
  await expect(details).toHaveAttribute("open", "");
}

/** Opens a collapsed history line in place (versions on Brief; discarded and runs on Creative), if it is closed. */
export async function openHistory(page: Page, kind: "versions" | "discarded" | "runs") {
  const details = page.locator(`details[data-history="${kind}"]`).filter({ visible: true });
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

/** Opens a campaign's Launch stage and waits for its Launch (simulated) panel. */
export async function openLaunch(page: Page, path?: string) {
  await openStage(page, "launch", path);
  const panel = page.locator("[data-launch-panel]");
  await expect(panel.getByRole("heading", { name: "Launch (simulated)" })).toBeVisible({ timeout: 60_000 });
  await panel.scrollIntoViewIfNeeded();
}

/**
 * Writes a brief for a demo brand from /campaigns (mock Brief agent) and waits
 * for version 1 on the Brief stage. Returns the campaign's overview path
 * (/campaigns/<id>); the page is left on its Brief stage.
 */
export async function newCampaign(page: Page, brand: "Fernhollow Outfitters" | "Quillmoor Money", objective: string): Promise<string> {
  await demoBrandId(page, brand);
  await page.goto("/campaigns");
  await settle(page);
  await page.getByLabel("Brand").selectOption({ label: brand });
  await page.getByLabel("Objective").fill(objective);
  await page.getByRole("button", { name: "Write the brief" }).click();
  // A new campaign opens on its overview (U10-2, answer Q2).
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  const path = new URL(page.url()).pathname;
  await openStage(page, "brief", path);
  await untilShown(page, () => expect(page.getByRole("heading", { name: "The brief", exact: true })).toBeVisible({ timeout: 10_000 }), 60_000);
  return path;
}

/** Sends a brief version for sign-off and approves it, as the owner, from the campaign's Brief stage. */
export async function signOffVersion(page: Page, version: number) {
  if (!/\/campaigns\/[0-9a-f-]{36}\/brief$/.test(new URL(page.url()).pathname)) await openStage(page, "brief");
  const panel = page.locator("[data-signoff-panel]").filter({ visible: true });
  await panel.getByRole("button", { name: `Send version ${version} for sign-off` }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Sent for sign-off" })).toBeVisible();
  await panel.getByRole("button", { name: `Approve version ${version}` }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: `Version ${version} signed off.` })).toBeVisible();
}

/**
 * Waits for what a background run (Inngest) shows on the page, reloading as it
 * waits. The page refreshes itself while a run is in progress, but on a slow
 * dev server a refresh can take longer than the refresh interval, so each one
 * is overtaken and the page never catches up; a reload always lands.
 */
export async function untilShown(page: Page, check: () => Promise<void>, timeout = 300_000) {
  await expect(async () => {
    const shown = await check().then(
      () => true,
      () => false,
    );
    if (shown) return;
    await page.reload({ waitUntil: "domcontentloaded" });
    await check();
  }).toPass({ timeout, intervals: [5_000, 10_000, 15_000] });
}

/** Presses Make creative on a signed-off brief's Creative stage and waits for the gallery to hold `count` ads. */
export async function makeCreative(page: Page, count: number) {
  // Open the Creative stage afresh, so the Make creative button is the current one.
  await openStage(page, "creative");
  await page.locator("[data-creative]").getByRole("button", { name: /^Make creative/ }).click();
  await expect(page.locator("[data-creative]").getByRole("button", { name: /^Making creative/ })).toBeVisible({ timeout: 30_000 });
  await untilShown(page, () => expect(page.locator("[data-gallery] > li")).toHaveCount(count, { timeout: 10_000 }));
  // U10-3: every ad shown, as the specs that follow work on any of them (a group shows six until Show all, or three each with several audiences).
  await showAllAds(page);
}

/**
 * C8-1: on a campaign's Creative stage, accepts each of the brand's don't
 * rules for every picked ad ("Accept for every picked ad"), one rule at a time
 * as a person does, waiting for each to show as decided.
 */
export async function acceptDontRulesForPicked(page: Page) {
  if (!/\/campaigns\/[0-9a-f-]{36}\/creative$/.test(new URL(page.url()).pathname)) await openStage(page, "creative");
  await settle(page);
  await openPickedChecks(page);
  await expect(page.locator("[data-bulk-dont-rule]").first()).toBeVisible({ timeout: 60_000 });
  const open = page.locator('[data-bulk-dont-rule]:not([data-open="0"])');
  for (let n = await open.count(); n > 0; n--) {
    await open.first().getByRole("button", { name: /^Accept for every picked ad/ }).click();
    await expect(open).toHaveCount(n - 1, { timeout: 30_000 });
  }
}

/** C8-1: draws an ad in a layout from its card in the gallery (a no-op when it already is); U10-3: from the card's Edit menu. */
export async function drawInLayout(page: Page, adNumber: number, layout: "Full bleed" | "Split" | "Card") {
  const name = `${layout} layout for ad ${adNumber}`;
  const card = page.locator("[data-gallery] > li[data-ad]").filter({ visible: true }).filter({ has: page.locator(`button[aria-label="${name}"]`) });
  await openAdMenu(card, "edit");
  const button = card.getByRole("button", { name, exact: true });
  if ((await button.getAttribute("aria-pressed")) === "true") return;
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
}

// ---------------------------------------------------------------- U10-3: the ad card's menus
// A gallery card shows the ad, its number and headline, its state and its
// scores, with Pick on its face; its tools open from "Edit" or "More" on the
// card (tests/e2e/creative-gallery.spec.ts has the interface). Specs that use a
// card's tools go through adTool(), so they change here, in one place.

export type AdMenu = "edit" | "more";

/** Where each of today's card tools lives after U10-3: on the card's face, or in one of its two menus. */
export const AD_TOOLS = {
  pick: { menu: null, role: "button", name: /^(Pick|Unpick) ad \d+$/ },
  layout: { menu: "edit", role: "button", name: /^(Full bleed|Split|Card) layout for ad \d+$/ },
  redraw: { menu: "edit", role: "button", name: /^Redraw ad \d+ with the current kit/ },
  "new-picture": { menu: "edit", role: "button", name: /^(New picture for|Drawing a new picture for) ad \d+/ },
  "new-words": { menu: "edit", role: "button", name: /^(New words for|Writing new words for) ad \d+/ },
  "edit-words": { menu: "edit", role: "button", name: /^Edit the words for ad \d+$/ },
  discard: { menu: "more", role: "button", name: /^Discard ad \d+$/ },
  sizes: { menu: "more", role: "link", name: /^Sizes of ad \d+$/ },
  compliance: { menu: "more", role: "link", name: /^Compliance of ad \d+$/ },
  translate: { menu: "more", role: "button", name: /^(Translate|Translating)/ },
} as const satisfies Record<string, { menu: AdMenu | null; role: "button" | "link"; name: RegExp }>;
export type AdToolName = keyof typeof AD_TOOLS;

/** A gallery card by its ad's id. */
export function adCard(page: Page, variantId: string): Locator {
  return page.locator(`[data-gallery] > li[data-ad="${variantId}"]`).filter({ visible: true });
}

/** Opens one of a card's menus (a no-op when it is open) and returns the menu. */
export async function openAdMenu(card: Locator, menu: AdMenu): Promise<Locator> {
  const trigger = card.locator(`button[data-ad-menu-button="${menu}"]`);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const panel = card.locator(`[data-ad-menu="${menu}"]`);
  await expect(panel).toBeVisible();
  return panel;
}

/** One of today's tools on a card, its menu opened first when it lives in one. */
export async function adTool(card: Locator, tool: AdToolName): Promise<Locator> {
  const t = AD_TOOLS[tool];
  const where = t.menu ? await openAdMenu(card, t.menu) : card;
  return where.getByRole(t.role, { name: t.name });
}

// ---------------------------------------------------------------- U10-3: the Creative stage's length (Rory's choices a and b)
// The checks on the picked ads (compliance, languages, pre-test, picture
// checks, the launch pack) fold into one <details data-picked-checks>, and
// each audience shows its first six ads (three each with several audiences)
// until "Show all N ads" ([data-show-all-ads]). Specs that use what is folded
// or past the first few ads open it here first (tests/e2e/creative-gallery.spec.ts has the interface).

/** Opens the checks on the picked ads on the Creative stage (a no-op when they are open). */
export async function openPickedChecks(page: Page) {
  const details = page.locator("details[data-picked-checks]").filter({ visible: true });
  if ((await details.getAttribute("open")) === null) await details.locator(":scope > summary").click();
  await expect(details).toHaveAttribute("open", "");
}

/** Shows every ad in every audience group on the Creative stage (presses each "Show all N ads"). */
export async function showAllAds(page: Page) {
  const buttons = page.locator("button[data-show-all-ads]").filter({ visible: true });
  for (let n = await buttons.count(); n > 0; n--) {
    await buttons.first().click();
    await expect(buttons).toHaveCount(n - 1);
  }
}
