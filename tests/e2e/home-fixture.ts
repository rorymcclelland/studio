// A browser-test fixture, not an app route: U10-5's work for Studio's home,
// written straight to the database as the tables' owner (CI's and local e2e's
// DATABASE_URL), in a new invitee's own workspace, so the home page shows
// exactly this and nothing other specs leave waiting in the dev workspace.
//
// Home reads what waits for a person (sign-offs, launches, run choices),
// unseen alerts on live launches, the live campaigns and the recent runs. Those
// rows are written as the app leaves them: a sign-off approval with its persona
// review and test plan, a launch approval with its waiting launch, launches
// approved and live (or ended) with alerts, and finished agent runs. An alert
// must name one of its launch's own ads (performance_alerts_check), so the
// live launches hold real ad rows; their picture is marked discarded, so
// compliance reads them as ads no longer in the gallery and nothing is drawn
// (no picture bytes are needed). The waiting launch names an ad id no gallery
// holds, as tests/e2e/status-fixture.ts does.
//
// Times are set in the past on purpose, so the order home and the inbox show
// is known: the sign-off, then the launch (asked before it), then the run
// choices, which are newer than both (Rory's decision, 9 November 2026: what
// has an Approve button first); then campaigns by their newest unseen alert.
//
// One campaign is written in the dev workspace (another workspace from the
// invitee's): a run in the invitee's workspace names its id, and home must
// never show its name (rule 7). removeHomeFixture deletes it and the
// invitee's workspace, with everything in it.
import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { devMember } from "./status-fixture";

type Tx = postgres.TransactionSql;

export type FixtureMember = { userId: string; workspaceId: string; email: string };

export type HomeKey = "waiting" | "launchWaiting" | "liveA" | "liveB" | "quiet" | "ended";
export type LiveKey = "liveA" | "liveB" | "quiet" | "ended";

export type HomeFixture = {
  brandId: string;
  /** Each campaign's id. */
  campaigns: Record<HomeKey, string>;
  /** Each campaign's name as home shows it: its brief's title (version 1). */
  names: Record<HomeKey, string>;
  /** The open sign-off of `waiting`, and the open launch approval of `launchWaiting`. */
  signoffApproval: string;
  launchApproval: string;
  /** The launches that went live, with their simulated day. */
  launches: Record<LiveKey, { id: string; simDay: number }>;
  /** Unseen alerts per launch (ended's do not count on home). */
  unseen: Record<"liveA" | "liveB" | "ended", number>;
  /** Finished runs: the persona review's, the brief's (waiting), the pictures' (liveA), and one naming the hidden campaign. */
  runs: { persona: string; testPlan: string; brief: string; imagery: string; hostile: string };
  /** The dev workspace's campaign the hostile run names. */
  hidden: { campaignId: string; name: string };
};

const FAKE_AD = "a1111111-1111-4111-8111-111111111111";
const SOCIAL = ["1080x1080"];

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

const brief = (title: string) => ({
  title,
  summary: "Bring walkers back for the autumn range before the first cold weekend.",
  story: "Walkers come back when the kit they bought lasts the season.",
  insights: [1, 2, 3].map((n) => ({ text: `Walkers say reason ${n} matters to them.`, cites: [`note-${n}`] })),
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach lapsed walkers." }],
  kpi: { metric: "reactivation rate" },
  mustInclude: [],
  avoid: [],
});

/** The member an email belongs to (an invitee has their own workspace once they accept). */
export async function memberByEmail(sql: postgres.Sql, email: string): Promise<FixtureMember> {
  const [m] = await sql`
    select u.id as user_id, m.workspace_id from auth.users u join public.workspace_members m on m.user_id = u.id
    where u.email = ${email} limit 1`;
  if (!m) throw new Error(`${email} has no workspace yet: accept the invite first`);
  return { userId: m.user_id as string, workspaceId: m.workspace_id as string, email };
}

async function campaign(tx: Tx, m: FixtureMember, brandId: string, title: string, status: "awaiting_signoff" | "approved"): Promise<string> {
  const [c] = await tx`
    insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
    values (${m.workspaceId}, ${brandId}, ${`${title}: bring walkers back for the autumn range`}, ${m.userId}, 1) returning id`;
  await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
    values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief(title))}, 'agent', ${m.userId})`;
  if (status === "approved") {
    await tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
  } else {
    await tx`update public.campaigns set status = 'awaiting_signoff' where id = ${c.id}`;
  }
  return c.id as string;
}

/**
 * The checks Make creative records with a drawn card ad (a Fernhollow card, as
 * tests/helpers/launch.ts draws one), so the gallery and Performance page can
 * describe the fixture's ads as they describe any other.
 */
const CARD_CHECKS = {
  fit: {
    cta: { size: 28, lines: ["Shop jackets"] },
    body: { size: 28, lines: ["A shell for wet days on high", "ground."] },
    legal: { size: 22, lines: ["Prices include VAT."], paragraphs: 1 },
    headline: { size: 60, lines: ["Fixture ad"] },
  },
  logo: "drawn",
  size: "1080x1080",
  layout: "card",
  picture: { box: { width: 468, height: 854 }, fit: "as before", source: { width: 2048, height: 2048 }, upscale: 0.42 },
  contrast: { cta: 15.67, body: 6.29, note: "Fog on Moss", text: "#E8EBE4", legal: 6.29, panel: "#3F5B3A", button: "#E8EBE4", source: "palette", headline: 6.29, buttonEdge: 6.29, buttonText: "#111111" },
  simulatedLabel: true,
  legalLinePresent: true,
};

/** An ad as Make creative records one, whose picture has since been discarded (so compliance never draws it). */
async function fixtureAd(tx: Tx, m: FixtureMember, brandId: string, campaignId: string, n: number): Promise<string> {
  const [a] = await tx`
    insert into public.assets (workspace_id, kind, brand_id, campaign_id, mime, width, height, bytes, sha256, simulated, created_by, created_by_kind, discarded_at)
    values (${m.workspaceId}, 'image', ${brandId}, ${campaignId}, 'image/webp', 1, 1, ${Buffer.from([0])}, ${randomBytes(32).toString("hex")}, true, ${m.userId}, 'agent', now())
    returning id`;
  const [s] = await tx`
    insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, source, created_by)
    values (${m.workspaceId}, ${campaignId}, 1, 'paid social', 'Walkers',
            ${tx.json({ headline: `Fixture ad ${n}`, body: "A shell for wet days on high ground.", cta: "Shop jackets" })}, 'agent', ${m.userId})
    returning id`;
  const [v] = await tx`
    insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by, picked_at)
    values (${m.workspaceId}, ${campaignId}, 1, ${a.id}, ${s.id}, 'card', ${tx.json(CARD_CHECKS)}, '{}'::jsonb, 'composed', ${m.userId}, now())
    returning id`;
  return v.id as string;
}

/** A launch with its approval, asked for at `askedAt`; then approved and live on `simDay`, or ended, unless it waits. */
async function launch(
  tx: Tx,
  m: FixtureMember,
  campaignId: string,
  ads: string[],
  status: "awaiting_approval" | "live" | "ended",
  simDay: number,
  askedAt: Date,
): Promise<{ launchId: string; approvalId: string }> {
  const [ap] = await tx`
    insert into public.approvals (workspace_id, kind, campaign_id, question, options, expires_at, created_at)
    values (${m.workspaceId}, 'launch', ${campaignId}, 'Launch (simulated)', '[]'::jsonb, now() + interval '14 days', ${askedAt}) returning id`;
  const [l] = await tx`
    insert into public.launches (workspace_id, campaign_id, ads, daily_budget_pence, days, starts_on, kpi_measure, kpi_value, seed, approval_id, created_by, created_at)
    values (${m.workspaceId}, ${campaignId}, ${tx.json(ads.map((variantId) => ({ variantId, sizes: SOCIAL, langs: ["en-GB"] })))}, 5000, 30, ${"2026-11-06"},
            'cpa', 20, 42, ${ap.id}, ${m.userId}, ${askedAt}) returning id`;
  if (status !== "awaiting_approval") {
    await tx`update public.approvals set status = 'approved', decided_by = ${m.userId}, decided_at = now() where id = ${ap.id}`;
    await tx`update public.launches set status = 'live', approved_at = now() where id = ${l.id}`;
    if (simDay > 0) await tx`update public.launches set sim_day = ${simDay} where id = ${l.id}`;
    if (status === "ended") await tx`update public.launches set status = 'ended', ended_by = ${m.userId}, ended_at = now() where id = ${l.id}`;
  }
  return { launchId: l.id as string, approvalId: ap.id as string };
}

async function alert(tx: Tx, m: FixtureMember, launchId: string, variantId: string, kind: "below_threshold" | "tiring" | "not_compliant", day: number, at: Date, seen = false) {
  const facts = kind === "not_compliant" ? { reason: "Fails: banned term 'Dry' in English." } : { note: "A fixture alert for U10-5; no clock moved." };
  await tx`
    insert into public.performance_alerts (workspace_id, launch_id, variant_id, kind, day, facts, seen_by, seen_at, created_at)
    values (${m.workspaceId}, ${launchId}, ${variantId}, ${kind}, ${day}, ${tx.json(facts)}, ${seen ? m.userId : null}, ${seen ? at : null}, ${at})`;
}

async function run(tx: Tx, m: FixtureMember, agent: string, input: Record<string, unknown>, label: string, at: Date): Promise<string> {
  const [r] = await tx`
    insert into public.agent_runs (workspace_id, agent, agent_version, status, input, created_by, label, created_at, completed_at)
    values (${m.workspaceId}, ${agent}, 1, 'completed', ${tx.json(input as never)}, ${m.userId}, ${label}, ${at}, ${at}) returning id`;
  return r.id as string;
}

/**
 * Everything home shows, in `m`'s workspace, named with `tag`:
 * - waiting: version 1 waiting for sign-off (asked 30 minutes ago), with a review of 3 synthetic personas and a test plan;
 * - launchWaiting: signed off, a launch waiting for approval (asked 35 minutes ago, before the sign-off);
 * - liveA: live on simulated day 14, two ads, alerts: 3 unseen (newest 10 minutes ago) and 1 seen;
 * - liveB: live on simulated day 9, one ad, 1 unseen alert (5 minutes ago);
 * - quiet: live on simulated day 3, no alerts;
 * - ended: its launch ended, 1 unseen alert (2 minutes ago), which home doesn't count.
 * And four finished runs (persona and test plan an hour ago, the brief 40 minutes ago, the pictures 30), plus one,
 * 20 minutes ago, whose input names a campaign in the dev workspace.
 */
export async function insertHomeFixture(sql: postgres.Sql, m: FixtureMember, tag: string): Promise<HomeFixture> {
  const dev = await devMember(sql);
  const hiddenName = `${tag} hidden: the owner's own campaign`;
  const [devBrand] = await sql`select id from public.brands where workspace_id = ${dev.workspaceId} order by created_at limit 1`;
  if (!devBrand) throw new Error("The dev workspace has no brand yet: the demo-brands setup project adds them");
  const [hidden] = await sql`
    insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
    values (${dev.workspaceId}, ${devBrand.id}, ${hiddenName}, ${dev.userId}, 1) returning id`;
  await sql`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
    values (${dev.workspaceId}, ${hidden.id}, 1, ${sql.json(brief(hiddenName))}, 'agent', ${dev.userId})`;

  return sql.begin(async (tx) => {
    const [b] = await tx`
      insert into public.brands (workspace_id, created_by, name, slug, is_simulated)
      values (${m.workspaceId}, ${m.userId}, 'Fernhollow Outfitters', ${`home-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 40)}, true)
      returning id`;
    const brandId = b.id as string;
    const names: Record<HomeKey, string> = {
      waiting: `${tag} waiting for sign-off`,
      launchWaiting: `${tag} launch waiting`,
      liveA: `${tag} live with three alerts`,
      liveB: `${tag} live with one alert`,
      quiet: `${tag} live with no alerts`,
      ended: `${tag} ended`,
    };
    const campaigns = {} as Record<HomeKey, string>;
    campaigns.waiting = await campaign(tx, m, brandId, names.waiting, "awaiting_signoff");
    for (const key of ["launchWaiting", "liveA", "liveB", "quiet", "ended"] as const) campaigns[key] = await campaign(tx, m, brandId, names[key], "approved");

    // The sign-off, with what its card summarises: personas and a test plan, both finished.
    const [signoff] = await tx`
      insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at, created_at)
      values (${m.workspaceId}, 'brief_signoff', ${campaigns.waiting}, 1, ${`Sign off version 1: ${names.waiting}`}, '[]'::jsonb, now() + interval '14 days', ${minutesAgo(30)})
      returning id`;
    const persona = await run(tx, m, "persona", { campaignId: campaigns.waiting, version: 1 }, "Persona review", minutesAgo(61));
    const testPlan = await run(tx, m, "testPlan", { campaignId: campaigns.waiting, version: 1 }, "Test plan", minutesAgo(60));
    const personas = [1, 2, 3].map((n) => ({ key: `p${n}`, name: `Walker ${n}`, segment: { id: null, title: "Walkers", facts: "Simulated" } }));
    await tx`insert into public.persona_reviews (workspace_id, campaign_id, brief_version, run_id, review, created_by)
      values (${m.workspaceId}, ${campaigns.waiting}, 1, ${persona},
              ${tx.json({ personas, averages: { relevance: 4, clarity: 4, credibility: 3, brandFit: 4 }, overall: 3.8, synthetic: true, simulatedData: true })}, ${m.userId})`;
    await tx`insert into public.test_plans (workspace_id, campaign_id, brief_version, run_id, plan, created_by)
      values (${m.workspaceId}, ${campaigns.waiting}, 1, ${testPlan},
              ${tx.json({ hypotheses: [{ statement: "Walkers respond to mending more than to price.", variable: "message", successMetric: "click-through rate" }], note: "Simulated" })}, ${m.userId})`;

    const { approvalId: launchApproval } = await launch(tx, m, campaigns.launchWaiting, [FAKE_AD], "awaiting_approval", 0, minutesAgo(35));

    // Live and ended launches, in this order (home lists live campaigns in the order they launched).
    const adsA = [await fixtureAd(tx, m, brandId, campaigns.liveA, 1), await fixtureAd(tx, m, brandId, campaigns.liveA, 2)];
    const adB = await fixtureAd(tx, m, brandId, campaigns.liveB, 3);
    const adEnded = await fixtureAd(tx, m, brandId, campaigns.ended, 4);
    const liveA = await launch(tx, m, campaigns.liveA, adsA, "live", 14, minutesAgo(50));
    const liveB = await launch(tx, m, campaigns.liveB, [adB], "live", 9, minutesAgo(45));
    const quiet = await launch(tx, m, campaigns.quiet, [FAKE_AD], "live", 3, minutesAgo(42));
    const ended = await launch(tx, m, campaigns.ended, [adEnded], "ended", 12, minutesAgo(48));

    await alert(tx, m, liveA.launchId, adsA[1], "below_threshold", 4, minutesAgo(13), true);
    await alert(tx, m, liveA.launchId, adsA[0], "below_threshold", 6, minutesAgo(12));
    await alert(tx, m, liveA.launchId, adsA[0], "tiring", 9, minutesAgo(11));
    await alert(tx, m, liveA.launchId, adsA[0], "not_compliant", 12, minutesAgo(10));
    await alert(tx, m, liveB.launchId, adB, "below_threshold", 7, minutesAgo(5));
    await alert(tx, m, ended.launchId, adEnded, "tiring", 8, minutesAgo(2));

    // Runs: labels that don't name the campaign, so the campaign home shows is the one it works out.
    const briefRun = await run(tx, m, "brief", { mode: "draft", campaignId: campaigns.waiting }, "Brief", minutesAgo(40));
    const imagery = await run(tx, m, "imagery", { campaignId: campaigns.liveA, version: 1 }, "Pictures", minutesAgo(30));
    const hostile = await run(tx, m, "brief", { mode: "draft", campaignId: hidden.id as string }, "Brief", minutesAgo(20));

    return {
      brandId,
      campaigns,
      names,
      signoffApproval: signoff.id as string,
      launchApproval,
      launches: {
        liveA: { id: liveA.launchId, simDay: 14 },
        liveB: { id: liveB.launchId, simDay: 9 },
        quiet: { id: quiet.launchId, simDay: 3 },
        ended: { id: ended.launchId, simDay: 12 },
      },
      unseen: { liveA: 3, liveB: 1, ended: 1 },
      runs: { persona, testPlan, brief: briefRun, imagery, hostile },
      hidden: { campaignId: hidden.id as string, name: hiddenName },
    };
  }) as Promise<HomeFixture>;
}

/**
 * `count` more tagline runs in `m`'s workspace, each waiting for a choice, as the tagline workflow leaves one (a run
 * awaiting approval with its open run_choice), asked for over the last few seconds, so they are newer than everything
 * in the fixture. Newest first.
 */
export async function insertRunChoices(sql: postgres.Sql, m: FixtureMember, count: number): Promise<{ runId: string; approvalId: string }[]> {
  return sql.begin(async (tx) => {
    const made: { runId: string; approvalId: string }[] = [];
    for (let i = 0; i < count; i++) {
      const at = new Date(Date.now() - (i + 1) * 1000);
      const [r] = await tx`
        insert into public.agent_runs (workspace_id, agent, agent_version, status, input, created_by, label, created_at)
        values (${m.workspaceId}, 'tagline', 1, 'awaiting_approval', ${tx.json({ brandName: "Larkspur Mill" })}, ${m.userId}, ${`Larkspur Mill ${i + 2}`}, ${at})
        returning id`;
      const [a] = await tx`
        insert into public.approvals (workspace_id, kind, run_id, question, options, expires_at, created_at)
        values (${m.workspaceId}, 'run_choice', ${r.id}, 'Which tagline should we use?', ${tx.json(["One", "Two", "Three"])}, now() + interval '1 day', ${at})
        returning id`;
      made.push({ runId: r.id as string, approvalId: a.id as string });
    }
    return made;
  }) as Promise<{ runId: string; approvalId: string }[]>;
}

/** Removes the dev workspace's hidden campaign and the invitee's whole workspace, as the tables' owner. */
export async function removeHomeFixture(sql: postgres.Sql, m: FixtureMember | null, hiddenCampaignId: string | null): Promise<void> {
  if (hiddenCampaignId) await sql`delete from public.campaigns where id = ${hiddenCampaignId}`;
  if (m) await sql`delete from public.workspaces where id = ${m.workspaceId}`;
}
