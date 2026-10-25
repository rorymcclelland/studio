// S1-6 test cases 1-4: the design-direction prototype. Sprint 1 built three;
// Sprint 2 removed A (press check) and B (control desk) and kept C, Soft
// machine, as the design system's reference (F-6, Q4).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const DIRECTIONS = ["soft-machine"];

test("F-6: the index lists only Soft machine, and A and B are gone", async ({ page }) => {
  await page.goto("/directions");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Soft machine"]);
  await expect(page.getByRole("link", { name: /Soft machine/ })).toHaveAttribute("href", "/directions/soft-machine");
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/Press check|Control desk/);
  for (const gone of ["/directions/press-check", "/directions/control-desk"]) {
    await page.goto(gone);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  }
});
const WIDTHS = [375, 1440];

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, "page scrolls sideways").toBeLessThanOrEqual(client);
}

async function contrastViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  return results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`));
}

for (const dir of DIRECTIONS) {
  test.describe(dir, () => {
    for (const width of WIDTHS) {
      test(`S1-6 #1: both screens fit ${width}px with no sideways scroll`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/directions/${dir}`);
        await noHorizontalScroll(page);
        await page.getByRole("button", { name: "Creative review", exact: true }).click();
        await noHorizontalScroll(page);
      });
    }

    test("S1-6 #2: text meets WCAG AA contrast in light and dark themes", async ({ page }) => {
      await page.goto(`/directions/${dir}`);
      for (const theme of ["first", "second"]) {
        for (const screen of ["Campaign", "Creative review"]) {
          await page.getByRole("button", { name: screen, exact: true }).click();
          // The sample ads are artwork; the "First snow" variant fails contrast on
          // purpose, because it is the example the accessibility check catches.
          const v = (await contrastViolations(page)).filter((t) => !t.includes("svg") && !t.includes("foreignObject"));
          expect(v, `${theme} theme, ${screen}`).toEqual([]);
        }
        await page.getByRole("button", { name: /theme$/ }).click();
      }
    });

    test("S1-6 #3: every control does something", async ({ page }) => {
      await page.goto(`/directions/${dir}`);
      // Approvals change state, then undo restores them.
      const approve = page.getByRole("button", { name: /^(Sign off|Approve)$/ }).first();
      await approve.click();
      const proto = page.locator("[data-theme]").first();
      await expect(proto.getByRole("status").first()).toBeVisible();
      await proto.getByRole("button", { name: "Undo" }).first().click();
      await expect(proto.getByRole("status")).toHaveCount(0);

      await page.getByRole("button", { name: "Creative review", exact: true }).click();
      // Filters narrow the set; selecting a variant updates the detail panel.
      await page.getByRole("button", { name: /^Failed/ }).click();
      await expect(page.getByText("Summit glow").first()).toBeVisible();
      await expect(page.getByText("Ridge at dawn")).toHaveCount(0);
      await page.getByRole("button", { name: /^All/ }).click();
      await page.getByRole("button", { name: /First snow/ }).first().click();
      await expect(page.getByText(/contrast 2.6:1/)).toBeVisible();
      // A failed variant cannot be signed off.
      await expect(page.getByRole("button", { name: /^(Sign off|Approve)$/ })).toBeDisabled();
      // Theme toggle switches the theme.
      const root = page.locator("[data-theme]").first();
      const before = await root.getAttribute("data-theme");
      await page.getByRole("button", { name: /theme$/ }).click();
      await expect(root).not.toHaveAttribute("data-theme", before!);
    });

    test("S1-6 #4: only the fictional brand appears, and data is labelled as sample", async ({ page }) => {
      await page.goto(`/directions/${dir}`);
      await expect(page.getByText("Sample data")).toBeVisible();
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/[®™]/);
      expect(text).toMatch(/Fernhollow/);
    });
  });
}
