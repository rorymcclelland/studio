// S1-5 #1 and #7 end to end: the real app, the real Inngest dev server, the
// offline mock model. Requires AUTH_MODE=dev and dev@example.test allow-listed.
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill("dev@example.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Try the tagline agent" })).toBeVisible();
}

test("start a run, approve a tagline, see the completed trail", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Brand name").fill("Fernhollow Outfitters");
  await page.getByRole("button", { name: "Propose taglines" }).click();

  await expect(page.getByRole("heading", { name: "Which tagline should we use?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Awaiting approval").first()).toBeVisible();
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Approve tagline" }).click();

  await expect(page.getByText("Chosen tagline")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Completed").first()).toBeVisible();
  await expect(page.getByText("Go further with Fernhollow", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Propose taglines" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval" })).toBeVisible();
  await expect(page.getByText("mock · mock-model")).toBeVisible();
});

test("rejecting ends the run as Rejected", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Brand name").fill("Kestrel Lane");
  await page.getByRole("button", { name: "Propose taglines" }).click();
  await expect(page.getByRole("heading", { name: "Which tagline should we use?" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Note (optional)").fill("None of these fit");
  await page.getByRole("button", { name: "Reject all" }).click();
  await expect(page.getByText("Rejected: None of these fit")).toBeVisible({ timeout: 30_000 });
});

test("a hostile brand name is shown as text, never run as markup", async ({ page }) => {
  let dialog = false;
  page.on("dialog", async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await signIn(page);
  await page.getByLabel("Brand name").fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Propose taglines" }).click();
  await expect(page.getByRole("heading", { name: "<img src=x onerror=alert(1)>" })).toBeVisible({ timeout: 30_000 });
  expect(dialog).toBe(false);
});

test("another workspace's run id shows not found", async ({ page }) => {
  await signIn(page);
  // Streaming responses start with 200, so check what is shown.
  await page.goto("/runs/11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await page.goto("/runs/not-a-uuid");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
