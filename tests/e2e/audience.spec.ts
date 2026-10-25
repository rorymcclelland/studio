// S3-1 through the UI, with the mock model: "Find audiences" on a brand page
// adds segments labelled as proposed by the Audience agent and as simulated
// (test case 6); they can be removed, the customer summary's cannot. The run
// page links back to them.
//
// Runs on Quillmoor: design-system.spec.ts compares Fernhollow's brand page
// between visits, so that page must not change under it.
import { expect, test } from "@playwright/test";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, settle, signIn } from "./helpers";

test("Find audiences adds labelled, simulated, removable segments", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const quillmoor = await demoBrandId(page, "Quillmoor Money");
  await page.goto(`/brands/${quillmoor}`);
  await settle(page);

  const segments = page.getByRole("region", { name: "Segments" }).filter({ visible: true });
  // The customer summary's segments are there before any run, and can't be removed.
  const system = segments.locator("[data-segment=system]");
  await expect(system.first()).toContainText("From the customer summary");
  await expect(system.first()).toContainText("Simulated data");
  await expect(system.getByRole("button", { name: /^Remove/ })).toHaveCount(0);

  await segments.getByRole("button", { name: "Find audiences" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "The Audience agent is counting and naming segments" })).toBeVisible();

  // The page follows the run until it finishes.
  await expect(segments.getByText("Completed")).toBeVisible({ timeout: 60_000 });
  const agent = segments.locator("[data-segment=agent]");
  const n = await agent.count();
  expect(n).toBeGreaterThan(0);
  for (const s of await agent.all()) {
    await expect(s.getByText("Proposed by the Audience agent", { exact: true })).toBeVisible();
    await expect(s.getByText("Simulated data", { exact: true })).toBeVisible();
  }
  await expect(segments.getByRole("button", { name: "Find audiences" })).toBeEnabled();

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `brand page with segments at ${width}px`);
    expect(await contrastViolations(page), `brand page with segments at ${width}px`).toEqual([]);
  }

  // Remove one.
  const title = (await agent.first().getByRole("heading").textContent())!;
  await agent.first().getByRole("button", { name: `Remove the segment ${title}` }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Segment removed." })).toBeVisible();
  await expect(agent).toHaveCount(n - 1);
  await expect(segments.getByRole("heading", { name: title, exact: true })).toHaveCount(0);

  // The run's page summarises it and links back to the segments.
  await segments.getByRole("link", { name: "See the run's trail" }).click();
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
  await expect(page.getByText(/segments saved to Quillmoor Money's context/)).toBeVisible();
  await page.getByRole("link", { name: "See the segments on the brand page" }).click();
  await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}#segments$`));
});
