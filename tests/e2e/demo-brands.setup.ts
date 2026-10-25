// S2-4 #5 through the UI: "Add demo brands" on an empty workspace adds both;
// pressing it again adds nothing and says why.
//
// A setup project (playwright.config.ts): it empties the dev workspace's
// brands, so it runs once, before the specs that read the demo brands, and
// leaves them loaded for those specs.
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { DEV_EMAIL, settle, signIn } from "./helpers";

async function devBrandCount(sql: postgres.Sql): Promise<number> {
  const [r] = await sql`
    select count(*)::int as n from public.brands b
    join public.workspace_members m on m.workspace_id = b.workspace_id
    join auth.users u on u.id = m.user_id
    where u.email = ${DEV_EMAIL}`;
  return r.n;
}

test("S2-4 #5: Add demo brands adds both; pressing it again adds nothing and says why", async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to empty the workspace first");
  test.setTimeout(120_000);
  await signIn(page); // creates the dev workspace if it is new
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`
      delete from public.brands where workspace_id in (
        select m.workspace_id from public.workspace_members m join auth.users u on u.id = m.user_id
        where u.email = ${DEV_EMAIL})`;

    await page.goto("/brands");
    await settle(page);
    await expect(page.getByRole("heading", { name: "No brands yet" })).toBeVisible();

    await page.getByRole("button", { name: "Add demo brands" }).click();
    // Loading takes a few seconds; the button says so meanwhile.
    await expect(page.getByRole("button", { name: "Adding demo brands…" })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "This takes a few seconds" })).toBeVisible();

    const toast = page.locator("[data-toast]").filter({ hasText: "Added Fernhollow Outfitters and Quillmoor Money" });
    await expect(toast).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: /^Fernhollow Outfitters/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Quillmoor Money/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Simulated data/ })).toHaveCount(2);
    expect(await devBrandCount(sql)).toBe(2);

    // Again: refused, with the reason, and nothing added.
    await page.getByRole("button", { name: "Add demo brands" }).click();
    const refusal = page.getByRole("alert").filter({ hasText: "already in this workspace" });
    // The loader names both brands, in no fixed order.
    await expect(refusal).toContainText("Fernhollow Outfitters");
    await expect(refusal).toContainText("Quillmoor Money");
    await expect(refusal).toContainText("Nothing was added.");
    expect(await devBrandCount(sql)).toBe(2);
    await page.reload();
    await expect(page.getByRole("link", { name: /Simulated data/ })).toHaveCount(2);
  } finally {
    await sql.end();
  }
});
