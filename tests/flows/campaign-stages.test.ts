// U10-2 against the database: campaignFacts() reads, once per page, the facts
// the stage bar, the overview's "Needs you" list and the stage pages' locks
// are worked out from (src/lib/campaigns/stages.ts, tests/lib/campaign-stages.test.ts),
// for real campaigns in each state, from writing to ended, and refuses another
// workspace's campaign (rule 7). The browser tests are tests/e2e/campaign-stages.spec.ts,
// whose top comment is the interface.
//
// Outside tests/db on purpose: building campaigns with ads, compliance
// decisions, a launch and two simulated weeks is hundreds of statements, and
// CI's Neon job (tests/db from a US runner, about 100 ms a query) is for the
// database's own rules. U10-2 adds no table. Plain Postgres in CI's first job
// runs this. The database is real; nothing is mocked but Next's cache.
//
// What the facts must equal is read from the functions today's campaign page
// already uses (getCampaign, getSignoffState, getReviews, getCreative,
// galleryCompliance, launchEligibility, launchesFor) and the Performance page's
// (performanceFor, listAlerts), so the loader can't drift from what the stage
// pages show; and where the state is known by construction, the figure is
// written out too.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));

import { campaignFacts } from "@/lib/campaigns/facts";
import { campaignStages, needsYou, type CampaignFacts } from "@/lib/campaigns/stages";
import { campaignStatusLabel } from "@/lib/campaigns/status";
import { adCompliance, decideFinding } from "@/lib/compliance/compute";
import { getCreative, discardVariant } from "@/lib/creative/gallery";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { listAlerts, markAlertSeen } from "@/lib/performance/alerts-store";
import { advance } from "@/lib/performance/clock";
import { performanceFor } from "@/lib/performance/dashboard";
import { endLaunch, launchEligibility } from "@/lib/performance/launch";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, brief, builder, campaignFor, productsFor, rawLaunch, type Member } from "../helpers/launch";

let a: Member;
let b: Member;
let brandA = "";
const ids: Record<string, string> = {};
/** The journey campaign's ads: the picked one launched, and one discarded. */
let pickedAd = "";
let discardedAd = "";
let launchId = "";

/** A campaign whose brief is still being written: version 0, and a Brief agent run in `runStatus` (none when null). */
async function writing(m: Member, objective: string, runStatus: string | null): Promise<string> {
  return asUser(m.userId, async (tx) => {
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by) values (${m.workspaceId}, ${brandA}, ${objective}, ${m.userId}) returning id`;
    if (runStatus) {
      // Linked as createCampaign links it: campaigns.run_id.
      const [r] = await tx`insert into public.agent_runs (workspace_id, agent, agent_version, status, input, created_by, label)
        values (${m.workspaceId}, 'brief', 1, ${runStatus}, ${tx.json({ campaignId: c.id as string })}, ${m.userId}, 'Brief') returning id`;
      await tx`update public.campaigns set run_id = ${r.id} where id = ${c.id}`;
    }
    return c.id as string;
  });
}

/** Version 1 that nobody has sent for sign-off (status draft). */
async function draft(m: Member, objective: string): Promise<string> {
  const id = await campaignFor(m, brandA, "draft", objective);
  await asUser(m.userId, (tx) => tx`update public.campaigns set status = 'draft' where id = ${id}`);
  return id;
}

/** Version 1 sent for sign-off, as requestSignoff leaves it. */
async function waiting(m: Member, objective: string): Promise<string> {
  const id = await draft(m, objective);
  await asUser(m.userId, async (tx) => {
    await tx`insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
      values (${m.workspaceId}, 'brief_signoff', ${id}, 1, ${`Sign off version 1: ${brief("Long way round 1").title}`}, '[]'::jsonb, now() + interval '7 days')`;
    await tx`update public.campaigns set status = 'awaiting_signoff' where id = ${id}`;
  });
  return id;
}

/** A persona review of `n` personas and a test plan for version 1, as the review workflows store them. */
async function reviewsFor(m: Member, campaignId: string, n: number) {
  await asUser(m.userId, async (tx) => {
    const run = async (agent: string) => {
      const [r] = await tx`insert into public.agent_runs (workspace_id, agent, agent_version, status, input, created_by, label)
        values (${m.workspaceId}, ${agent}, 1, 'completed', ${tx.json({ campaignId, version: 1 })}, ${m.userId}, ${agent}) returning id`;
      return r.id as string;
    };
    const personas = Array.from({ length: n }, (_, i) => ({ name: `Walker ${i + 1}`, segment: { id: null, title: "Walkers", facts: "Simulated" } }));
    await tx`insert into public.persona_reviews (workspace_id, campaign_id, brief_version, run_id, review, created_by)
      values (${m.workspaceId}, ${campaignId}, 1, ${await run("persona")}, ${tx.json({ personas, averages: { relevance: 4, clarity: 4, credibility: 4, brandFit: 4 }, overall: 4, synthetic: true, simulatedData: true })}, ${m.userId})`;
    await tx`insert into public.test_plans (workspace_id, campaign_id, brief_version, run_id, plan, created_by)
      values (${m.workspaceId}, ${campaignId}, 1, ${await run("testPlan")}, ${tx.json({ hypotheses: [], note: "Simulated" })}, ${m.userId})`;
  });
}

/** Accepts every open review item on an ad, as a person does on its Compliance view. */
async function acceptReviews(m: Member, variantId: string) {
  const ad = (await adCompliance(m.userId, variantId))!;
  for (const f of [...ad.perAd, ...ad.picture, ...ad.items.flatMap((i) => i.findings)]) {
    if (f.outcome !== "review") continue;
    await decideFinding(m, variantId, { lang: f.lang, size: f.size, rule: f.key, hash: f.hash, decision: "accept", note: "Checked by hand" });
  }
}

/** The facts, which must be there. */
async function factsOf(id: string, m: Member = a): Promise<CampaignFacts> {
  const f = await campaignFacts(m.userId, id);
  expect(f, id).not.toBeNull();
  return f!;
}

/** What today's functions say the creative facts are. */
async function creativeNow(id: string) {
  const view = (await getCreative(a.userId, id))!;
  const pickedNow = view.variants.filter((v) => v.picked && v.briefVersion === view.version);
  let toDecide = 0;
  for (const v of pickedNow) {
    const c = await adCompliance(a.userId, v.id);
    if (c && c.pill.tone === "review") toDecide++;
  }
  const eligibility = await launchEligibility(a.userId, id);
  return {
    creative: {
      ads: view.variants.length,
      picked: view.variants.filter((v) => v.picked).length,
      running: !!view.makeCreative.runningRunId,
      discarded: view.discarded.length + view.discardedSets.length,
      runs: view.runs.length,
      costPence: view.totalCostPence,
    },
    toDecide,
    launchable: eligibility && !("refused" in eligibility) ? eligibility.ads.length : 0,
  };
}

const labels = (f: CampaignFacts) => Object.fromEntries(campaignStages(f).map((s) => [s.id, s.label]));
const needIds = (f: CampaignFacts) => needsYou(f).map((n) => n.id);
const unseenIn = async (launch: string) => Number((await getSql()`select count(*)::int as n from public.performance_alerts where launch_id = ${launch} and seen_at is null`)[0].n);

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  brandA = await brandFor(a, "fernhollow-stages");
  await productsFor(a, brandA, FERNHOLLOW.products.slice(0, 3).map((p) => ({ name: p.name, pricePence: p.pricePence })));

  ids.writing = await writing(a, "A brief the Brief agent is still writing", "running");
  ids.notWritten = await writing(a, "A brief the Brief agent never wrote", "failed");
  ids.draft = await draft(a, "A draft nobody has sent for sign-off");
  ids.waiting = await waiting(a, "A draft waiting for sign-off, with its personas and test plan");
  await reviewsFor(a, ids.waiting, 3);
  ids.signedOff = await campaignFor(a, brandA, "signed off", "Signed off with nothing made yet");
  ids.edited = await campaignFor(a, brandA, "edited", "Signed off, then edited to version 2");

  // The journey: signed off, two ads (one picked, one then discarded); later accepted, launched, live, ended.
  ids.journey = await campaignFor(a, brandA, "signed off", "Bring walkers back for autumn, stage by stage");
  const mk = builder(a, brandA, ids.journey);
  const image = await mk.image("stages one");
  pickedAd = await mk.ad(image, await mk.words("Made for the long way round"), "card", true);
  discardedAd = await mk.ad(image, await mk.words("Kit for wet weekends"), "split", false);
  await discardVariant(a, discardedAd);
}, 300_000);

afterAll(closeSql);

describe("U10-2 campaignFacts() reads each campaign's stage facts", () => {
  it("#4 writing: version 0 with the Brief agent's run; a run that failed reads as not written", async () => {
    const f = await factsOf(ids.writing);
    expect(f).toMatchObject({ campaignId: ids.writing, status: "drafting", currentVersion: 0, approvedVersion: null, briefRun: "running", signoffOpen: null, versions: 0, launches: [], performance: null });
    expect(labels(f)).toMatchObject({ brief: "Writing the brief", audience: "After the brief", creative: "After sign-off" });
    expect(needIds(f)).toEqual([]);
    expect(campaignStatusLabel(f)).toBe("Writing the brief");

    const failed = await factsOf(ids.notWritten);
    expect(failed).toMatchObject({ currentVersion: 0, briefRun: "failed" });
    expect(labels(failed).brief).toBe("Not written");
  });

  it("#2 #4 a draft: its version, and Send for sign-off is what needs you", async () => {
    const f = await factsOf(ids.draft);
    expect(f).toMatchObject({ status: "draft", currentVersion: 1, approvedVersion: null, signoffOpen: null, versions: 1 });
    expect(f.audience).toEqual({ personas: 0, testPlan: false, running: false });
    expect(labels(f)).toEqual({ brief: "Draft", audience: "Not run yet", creative: "After sign-off", launch: "No ads ready", performance: "After launch" });
    expect(needsYou(f)).toEqual([{ id: "send-signoff", text: "Send version 1 for sign-off", href: `/campaigns/${ids.draft}/brief` }]);
  });

  it("#2 #4 waiting for sign-off: the open sign-off's version, and its personas and test plan", async () => {
    const f = await factsOf(ids.waiting);
    expect(f).toMatchObject({ status: "awaiting_signoff", currentVersion: 1, signoffOpen: 1 });
    expect(f.audience).toEqual({ personas: 3, testPlan: true, running: false });
    expect(labels(f)).toMatchObject({ brief: "Waiting for sign-off", audience: "3 personas, test plan" });
    expect(needIds(f)).toEqual(["decide-signoff"]);
  });

  it("#4 #8 signed off with nothing made: Creative open with no ads, Launch and Performance locked", async () => {
    const f = await factsOf(ids.signedOff);
    expect(f).toMatchObject({ status: "approved", approvedVersion: 1, currentVersion: 1, signoffOpen: null, toDecide: 0, launchable: 0, launches: [], performance: null });
    expect(f.creative).toEqual((await creativeNow(ids.signedOff)).creative);
    expect(f.creative).toMatchObject({ ads: 0, picked: 0, discarded: 0 });
    expect(labels(f)).toMatchObject({ brief: "Signed off", creative: "No ads yet", launch: "No ads ready", performance: "After launch" });
    expect(campaignStages(f).filter((s) => s.locked).map((s) => s.id)).toEqual(["launch", "performance"]);
    expect(needIds(f)).toEqual([]);
  });

  it("#8 edited after sign-off: a draft again, so Creative is locked, and its version is the one to send", async () => {
    const f = await factsOf(ids.edited);
    expect(f).toMatchObject({ status: "draft", currentVersion: 2, approvedVersion: 1, versions: 2 });
    expect(campaignStages(f).find((s) => s.id === "creative")!.locked).not.toBeNull();
    expect(needsYou(f)).toEqual([{ id: "send-signoff", text: "Send version 2 for sign-off", href: `/campaigns/${ids.edited}/brief` }]);
  });

  it("#2 #4 ads picked with compliance waiting: the counts as the gallery has them, and the decision is what needs you", async () => {
    const f = await factsOf(ids.journey);
    const now = await creativeNow(ids.journey);
    expect({ creative: f.creative, toDecide: f.toDecide, launchable: f.launchable }).toEqual(now);
    // By construction: one current ad, picked, with the brand's don't rules still to decide; one discarded.
    expect(f.creative).toMatchObject({ ads: 1, picked: 1, discarded: 1 });
    expect(f.toDecide).toBe(1);
    expect(f.launchable).toBe(0);
    expect(labels(f)).toMatchObject({ creative: "1 ad, 1 picked", launch: "No ads ready" });
    expect(needsYou(f)).toEqual([{ id: "compliance", text: "Decide compliance for 1 picked ad", href: `/campaigns/${ids.journey}/creative?show=decide` }]);
  });

  it("#2 deciding compliance removes the need, and the accepted ad is ready to launch", async () => {
    await acceptReviews(a, pickedAd);
    const f = await factsOf(ids.journey);
    expect({ creative: f.creative, toDecide: f.toDecide, launchable: f.launchable }).toEqual(await creativeNow(ids.journey));
    expect(f.toDecide).toBe(0);
    expect(f.launchable).toBe(1);
    expect(labels(f).launch).toBe("1 ad ready");
    expect(needIds(f)).toEqual([]);
  });

  it("#2 #4 a launch waiting for approval: approving it is what needs you", async () => {
    ({ launchId } = await rawLaunch(a, ids.journey, [pickedAd], { status: "awaiting_approval", kpi_measure: "ctr", kpi_value: 50 }));
    const f = await factsOf(ids.journey);
    expect(f.launches).toEqual([{ status: "awaiting_approval", simDay: 0, days: 30 }]);
    expect(f.performance).toBeNull();
    expect(labels(f)).toMatchObject({ launch: "Waiting for approval", performance: "After launch" });
    expect(needsYou(f)).toEqual([{ id: "approve-launch", text: "Approve or refuse the launch (simulated)", href: "/approvals" }]);
    // Cleared as the tables' owner (the app can't delete a launch), so the next test launches it live.
    await getSql()`delete from public.launches where id = ${launchId}`;
    await getSql()`delete from public.approvals where kind = 'launch' and campaign_id = ${ids.journey}`;
    expect(needIds(await factsOf(ids.journey))).toEqual([]);
  });

  it("#1 #2 #4 live on simulated day 14: the day, the unseen alerts and the ads below the threshold, as the Performance page has them", async () => {
    // A click-through rate of 50% is out of any ad's reach, so once learning is over the ad is below it and alerted.
    ({ launchId } = await rawLaunch(a, ids.journey, [pickedAd], { kpi_measure: "ctr", kpi_value: 50 }));
    await advance(a, launchId, 7, 0);
    await advance(a, launchId, 7, 7);
    const f = await factsOf(ids.journey);
    expect(f.launches).toEqual([{ status: "live", simDay: 14, days: 30 }]);
    const perf = (await performanceFor(a.userId, ids.journey))!;
    const below = perf.latest!.ads.filter((x) => x.status === "below_threshold").map((x) => perf.ads.find((ad) => ad.variantId === x.variantId)!.adNumber);
    expect(below).toHaveLength(1);
    const unseen = await unseenIn(launchId);
    expect(unseen).toBeGreaterThan(0);
    expect(f.performance).toEqual({ unseenAlerts: unseen, belowThreshold: below });
    expect(campaignStatusLabel(f)).toBe("Live (simulated day 14)");
    expect(labels(f)).toMatchObject({ launch: "Live (simulated day 14)", performance: `${unseen} new alert${unseen === 1 ? "" : "s"}` });
    expect(needIds(f)).toEqual(["alerts", "clock"]);
    expect(needsYou(f)[0]).toEqual({ id: "alerts", text: `${unseen} unseen alert${unseen === 1 ? "" : "s"} (simulated)`, href: `/campaigns/${ids.journey}/performance` });
  }, 120_000);

  it("#2 marking alerts seen counts down, and the last one removes the need", async () => {
    const alerts = (await listAlerts(a.userId, ids.journey))!.filter((x) => !x.seenAt);
    expect(alerts.length).toBeGreaterThan(0);
    await markAlertSeen(a, alerts[0].id);
    expect((await factsOf(ids.journey)).performance!.unseenAlerts).toBe(alerts.length - 1);
    for (const x of alerts.slice(1)) await markAlertSeen(a, x.id);
    const f = await factsOf(ids.journey);
    expect(f.performance!.unseenAlerts).toBe(0);
    expect(labels(f).performance).toBe("No new alerts");
    expect(needIds(f)).toEqual(["clock"]);
  });

  it("#3 #4 ended: nothing needs you", async () => {
    await endLaunch(a, launchId);
    const f = await factsOf(ids.journey);
    expect(f.launches).toEqual([{ status: "ended", simDay: 14, days: 30 }]);
    expect(campaignStatusLabel(f)).toBe("Ended");
    expect(labels(f)).toMatchObject({ launch: "Ended", performance: "No new alerts" });
    expect(campaignStages(f).filter((s) => s.locked)).toEqual([]);
    expect(needsYou(f)).toEqual([]);
  });

  it("#7 rule 7: another workspace gets nothing for any of these campaigns, and a malformed or missing id is the same", async () => {
    for (const [key, id] of Object.entries(ids)) expect(await campaignFacts(b.userId, id), key).toBeNull();
    for (const id of ["not-a-uuid", "", "11111111-1111-4111-8111-111111111111", `${ids.journey}' or '1'='1`]) expect(await campaignFacts(a.userId, id), id).toBeNull();
    // B's own campaign reads as its own, with none of A's launches or alerts.
    const brandB = await brandFor(b, "fernhollow-stages-b");
    const own = await campaignFor(b, brandB, "signed off", "Workspace B's signed-off campaign");
    const f = await factsOf(own, b);
    expect(f).toMatchObject({ campaignId: own, status: "approved", launches: [], performance: null, toDecide: 0, launchable: 0 });
    expect(f.creative).toMatchObject({ ads: 0, picked: 0, discarded: 0, runs: 0 });
  });
});
