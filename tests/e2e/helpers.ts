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

/** Waits until a page has settled: content shown, fonts loaded, no requests in flight. */
export async function settle(page: Page) {
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
