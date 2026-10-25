// Shared steps for the end-to-end specs.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const DEV_EMAIL = "dev@example.test";

export async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(DEV_EMAIL);
  await page.getByRole("button", { name: "Sign in" }).click();
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
