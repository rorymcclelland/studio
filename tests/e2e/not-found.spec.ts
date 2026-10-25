// F-12: a record page with an id that can't be an id is a real 404; a
// well-formed id that doesn't exist shows the not-found screen and is kept
// out of search engines (Next.js commits to 200 once the app shell streams,
// so it can't be a 404; see docs/refinement/sprint-3.md).
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("F-12 #1 malformed ids answer 404", async ({ page }) => {
  for (const path of ["/brands/nope", "/brands/nope/edit", "/runs/123", "/campaigns/not-a-uuid"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: /not found|can't find|couldn't find/i }).first(), path).toBeVisible();
  }
});

test("F-12 #2 a well-formed id that isn't in the workspace shows not found and is not indexed", async ({ page }) => {
  for (const path of ["/brands/11111111-1111-4111-8111-111111111111", "/runs/11111111-1111-4111-8111-111111111111", "/campaigns/11111111-1111-4111-8111-111111111111"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Not found" }).filter({ visible: true }), path).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first(), path).toBeAttached();
  }
});
