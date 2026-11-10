// Sprint 10b, D-1 New brand, D-2 #2 (fictional versus simulated, as a person
// sees it) and D-3 Simulated data for a new brand, through the UI. A person
// starts a brand of their own from the Brands page ("Brightwater Kitchen"),
// lands in its kit editor, gives it simulated customers and orders from a short
// profile, and sees them labelled "Simulated data" and never "Demo brand".
//
// These tests use a new invitee's own workspace (the owner invites them on
// /invites and they accept, as runs-list.spec.ts does), so the Brands page
// starts empty and nothing other specs do in the dev workspace is on it. The
// tests run serially, in order: D-1 makes the brands D-3 fills. Every name is
// fictional (rule 2; tests/fixtures/new-brand.ts).
//
// 1. (D-1 #1) "Brightwater Kitchen" with a category creates a brand in the
//    reader's workspace, opens its kit editor, and is listed on /brands. The
//    empty states on /brands and /campaigns offer New brand and Add demo brands.
// 2. (D-1 #2) A short name another brand in the workspace uses is refused with
//    the field error; nothing is created.
// 3. (D-1 #3) An empty name, and a name of 81 characters, are refused with
//    field errors; nothing is created.
// 4. (D-1 #4) A name with markup and SQL is stored and shown as text. Another
//    workspace never sees the brand: tests/db/new-brand.test.ts.
// 5. (D-1 #5) The form fits within 1.5 screens at 375 px; AA contrast and no
//    sideways scroll at 375 px and 1440 px.
// 6. (D-3 #1) A profile of 3 products and 2,000 customers makes them, with the
//    orders within 5% of what the generator promises; the customer summary
//    shows the counts and "Simulated data".
// 7. (D-2 #2) The new brand with generated data shows "Simulated data" and no
//    "Demo brand" pill; a demo brand still shows "Demo brand". The launch pack
//    README's words are tests/lib/own-names.test.ts.
// 8. (D-3 #4) Refused with field errors, nothing saved: no products, a price of
//    0 or over £10,000, and a customer count outside 500 to 20,000; and a brand
//    that already has customers has no form.
//
// ---------------------------------------------------------------- interface
// What the builder provides. These tests, tests/lib/new-brand.test.ts,
// tests/db/new-brand.test.ts, tests/db/fictional-brands.test.ts,
// tests/lib/own-names.test.ts, tests/lib/simulated-profile.test.ts and
// tests/flows/simulated-data.test.ts pin it. Rules 1, 2, 5 and 7 hold: simulated
// data is labelled as simulated wherever it is shown; the tests use fictional
// names; generating data makes no model call; every read and write goes through
// asUser() in the reader's workspace.
//
// Migration (a new file in db/migrations; never edit an applied one):
//   brands.is_fictional boolean not null default false. The same migration sets it true for every
//     brand with is_simulated = true (the demo brands are fictional and simulated), with
//     "update public.brands set is_fictional = true where is_simulated".
//   brands.own_names text[] not null default '{}', with a check constraint of at most 5 names
//     (cardinality(own_names) <= 5; SQLSTATE 23514 when broken). The 80-character limit is the kit's (zod).
//   brands_guard: is_fictional can never change after insert; is_simulated may change from false to
//     true (D-3 generates data) and never back ("cannot be changed", 42501, as today).
//   The demo loader (src/lib/demo/load.ts) inserts its brands with is_fictional = true and is_simulated = true.
//   createBrand() (src/lib/brands/repo.ts) inserts is_fictional = false; with no opts, is_simulated = false.
//   Brand (repo.ts) gains isFictional: boolean and ownNames: string[].
//   brands.is_simulated keeps one meaning only: the brand's data is simulated.
//
// src/lib/brands/schema.ts:
//   brandInputSchema gains ownNames: up to 5 names, each 1 to 80 characters, default [], unique ignoring case.
//     Messages (field keys as parseBrandInput gives them):
//       "ownNames":   "No more than 5 own names."
//       "ownNames.N": "Own name can't be empty."  |  "Own name must be 80 characters or fewer."
//       "ownNames.N": "This name is also one of the brand's banned terms."  (an own name equal to a banned term,
//                     ignoring case and spacing, as normaliseKitText compares them)
//   slugFromName(name: string) => string: lower case, accents folded (é to e), every run of other characters
//     one hyphen, no hyphen at either end, at most 40 characters (cut at a hyphen where it can be, never ending
//     in one); "" when nothing is left. "Brightwater Kitchen" gives "brightwater-kitchen".
//   newBrandSchema: name, slug, category and description with brandInputSchema's rules and messages;
//     parseNewBrand(raw: unknown) => ParseResult-like { ok: true; data: { name; slug; category; description } }
//     | { ok: false; fieldErrors: Record<string, string> }. "Give the brand a name." for an empty name,
//     "Name must be 80 characters or fewer." for 81.
//
// Pages and words (British English, no em dashes):
//   /brands:
//     - A link "New brand" (data-new-brand, href "/brands/new") at the top of the page, whether or not the
//       workspace has brands.
//     - Empty state "No brands yet" with two actions: the link "New brand" and the button "Add demo brands".
//     - Each brand's card: "Simulated data" when is_simulated; "Demo brand" when is_fictional; the category.
//   /campaigns with no brands: the empty state "Add a brand first" offers "New brand" (a link to /brands/new)
//     and "Add demo brands" (a link to /brands, where the button is).
//   /brands/new (src/app/(app)/brands/new/page.tsx, inside <Suspense>):
//     - <h1> "New brand"; a form [data-new-brand-form] with noValidate, labelled fields:
//       "Name" (required, no maxLength attribute: an 81st character is said, not blocked),
//       "Short name" (filled in from the name with slugFromName() until the person edits it; editable),
//       "Category", "Description"; the button "Create brand" ("Creating…" while it runs).
//     - A refusal: role="alert" "Some fields need changing. Nothing was saved.", each bad field with
//       aria-invalid="true" and aria-describedby naming "<field id>-error", whose text is the message.
//       A short name another brand in the workspace uses: "Already used by another brand." (the 23505 that
//       createBrand() already turns into BrandInputError).
//     - Created through createBrand() with asUser(), in the reader's workspace (rule 7), not fictional and
//       not simulated; then the browser goes to /brands/<id>/edit (<h1> "Edit brand kit").
//     - Within 1.5 screens at 375 px (812 px high): the Create brand button's bottom edge at most 1,218 px
//       from the top of the page. AA contrast and no sideways scroll at 375 px and 1440 px.
//   The kit editor (/brands/<id>/edit) and the languages page (/brands/<id>/languages): the "Demo brand" pill
//     reads isFictional, never isSimulated. The kit editor has a fieldset "Also known as" (a ListField:
//     field "ownNames", items "Own name 1", "Own name 2", ..., the button "Add an own name", at most 5;
//     hint "Other names this brand's ads may use, such as a parent brand's. Up to 5, 80 characters each.").
//   "Simulated data" (brands list, brand page header, segments, customer summary, campaign frame) reads
//     isSimulated, as today.
//   The launch pack (src/lib/creative/pack.ts): PackPlan.campaign gains brandFictional: boolean (brands.is_fictional)
//     beside brandSimulated (is_simulated); readme() ends "Studio is a working title. The brand in this pack is
//     fictional." only when brandFictional, else "Studio is a working title." and no claim either way.
//
// D-2 own names in the checks (rule 2's market exception: notes may name the company; the brand's own names may
// reach a brief and creative, any other company may not):
//   src/lib/brands/own-names.ts (NEW, PURE): refusableNames(realNames: string[], brand: { name: string;
//     ownNames: readonly string[] }) => string[]: the market notes' names less any equal to the brand's name or one
//     of its own names (ignoring case and spacing, as normaliseKitText compares); "Brightwater Foods Group" is not
//     "Brightwater". realNamesFor() (src/lib/brief/gather.ts) returns refusableNames() of what the notes declare, so
//     every check that reads it (brief, copy, translation, upload, imagery) gets the filtered list.
//   The checks also take the own names themselves, so they are treated like the brand's name whoever calls them:
//     KitLists.ownNames?: string[] (evidenceProblems skips a real name that is an own name);
//     CopyRules.ownNames?: string[] and TranslationRules.ownNames?: string[] (setProblems and translationProblems
//       skip them as real names, and count their words as the brand's own for the "looks like another brand" check);
//     realNameRule(words, realNames, ownNames: readonly string[] = []) (src/lib/compliance/upload-rules.ts);
//     copyInput and localiseInput gain ownNames: string[] (default []), from the kit.
//   Imagery (src/lib/agents/imagery.ts): imageryInput gains ownNames: string[] (up to 5, default []), for the checks
//     only; forImageModel() takes each own name out of every text the model is given, as it takes out the brand's
//     name and the notes' names; promptProblems() refuses a prompt naming one ('prompt <n> names "<own name>", one of
//     the brand's own names; ...'). Rule 8 and the picture check are unchanged.
//
// D-3, src/lib/demo/profile.ts (NEW, PURE: no database, no model):
//   REGION_SETS: { uk: readonly string[]; japan: readonly string[] }: uk is the demo brands' 12 UK regions
//     (as src/lib/demo/briefs.ts lists them); japan is exactly
//     ["Hokkaido", "Tohoku", "Kanto", "Chubu", "Kansai", "Chugoku", "Shikoku", "Kyushu-Okinawa"].
//   PROFILE_LIMITS = { minProducts: 1, maxProducts: 10, minCustomers: 500, maxCustomers: 20_000,
//     defaultCustomers: 5_000, maxPricePence: 1_000_000, maxBusiestMonths: 3 }
//   type ProfileProduct = { name: string; category: string; pricePence: number; popularity: "low" | "medium" | "high" }
//   type DataProfile = { products: ProfileProduct[]; customers: number; regionSet: "uk" | "japan"; busiestMonths: number[] }
//   parseDataProfile(raw: unknown) => { ok: true; data: DataProfile } | { ok: false; fieldErrors: Record<string, string> }
//     "products":               "Add at least one product."  |  "No more than 10 products."
//     "products.N.name":        "Name the product."  |  "Product name must be 80 characters or fewer."
//     "products.N.category":    "Category must be 60 characters or fewer." (optional, default "")
//     "products.N.pricePence":  "Give a price above £0."  |  "Keep the price to £10,000 or less."  (whole pence)
//     "products.N.popularity":  "Choose low, medium or high."
//     "customers":              "Choose between 500 and 20,000 customers." (a whole number)
//     "regionSet":              "Choose UK regions or Japan's regions."
//     "busiestMonths":          "Choose one to three busiest months." (distinct months 1 to 12)
//     Text is trimmed and stored as text (markup and SQL included).
//   penceFromPounds(text: string) => number | null: trimmed; an optional "£", digits with optional thousands commas
//     in groups of three, and up to 2 decimal places: "12.50", "£12.50", " 12.5 ", "12", "0" and "1,200" read as
//     pence (1250, 1250, 1250, 1200, 0, 120000); anything else ("", "abc", "12.505", "-3", "12,50", "1e3") is null.
//     The form says "Use a price such as 12.50." for null.
//   simulatedDataDay(now: Date) => Date: the start of now's UTC day. The data's reference date and data_as_of.
//   simulatedDataSeed(brandId: string, day: Date) => number: an integer from the brand id and the UTC day; the
//     same for the same brand and day, different for another brand or day.
//   profileToBrief(profile: DataProfile, kit: BrandKit) => DemoBrief: customers = profile.customers;
//     regions.names = REGION_SETS[profile.regionSet]; peakMonths = profile.busiestMonths (the busiest calendar
//     month of the data is one of them); products in the profile's order with weights rising with popularity
//     (low < medium < high); targetOrders = the orders the generator lands within 5% of (generateDemoBrand's promise).
//   simulateProfile(profile, kit, at: { brandId: string; now: Date }) => { brief: DemoBrief; data: DemoData; refDate: Date; seed: number }:
//     refDate = simulatedDataDay(at.now), seed = simulatedDataSeed(at.brandId, refDate), data = generateDemoBrand(brief, { seed, refDate }).
//
// D-3, src/lib/demo/simulated.ts (server, through asUser(); rule 7):
//   class SimulatedDataError extends Error { fieldErrors: Record<string, string> }
//   generateSimulatedData(member: Member, brandId: string, raw: unknown, opts?: { now?: Date })
//     => Promise<{ products: number; customers: number; orders: number; asOf: string }>
//     Validates with parseDataProfile (a refusal: SimulatedDataError with its fieldErrors, nothing saved);
//     refuses a malformed id or a brand not in the reader's workspace ("That brand isn't in your workspace.");
//     refuses a brand that already has customers
//     ("This brand already has customers, so no simulated data can be added."); else, in one transaction, saves the products, customers, orders and order lines of
//     simulateProfile(), sets is_simulated = true and data_as_of = refDate, and syncs the context store
//     (syncBrandContext) as the demo loader does. No model calls (rule 5).
//
// D-3 pages and words:
//   The brand page's "Products and data" tab, on a brand with no customers: a link
//     <a data-generate-data href="/brands/<id>/simulated-data"> "Generate simulated data", with the sentence
//     "Make simulated customers and orders from a short profile. They are labelled as simulated everywhere, and
//     no AI is used." None once the brand has customers.
//   /brands/<id>/simulated-data (inside <Suspense>): <h1> "Generate simulated data"; a form
//     [data-simulated-data-form] with noValidate:
//       - product rows, one empty to start: "Product N name", "Product N category", "Product N price (£)"
//         (text, inputMode decimal), "Product N popularity" (a <select>: "Low", "Medium" (the default), "High");
//         the buttons "Add a product" (disabled at 10, "That's the most allowed (10).") and "Remove product N";
//       - "Customers" (a number, 5000 to start; hint "500 to 20,000.");
//       - a fieldset "Regions" with the radios "UK regions" (checked to start) and "Japan's regions";
//       - a fieldset "Busiest months" with the checkboxes "January" to "December";
//       - the button "Generate data" ("Generating…" while it runs).
//     A refusal: role="alert" "Some fields need changing. Nothing was saved.", the field messages above beside
//       their fields (aria-invalid, aria-describedby "<id>-error"; the products' list message in the alert too).
//     Done: the browser goes to /brands/<id>?tab=products, where the customer summary shows the pill
//       "Simulated data" and [data-figure="Customers"] and [data-figure="Orders"] with the counts.
//     On a brand that already has customers the page shows "This brand already has customers, so no simulated
//       data can be added." and no form; another workspace's brand id is not found.
// ----------------------------------------------------------------------------
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { parseBrandInput } from "@/lib/brands/schema";
import { profileToBrief } from "@/lib/demo/profile";
import { BRIGHTWATER, BRIGHTWATER_PANTRY, BRIGHTWATER_PROFILE, HOSTILE_BRAND_NAME } from "../fixtures/new-brand";
import { contrastViolations, demoBrandId, expectNoHorizontalScroll, settle, signIn, step } from "./helpers";
import { memberByEmail, type FixtureMember } from "./home-fixture";
import { MAIN_ACTION_SCREENS, VIEWPORT_HEIGHT } from "./page-budgets";

type Sql = postgres.Sql;
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const PHONE = { width: 375, height: VIEWPORT_HEIGHT[375] };
const DESKTOP = { width: 1440, height: VIEWPORT_HEIGHT[1440] };
const REFUSED = "Some fields need changing. Nothing was saved.";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let guestState: StorageState | null = null;
let guest: FixtureMember | null = null;
/** Brightwater Kitchen's id, from D-1 #1. */
let kitchenId = "";

const withSql = async <T>(body: (sql: Sql) => Promise<T>): Promise<T> => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return await body(sql);
  } finally {
    await sql.end();
  }
};

async function guestPage(browser: Browser, viewport = DESKTOP): Promise<Page> {
  expect(guestState, "the invitee from the setup").not.toBeNull();
  const ctx = await browser.newContext({ storageState: guestState!, viewport });
  return ctx.newPage();
}

async function open(page: Page, path: string, h1: string) {
  await page.goto(path);
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: h1, exact: true })).toBeVisible();
}

/** The text of the error message a control points at with aria-describedby (as brands.spec.ts reads it). */
async function errorOf(control: Locator): Promise<string | null> {
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter((x) => x.endsWith("-error"));
  if (ids.length !== 1) return null;
  return control.page().locator(`[id="${ids[0]}"]`).filter({ visible: true }).textContent();
}

const brandCount = () => withSql(async (sql) => Number((await sql`select count(*)::int as n from public.brands where workspace_id = ${guest!.workspaceId}`)[0].n));
const brandRow = (name: string) =>
  withSql(async (sql) => (await sql`select id, workspace_id, slug, is_fictional, is_simulated from public.brands where workspace_id = ${guest!.workspaceId} and name = ${name}`)[0] ?? null);

/** Fills and submits the New brand form, as a person does. */
async function fillNewBrand(page: Page, b: { name: string; slug?: string; category?: string; description?: string }) {
  const form = page.locator("[data-new-brand-form]");
  await form.getByLabel("Name", { exact: true }).fill(b.name);
  if (b.slug !== undefined) await form.getByLabel("Short name", { exact: true }).fill(b.slug);
  if (b.category !== undefined) await form.getByLabel("Category", { exact: true }).fill(b.category);
  if (b.description !== undefined) await form.getByLabel("Description", { exact: true }).fill(b.description);
  await form.getByRole("button", { name: "Create brand" }).click();
}

/** Fills the simulated-data profile's form: product rows, customers, regions and busiest months. */
async function fillProfile(page: Page, p: { products: { name: string; category: string; price: string; popularity: "Low" | "Medium" | "High" }[]; customers: string; regions: "UK regions" | "Japan's regions"; months: string[] }) {
  const form = page.locator("[data-simulated-data-form]");
  for (const [i, prod] of p.products.entries()) {
    if (i > 0) await form.getByRole("button", { name: "Add a product" }).click();
    await form.getByLabel(`Product ${i + 1} name`, { exact: true }).fill(prod.name);
    await form.getByLabel(`Product ${i + 1} category`, { exact: true }).fill(prod.category);
    await form.getByLabel(`Product ${i + 1} price (£)`, { exact: true }).fill(prod.price);
    await form.getByLabel(`Product ${i + 1} popularity`, { exact: true }).selectOption({ label: prod.popularity });
  }
  await form.getByLabel("Customers", { exact: true }).fill(p.customers);
  await form.getByRole("radio", { name: p.regions, exact: true }).check();
  for (const m of p.months) await form.getByRole("checkbox", { name: m, exact: true }).check();
}

const POPULARITY = { low: "Low", medium: "Medium", high: "High" } as const;
const pounds = (pence: number) => (pence / 100).toFixed(2);

test.describe("Sprint 10b: a new brand of your own, with simulated data, in a new invitee's workspace", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    if (!process.env.DATABASE_URL) return;
    test.setTimeout(180_000);
    const email = `new-brand-${Date.now()}@example.test`;
    const owner = await (await browser.newContext({ viewport: DESKTOP })).newPage();
    await signIn(owner);
    await owner.goto("/invites");
    await settle(owner);
    await owner.getByLabel("Email").filter({ visible: true }).fill(email);
    await owner.getByRole("button", { name: "Create invite link" }).click();
    const link = await owner.locator("[data-invite-link] input").first().inputValue();
    await owner.context().close();
    const ctx = await browser.newContext({ viewport: DESKTOP });
    const g = await ctx.newPage();
    await g.goto(new URL(link).pathname);
    await g.getByRole("button", { name: "Continue to Studio" }).click();
    await expect(g.getByRole("heading", { name: "Try the tagline agent" })).toBeVisible();
    guestState = await ctx.storageState();
    await ctx.close();
    guest = await withSql((sql) => memberByEmail(sql, email));
  });

  test.afterAll(async () => {
    if (!process.env.DATABASE_URL || !guest) return;
    // The invitee's brands and everything under them go with the brands (on delete cascade).
    await withSql((sql) => sql`delete from public.brands where workspace_id = ${guest!.workspaceId}`);
  });

  test(
    "D-1 #1: Brightwater Kitchen with a category is created in the reader's workspace, opens its kit editor and is listed on /brands; the empty states offer New brand and Add demo brands",
    { annotation: [{ type: "case", description: "D-1.1" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to check the brand's workspace and flags");
      test.setTimeout(120_000);

      await step(page, "D-1.1: with no brands, /brands and /campaigns offer both New brand and Add demo brands", async () => {
        const g = await guestPage(browser);
        await open(g, "/brands", "Brands");
        const empty = g.locator("main").filter({ has: g.getByRole("heading", { name: "No brands yet" }) });
        await expect(g.getByRole("heading", { name: "No brands yet" })).toBeVisible();
        await expect(empty.getByRole("button", { name: "Add demo brands" })).toBeVisible();
        await expect(g.getByRole("link", { name: "New brand", exact: true }).first()).toHaveAttribute("href", "/brands/new");
        await open(g, "/campaigns", "Campaigns");
        await expect(g.getByRole("heading", { name: "Add a brand first" })).toBeVisible();
        await expect(g.getByRole("link", { name: "New brand", exact: true })).toHaveAttribute("href", "/brands/new");
        await expect(g.getByText("Add demo brands", { exact: true }).filter({ visible: true })).toHaveCount(1);
        await g.context().close();
      });

      await step(page, "D-1.1: New brand, Brightwater Kitchen with Home cooking: the short name fills itself in, then the kit editor opens", async () => {
        const g = await guestPage(browser);
        await open(g, "/brands", "Brands");
        await g.getByRole("link", { name: "New brand", exact: true }).first().click();
        await g.waitForURL("**/brands/new");
        await settle(g);
        await expect(g.getByRole("heading", { level: 1, name: "New brand" })).toBeVisible();
        const form = g.locator("[data-new-brand-form]");
        await form.getByLabel("Name", { exact: true }).fill(BRIGHTWATER.name);
        await expect(form.getByLabel("Short name", { exact: true })).toHaveValue(BRIGHTWATER.slug);
        await form.getByLabel("Category", { exact: true }).fill(BRIGHTWATER.category);
        await form.getByLabel("Description", { exact: true }).fill(BRIGHTWATER.description);
        await form.getByRole("button", { name: "Create brand" }).click();
        await g.waitForURL(/\/brands\/[0-9a-f-]{36}\/edit$/);
        await settle(g);
        await expect(g.getByRole("heading", { level: 1, name: "Edit brand kit" })).toBeVisible();
        // Next keeps the New brand page hidden in the document after the move, so look only at what is shown.
        await expect(g.getByLabel("Name", { exact: true }).filter({ visible: true })).toHaveValue(BRIGHTWATER.name);
        await expect(g.getByLabel("Category", { exact: true }).filter({ visible: true })).toHaveValue(BRIGHTWATER.category);
        // D-2: the kit editor has the brand's own names, and a person's own brand is not a demo brand.
        await expect(g.getByRole("group", { name: "Also known as" })).toBeVisible();
        await expect(g.getByRole("button", { name: "Add an own name" })).toBeVisible();
        await expect(g.getByText("Demo brand", { exact: true }).filter({ visible: true })).toHaveCount(0);
        await expect(g.getByText("Simulated data", { exact: true }).filter({ visible: true })).toHaveCount(0);
        kitchenId = new URL(g.url()).pathname.split("/")[2];
        await g.context().close();
      });

      await step(page, "D-1.1: the brand is in the invitee's workspace, neither fictional nor simulated, and listed on /brands", async () => {
        const row = await brandRow(BRIGHTWATER.name);
        expect(row).not.toBeNull();
        expect(row).toMatchObject({ id: kitchenId, workspace_id: guest!.workspaceId, slug: BRIGHTWATER.slug, is_fictional: false, is_simulated: false });
        const g = await guestPage(browser);
        await open(g, "/brands", "Brands");
        const card = g.getByRole("list", { name: "Brands in this workspace" }).getByRole("link", { name: new RegExp(`^${BRIGHTWATER.name}`) });
        await expect(card).toHaveAttribute("href", `/brands/${kitchenId}`);
        await expect(card).toContainText(BRIGHTWATER.category);
        await expect(card).not.toContainText("Simulated data");
        await expect(card).not.toContainText("Demo brand");
        // The New brand link stays once there are brands.
        await expect(g.locator("a[data-new-brand]")).toHaveAttribute("href", "/brands/new");
        await g.context().close();
      });
    },
  );

  test(
    "D-1 #2: a short name another brand in the workspace uses is refused with the field error, and nothing is created",
    { annotation: [{ type: "case", description: "D-1.2" }] },
    async ({ browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to check nothing was created");
      const before = await brandCount();
      const g = await guestPage(browser);
      await open(g, "/brands/new", "New brand");
      await fillNewBrand(g, { name: "Brightwater Kitchen Two", slug: BRIGHTWATER.slug, category: "Home cooking" });
      await expect(g.getByRole("alert").filter({ hasText: REFUSED })).toBeVisible();
      expect(await errorOf(g.getByLabel("Short name", { exact: true }))).toBe("Already used by another brand.");
      await expect(g).toHaveURL(/\/brands\/new$/);
      expect(await brandCount()).toBe(before);
      expect(await brandRow("Brightwater Kitchen Two")).toBeNull();
      await g.context().close();
    },
  );

  test(
    "D-1 #3: an empty name, and a name of 81 characters, are refused with field errors, and nothing is created",
    { annotation: [{ type: "case", description: "D-1.3" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to check nothing was created");
      const before = await brandCount();
      const g = await guestPage(browser);

      await step(page, "D-1.3: an empty name", async () => {
        await open(g, "/brands/new", "New brand");
        await fillNewBrand(g, { name: "", slug: "empty-name", category: "Home cooking" });
        await expect(g.getByRole("alert").filter({ hasText: REFUSED })).toBeVisible();
        expect(await errorOf(g.getByLabel("Name", { exact: true }))).toBe("Give the brand a name.");
        // Focus goes to the field to fix.
        await expect(g.getByLabel("Name", { exact: true })).toBeFocused();
      });

      await step(page, "D-1.3: a name of 81 characters", async () => {
        const long = `Brightwater ${"k".repeat(69)}`;
        expect(long).toHaveLength(81);
        await open(g, "/brands/new", "New brand");
        await fillNewBrand(g, { name: long, slug: "long-name", category: "Home cooking" });
        await expect(g.getByLabel("Name", { exact: true })).toHaveValue(long);
        await expect(g.getByRole("alert").filter({ hasText: REFUSED })).toBeVisible();
        expect(await errorOf(g.getByLabel("Name", { exact: true }))).toBe("Name must be 80 characters or fewer.");
        // Exactly 80 is fine: the same form, one character shorter, is no longer refused for the name.
        await g.getByLabel("Name", { exact: true }).fill(long.slice(0, 80));
        await expect(g.getByLabel("Name", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
      });

      expect(await brandCount()).toBe(before);
      await g.context().close();
    },
  );

  test(
    "D-1 #4: a name with markup and SQL is stored as text and shown escaped",
    { annotation: [{ type: "case", description: "D-1.4" }] },
    async ({ browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to read the stored name");
      const g = await guestPage(browser);
      const dialogs: string[] = [];
      g.on("dialog", async (d) => {
        dialogs.push(d.message());
        await d.dismiss();
      });
      await open(g, "/brands/new", "New brand");
      await fillNewBrand(g, { name: HOSTILE_BRAND_NAME, category: "Home cooking" });
      await g.waitForURL(/\/brands\/[0-9a-f-]{36}\/edit$/);
      await settle(g);
      // Stored exactly as typed, as text; the brands table is still there.
      const row = await brandRow(HOSTILE_BRAND_NAME);
      expect(row, "the hostile name, stored as typed").not.toBeNull();
      expect(row!.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      // Shown as text on the list and on its own page: no element made from it, and no script ran.
      await open(g, "/brands", "Brands");
      await expect(g.getByText(HOSTILE_BRAND_NAME, { exact: true }).first()).toBeVisible();
      await expect(g.locator('main img[src="x"]')).toHaveCount(0);
      await open(g, `/brands/${row!.id}`, HOSTILE_BRAND_NAME);
      await expect(g.locator('main img[src="x"]')).toHaveCount(0);
      expect(dialogs).toEqual([]);
      await g.context().close();
    },
  );

  test(
    "D-1 #5: the New brand form fits within 1.5 screens at 375 px, with AA contrast and no sideways scroll at 375 px and 1440 px",
    { annotation: [{ type: "case", description: "D-1.5" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the invitee");
      for (const viewport of [PHONE, DESKTOP]) {
        await step(page, `D-1.5: /brands/new at ${viewport.width} px`, async () => {
          const g = await guestPage(browser, viewport);
          await open(g, "/brands/new", "New brand");
          if (viewport.width === 375) {
            const button = g.locator("[data-new-brand-form]").getByRole("button", { name: "Create brand" });
            const bottom = await button.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
            expect(bottom, "the Create brand button's bottom edge, from the top of the page").toBeLessThanOrEqual(MAIN_ACTION_SCREENS * VIEWPORT_HEIGHT[375]);
          }
          await expectNoHorizontalScroll(g, `/brands/new at ${viewport.width}px`);
          expect(await contrastViolations(g), `/brands/new at ${viewport.width}px`).toEqual([]);
          // With errors shown too.
          await fillNewBrand(g, { name: "", slug: "" });
          await expect(g.getByRole("alert").filter({ hasText: REFUSED })).toBeVisible();
          await expectNoHorizontalScroll(g, `/brands/new with errors at ${viewport.width}px`);
          expect(await contrastViolations(g), `/brands/new with errors at ${viewport.width}px`).toEqual([]);
          await g.context().close();
        });
      }
    },
  );

  test(
    "D-3 #1: a profile of 3 products and 2,000 customers makes them, with the orders within 5% of the generator's promise, and the customer summary shows the counts and Simulated data",
    { annotation: [{ type: "case", description: "D-3.1" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to count what was saved");
      test.setTimeout(180_000);
      expect(kitchenId, "Brightwater Kitchen from D-1 #1").not.toBe("");
      const g = await guestPage(browser);

      await step(page, "D-3.1: the Products and data tab offers Generate simulated data, with no AI", async () => {
        await open(g, `/brands/${kitchenId}?tab=products`, BRIGHTWATER.name);
        const offer = g.locator("a[data-generate-data]");
        await expect(offer).toHaveText("Generate simulated data");
        await expect(offer).toHaveAttribute("href", `/brands/${kitchenId}/simulated-data`);
        await expect(g.getByText("Make simulated customers and orders from a short profile. They are labelled as simulated everywhere, and no AI is used.")).toBeVisible();
        await offer.click();
        await g.waitForURL(`**/brands/${kitchenId}/simulated-data`);
        await settle(g);
        await expect(g.getByRole("heading", { level: 1, name: "Generate simulated data" })).toBeVisible();
        const form = g.locator("[data-simulated-data-form]");
        // The defaults: one empty product row at Medium, 5,000 customers, UK regions.
        await expect(form.getByLabel("Product 1 name", { exact: true })).toHaveValue("");
        await expect(form.getByLabel("Product 1 popularity", { exact: true })).toHaveValue("medium");
        await expect(form.getByLabel("Customers", { exact: true })).toHaveValue("5000");
        await expect(form.getByRole("radio", { name: "UK regions", exact: true })).toBeChecked();
        await expect(form.getByRole("radio", { name: "Japan's regions", exact: true })).not.toBeChecked();
        await expect(form.getByRole("group", { name: "Busiest months" }).getByRole("checkbox")).toHaveCount(12);
        await expectNoHorizontalScroll(g, "the profile form at 1440px");
        expect(await contrastViolations(g), "the profile form at 1440px").toEqual([]);
      });

      await step(page, "D-3.1: three products, 2,000 customers, UK regions, busiest in January and September; Generate data", async () => {
        await fillProfile(g, {
          products: BRIGHTWATER_PROFILE.products.map((p) => ({ name: p.name, category: p.category, price: pounds(p.pricePence), popularity: POPULARITY[p.popularity] })),
          customers: String(BRIGHTWATER_PROFILE.customers),
          regions: "UK regions",
          months: BRIGHTWATER_PROFILE.busiestMonths.map((m) => MONTHS[m - 1]),
        });
        await g.locator("[data-simulated-data-form]").getByRole("button", { name: "Generate data" }).click();
        await g.waitForURL(new RegExp(`/brands/${kitchenId}\\?tab=products$`), { timeout: 60_000 });
        await settle(g);
      });

      await step(page, "D-3.1: saved in the invitee's workspace: 3 products, 2,000 customers, orders within 5% of the promise; the brand is simulated, not fictional", async () => {
        const counts = await withSql(async (sql) => {
          const [r] = await sql`
            select
              (select count(*)::int from public.products where brand_id = ${kitchenId}) as products,
              (select count(*)::int from public.customers where brand_id = ${kitchenId}) as customers,
              (select count(*)::int from public.orders where brand_id = ${kitchenId}) as orders,
              (select count(*)::int from public.customers where brand_id = ${kitchenId} and workspace_id <> ${guest!.workspaceId}) as elsewhere,
              b.is_simulated, b.is_fictional, b.data_as_of
            from public.brands b where b.id = ${kitchenId}`;
          return r;
        });
        expect(counts).toMatchObject({ products: 3, customers: 2000, elsewhere: 0, is_simulated: true, is_fictional: false });
        expect(counts.data_as_of).not.toBeNull();
        const kit = parseBrandInput({ name: BRIGHTWATER.name, slug: BRIGHTWATER.slug, category: BRIGHTWATER.category, description: BRIGHTWATER.description });
        if (!kit.ok) throw new Error(`the fixture kit is invalid: ${JSON.stringify(kit.fieldErrors)}`);
        const promised = profileToBrief(BRIGHTWATER_PROFILE, kit.data).targetOrders;
        const ratio = counts.orders / promised;
        expect(ratio, `${counts.orders} orders against ${promised} promised`).toBeGreaterThan(0.95);
        expect(ratio, `${counts.orders} orders against ${promised} promised`).toBeLessThan(1.05);

        // The customer summary: the counts, labelled once as simulated (rule 1).
        const summary = g.locator("section").filter({ has: g.getByRole("heading", { name: "Customers and orders" }) });
        await expect(summary.getByText("Simulated data", { exact: true })).toBeVisible();
        await expect(summary.locator('[data-figure="Customers"] dd').first()).toHaveText("2,000");
        await expect(summary.locator('[data-figure="Orders"] dd').first()).toHaveText(counts.orders.toLocaleString("en-GB"));
        await expect(summary).toContainText("not real people or sales");
        // The products, and no offer to generate again.
        for (const p of BRIGHTWATER_PROFILE.products) await expect(g.getByRole("cell", { name: p.name, exact: true }).first()).toBeVisible();
        await expect(g.locator("a[data-generate-data]")).toHaveCount(0);
        await g.context().close();
      });
    },
  );

  test(
    "D-2 #2: a new brand with generated data shows Simulated data and no Demo brand pill, and a demo brand still shows Demo brand",
    { annotation: [{ type: "case", description: "D-2.2" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed for the invitee");
      expect(kitchenId, "Brightwater Kitchen with its data, from D-3 #1").not.toBe("");
      const g = await guestPage(browser);
      const pills = (p: Page, text: string) => p.locator("main").getByText(text, { exact: true }).filter({ visible: true });

      await step(page, "D-2.2: Brightwater Kitchen on /brands, its page, its kit editor and its languages: Simulated data, never Demo brand", async () => {
        await open(g, "/brands", "Brands");
        const card = g.getByRole("list", { name: "Brands in this workspace" }).getByRole("link", { name: new RegExp(`^${BRIGHTWATER.name}`) });
        await expect(card.getByText("Simulated data", { exact: true })).toBeVisible();
        await expect(card.getByText("Demo brand", { exact: true })).toHaveCount(0);
        await open(g, `/brands/${kitchenId}`, BRIGHTWATER.name);
        await expect(pills(g, "Simulated data").first()).toBeVisible();
        await expect(pills(g, "Demo brand")).toHaveCount(0);
        await open(g, `/brands/${kitchenId}/edit`, "Edit brand kit");
        await expect(pills(g, "Demo brand")).toHaveCount(0);
        await g.goto(`/brands/${kitchenId}/languages`);
        await settle(g);
        await expect(pills(g, "Demo brand")).toHaveCount(0);
        await g.context().close();
      });

      await step(page, "D-2.2: the owner's Fernhollow Outfitters (fictional and simulated) still shows Demo brand in its kit editor", async () => {
        await signIn(page);
        const fern = await demoBrandId(page, "Fernhollow Outfitters");
        await open(page, `/brands/${fern}/edit`, "Edit brand kit");
        await expect(pills(page, "Demo brand")).toHaveCount(1);
      });
    },
  );

  test(
    "D-3 #4: no products, a price of 0 or over £10,000, and a customer count outside 500 to 20,000 are refused with field errors and nothing saved; a brand with customers has no form",
    { annotation: [{ type: "case", description: "D-3.4" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to check nothing was saved");
      test.setTimeout(120_000);
      const g = await guestPage(browser);
      let pantry = "";

      await step(page, "D-3.4: a second new brand, Brightwater Pantry, with no customers", async () => {
        await open(g, "/brands/new", "New brand");
        await fillNewBrand(g, { name: BRIGHTWATER_PANTRY.name, category: BRIGHTWATER_PANTRY.category });
        await g.waitForURL(/\/brands\/[0-9a-f-]{36}\/edit$/);
        pantry = new URL(g.url()).pathname.split("/")[2];
      });

      const nothingSaved = async (what: string) => {
        const r = await withSql(async (sql) => (await sql`
          select (select count(*)::int from public.products where brand_id = ${pantry}) as products,
                 (select count(*)::int from public.customers where brand_id = ${pantry}) as customers,
                 b.is_simulated from public.brands b where b.id = ${pantry}`)[0]);
        expect(r, what).toMatchObject({ products: 0, customers: 0, is_simulated: false });
        await expect(g).toHaveURL(new RegExp(`/brands/${pantry}/simulated-data$`));
      };
      const generate = () => g.locator("[data-simulated-data-form]").getByRole("button", { name: "Generate data" }).click();
      const product = { name: "Oat jar", category: "Pantry", price: "4.50", popularity: "High" as const };

      await step(page, "D-3.4: no products: Remove product 1, then Generate data", async () => {
        await open(g, `/brands/${pantry}/simulated-data`, "Generate simulated data");
        await g.getByRole("button", { name: "Remove product 1" }).click();
        await g.getByRole("checkbox", { name: "March", exact: true }).check();
        await generate();
        const alert = g.getByRole("alert").filter({ hasText: REFUSED });
        await expect(alert).toBeVisible();
        await expect(g.getByText("Add at least one product.").filter({ visible: true }).first()).toBeVisible();
        await nothingSaved("no products");
      });

      for (const [price, message] of [
        ["0", "Give a price above £0."],
        ["10000.01", "Keep the price to £10,000 or less."],
      ] as const) {
        await step(page, `D-3.4: a price of £${price}: "${message}"`, async () => {
          await open(g, `/brands/${pantry}/simulated-data`, "Generate simulated data");
          await fillProfile(g, { products: [{ ...product, price }], customers: "1000", regions: "Japan's regions", months: ["March"] });
          await generate();
          await expect(g.getByRole("alert").filter({ hasText: REFUSED })).toBeVisible();
          expect(await errorOf(g.getByLabel("Product 1 price (£)", { exact: true }))).toBe(message);
          await nothingSaved(`a price of ${price}`);
        });
      }

      for (const customers of ["499", "20001"]) {
        await step(page, `D-3.4: ${customers} customers`, async () => {
          await open(g, `/brands/${pantry}/simulated-data`, "Generate simulated data");
          await fillProfile(g, { products: [product], customers, regions: "UK regions", months: ["March"] });
          await generate();
          await expect(g.getByRole("alert").filter({ hasText: REFUSED })).toBeVisible();
          expect(await errorOf(g.getByLabel("Customers", { exact: true }))).toBe("Choose between 500 and 20,000 customers.");
          await nothingSaved(`${customers} customers`);
        });
      }

      await step(page, "D-3.4: a brand that already has customers (Brightwater Kitchen) has no offer and no form", async () => {
        await open(g, `/brands/${kitchenId}?tab=products`, BRIGHTWATER.name);
        await expect(g.locator("a[data-generate-data]")).toHaveCount(0);
        await open(g, `/brands/${kitchenId}/simulated-data`, "Generate simulated data");
        await expect(g.getByText("This brand already has customers, so no simulated data can be added.")).toBeVisible();
        await expect(g.locator("[data-simulated-data-form]")).toHaveCount(0);
        const customers = await withSql(async (sql) => Number((await sql`select count(*)::int as n from public.customers where brand_id = ${kitchenId}`)[0].n));
        expect(customers).toBe(BRIGHTWATER_PROFILE.customers);
        await g.context().close();
      });
    },
  );
});
