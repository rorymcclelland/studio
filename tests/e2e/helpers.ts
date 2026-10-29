// Shared steps for the end-to-end specs.
import { existsSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

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
