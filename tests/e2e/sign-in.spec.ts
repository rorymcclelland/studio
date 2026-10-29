// N-2 and N-3 through the UI: sign in by email (the link comes from the
// console mailer, read through /api/dev/last-sign-in-link), Continue, the
// session cookie, sign-out, and revoking. The library and database halves,
// including the limits and hostile input, are in tests/auth and tests/db.
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  contrastViolations,
  DEV_EMAIL,
  expectNoHorizontalScroll,
  requestLink,
  sentLinks,
  settle,
  SIGN_IN_REPLY,
  signIn,
  signInByEmail,
} from "./helpers";

const HOME = "Try the tagline agent";

async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return ctx.newPage();
}

/** Layout and contrast at both widths, with a screenshot of each for review. */
async function checkWidths(page: Page, name: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${name} at ${width}px`);
    expect(await contrastViolations(page), `${name} at ${width}px`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("N-3 #1 and #5: an allow-listed email gets a link; opening it uses nothing; Continue signs in once; then it has expired", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await freshPage(browser);
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  await expect(page.locator("[data-invite-help]")).toHaveText("Anyone with access, invited people included, can sign in here with their email.");
  await expect(page.getByText(/Ask Rory for a new sign-in link/)).toHaveCount(0);
  await checkWidths(page, "sign-in");

  const path = await requestLink(page, DEV_EMAIL);
  expect(path).toMatch(/^\/signin\/link\/[A-Za-z0-9_-]{43}$/);
  await checkWidths(page, "sign-in-reply");

  // #5: opening the link (GET), even twice, only shows Continue and uses nothing.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Sign in to Studio" })).toBeVisible();
  await expect(page.getByText("This link works once, and only for 15 minutes after it was sent.", { exact: false })).toBeVisible();
  await checkWidths(page, "sign-in-link-continue");
  const scanner = await freshPage(browser);
  await scanner.goto(path);
  await expect(scanner.getByRole("button", { name: "Continue to Studio" })).toBeVisible();
  await scanner.context().close();

  await page.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(page.getByRole("heading", { name: HOME })).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByText(DEV_EMAIL)).toBeVisible();

  // N-2: the session cookie is httpOnly, SameSite=Lax, path /, 30 days (not Secure on local http).
  const cookie = (await page.context().cookies()).find((c) => c.name === "cs_session")!;
  expect(cookie).toBeDefined();
  expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
  const days = (cookie.expires * 1000 - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);

  // Works once: a second Continue, from another browser, says it has expired.
  const again = await freshPage(browser);
  await again.goto(path);
  await again.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(again).toHaveURL(/\/signin\?link=expired$/);
  await expect(again.locator("[data-invite-notice=link-expired]")).toHaveText(
    "This link has expired. Sign-in links work once, for 15 minutes. Enter your email below for a new one.",
  );
  await checkWidths(again, "sign-in-link-expired");
  await again.goto("/brands");
  await expect(again).toHaveURL(/\/signin$/);
  await again.context().close();
  await page.context().close();
});

test("N-3 #2 and #3, N-2 #4 and #5: an invitee signs out, signs back in by email to their own workspace, and once revoked gets nothing", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const email = `by-email-${Date.now()}@example.test`;

  // The owner invites someone; they accept and get their own session.
  await signIn(page);
  await page.goto("/invites");
  await settle(page);
  await page.getByLabel("Email").filter({ visible: true }).fill(email);
  await page.getByRole("button", { name: "Create invite link" }).click();
  const invite = await page.locator("[data-invite-link] input").first().inputValue();
  const guest = await freshPage(browser);
  await guest.goto(new URL(invite).pathname);
  await guest.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(guest.getByRole("heading", { name: HOME })).toBeVisible();
  const first = (await guest.context().cookies()).find((c) => c.name === "cs_session")!;
  expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // N-2 #4: sign-out ends the session; the same cookie, replayed, is signed out.
  await guest.getByRole("button", { name: "Account" }).click();
  await guest.getByRole("button", { name: "Sign out" }).click();
  await expect(guest).toHaveURL(/\/signin$/);
  expect((await guest.context().cookies()).find((c) => c.name === "cs_session")).toBeUndefined();
  const replay = await freshPage(browser);
  await replay.context().addCookies([first]);
  await replay.goto("/brands");
  await expect(replay).toHaveURL(/\/signin$/);
  // Sprint 6 review: the dead cookie is cleared, not renewed.
  expect((await replay.context().cookies()).find((c) => c.name === "cs_session")).toBeUndefined();
  await replay.context().addCookies([first]);
  await replay.goto("/");
  await expect(replay).toHaveURL(/\/welcome$/);
  expect((await replay.context().cookies()).find((c) => c.name === "cs_session")).toBeUndefined();
  await replay.context().close();

  // N-3 #2: the invitee signs back in by email, to their own empty workspace.
  await signInByEmail(guest, email);
  await guest.getByRole("button", { name: "Account" }).click();
  await expect(guest.getByText(email)).toBeVisible();
  await guest.keyboard.press("Escape");
  await guest.goto("/brands");
  await settle(guest);
  await expect(guest.getByRole("heading", { name: "No brands yet" })).toBeVisible();

  // N-2 #5: revoking them ends that session too; their next request goes to sign-in.
  await page.goto("/invites");
  await settle(page);
  const row = page.locator("[data-invite]").filter({ hasText: email });
  await row.getByRole("button", { name: `Revoke the invite for ${email}` }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Revoked" })).toBeVisible();
  await guest.goto("/brands");
  await expect(guest).toHaveURL(/\/signin$/);

  // N-3 #3: revoked, or unknown: the same reply, and nothing is sent.
  const unknown = `nobody-${Date.now()}@example.test`;
  for (const address of [email, unknown]) {
    const before = (await sentLinks(guest.request, address)).count;
    await guest.goto("/signin");
    await guest.getByLabel("Email").fill(address);
    await guest.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(guest.getByRole("status")).toHaveText(SIGN_IN_REPLY);
    await guest.waitForTimeout(2_000); // the send would happen just after the reply
    expect((await sentLinks(guest.request, address)).count, address).toBe(before);
  }
  await guest.context().close();
});

test("N-3 #6: a header-injection or over-long address is refused on the page, with no reply", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto("/signin");
  await settle(page); // hydrated, so the changes below stay
  const input = page.getByLabel("Email");
  // The browser's own checks are bypassed, so the server's validation is what's
  // tested. A single-line field drops the newline itself; what reaches the
  // server is refused all the same (the raw newline is tested in tests/auth).
  await input.evaluate((el: HTMLInputElement) => {
    el.form!.noValidate = true;
    el.removeAttribute("maxlength");
  });
  for (const [value, error] of [
    ["a@b.c\nBcc: x@y.z", "Enter a valid email address."],
    [`${"a".repeat(288)}@example.test`, "An email address can be at most 254 characters."],
  ] as const) {
    await input.fill(value);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText(error)).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  }
  await page.context().close();
});

test("the console mailer route answers off Vercel only, and tells nothing beyond its own outbox", async ({ request }) => {
  const res = await request.get("/api/dev/last-sign-in-link?email=nobody-at-all@example.test");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ link: null, count: 0 });
});
