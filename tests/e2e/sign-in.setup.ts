// N-2 and N-3: a setup project (playwright.config.ts) that signs the owner in
// by email, as a person does (ask for a link, read it from the console
// mailer, press Continue), and saves the browser state every spec's signIn()
// reuses. A saved state that still works is kept, so most runs ask for no
// link at all for dev@example.test.
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { DEV_EMAIL, DEV_STATE, signInByEmail } from "./helpers";

test("sign in as the owner by email and keep the session", async ({ browser }) => {
  if (existsSync(DEV_STATE)) {
    const ctx = await browser.newContext({ storageState: DEV_STATE });
    const page = await ctx.newPage();
    await page.goto("/");
    const ok = await page.getByRole("heading", { name: "Try the tagline agent" }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    await ctx.close();
    if (ok) return;
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInByEmail(page, DEV_EMAIL);
  const cookie = (await ctx.cookies()).find((c) => c.name === "cs_session");
  expect(cookie, "the session cookie").toBeDefined();
  mkdirSync(dirname(DEV_STATE), { recursive: true });
  await ctx.storageState({ path: DEV_STATE });
  await ctx.close();
});
