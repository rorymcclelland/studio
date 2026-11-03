// S2-3 (brand kit editor and overview) test cases 1, 2, 3, 5, 6 and 7, and
// S2-5's search box (test cases 1 and 5 through the UI).
// S2-3 #4 is tests/db (summary figures against direct queries); S2-4 #5 is
// demo-brands.setup.ts, which loads the demo brands these tests use.
//
// Fernhollow is only read here (design-system.spec.ts compares its screens
// between visits); every test that saves edits Quillmoor. F-26
// (creative.spec.ts) reorders Fernhollow's palette for a moment, and not
// Quillmoor's, because S2-3 #2 checks that Quillmoor's palette is unchanged.
//
// Pages left with Cache Components stay in the document, hidden, so plain
// locators below are filtered to visible elements.
import { randomUUID } from "node:crypto";
import { expect, test, type Dialog, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { demoBrandId, expectedStops, settle, signIn, tabThrough } from "./helpers";

const LEAVE = "You have unsaved changes to this brand kit. Leave without saving them?";

let fernhollow = "";
let quillmoor = "";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  fernhollow = await demoBrandId(page, "Fernhollow Outfitters");
  quillmoor = await demoBrandId(page, "Quillmoor Money");
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

/** Opens a brand's editor the way a person does: overview, then "Edit brand kit". */
async function openEditor(page: Page, id: string) {
  await page.goto(`/brands/${id}`);
  await settle(page);
  await page.getByRole("link", { name: "Edit brand kit" }).click();
  await expect(page.getByRole("heading", { name: "Edit brand kit", level: 1 })).toBeVisible();
  await settle(page);
  // An untouched editor has nothing to lose.
  await expect(page.getByText("No changes yet.")).toBeVisible();
}

/** The text of the error message a control points at with aria-describedby. */
async function errorOf(control: Locator): Promise<string | null> {
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter((x) => x.endsWith("-error"));
  if (ids.length !== 1) return null;
  return control.page().locator(`[id="${ids[0]}"]`).filter({ visible: true }).textContent();
}

/** Records every dialog; answers each with the next of `answers` (true accepts). */
function dialogs(page: Page, answers: boolean[] = []) {
  const seen: Dialog[] = [];
  page.on("dialog", async (d) => {
    seen.push(d);
    if (answers.shift() ?? true) await d.accept();
    else await d.dismiss();
  });
  return seen;
}

// The tests that save Quillmoor's kit are tagged @brand-kit: they run in the brand-kit project (playwright.config.ts),
// after every other spec and one at a time, as other specs read Quillmoor's kit (its don't rules, its voice).
test.describe("S2-3 #1: editing the kit", { tag: "@brand-kit" }, () => {
  test("change the tone words and a don't rule, save, reload: the overview shows the change", async ({ page }) => {
    const tag = randomUUID().slice(0, 6);
    const word = `steady-${tag}`;
    const rule = `Promise returns of any kind (${tag})`;
    await openEditor(page, quillmoor);

    await page.getByLabel("Tone word 1", { exact: true }).fill(word);
    await page.getByRole("button", { name: "Add a tone word" }).click();
    // The new row takes focus.
    await expect(page.getByRole("group", { name: "Tone words" }).getByRole("textbox").last()).toBeFocused();
    await page.keyboard.type(`kind-${tag}`);
    await page.getByLabel("Don't rule 1", { exact: true }).fill(rule);
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await page.getByRole("button", { name: "Save brand kit" }).click();

    await expect(page.locator("[data-toast]").filter({ hasText: "Brand kit saved for Quillmoor Money." })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}$`));
    for (const pass of ["after saving", "after a reload"]) {
      const tone = page.getByRole("list", { name: "Tone words" });
      await expect(tone.getByText(word, { exact: true }), pass).toBeVisible();
      await expect(tone.getByText(`kind-${tag}`, { exact: true }), pass).toBeVisible();
      await expect(page.getByRole("list", { name: "Don't" }).getByText(rule, { exact: true }), pass).toBeVisible();
      await page.reload();
      await settle(page);
    }
  });
});

test.describe("S2-3 #2: validation", { tag: "@brand-kit" }, () => {
  test("messages appear beside the right field, and nothing is saved while any field is invalid", async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to check nothing was saved");
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const row = async () => (await sql`select slug, palette, tone_words, updated_at from public.brands where id = ${quillmoor}`)[0];
    try {
      const before = await row();
      dialogs(page); // leaving at the end discards the draft
      await openEditor(page, quillmoor);

      const hex = page.getByLabel("Colour 1 hex value");
      const slug = page.getByLabel("Short name");
      await hex.fill("#12345");
      await slug.fill("Not A Slug");
      await page.getByRole("button", { name: "Add a tone word" }).click(); // left empty
      await page.getByRole("button", { name: "Save brand kit" }).click();

      await expect(page.getByRole("alert").filter({ hasText: "3 fields need changing" })).toContainText(
        "Nothing has been saved.",
      );
      expect(await errorOf(hex)).toBe("Use a hex colour such as #3F5B3A.");
      expect(await errorOf(slug)).toBe("Use lower-case letters, numbers and hyphens, such as fern-hollow.");
      expect(await errorOf(page.getByRole("group", { name: "Tone words" }).getByRole("textbox").last())).toBe(
        "Tone word can't be empty.",
      );
      // Focus goes to the first field to fix; other fields are not marked.
      await expect(slug).toBeFocused();
      await expect(page.getByLabel("Name", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
      await expect(page).toHaveURL(/\/edit$/);

      // Fixing one field is not enough: still nothing is saved.
      await hex.fill("#1F4E79");
      await expect(hex).not.toHaveAttribute("aria-invalid", "true");
      await page.getByRole("button", { name: "Save brand kit" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "2 fields need changing" })).toBeVisible();
      await expect(page).toHaveURL(/\/edit$/);

      const after = await row();
      expect(after.slug).toBe(before.slug);
      expect(after.palette).toEqual(before.palette);
      expect(after.tone_words).toEqual(before.tone_words);
      expect(after.updated_at).toEqual(before.updated_at);
    } finally {
      await sql.end();
    }
  });
});

test.describe("S2-3 #3: unsaved changes", { tag: "@brand-kit" }, () => {
  test("leaving by a link or the back button with unsaved changes asks first; staying keeps them", async ({ page }) => {
    const seen = dialogs(page, [false, false, true]);
    await openEditor(page, quillmoor);
    const field = page.getByLabel("Voice notes");
    const original = await field.inputValue();
    await field.fill(`${original} Draft that is never saved.`);

    // A link in the main navigation: stay.
    await page.getByRole("link", { name: "Brands", exact: true }).click();
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0].type()).toBe("confirm");
    expect(seen[0].message()).toBe(LEAVE);
    await expect(page).toHaveURL(/\/edit$/);
    await expect(field).toHaveValue(`${original} Draft that is never saved.`);

    // The back button: stay.
    await page.goBack();
    await expect.poll(() => seen.length).toBe(2);
    await expect(page).toHaveURL(/\/edit$/);
    await expect(field).toHaveValue(`${original} Draft that is never saved.`);

    // Cancel: leave. The overview shows; nothing was saved.
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect.poll(() => seen.length).toBe(3);
    await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}$`));
    await expect(page.getByText("Draft that is never saved.")).toHaveCount(0);

    // Coming back starts from the saved kit, not the discarded draft.
    await page.getByRole("link", { name: "Edit brand kit" }).click();
    await expect(page.getByLabel("Voice notes")).toHaveValue(original);
  });

  test("the back button can leave too, after asking", async ({ page }) => {
    const seen = dialogs(page, [true]);
    await openEditor(page, quillmoor);
    await page.getByLabel("Category").fill("Changed and then abandoned");
    await page.goBack();
    await expect.poll(() => seen.length).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}$`));
    await expect(page.getByRole("heading", { name: "Quillmoor Money", level: 1 })).toBeVisible();
  });

  test("closing the tab with unsaved changes asks (the browser's own prompt)", async ({ page }) => {
    const seen = dialogs(page, [true]);
    await openEditor(page, quillmoor);
    await page.getByLabel("Category").fill("Changed before closing the tab");
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => seen.map((d) => d.type())).toEqual(["beforeunload"]);
  });

  test("saved changes, or none, leave without asking", async ({ page }) => {
    const seen = dialogs(page);
    // No changes: links and back just go.
    await openEditor(page, quillmoor);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}$`));
    await page.getByRole("link", { name: "Edit brand kit" }).click();
    await page.getByRole("link", { name: "Brands", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Brands", level: 1 })).toBeVisible();

    // Saved changes: saving leaves, then back and links just go.
    await openEditor(page, quillmoor);
    const notes = page.getByLabel("Voice notes");
    const saved = `${(await notes.inputValue()).replace(/ Saved at \d+\.$/, "")} Saved at ${Date.now()}.`;
    await notes.fill(saved);
    await page.getByRole("button", { name: "Save brand kit" }).click();
    await expect(page).toHaveURL(new RegExp(`/brands/${quillmoor}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/edit$/);
    // The kept editor shows what was saved, not the kit from before the save.
    await expect(page.getByLabel("Voice notes")).toHaveValue(saved);
    await expect(page.getByText("No changes yet.")).toBeVisible();
    await page.getByRole("link", { name: "Agent runs", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Agent runs", level: 1 })).toBeVisible();
    expect(seen.map((d) => d.message())).toEqual([]);
  });
});

test.describe("S2-3 #5: simulated data is labelled", () => {
  test("every customer and order figure of a simulated brand says Simulated data", async ({ page }) => {
    await page.goto(`/brands/${fernhollow}`);
    await settle(page);
    const section = page.getByRole("region", { name: "Customers and orders" });
    const figures = section.locator("[data-figure]");
    // Customers, orders, repeat rate, lapsed, orders by month, regions, age bands.
    await expect(figures).toHaveCount(7);
    for (const f of await figures.all()) {
      await expect(f.getByText("Simulated data", { exact: true }), (await f.getAttribute("data-figure"))!).toBeVisible();
    }
    await expect(section.getByText("2,000", { exact: true })).toBeVisible();
    // The chart has a text alternative and every month in a table.
    await expect(section.getByRole("img", { name: /^Bar chart of orders in each of the 24 months.*simulated data/ })).toBeVisible();
    await section.getByText("Show orders by month as a table").click();
    await expect(section.getByRole("table", { name: "Orders by month (simulated data)" }).getByRole("row")).toHaveCount(25);
    // The brand itself is marked too.
    await expect(page.getByRole("heading", { level: 1 }).locator("..").getByText("Simulated data")).toBeVisible();
  });
});

test.describe("S2-3 #6: another workspace's brand", () => {
  test("another workspace's brand id, or a malformed id, shows not found", async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to create another workspace");
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const userId = randomUUID();
    try {
      const [brand] = await sql.begin(async (tx) => {
        await tx`insert into auth.users (id, email) values (${userId}, ${`other-${userId}@example.test`})`;
        const [ws] = await tx`insert into public.workspaces (name, created_by) values ('Other workspace', ${userId}) returning id`;
        await tx`insert into public.workspace_members (workspace_id, user_id) values (${ws.id}, ${userId})`;
        return tx`insert into public.brands (workspace_id, created_by, name, slug)
          values (${ws.id}, ${userId}, 'Hidden Harbour Teas', 'hidden-harbour') returning id`;
      });
      for (const path of [`/brands/${brand.id}`, `/brands/${brand.id}/edit`, "/brands/not-a-uuid", "/brands/not-a-uuid/edit"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: "Not found" }), path).toBeVisible();
        await expect(page.getByText("Hidden Harbour Teas"), path).toHaveCount(0);
      }
    } finally {
      await sql`delete from public.workspaces where created_by = ${userId}`; // and its brand
      await sql`delete from auth.users where id = ${userId}`;
      await sql.end();
    }
  });
});

test.describe("S2-3 #7: keyboard (layout and contrast are in design-system.spec.ts)", () => {
  test("every control on the brand screens is reachable with Tab and shows a focus ring", async ({ page }) => {
    dialogs(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ["/brands", `/brands/${fernhollow}`, `/brands/${fernhollow}?q=lapsed`, `/brands/${fernhollow}/edit`]) {
      await page.goto(path);
      await settle(page);
      const stops = await tabThrough(page, 250);
      const expected = await expectedStops(page);
      expect(expected, `${path}: controls found`).toBeGreaterThan(5);
      expect(stops.length, `${path}: controls reached with Tab`).toBe(expected);
      for (const s of stops) expect(s.ring, `${path}: control ${s.key} has no visible focus ring`).toBe(true);
    }
  });

  test("brand controls work with Enter and Space", async ({ page }) => {
    dialogs(page); // the draft is discarded at the end
    // Enter in the search box searches.
    await page.goto(`/brands/${fernhollow}`);
    await settle(page);
    await page.getByLabel(/^Search the context for/).focus();
    await page.keyboard.type("repeat");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: /for “repeat”/ })).toBeVisible();

    // Enter on a link opens the editor.
    await page.getByRole("link", { name: "Edit brand kit" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Edit brand kit", level: 1 })).toBeVisible();

    // Space on "Add a banned term" adds a row and focuses it; Enter on its Remove takes it away.
    const terms = page.getByRole("group", { name: "Banned terms" }).getByRole("textbox");
    const n = await terms.count();
    await page.getByRole("button", { name: "Add a banned term" }).focus();
    await page.keyboard.press("Space");
    await expect(terms).toHaveCount(n + 1);
    await expect(terms.last()).toBeFocused();
    await page.getByRole("button", { name: `Remove Banned term ${n + 1}` }).focus();
    await page.keyboard.press("Enter");
    await expect(terms).toHaveCount(n);
    // Focus moves to the row above, not lost.
    await expect(terms.last()).toBeFocused();
  });
});

test.describe("S2-5: the search box on the overview", () => {
  test("S2-5 #1: searching “lapsed” on Fernhollow shows the lapsed segment first, with its kind and source", async ({ page }) => {
    await page.goto(`/brands/${fernhollow}`);
    await settle(page);
    await page.getByLabel(/^Search the context for/).fill("lapsed");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\?q=lapsed$/);
    const results = page.locator("[data-search-result]").filter({ visible: true });
    await expect(results.first()).toBeVisible();
    await expect(results.first().getByRole("heading")).toHaveText("Lapsed customers (no order in 12 months)");
    await expect(results.first()).toContainText("Segment");
    await expect(results.first()).toContainText("Simulated data.");
    await expect(results.first()).toContainText("Source: Customer summary");
    await expect(page.getByRole("status").filter({ hasText: /for “lapsed”, best match first/ })).toBeVisible();
  });

  test("an empty search and a search with no results say so", async ({ page }) => {
    await page.goto(`/brands/${fernhollow}`);
    await settle(page);
    await expect(page.getByText(/Search by word or phrase/)).toBeVisible();
    await page.getByLabel(/^Search the context for/).fill("zzzqqq");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Nothing matches “zzzqqq”" })).toBeVisible();
    await expect(page.locator("[data-search-result]").filter({ visible: true })).toHaveCount(0);
  });

  test("S2-5 #5: hostile searches show a normal empty or results state, never an error", async ({ page }) => {
    const hostile = ["' or 1=1 --", "&", ":*", "<script>alert(1)</script>", "x".repeat(1000)];
    let dialog = false;
    page.on("dialog", async (d) => {
      dialog = true;
      await d.dismiss();
    });
    for (const q of hostile) {
      if (q.length < 200) {
        await page.goto(`/brands/${fernhollow}`);
        await settle(page);
        await page.getByLabel(/^Search the context for/).fill(q);
        await page.getByRole("button", { name: "Search", exact: true }).click();
      } else {
        // Longer than the box allows: straight into the address.
        await page.goto(`/brands/${fernhollow}?q=${encodeURIComponent(q)}`);
      }
      const label = q.slice(0, 20);
      await expect(page.getByRole("status").filter({ hasText: /^(Nothing matches|\d+ results? for)/ }), label).toBeVisible();
      await expect(page.getByRole("heading", { name: "Fernhollow Outfitters", level: 1 }), label).toBeVisible();
      await expect(page.getByText(/went wrong|Application error/i), label).toHaveCount(0);
    }
    expect(dialog).toBe(false);
  });
});
