// U10-8 The runs list: filters, the campaign, and every run reachable, through
// the UI. A person finds a run by campaign, agent or status (the filters are in
// the address, so they survive a reload and can be shared), past the first 50
// with "Older runs"; each row names its campaign, or "No campaign" (the tagline
// demo); the simulated label is said once, in the cost column's heading, not on
// every row; and a run's trail numbers its steps without gaps. Answer B1 (9
// November) gives U10-8 the campaigns list too: filters and paging like the
// runs list, so it fits its length budget with the suite's campaigns.
//
// Other specs make runs and campaigns in the dev workspace while this runs, so
// these tests use a new invitee's own workspace: the owner invites them on
// /invites and they accept, as a person does; then its runs and campaigns are
// written to the database (tests/e2e/runs-fixture.ts): 60 runs (the 50th and
// 51st at the same moment), 25 campaigns over two fictional brands, and in the
// dev workspace a campaign and a run whose ids are another workspace's. The
// tests read only, so they run in any order after the setup; serial, so the
// fixture is made once.
//
// 1. Filtering by campaign, agent or status shows only the matching runs, and
//    the filters survive a reload (they are in the address). Failure path:
//    unknown or garbage filter values show all runs with a plain note, never
//    an error; a filter no run matches says so, with Clear filters.
// 2. With 60 runs, "Older runs" shows runs 51 to 60, none twice or missed (a
//    cursor: the last run shown, by created_at then id). A bad cursor
//    (garbage, or another workspace's run) shows the first page.
// 3. Each row names its campaign, or "No campaign" for the tagline demo; the
//    simulated label is once, in the cost column's heading, at 375 px and 1440 px.
// 4. Another workspace's runs never appear, whatever the filters: another
//    workspace's campaign id in the address is not applied (with the note),
//    and its name is nowhere; a run naming it says "No campaign".
// 5. A run trail's steps are numbered 1 to n without gaps (the Imagery run's
//    steps are recorded at seq 1, 2, 3, 5 and 7).
// 6. (B1) The campaigns list: within its length budget at 375 px and 1440 px
//    with 25 campaigns (a page of 20, then "Older campaigns" with the other 5);
//    filtering by brand and status works and survives a reload; garbage is
//    noted and not applied. U10-6 measures the same page after the whole
//    suite (its "campaigns" page, tests/e2e/page-budgets.ts).
//
// ---------------------------------------------------------------- interface
// What the builder provides. The tests here, tests/lib/runs-list.test.ts and
// tests/flows/runs-list.test.ts pin it. Rules 1, 4 and 7 hold: every
// simulated cost is still said to be simulated (once, in the heading, when
// every cost shown is wholly simulated); the trail itself is unchanged, only
// its numbering; every read goes through asUser(), the filters included.
//
// URL parameters:
//   /runs       ?campaign=<campaign id>&agent=<agent key>&status=<run status>&before=<run id>
//   /campaigns  ?brand=<brand id>&status=<campaign status key>&before=<campaign id>
//   (Review fix, 10 November: the campaigns cursor is now the last row's position, <updated_at in microseconds>_<campaign id>.)
//   Missing or empty is no filter. A value Studio doesn't recognise is not applied and is named in the
//   plain note; the other filters still apply. `before` is a cursor: the id of the last row shown on the
//   page before (never an offset); a malformed one, or one not in the reader's workspace, shows the first
//   page, with no note.
//
// src/lib/agents/run-list.ts (NEW, PURE: imports only @/lib/format):
//   RUNS_PAGE_SIZE = 50
//   RUN_FILTER_KEYS = ["campaign", "agent", "status"] as const; type RunFilterKey = typeof RUN_FILTER_KEYS[number]
//   RUN_STATUSES = ["queued", "running", "awaiting_approval", "completed", "failed", "rejected", "expired", "stopped_cap"]
//   type RunFilters = { campaign: string | null; agent: string | null; status: string | null }
//   type SearchParams = Record<string, string | string[] | undefined>
//   parseRunFilters(params: SearchParams, agents: readonly string[]) => { filters: RunFilters; before: string | null; ignored: RunFilterKey[] }
//     A repeated parameter is read by its first value. Missing or "" is null, not ignored. campaign: a UUID
//     (any case; returned in lower case), else ignored. agent: exactly one of `agents` (the page passes every
//     agent key and workflow key: AGENTS' and WORKFLOW_NAMES'), else ignored. status: exactly one of
//     RUN_STATUSES, else ignored. before: a UUID (lower case), else null, quietly. ignored is in the order
//     campaign, agent, status. Other parameters are left alone. Never throws.
//   runsHref(filters: Partial<RunFilters>, before?: string | null) => string: "/runs", then the set values in
//     the order campaign, agent, status, before, encoded by URLSearchParams ("/runs" with none).
//   filterNote(ignored: readonly string[]) => string | null: null for none;
//     "Filter not recognised, so not applied: agent."
//     "Filters not recognised, so not applied: campaign and status."
//     "Filters not recognised, so not applied: campaign, agent and status."
//   costHeading(runs: readonly { cost_pence: string | number; simulated_pence: string | number }[]) => "Cost (simulated)" | "Cost":
//     "Cost (simulated)" when some run's cost is above 0 and every run with a cost above 0 is wholly
//     simulated (formatCost's rule: simulated >= cost - 0.0001); otherwise "Cost".
//   runCostText(run, heading: string) => string: formatPence(cost) under "Cost (simulated)"; otherwise
//     formatCost(cost, simulated), so a run with a real part keeps its own words (rule 1).
//   numberTrailSteps<T extends { seq: number }>(steps: readonly T[]) => (T & { number: number })[]: a new array
//     in seq order, numbered 1 to n; nothing left out, the input unchanged.
//
// src/lib/campaigns/list-filters.ts (NEW, PURE: imports only ./status and @/lib/agents/run-list):
//   CAMPAIGNS_PAGE_SIZE = 20
//   CAMPAIGN_FILTER_KEYS = ["brand", "status"] as const; type CampaignFilterKey
//   type CampaignStatusKey = "writing" | "draft" | "waiting" | "signedOff" | "launchWaiting" | "live" | "ended"
//   CAMPAIGN_STATUS_FILTERS: readonly { id: CampaignStatusKey; label: string }[], in that order, labelled with
//     CAMPAIGN_STATUS_LABELS' words and "Live" for live.
//   campaignStatusKey(facts: CampaignStatusFacts) => CampaignStatusKey: campaignStatusLabel's precedence (a live
//     launch, a launch waiting, an ended launch, then the brief's state; an unknown status is draft).
//   type CampaignFilters = { brand: string | null; status: CampaignStatusKey | null }
//   parseCampaignFilters(params: SearchParams) => { filters: CampaignFilters; before: string | null; ignored: CampaignFilterKey[] }
//     as parseRunFilters: brand a UUID, status exactly a CampaignStatusKey.
//   campaignsHref(filters: Partial<CampaignFilters>, before?: string | null) => string: "/campaigns", then brand,
//     status, before.
//   campaignFilterNote(ignored) => string | null: filterNote's words ("Filter not recognised, so not applied: brand.").
//
// src/lib/agents/runs.ts (server, through asUser(); rule 7):
//   type RunsPage = { runs: RunSummary[]; older: string | null; ignored: RunFilterKey[] }
//   listRunsPage(userId: string, query: { filters: RunFilters; before: string | null }, pageSize = RUNS_PAGE_SIZE) => Promise<RunsPage>
//     Ordered by created_at desc, then id desc; at most pageSize runs; older is the last run's id when more
//     match, else null (exactly a page: null). campaign: the campaign RunSummary.campaign works out (the
//     input's campaignId, else a question's launch's campaign); an id that is no campaign in the reader's
//     workspace (another workspace's, unknown or malformed) is not applied and ignored is ["campaign"].
//     agent and status: exact, as parameters (never pattern-matched). before: a run in the reader's
//     workspace gives the runs strictly after it in that order; anything else gives the first page.
//   listRuns(userId, limit, brandId) is unchanged (home and the brand page read it).
//
// src/lib/brief/repo.ts (server, through asUser()):
//   type CampaignsPage = { campaigns: CampaignSummary[]; older: string | null; ignored: CampaignFilterKey[] }
//   listCampaignsPage(userId: string, query: { filters: CampaignFilters; before: string | null }, pageSize = CAMPAIGNS_PAGE_SIZE) => Promise<CampaignsPage>
//     Ordered by updated_at desc, then id desc, as listRunsPage; brand: a brand in the reader's workspace,
//     else not applied and ignored ["brand"]; status: the campaigns whose campaignStatusKey is it, in the
//     query (so paging is right). listCampaigns(userId, brandId) is unchanged.
//
// The runs list (src/app/(app)/runs/page.tsx), reading its searchParams:
//   - <h1> "Agent runs", as today.
//   - <form data-run-filters method="get" action="/runs">, three labelled <select>s and a submit button
//     "Apply filters": "Campaign" (name campaign; "All campaigns" with value "", then every campaign in the
//     workspace by campaignName(), value its id), "Agent" (name agent; "All agents" "", then each agent and
//     workflow key, labelled agentDisplayName()), "Status" (name status; "All statuses" "", then RUN_STATUSES
//     in StatusBadge's words: "Failed", "Completed", ...). Each shows the filter applied. While any filter
//     is applied, a link "Clear filters" to /runs.
//   - With filterNote() not null, a leaf <p data-runs-filter-note> with it (never an error page).
//   - The table in [data-runs-table]; per run, newest first, <tr data-run="<runId>"> with its link to
//     /runs/<id>; at each width exactly one visible leaf [data-run-campaign] holding the campaign's name or
//     "No campaign", and one visible leaf [data-run-cost] with runCostText(); the agent's name stays a
//     table cell at 1440 px (creative.spec finds "Make creative" by its cell).
//   - The cost heading: at each width exactly one visible leaf [data-cost-heading] with costHeading()
//     (the Cost column's <th> from sm up; at 375 px, where that column is hidden, inside the table's
//     heading row). "(simulated)" is in main's visible text once; the SimulatedCostNote stays below.
//   - When older is not null, <a data-older-runs href={runsHref(filters, older)}> "Older runs"; none otherwise.
//   - No run matching the filters: an empty state titled "No runs match these filters", with Clear filters.
//     With no filters and no runs, today's "No runs yet".
//
// A run's trail (src/app/(app)/runs/[id]/page.tsx): the steps through numberTrailSteps(); each
//   <li data-trail-step data-step-seq="<seq>"> with a leaf [data-step-number] "Step <number>" (1 to n);
//   the attempts list's label uses the same number.
//
// The campaigns list (src/app/(app)/campaigns/page.tsx), reading its searchParams:
//   - <form data-campaign-filters method="get" action="/campaigns">: "Brand" (name brand; "All brands" "",
//     then the workspace's brands) and "Status" (name status; "All statuses" "", then CAMPAIGN_STATUS_FILTERS'
//     labels), a submit button "Apply filters", and "Clear filters" to /campaigns while any is applied.
//     (The New campaign form also has a "Brand": specs find it inside the "New campaign" region.)
//   - With campaignFilterNote() not null, a leaf <p data-campaigns-filter-note> with it.
//   - The list as today ([data-campaign-list], each row's status in [data-campaign-status]), each <li>
//     with data-campaign-row="<campaignId>"; at most CAMPAIGNS_PAGE_SIZE rows.
//   - When older is not null, <a data-older-campaigns href={campaignsHref(filters, older)}> "Older campaigns".
//   - No campaign matching: "No campaigns match these filters", with Clear filters.
//
// tests/e2e/page-budgets.ts: the "campaigns" page's length marker is U10-8's (answer B1) and the "runs"
// page's stays U10-8's; the builder removes each when its page fits.
//
// Existing specs to update with the build: helpers.ts newCampaign(), campaigns.spec.ts
// (newFernhollowCampaign and the objective check), languages.spec.ts and launch-pack.spec.ts find the
// New campaign form's "Brand" with page.getByLabel("Brand"), which the filter's "Brand" makes ambiguous:
// scope them to page.getByRole("region", { name: "New campaign" }). creative.spec.ts looks for the Make
// creative run on /runs, now 50 a page: open /runs?agent=creative. quick-fixes.spec.ts U10-1 #3 and
// design-system.spec.ts (keyboard stops and widths on /runs and /campaigns) read the lists, with the
// filters' controls added.
// ----------------------------------------------------------------------------
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { formatPence } from "@/lib/format";
import { contrastViolations, expectNoHorizontalScroll, settle, signIn, step } from "./helpers";
import { memberByEmail, type FixtureMember } from "./home-fixture";
import { BUDGET_SCREENS, lengthProblem, VIEWPORT_HEIGHT, type Width } from "./page-budgets";
import { CAMPAIGNS, insertRunsFixture, removeRunsFixture, RUNS, STATE_LABELS, type FixtureRun, type RunsFixture } from "./runs-fixture";

type Sql = postgres.Sql;
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const NO_CAMPAIGN = "No campaign";
const PAGE = 50;
const CAMPAIGN_PAGE = 20;
const SIMULATED_HEADING = "Cost (simulated)";
const VIEWPORTS: Record<Width, { width: number; height: number }> = { 375: { width: 375, height: VIEWPORT_HEIGHT[375] }, 1440: { width: 1440, height: VIEWPORT_HEIGHT[1440] } };
const PHONE = VIEWPORTS[375];
const DESKTOP = VIEWPORTS[1440];

const ONE_NOTE = (key: string) => `Filter not recognised, so not applied: ${key}.`;
const ALL_THREE_NOTE = "Filters not recognised, so not applied: campaign, agent and status.";
const BOTH_CAMPAIGN_NOTE = "Filters not recognised, so not applied: brand and status.";

const runsTable = (page: Page) => page.locator("[data-runs-table]");
const runRows = (page: Page) => runsTable(page).locator("[data-run]");
const filters = (page: Page) => page.locator("[data-run-filters]");
const olderRuns = (page: Page) => page.locator("a[data-older-runs]");
const campaignFilters = (page: Page) => page.locator("[data-campaign-filters]");
const campaignRows = (page: Page) => page.locator("[data-campaign-list] [data-campaign-row]");

// The setup's state, shared by the serial tests below.
let guestState: StorageState | null = null;
let guest: FixtureMember | null = null;
let fx: RunsFixture | null = null;

const withSql = async <T>(body: (sql: Sql) => Promise<T>): Promise<T> => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return await body(sql);
  } finally {
    await sql.end();
  }
};

/** The invitee's own signed-in page, at a width. */
async function guestPage(browser: Browser, viewport = DESKTOP): Promise<Page> {
  expect(guestState, "the invitee from the setup").not.toBeNull();
  expect(fx, "the runs fixture from the setup").not.toBeNull();
  const ctx = await browser.newContext({ storageState: guestState!, viewport });
  return ctx.newPage();
}

async function open(page: Page, path: string, h1 = "Agent runs") {
  await page.goto(path);
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: h1, exact: true })).toBeVisible();
}

/** Each shown row's id, in order. */
const rowIds = (rows: Locator) => rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-run") ?? e.getAttribute("data-campaign-row")));

/** Per shown run, the text of its visible [data-run-campaign] and [data-run-cost] leaves (each must be exactly one). */
async function visibleCells(page: Page): Promise<{ id: string; campaign: string[]; cost: string[] }[]> {
  return runRows(page).evaluateAll((els) =>
    els.map((row) => {
      const shown = (sel: string) => Array.from(row.querySelectorAll<HTMLElement>(sel)).filter((e) => e.checkVisibility()).map((e) => (e.textContent ?? "").trim());
      return { id: row.getAttribute("data-run")!, campaign: shown("[data-run-campaign]"), cost: shown("[data-run-cost]") };
    }),
  );
}

const ids = (runs: { id: string }[]) => runs.map((r) => r.id);
const matching = (f: { campaign?: string; agent?: string; status?: string }) =>
  fx!.runs.filter((r) => (!f.campaign || r.campaign?.id === f.campaign) && (!f.agent || r.agent === f.agent) && (!f.status || r.status === f.status));

/** The address the list must be on, whatever order the builder's form sends the parameters in. */
function expectQuery(page: Page, want: Record<string, string>) {
  const params = Object.fromEntries([...new URL(page.url()).searchParams].filter(([, v]) => v !== ""));
  expect(new URL(page.url()).pathname).toBe("/runs");
  expect(params).toEqual(want);
}

async function expectRuns(page: Page, want: FixtureRun[], what: string) {
  await expect(runRows(page), what).toHaveCount(want.length);
  expect(await rowIds(runRows(page)), what).toEqual(ids(want));
}

/** Applies the runs list's filters through its form, as a person does. */
async function applyFilters(page: Page, choose: { campaign?: string; agent?: string; status?: string }) {
  const form = filters(page);
  if (choose.campaign) await form.getByLabel("Campaign", { exact: true }).selectOption({ label: choose.campaign });
  if (choose.agent) await form.getByLabel("Agent", { exact: true }).selectOption({ label: choose.agent });
  if (choose.status) await form.getByLabel("Status", { exact: true }).selectOption({ label: choose.status });
  await form.getByRole("button", { name: "Apply filters" }).click();
  await page.waitForURL(/\/runs\?/);
  await settle(page);
}

test.describe("U10-8 the runs list and the campaigns list, for a new invitee's workspace with 60 runs and 25 campaigns", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    if (!process.env.DATABASE_URL) return;
    test.setTimeout(180_000);
    const email = `runs-${Date.now()}@example.test`;
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
    fx = await withSql((sql) => insertRunsFixture(sql, guest!, `Runs ${Date.now().toString(36)}`));
  });

  test.afterAll(async () => {
    if (!process.env.DATABASE_URL) return;
    await withSql((sql) => removeRunsFixture(sql, guest, fx));
  });

  test(
    "U10-8 #3: each row names its campaign, or No campaign for the tagline demo, and the simulated label is once, in the cost heading, at 375 px and 1440 px",
    { annotation: [{ type: "case", description: "U10-8.3" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the invitee's runs");
      test.setTimeout(120_000);
      const first = fx!.runs.slice(0, PAGE);
      for (const viewport of [PHONE, DESKTOP]) {
        await step(page, `U10-8.3: at ${viewport.width} px, the 50 newest runs, each naming its campaign or No campaign`, async () => {
          const g = await guestPage(browser, viewport);
          await open(g, "/runs");
          await expectRuns(g, first, `the first page at ${viewport.width}px`);
          const cells = await visibleCells(g);
          for (const [i, c] of cells.entries()) {
            const want = first[i];
            expect(c.campaign, `run ${i + 1}'s campaign at ${viewport.width}px`).toEqual([want.campaign?.name ?? NO_CAMPAIGN]);
          }
          // The tagline demo, and a run naming another workspace's campaign, say No campaign.
          expect(cells.find((c) => c.id === fx!.tagline)!.campaign).toEqual([NO_CAMPAIGN]);
          expect(cells.find((c) => c.id === fx!.hostile)!.campaign).toEqual([NO_CAMPAIGN]);
          await g.context().close();
        });

        await step(page, `U10-8.3: at ${viewport.width} px, "(simulated)" once, in the cost heading; each row's cost is the amount alone`, async () => {
          const g = await guestPage(browser, viewport);
          await open(g, "/runs");
          const heading = runsTable(g).locator("[data-cost-heading]").filter({ visible: true });
          await expect(heading).toHaveCount(1);
          await expect(heading).toHaveText(SIMULATED_HEADING);
          const cells = await visibleCells(g);
          for (const [i, c] of cells.entries()) expect(c.cost, `run ${i + 1}'s cost at ${viewport.width}px`).toEqual([formatPence(first[i].pence)]);
          const text = await g.locator("main").innerText();
          expect(text.match(/\(simulated\)/g) ?? [], `"(simulated)" in the page at ${viewport.width}px`).toHaveLength(1);
          // Rule 1: what "simulated" means is still said, below the table.
          await expect(g.locator("[data-simulated-cost-note]")).toBeVisible();
          await expectNoHorizontalScroll(g, `/runs at ${viewport.width}px`);
          expect(await contrastViolations(g), `/runs at ${viewport.width}px`).toEqual([]);
          await g.context().close();
        });
      }
    },
  );

  test(
    "U10-8 #1: filtering by campaign, agent or status shows only the matching runs, and the filters survive a reload",
    { annotation: [{ type: "case", description: "U10-8.1" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the invitee's runs");
      test.setTimeout(180_000);
      const second = fx!.named.second;

      await step(page, "U10-8.1: by campaign, from the form: only that campaign's runs, in the address, and after a reload", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, "/runs");
        await applyFilters(g, { campaign: second.name });
        expectQuery(g, { campaign: second.id });
        const want = matching({ campaign: second.id });
        expect(want.length).toBeGreaterThan(0);
        await expectRuns(g, want, "by campaign");
        for (const c of await visibleCells(g)) expect(c.campaign).toEqual([second.name]);
        await g.reload();
        await settle(g);
        await expectRuns(g, want, "by campaign, after a reload");
        await expect(filters(g).getByLabel("Campaign", { exact: true })).toHaveValue(second.id);
        await expect(olderRuns(g)).toHaveCount(0);
        await g.context().close();
      });

      await step(page, "U10-8.1: by agent (Copy agent): only Copy runs, and after a reload", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, "/runs");
        await applyFilters(g, { agent: "Copy agent" });
        expectQuery(g, { agent: "copy" });
        await expectRuns(g, matching({ agent: "copy" }), "by agent");
        await g.reload();
        await settle(g);
        await expectRuns(g, matching({ agent: "copy" }), "by agent, after a reload");
        await expect(filters(g).getByLabel("Agent", { exact: true })).toHaveValue("copy");
        await g.context().close();
      });

      await step(page, "U10-8.1: by status (Failed) at 375 px: only failed runs, and after a reload", async () => {
        const g = await guestPage(browser, PHONE);
        await open(g, "/runs");
        await applyFilters(g, { status: "Failed" });
        expectQuery(g, { status: "failed" });
        await expectRuns(g, matching({ status: "failed" }), "by status");
        await g.reload();
        await settle(g);
        await expectRuns(g, matching({ status: "failed" }), "by status, after a reload");
        await expect(filters(g).getByLabel("Status", { exact: true })).toHaveValue("failed");
        await expectNoHorizontalScroll(g, "/runs filtered at 375px");
        expect(await contrastViolations(g), "/runs filtered at 375px").toEqual([]);
        await g.context().close();
      });

      await step(page, "U10-8.1: all three from a shared address, shown in the form; Clear filters shows every run again", async () => {
        const g = await guestPage(browser, DESKTOP);
        const first = fx!.named.first;
        await open(g, `/runs?campaign=${first.id}&agent=imagery&status=completed`);
        const want = matching({ campaign: first.id, agent: "imagery", status: "completed" });
        expect(want.length).toBeGreaterThan(0);
        await expectRuns(g, want, "all three");
        await expect(filters(g).getByLabel("Campaign", { exact: true })).toHaveValue(first.id);
        await expect(filters(g).getByLabel("Agent", { exact: true })).toHaveValue("imagery");
        await expect(filters(g).getByLabel("Status", { exact: true })).toHaveValue("completed");
        await g.getByRole("link", { name: "Clear filters" }).click();
        await g.waitForURL((u) => u.pathname === "/runs" && u.search === "");
        await settle(g);
        await expectRuns(g, fx!.runs.slice(0, PAGE), "cleared");
        await expect(g.getByRole("link", { name: "Clear filters" })).toHaveCount(0);
        await g.context().close();
      });

      await step(page, "U10-8.1 failure path: garbage in every filter shows all runs with a plain note, never an error", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, `/runs?campaign=not-a-uuid&agent=${encodeURIComponent("' or 1=1 --")}&status=${encodeURIComponent("<script>alert(1)</script>")}`);
        await expect(g.locator("[data-runs-filter-note]")).toHaveText(ALL_THREE_NOTE);
        await expectRuns(g, fx!.runs.slice(0, PAGE), "garbage filters");
        await expect(g.getByText(/something went wrong|application error/i)).toHaveCount(0);
        // One unknown filter is noted; the good one still applies.
        await open(g, "/runs?agent=nope&status=failed");
        await expect(g.locator("[data-runs-filter-note]")).toHaveText(ONE_NOTE("agent"));
        await expectRuns(g, matching({ status: "failed" }), "an unknown agent with a known status");
        // No note when every filter is known.
        await open(g, "/runs?status=failed");
        await expect(g.locator("[data-runs-filter-note]")).toHaveCount(0);
        await g.context().close();
      });

      await step(page, "U10-8.1: a filter no run matches says so, with Clear filters", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, "/runs?status=stopped_cap");
        await expect(runRows(g)).toHaveCount(0);
        await expect(g.getByRole("heading", { name: "No runs match these filters" })).toBeVisible();
        await expect(g.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/runs");
        await g.context().close();
      });
    },
  );

  test(
    "U10-8 #2: with 60 runs, Older runs shows runs 51 to 60, none shown twice or missed, and a bad cursor shows the first page",
    { annotation: [{ type: "case", description: "U10-8.2" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the invitee's runs");
      test.setTimeout(120_000);
      const runs = fx!.runs;
      expect(runs).toHaveLength(RUNS);

      for (const viewport of [DESKTOP, PHONE]) {
        await step(page, `U10-8.2: at ${viewport.width} px, the first page is the 50 newest, then Older runs shows runs 51 to 60`, async () => {
          const g = await guestPage(browser, viewport);
          await open(g, "/runs");
          await expectRuns(g, runs.slice(0, PAGE), "the first page");
          await expect(olderRuns(g)).toHaveCount(1);
          await expect(olderRuns(g)).toHaveText("Older runs");
          await expect(olderRuns(g)).toHaveAttribute("href", `/runs?before=${runs[PAGE - 1].id}`);
          const firstIds = await rowIds(runRows(g));
          await olderRuns(g).click();
          await g.waitForURL(/[?&]before=/);
          await settle(g);
          await expectRuns(g, runs.slice(PAGE), "the second page");
          await expect(olderRuns(g)).toHaveCount(0);
          const all = [...firstIds, ...(await rowIds(runRows(g)))];
          expect(new Set(all).size, "no run shown twice").toBe(RUNS);
          expect(all, "none missed, in order").toEqual(ids(runs));
          // The 50th and 51st runs share a moment: the id keeps them on separate pages.
          expect(runs[PAGE - 1].at.getTime()).toBe(runs[PAGE].at.getTime());
          await g.reload();
          await settle(g);
          await expectRuns(g, runs.slice(PAGE), "the second page, after a reload");
          await g.context().close();
        });
      }

      await step(page, "U10-8.2 failure path: a garbage cursor, an offset or another workspace's run shows the first page, never an error", async () => {
        const g = await guestPage(browser, DESKTOP);
        for (const before of ["garbage", "50", fx!.hidden.runId]) {
          await open(g, `/runs?before=${encodeURIComponent(before)}`);
          await expectRuns(g, runs.slice(0, PAGE), `before=${before}`);
          await expect(olderRuns(g)).toHaveAttribute("href", `/runs?before=${runs[PAGE - 1].id}`);
        }
        await g.context().close();
      });
    },
  );

  test(
    "U10-8 #4: another workspace's runs and campaign never appear, whatever the filters, including its campaign id in the address",
    { annotation: [{ type: "case", description: "U10-8.4" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the invitee's runs and the dev workspace's campaign");
      test.setTimeout(120_000);
      const hidden = fx!.hidden;
      const mine = new Set(ids(fx!.runs));

      await step(page, "U10-8.4: the dev workspace's campaign id in the address is not applied, with the note, and its name is nowhere", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, `/runs?campaign=${hidden.campaignId}`);
        await expect(g.locator("[data-runs-filter-note]")).toHaveText(ONE_NOTE("campaign"));
        await expectRuns(g, fx!.runs.slice(0, PAGE), "another workspace's campaign");
        await expect(g.locator("main")).not.toContainText(hidden.name);
        // The form offers only the invitee's own campaigns.
        const options = await filters(g).getByLabel("Campaign", { exact: true }).locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
        expect(options).not.toContain(hidden.campaignId);
        expect(options.filter((v) => v !== "").sort()).toEqual(fx!.campaigns.map((c) => c.id).sort());
        await g.context().close();
      });

      await step(page, "U10-8.4: with every filter and on every page, only the invitee's own runs", async () => {
        const g = await guestPage(browser, DESKTOP);
        const paths = [
          "/runs",
          `/runs?before=${fx!.runs[PAGE - 1].id}`,
          `/runs?campaign=${hidden.campaignId}&status=failed`,
          `/runs?agent=tagline`,
          `/runs?agent=brief&status=completed`,
          `/runs?before=${hidden.runId}`,
        ];
        for (const path of paths) {
          await open(g, path);
          for (const id of await rowIds(runRows(g))) expect(mine.has(id!), `${path}: ${id}`).toBe(true);
          await expect(g.locator("main"), path).not.toContainText(hidden.name);
          await expect(g.locator("main"), path).not.toContainText("another workspace's run");
        }
        await g.context().close();
      });

      await step(page, "U10-8.4: the run whose input names the dev workspace's campaign says No campaign", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, "/runs?agent=brief");
        const row = (await visibleCells(g)).find((c) => c.id === fx!.hostile);
        expect(row, "the run naming another workspace's campaign").toBeDefined();
        expect(row!.campaign).toEqual([NO_CAMPAIGN]);
        await g.context().close();
      });
    },
  );

  test(
    "U10-8 #5: a run trail's steps are numbered without gaps",
    { annotation: [{ type: "case", description: "U10-8.5" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the invitee's runs");
      const trail = fx!.trail;
      for (const viewport of [DESKTOP, PHONE]) {
        await step(page, `U10-8.5: at ${viewport.width} px, the Imagery run's five steps (recorded at seq 1, 2, 3, 5 and 7) read Step 1 to Step 5`, async () => {
          const g = await guestPage(browser, viewport);
          // Reached from the list, as a person does.
          await open(g, `/runs?campaign=${fx!.named.first.id}&agent=imagery`);
          await runsTable(g).locator(`[data-run="${trail.runId}"] a[href="/runs/${trail.runId}"]`).filter({ visible: true }).first().click();
          await g.waitForURL(`**/runs/${trail.runId}`);
          await settle(g);
          const steps = g.locator("[data-trail-step]");
          await expect(steps).toHaveCount(trail.seqs.length);
          await expect(steps.locator("[data-step-number]")).toHaveText(trail.seqs.map((_, i) => `Step ${i + 1}`));
          expect(await steps.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-step-seq"))))).toEqual(trail.seqs);
          for (const [i, name] of trail.names.entries()) await expect(steps.nth(i).getByRole("heading", { name, exact: true })).toBeVisible();
          // No number past the last step, and none skipped.
          await expect(g.getByText(/^Step (6|7)$/)).toHaveCount(0);
          await expectNoHorizontalScroll(g, `the trail at ${viewport.width}px`);
          await g.context().close();
        });
      }
    },
  );

  test(
    "U10-8 #6: the campaigns list is within its length budget at 375 px and 1440 px, and filtering and Older paging work",
    { annotation: [{ type: "case", description: "U10-8.6" }] },
    async ({ page, browser }) => {
      test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the invitee's campaigns");
      test.setTimeout(180_000);
      const campaigns = fx!.campaigns;
      expect(campaigns).toHaveLength(CAMPAIGNS);

      for (const width of [375, 1440] as const) {
        await step(page, `U10-8.6: at ${width} px, 20 campaigns, within ${BUDGET_SCREENS[width]} screens, then Older campaigns shows the other 5`, async () => {
          const g = await guestPage(browser, VIEWPORTS[width]);
          await open(g, "/campaigns", "Campaigns");
          await expect(campaignRows(g)).toHaveCount(CAMPAIGN_PAGE);
          expect(await rowIds(campaignRows(g))).toEqual(campaigns.slice(0, CAMPAIGN_PAGE).map((c) => c.id));
          const height = await g.evaluate(() => document.documentElement.scrollHeight);
          const problem = lengthProblem("The campaigns list (25 campaigns)", { width, viewportHeight: VIEWPORT_HEIGHT[width], status: 200, notFound: false, height, mainActionTop: null });
          expect(problem).toBeNull();
          // The New campaign form is still there, with its own Brand.
          await expect(g.getByRole("region", { name: "New campaign" }).getByLabel("Brand")).toHaveCount(1);
          const older = g.locator("a[data-older-campaigns]");
          await expect(older).toHaveText("Older campaigns");
          // Review fix: the cursor is the 20th campaign's position (updated_at in microseconds, then its id).
          const last = campaigns[CAMPAIGN_PAGE - 1];
          await expect(older).toHaveAttribute("href", `/campaigns?before=${last.at.getTime() * 1000}_${last.id}`);
          await older.click();
          await g.waitForURL(/[?&]before=/);
          await settle(g);
          expect(await rowIds(campaignRows(g))).toEqual(campaigns.slice(CAMPAIGN_PAGE).map((c) => c.id));
          await expect(g.locator("a[data-older-campaigns]")).toHaveCount(0);
          await expectNoHorizontalScroll(g, `/campaigns at ${width}px`);
          expect(await contrastViolations(g), `/campaigns at ${width}px`).toEqual([]);
          await g.context().close();
        });
      }

      await step(page, "U10-8.6: by brand and status from the form (Quillmoor Money, Waiting for sign-off): only those, in the address, and after a reload", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, "/campaigns", "Campaigns");
        const form = campaignFilters(g);
        await form.getByLabel("Brand", { exact: true }).selectOption({ label: "Quillmoor Money" });
        await form.getByLabel("Status", { exact: true }).selectOption({ label: STATE_LABELS.waiting });
        await form.getByRole("button", { name: "Apply filters" }).click();
        await g.waitForURL(/\/campaigns\?/);
        await settle(g);
        const params = Object.fromEntries([...new URL(g.url()).searchParams].filter(([, v]) => v !== ""));
        expect(params).toEqual({ brand: fx!.brands.quillmoor, status: "waiting" });
        const want = campaigns.filter((c) => c.brand === "Quillmoor Money" && c.state === "waiting").map((c) => c.id);
        expect(want.length).toBeGreaterThan(0);
        expect(await rowIds(campaignRows(g))).toEqual(want);
        await expect(campaignRows(g).locator("[data-campaign-status]")).toHaveText(want.map(() => STATE_LABELS.waiting));
        await g.reload();
        await settle(g);
        expect(await rowIds(campaignRows(g))).toEqual(want);
        await expect(form.getByLabel("Brand", { exact: true })).toHaveValue(fx!.brands.quillmoor);
        await expect(form.getByLabel("Status", { exact: true })).toHaveValue("waiting");
        await g.context().close();
      });

      await step(page, "U10-8.6 failure path: garbage filters and a garbage cursor show the first page, with the note for the filters", async () => {
        const g = await guestPage(browser, DESKTOP);
        await open(g, "/campaigns?brand=not-a-uuid&status=nope", "Campaigns");
        await expect(g.locator("[data-campaigns-filter-note]")).toHaveText(BOTH_CAMPAIGN_NOTE);
        expect(await rowIds(campaignRows(g))).toEqual(campaigns.slice(0, CAMPAIGN_PAGE).map((c) => c.id));
        await open(g, `/campaigns?before=garbage`, "Campaigns");
        await expect(g.locator("[data-campaigns-filter-note]")).toHaveCount(0);
        expect(await rowIds(campaignRows(g))).toEqual(campaigns.slice(0, CAMPAIGN_PAGE).map((c) => c.id));
        await open(g, "/campaigns?status=live", "Campaigns");
        await expect(campaignRows(g)).toHaveCount(0);
        await expect(g.getByRole("heading", { name: "No campaigns match these filters" })).toBeVisible();
        await expect(g.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/campaigns");
        await g.context().close();
      });
    },
  );
});
