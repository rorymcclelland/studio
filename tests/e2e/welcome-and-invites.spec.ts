// F-3 through the UI: the public welcome page for anyone signed out, and the
// owner's one-time invite links (N-2: accepting one starts Studio's own session).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { contrastViolations, expectNoHorizontalScroll, settle, signIn } from "./helpers";

const APP_ROUTES = ["/brands", "/campaigns", "/approvals", "/runs", "/invites", "/design"];

async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return ctx.newPage();
}

test("F-3 #1: signed out, / is the welcome page with no app data, and app routes go to sign-in", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await settle(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A multi-agent campaign studio for marketing teams");
  await expect(page.getByText("Fictional brands", { exact: true })).toBeVisible();
  await expect(page.getByText("Simulated data", { exact: true })).toBeVisible();
  await expect(page.getByText("Access is by invitation. Anyone with access can sign in with their email.")).toBeVisible();
  await expect(page.getByText(/Ask Rory for a new sign-in link/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/signin");
  // No app data: no brand, no nav, no spend, no account.
  const text = await page.locator("body").innerText();
  for (const s of ["Fernhollow", "Quillmoor", "Agent runs", "AI today", "Account", "dev@example.test"]) {
    expect(text, `the welcome page shows "${s}"`).not.toContain(s);
  }
  await expect(page.locator("img")).toHaveCount(0);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `welcome at ${width}px`);
    expect(await contrastViolations(page), `welcome at ${width}px`).toEqual([]);
  }

  for (const path of APP_ROUTES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/signin$/);
  }
});

test("F-3 #2 and #3: an invite signs someone in once, to their own workspace, until it is revoked", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const email = `guest-${Date.now()}@example.test`;

  // The owner creates an invite; the link is shown once with a Copy button.
  await signIn(page);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("link", { name: "Invites" }).click();
  await expect(page.getByRole("heading", { name: "Invites", level: 1 })).toBeVisible();
  // Pages left with Cache Components stay in the document, hidden (the sign-in form among them).
  await page.getByLabel("Email").filter({ visible: true }).fill(email);
  await page.getByLabel("Note for you (optional)").fill("End-to-end test");
  await page.getByRole("button", { name: "Create invite link" }).click();
  const created = page.locator("[data-invite-link]");
  await expect(created).toContainText("works once");
  await expect(created).toContainText("7 days");
  await expect(created.getByRole("button", { name: "Copy link" })).toBeVisible();
  const link = await created.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  const row = page.locator("[data-invite]").filter({ hasText: email });
  await expect(row).toContainText("Open");
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `/invites at ${width}px`);
    expect(await contrastViolations(page), `/invites at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Someone else opens it: signed in, on their own empty workspace.
  const guest = await freshPage(browser);
  await guest.goto(new URL(link).pathname);
  // Opening the link alone uses nothing (review 3): it asks to continue.
  await expect(guest.getByRole("heading", { name: "You've been invited to Studio" })).toBeVisible();
  expect(await contrastViolations(guest), "invite page").toEqual([]);
  await guest.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(guest.getByRole("heading", { name: "Try the tagline agent" })).toBeVisible();
  await guest.goto("/brands");
  await settle(guest);
  await expect(guest.getByRole("heading", { name: "No brands yet" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Add demo brands" })).toBeVisible();
  await guest.getByRole("button", { name: "Account" }).click();
  await expect(guest.getByText(email)).toBeVisible();
  // Not the owner: no Invites in the menu, and the page is not found.
  await expect(guest.getByRole("link", { name: "Invites" })).toHaveCount(0);
  await guest.keyboard.press("Escape");
  await guest.goto("/invites");
  await expect(guest.getByRole("heading", { name: "Not found" })).toBeVisible();

  // The link works once.
  const again = await freshPage(browser);
  await again.goto(new URL(link).pathname);
  await again.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(again).toHaveURL(/\/signin\?invite=expired$/);
  await expect(again.locator("[data-invite-notice=expired]")).toHaveText(
    "This invite link has expired or was already used. If you've signed in before, enter your email below for a sign-in link; if not, ask Rory for a new invite.",
  );
  expect(await contrastViolations(again), "sign-in after an expired invite").toEqual([]);
  await again.goto("/brands");
  await expect(again).toHaveURL(/\/signin$/);
  // N-3 (closing F-18): the sign-in page says invitees sign back in with their email.
  await expect(again.locator("[data-invite-help]")).toHaveText("Anyone with access, invited people included, can sign in here with their email.");

  // Revoking signs that person out on their next page load.
  await page.reload();
  await expect(row).toContainText("Used");
  await row.getByRole("button", { name: `Revoke the invite for ${email}` }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Revoked" })).toBeVisible();
  await expect(row).toContainText("Revoked");
  await guest.goto("/brands");
  await expect(guest).toHaveURL(/\/signin$/);

  await guest.context().close();
  await again.context().close();
});

test("F-18a: New sign-in link sits beside Revoke, and its link opens below the row without moving them", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const email = `back-${Date.now()}@example.test`;
  await signIn(page);
  await page.goto("/invites");
  await settle(page);
  await page.getByLabel("Email").filter({ visible: true }).fill(email);
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.locator("[data-invite-link] input").first().inputValue();
  const guest = await freshPage(browser);
  await guest.goto(new URL(link).pathname);
  await guest.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(guest.getByRole("heading", { name: "Try the tagline agent" })).toBeVisible();
  await guest.context().close();

  await page.reload();
  await settle(page);
  const row = page.locator("[data-invite=used]").filter({ hasText: email });
  const newLink = row.getByRole("button", { name: `Make a new sign-in link for ${email}` });
  const revoke = row.getByRole("button", { name: `Revoke the invite for ${email}` });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    const [a, b] = [await newLink.boundingBox(), await revoke.boundingBox()];
    // Side by side, on one line.
    expect(Math.abs(a!.y - b!.y), `buttons on one line at ${width}px`).toBeLessThan(2);
    expect(a!.x + a!.width, `New sign-in link before Revoke at ${width}px`).toBeLessThanOrEqual(b!.x);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await revoke.boundingBox();
  await newLink.click();
  const box = row.locator("[data-invite-link]");
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  const after = await revoke.boundingBox();
  expect(after!.x, "Revoke stays where it was").toBeCloseTo(before!.x, 0);
  const boxRect = await box.boundingBox();
  expect(boxRect!.y, "the link opens below the buttons").toBeGreaterThan(after!.y + after!.height);
  const rowRect = await row.boundingBox();
  expect(boxRect!.width, "the link box spans the row").toBeGreaterThan(rowRect!.width * 0.8);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `/invites with a new link at ${width}px`);
    expect(await contrastViolations(page), `/invites with a new link at ${width}px`).toEqual([]);
  }
});
