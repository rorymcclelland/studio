// U10-6: the audit's fullest data (8 November 2026), built through the same
// e2e helpers and steps the audit's script reused, so every page is measured
// with as much on it as Studio makes today. The audit's script was a
// throwaway; this is it, kept:
//
// - The live campaign (Fernhollow, LIVE_OBJECTIVE): brief signed off (which
//   runs the personas and the test plan), 12 ads made, 4 paid-social ads
//   picked, ad 1 translated into French, German and Spanish, every don't rule
//   accepted for the picked ads, pre-tested, asked to launch with the
//   defaults, given a seed whose month has an ad tiring between days 9 and 14
//   (and the default threshold, so ads below it raise alerts too), approved in
//   the inbox, moved to simulated day 14, one alert marked as seen, and two
//   questions asked.
// - Two audiences (Quillmoor): signed off with a second audience, 24 ads.
// - Waiting for sign-off (Fernhollow): a campaign line typed (version 2), a
//   completed Suggest lines run for version 2 with its three lines (written
//   straight to the database, plainly labelled as a fixture: no model was
//   called), version 2 sent, personas and test plan (Sprint 10b QA finding 5,
//   so the Brief stage is measured with a line and its suggestions).
// - Early (Quillmoor): version 1, a draft.
// - A tagline run waiting for a choice.
// Each part is found by its objective (or brand name) and reused when it is
// already complete, so a local re-run doesn't build it again; in CI the
// database is new and everything is built, by tests/e2e/page-length-data.setup.ts,
// one part per test, beside the other specs.
//
// The extras that other specs also touch (Quillmoor's segments and market
// notes, the runs list's length, an open invite) are made by ensureExtras(),
// which tests/e2e/page-length.spec.ts runs after every other spec, so it never
// races audience.spec.ts or market.spec.ts.
//
// U10-2 split the campaign page into stages: these steps reach each one
// through the shared helpers (openStage, openLaunch in ./helpers), so the
// creative steps run on the Creative stage, the launch and the clock on the
// Launch stage, and the personas are waited for on the Audience stage. U10-3
// moved the ad cards' tools into their Edit and More menus: the pick and
// translate steps reach them through adTool() and openAdMenu().
import { expect, type Page } from "@playwright/test";
import type postgres from "postgres";
import type { LaunchAd } from "@/lib/performance/launch";
import { MOCK_CPA_QUESTION, seedWithTiring } from "../helpers/monitor";
import {
  acceptDontRulesForPicked,
  openPickedChecks,
  adTool,
  DEV_EMAIL,
  demoBrandId,
  inboxCard,
  makeCreative,
  newCampaign,
  openAdMenu,
  openLaunch,
  openStage,
  settle,
  signOffVersion,
  startRunAwaitingApproval,
  step,
  untilShown,
} from "./helpers";
import { setWaitingLaunchTerms } from "./launch-fixture";
import type { FullestData } from "./page-budgets";

type Sql = postgres.Sql;

export const LIVE_OBJECTIVE = "Bring walkers back for the autumn range before the first cold weekend (length budgets)";
export const TWO_AUDIENCES_OBJECTIVE = "Bring lapsed savers and new savers to the Plus plan this spring (length budgets)";
export const WAITING_OBJECTIVE = "Win lapsed walkers back before winter, waiting for sign-off (length budgets)";
export const EARLY_OBJECTIVE = "Bring new savers to the Plus plan, the brief only (length budgets)";
export const TAGLINE_BRAND = "Larkspur Fells";
/** D-4 (Sprint 10b): the waiting campaign's line, typed, and its three suggestions, near the 30-character limit. Fictional words only (rule 2). */
export const WAITING_LINE = "Out on the fells before frost";
export const WAITING_SUGGESTIONS = ["Back on the ridge before dusk", "Warm through the first cold", "Wrapped up for the high tops"];
/** The runs list is measured full: U10-8's case 2 uses 60 runs, past the list's 50. */
export const RUNS = 60;
export const QUESTIONS = [MOCK_CPA_QUESTION, "What did our rivals spend?"];

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const panel = (page: Page) => page.locator("[data-launch-panel]");
const social = (page: Page) => page.locator('[data-gallery] > li[data-channel="paid social"]');
const idOf = (path: string) => path.split("/").pop()!;

async function devWorkspace(sql: Sql): Promise<{ userId: string; workspaceId: string }> {
  const [m] = await sql`
    select u.id as user_id, m.workspace_id from auth.users u join public.workspace_members m on m.user_id = u.id
    where u.email = ${DEV_EMAIL} limit 1`;
  return { userId: m.user_id as string, workspaceId: m.workspace_id as string };
}

// ---------------------------------------------------------------- finding what is already built

/** The live campaign, when one is complete: live on day 14 or later, with an alert seen and both questions asked. */
async function findLive(sql: Sql): Promise<string | null> {
  const [c] = await sql`
    select c.id from public.campaigns c join public.launches l on l.campaign_id = c.id and l.status = 'live' and l.sim_day >= 14
    where c.objective = ${LIVE_OBJECTIVE}
      and exists (select 1 from public.performance_alerts a where a.launch_id = l.id and a.seen_at is not null)
      and (select count(*) from public.performance_questions q where q.launch_id = l.id and (q.answer is not null or q.refused is not null)) >= ${QUESTIONS.length}
    order by c.created_at desc limit 1`;
  return (c?.id as string) ?? null;
}

async function findTwoAudiences(sql: Sql): Promise<string | null> {
  const [c] = await sql`
    select c.id from public.campaigns c
    where c.objective = ${TWO_AUDIENCES_OBJECTIVE} and c.status = 'approved'
      and (select count(*) from public.ad_variants v where v.campaign_id = c.id) >= 24
    order by c.created_at desc limit 1`;
  return (c?.id as string) ?? null;
}

async function findWaiting(sql: Sql): Promise<string | null> {
  const [c] = await sql`
    select c.id from public.campaigns c
    where c.objective = ${WAITING_OBJECTIVE} and c.status = 'awaiting_signoff'
      and exists (select 1 from public.test_plans t where t.campaign_id = c.id)
      and exists (select 1 from public.brief_versions v where v.campaign_id = c.id and v.version = c.current_version and v.brief ->> 'line' = ${WAITING_LINE})
      and exists (
        select 1 from public.agent_runs r
        where r.agent = 'tagline' and r.status = 'completed' and r.input #>> '{campaign,campaignId}' = c.id::text
          and (r.input #>> '{campaign,version}')::int = c.current_version)
    order by c.created_at desc limit 1`;
  return (c?.id as string) ?? null;
}

async function findEarly(sql: Sql): Promise<string | null> {
  const [c] = await sql`select id from public.campaigns where objective = ${EARLY_OBJECTIVE} and current_version >= 1 order by created_at desc limit 1`;
  return (c?.id as string) ?? null;
}

async function findTagline(sql: Sql): Promise<string | null> {
  const [r] = await sql`
    select id from public.agent_runs where agent = 'tagline' and status = 'awaiting_approval' and input ->> 'brandName' = ${TAGLINE_BRAND}
    order by created_at desc limit 1`;
  return (r?.id as string) ?? null;
}

// ---------------------------------------------------------------- building

/** The live campaign (see the top of this file). About ten minutes with the mock models. Returns its id. */
export async function buildLive(page: Page, sql: Sql): Promise<string> {
  const found = await findLive(sql);
  if (found) return found;
  let path = "";
  let launchId = "";

  await step(page, "Fullest data: a signed-off Fernhollow brief, its personas and test plan, and 12 ads", async () => {
    path = await newCampaign(page, "Fernhollow Outfitters", LIVE_OBJECTIVE);
    await signOffVersion(page, 1);
    await makeCreative(page, 12);
  });

  await step(page, "Fullest data: pick four paid-social ads", async () => {
    expect(await social(page).count()).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 4; i++) {
      const card = social(page).nth(i);
      const pick = await adTool(card, "pick");
      await expect(pick).toHaveAccessibleName(/^Pick ad \d+$/);
      await pick.click();
      await expect(card).toHaveAttribute("data-picked", "", { timeout: 30_000 });
    }
  });

  await step(page, "Fullest data: translate ad 1 into French, German and Spanish", async () => {
    const first = page.locator("[data-gallery] > li[data-picked]").first();
    await openAdMenu(first, "more");
    const translate = first.getByRole("button", { name: /^Translate\s*\((about \d+p|under 1p), at most \d+p\)$/ });
    await expect(translate).toBeEnabled({ timeout: 30_000 });
    await translate.click();
    await untilShown(page, () => expect(page.locator("[data-gallery] > li[data-picked]").first().locator("[data-translation]")).toHaveCount(3, { timeout: 10_000 }), 180_000);
  });

  await step(page, "Fullest data: accept the brand's don't rules for every picked ad", async () => {
    await openStage(page, "creative", path);
    await acceptDontRulesForPicked(page);
  });

  await step(page, "Fullest data: pre-test the picked ads", async () => {
    const bar = page.locator("[data-pretest-bar]");
    const button = bar.getByRole("button", { name: /^Pre-test picked ads/ });
    // U10-3: the pre-test bar is among the checks on the picked ads, folded into one line until opened.
    await untilShown(
      page,
      async () => {
        await openPickedChecks(page);
        await expect(button).toBeEnabled({ timeout: 10_000 });
      },
      180_000,
    );
    await button.click();
    await untilShown(page, () => expect(page.locator("[data-gallery] > li[data-picked] [data-pretest-average]")).toHaveCount(4, { timeout: 10_000 }), 240_000);
  });

  await step(page, "Fullest data: ask to launch with the defaults, give it a seed with an ad tiring between days 9 and 14, approve it in the inbox", async () => {
    await openLaunch(page, path);
    await panel(page).getByRole("button", { name: "Ask to launch" }).click();
    await expect(panel(page).locator("[data-launch-status]")).toHaveText("Waiting for approval", { timeout: 30_000 });
    const [l] = await sql`
      select id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, days, daily_budget_pence, ads
      from public.launches where campaign_id = ${idOf(path)} and status = 'awaiting_approval'`;
    launchId = l.id as string;
    const prices = await sql`
      select p.price_pence from public.products p join public.campaigns c on c.brand_id = p.brand_id
      where c.id = ${idOf(path)} and p.active order by p.price_pence`;
    const found = seedWithTiring(
      { startsOn: l.starts_on, days: l.days, dailyBudgetPence: l.daily_budget_pence, ads: l.ads as LaunchAd[], orderValuesPence: prices.map((p) => p.price_pence as number) },
      9,
      14,
    );
    // The default threshold stays (cost per acquisition at or below £20), so ads below it raise alerts as well.
    await setWaitingLaunchTerms(sql, launchId, { seed: found.seed });
    await page.goto("/approvals");
    await settle(page);
    const card = inboxCard(page, "launch", path);
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
  });

  await step(page, "Fullest data: move the simulation on to day 14", async () => {
    for (const day of [7, 14]) {
      await openLaunch(page, path);
      await panel(page).getByRole("button", { name: "Next week" }).click();
      await expect(panel(page).locator("[data-sim-clock]")).toHaveText(`Simulated day ${day} of 30`, { timeout: 60_000 });
    }
  });

  await step(page, "Fullest data: mark one alert as seen, and ask two questions", async () => {
    await page.goto(`${path}/performance`);
    await settle(page);
    const unseen = page.locator("[data-perf-alerts] [data-perf-alert]").filter({ has: page.getByRole("button", { name: "Mark as seen" }) });
    await expect(unseen.first()).toBeVisible({ timeout: 30_000 });
    await unseen.first().getByRole("button", { name: "Mark as seen" }).click();
    // U10-4: a seen alert folds into one line, its "Seen by" inside it, so it is waited for as attached.
    await expect(page.locator("[data-perf-alerts] [data-alert-seen]").first()).toBeAttached({ timeout: 30_000 });
    const box = page.locator("[data-ask]");
    for (const question of QUESTIONS) {
      await box.getByRole("textbox", { name: "Ask about this campaign" }).fill(question);
      await box.getByRole("button", { name: "Ask" }).click();
      const asked = page.locator("[data-ask-question]").filter({ has: page.locator("[data-ask-text]", { hasText: question }) }).first();
      await untilShown(page, () => expect(asked.locator("[data-ask-answer]")).not.toBeEmpty({ timeout: 2_000 }), 120_000);
    }
  });

  const live = await findLive(sql);
  if (!live) throw new Error(`The live campaign at ${path} isn't complete: check it's on simulated day 14 with an alert seen and both questions answered`);
  return live;
}

/** Quillmoor with two audiences and 24 ads, as several-audiences.spec.ts makes it. Returns its id. */
export async function buildTwoAudiences(page: Page, sql: Sql): Promise<string> {
  const found = await findTwoAudiences(sql);
  if (found) return found;
  await step(page, "Fullest data: a Quillmoor brief signed off with two audiences, and 24 ads", async () => {
    const path = await newCampaign(page, "Quillmoor Money", TWO_AUDIENCES_OBJECTIVE);
    await signOffVersion(page, 1);
    await openStage(page, "brief", path);
    await page.getByRole("button", { name: "Edit the audiences" }).click();
    const section = page.locator("[data-section=audiences]").filter({ visible: true });
    await section.getByRole("button", { name: "Add an audience" }).click();
    const first = await section.getByLabel("Audience 1", { exact: true }).inputValue();
    const second = section.getByLabel("Audience 2", { exact: true });
    const other = await second.locator("option").evaluateAll((opts, taken) => (opts as HTMLOptionElement[]).map((o) => o.value).find((v) => v && v !== taken)!, first);
    await second.selectOption(other);
    await section.getByLabel("Why audience 2").fill("They already trust the app and may move up a plan.");
    await section.getByRole("button", { name: "Save the audiences" }).click();
    await expect(toast(page, "Saved as version 2.")).toBeVisible({ timeout: 30_000 });
    await signOffVersion(page, 2);
    await makeCreative(page, 24);
  });
  const id = await findTwoAudiences(sql);
  if (!id) throw new Error("The two-audience campaign isn't complete");
  return id;
}

/**
 * Fernhollow with a campaign line (version 2) and a completed Suggest lines run for that version, version 2 sent
 * for sign-off, with its personas and test plan. Returns its id.
 */
export async function buildWaiting(page: Page, sql: Sql): Promise<string> {
  const found = await findWaiting(sql);
  if (found) return found;
  await step(page, "Fullest data: a Fernhollow brief with a campaign line and three suggested lines, waiting for sign-off, with its personas and test plan", async () => {
    const path = await newCampaign(page, "Fernhollow Outfitters", WAITING_OBJECTIVE);
    // D-4: the line, typed, makes version 2.
    await page.getByRole("button", { name: "Edit the campaign line" }).click();
    await page.getByRole("textbox", { name: "Campaign line", exact: true }).fill(WAITING_LINE);
    await page.getByRole("button", { name: "Save the campaign line" }).click();
    await expect(toast(page, "Saved as version 2.")).toBeVisible();
    // A Suggest lines run for version 2, completed with three lines, in the shape startSuggestLines() makes
    // (src/lib/brief/line.ts) and the Tagline agent returns. A fixture: no model was called, and it costs nothing.
    const { userId, workspaceId } = await devWorkspace(sql);
    const campaignId = idOf(path);
    const [v] = await sql`select brief from public.brief_versions where campaign_id = ${campaignId} and version = 2`;
    const input = {
      brandName: "Fernhollow Outfitters",
      campaign: { campaignId, version: 2, title: String(v.brief.title).slice(0, 100), story: String(v.brief.story ?? "").slice(0, 1200), audiences: [], voice: "" },
    };
    await sql`
      insert into public.agent_runs (workspace_id, agent, agent_version, status, input, output, created_by, created_at, updated_at, completed_at, label)
      values (${workspaceId}, 'tagline', 1, 'completed', ${sql.json(input)}, ${sql.json({ taglines: WAITING_SUGGESTIONS })}, ${userId},
              now(), now(), now(), 'Fernhollow Outfitters: suggest lines (fixture run, no model was called)')`;
    await page.reload();
    await settle(page);
    await expect(page.locator("[data-line-suggestion]").filter({ visible: true })).toHaveCount(3);
    const signoff = page.locator("[data-signoff-panel]").filter({ visible: true });
    await signoff.getByRole("button", { name: "Send version 2 for sign-off" }).click();
    await expect(toast(page, "Sent for sign-off")).toBeVisible();
    // The personas and the test plan are on the Audience stage.
    await openStage(page, "audience", path);
    await untilShown(page, async () => {
      await expect(page.locator("[data-persona]").filter({ visible: true }).first()).toBeVisible({ timeout: 5_000 });
      await expect(page.locator("[data-hypothesis]").filter({ visible: true }).first()).toBeVisible({ timeout: 5_000 });
    }, 180_000);
  });
  const id = await findWaiting(sql);
  if (!id) throw new Error("The campaign waiting for sign-off isn't complete");
  return id;
}

/** Quillmoor, version 1, a draft. Returns its id. */
export async function buildEarly(page: Page, sql: Sql): Promise<string> {
  const found = await findEarly(sql);
  if (found) return found;
  await step(page, "Fullest data: a Quillmoor brief, version 1 only", async () => {
    await newCampaign(page, "Quillmoor Money", EARLY_OBJECTIVE);
  });
  return (await findEarly(sql))!;
}

/** A tagline run waiting for a choice. Returns its id. */
export async function buildTagline(page: Page, sql: Sql): Promise<string> {
  const found = await findTagline(sql);
  if (found) return found;
  return idOf(await startRunAwaitingApproval(page, TAGLINE_BRAND));
}

// ---------------------------------------------------------------- extras, after every other spec

/**
 * What other specs also make, made here only when missing, after they have
 * all run: Quillmoor's segments from the Audience agent and its market notes,
 * at least RUNS runs (the extra ones written straight to the database, plainly
 * labelled as fixtures), and one open invite.
 */
export async function ensureExtras(page: Page, sql: Sql, data: FullestData): Promise<void> {
  const [seg] = await sql`select count(*)::int as n from public.context_items where brand_id = ${data.quillmoor} and kind = 'segment' and source = 'Audience agent'`;
  if (seg.n === 0) {
    await step(page, "Fullest data: Find audiences on Quillmoor", async () => {
      await page.goto(`/brands/${data.quillmoor}?tab=audience`);
      await settle(page);
      const segments = page.getByRole("region", { name: "Segments" }).filter({ visible: true });
      await segments.getByRole("button", { name: "Find audiences" }).click();
      await expect(segments.getByText("Completed")).toBeVisible({ timeout: 90_000 });
    });
  }
  const [notes] = await sql`select count(*)::int as n from public.context_items where brand_id = ${data.quillmoor} and source = 'Market agent'`;
  if (notes.n === 0) {
    await step(page, "Fullest data: refresh Quillmoor's market notes", async () => {
      await page.goto(`/brands/${data.quillmoor}?tab=audience`);
      await settle(page);
      const section = page.locator("section:has(h2#market)").filter({ visible: true });
      await section.getByRole("button", { name: "Refresh market notes" }).click();
      const confirm = section.locator("[data-market-confirm]");
      const started = toast(page, "The Market agent is searching the web");
      await expect(confirm.or(started).first()).toBeVisible();
      if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Refresh anyway" }).click();
      await expect(section.getByRole("button", { name: "Refresh market notes" })).toBeEnabled({ timeout: 90_000 });
      await expect(section.locator("[data-market-note]").first()).toBeVisible({ timeout: 30_000 });
    });
  }
  const { userId, workspaceId } = await devWorkspace(sql);
  const [runs] = await sql`select count(*)::int as n from public.agent_runs where workspace_id = ${workspaceId}`;
  if (runs.n < RUNS) {
    // Older than every real run, so the real ones stay at the top of the list.
    await sql`
      insert into public.agent_runs (workspace_id, agent, agent_version, status, input, error, created_by, created_at, updated_at, completed_at, label)
      select ${workspaceId}, 'tagline', 1, 'failed', ${sql.json({ brandName: TAGLINE_BRAND })},
             'A fixture run for the length-budget check: no model was called.', ${userId},
             now() - interval '2 days' - make_interval(mins => n), now() - interval '2 days' - make_interval(mins => n),
             now() - interval '2 days' - make_interval(mins => n), ${`${TAGLINE_BRAND}: fixture run`}
      from generate_series(1, ${RUNS - runs.n}) as n`;
  }
  const [invite] = await sql`select count(*)::int as n from public.invites where created_by = ${userId} and used_at is null and revoked_at is null and expires_at > now()`;
  if (invite.n === 0) {
    await step(page, "Fullest data: one open invite", async () => {
      await page.goto("/invites");
      await settle(page);
      await page.getByLabel("Email").filter({ visible: true }).fill(`length-budgets-${Date.now()}@example.test`);
      await page.getByRole("button", { name: "Create invite link" }).click();
      await expect(page.locator("[data-invite-link]")).toContainText("works once");
    });
  }
}

/**
 * Every id the budgets need. With `build`, missing parts are built (a
 * standalone run of tests/e2e/page-length.spec.ts); without, a missing part
 * fails with what to run.
 */
export async function fullestData(page: Page, sql: Sql, { build }: { build: boolean }): Promise<FullestData> {
  const fernhollow = await demoBrandId(page, "Fernhollow Outfitters");
  const quillmoor = await demoBrandId(page, "Quillmoor Money");
  const need = async (what: string, find: () => Promise<string | null>, make: () => Promise<string>) => {
    const found = await find();
    if (found) return found;
    if (build) return make();
    throw new Error(`The fullest data has no ${what}: run the page-length-data project first (npx playwright test --project=page-length-data)`);
  };
  const live = await need("live campaign", () => findLive(sql), () => buildLive(page, sql));
  const [imagery] = await sql`select id from public.agent_runs where agent = 'imagery' and input ->> 'campaignId' = ${live} order by created_at limit 1`;
  return {
    fernhollow,
    quillmoor,
    live,
    twoAudiences: await need("two-audience campaign", () => findTwoAudiences(sql), () => buildTwoAudiences(page, sql)),
    waiting: await need("campaign waiting for sign-off", () => findWaiting(sql), () => buildWaiting(page, sql)),
    early: await need("brief-only campaign", () => findEarly(sql), () => buildEarly(page, sql)),
    imageryRun: imagery.id as string,
    taglineRun: await need("tagline run waiting for a choice", () => findTagline(sql), () => buildTagline(page, sql)),
  };
}
