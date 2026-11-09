// U10-5 Home leads with work, against the real database: what home's "Needs
// you" lists (homeNeedsFor in src/lib/home/work.ts: the approvals the inbox
// would list and the unseen alerts per live campaign, each linked to its
// place), the live campaigns with their own share (homeHealth's `live`), and
// each run's campaign (listRuns), all read through asUser(): another
// workspace's approvals, alerts, campaigns and runs never appear, and a run
// that names another workspace's campaign names none (rule 7). U10-5 adds no
// table. Rows are written as the app leaves them, straight to the database as
// the tables' owner where the app has no way to (alerts, a question's run, a
// run waiting for a choice); the clock is moved with the app's own advance()
// for the one share that needs simulated days.
//
// Outside tests/db, as every Sprint 10 flow is (CI's Neon job runs tests/db
// from a US runner). The pure parts are tests/lib/home-work.test.ts; the pages
// are tests/e2e/home-work.spec.ts, whose header holds the interface.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));

import { listRuns } from "@/lib/agents/runs";
import { listInbox } from "@/lib/approvals/repo";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { homeNeedsFor } from "@/lib/home/work";
import { unseenAlertCount } from "@/lib/performance/alerts-store";
import { advance } from "@/lib/performance/clock";
import { homeHealth, performanceFor } from "@/lib/performance/dashboard";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, brief, builder, productsFor, rawLaunch, type Member } from "../helpers/launch";

const FAKE_AD = "a1111111-1111-4111-8111-111111111111";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

let a: Member;
let b: Member;
/** A member of a workspace with nothing in it. */
let empty: Member;
let brandA = "";

const names = {
  waiting: "Home: waiting for sign-off",
  expired: "Home: a sign-off nobody decided in time",
  launchWaiting: "Home: launch waiting",
  liveA: "Home: live with two unseen alerts",
  liveB: "Home: live with one unseen alert",
  ended: "Home: ended, with an unseen alert",
  advanced: "Home: live and moved on a week",
  theirs: "Theirs: B's own live campaign",
};
const writingObjective = "A brief the Brief agent is still writing, named by its objective";

const ids: Record<string, string> = {};
const approvals: Record<string, string> = {};
const launches: Record<string, string> = {};
const runs: Record<string, string> = {};

/** A campaign with version 1 titled `title`, signed off or waiting for sign-off. */
async function campaignTitled(m: Member, brandId: string, title: string, state: "signed off" | "draft"): Promise<string> {
  return asUser(m.userId, async (tx) => {
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${brandId}, ${`${title}: bring walkers back for autumn`}, ${m.userId}, 1) returning id`;
    await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief(title))}, 'agent', ${m.userId})`;
    if (state === "signed off") await tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
    else await tx`update public.campaigns set status = 'draft' where id = ${c.id}`;
    return c.id as string;
  });
}

/** A sign-off of version 1, asked `askedAt`, closing at `expiresAt`, as requestSignoff leaves it. */
async function signoff(m: Member, campaignId: string, title: string, askedAt: Date, expiresAt: Date): Promise<string> {
  await getSql()`update public.campaigns set status = 'awaiting_signoff' where id = ${campaignId}`;
  const [r] = await getSql()`
    insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at, created_at)
    values (${m.workspaceId}, 'brief_signoff', ${campaignId}, 1, ${`Sign off version 1: ${title}`}, '[]'::jsonb, ${expiresAt}, ${askedAt}) returning id`;
  return r.id as string;
}

async function insertRun(m: Member, agent: string, input: Record<string, unknown>, label: string, status = "completed", at = new Date()): Promise<string> {
  const [r] = await getSql()`
    insert into public.agent_runs (workspace_id, agent, agent_version, status, input, created_by, label, created_at)
    values (${m.workspaceId}, ${agent}, 1, ${status}, ${getSql().json(input as never)}, ${m.userId}, ${label}, ${at}) returning id`;
  return r.id as string;
}

/** A run's choice waiting in the inbox (the tagline demo's), for a run in `status`. */
async function runChoice(m: Member, runId: string): Promise<string> {
  const [r] = await getSql()`
    insert into public.approvals (workspace_id, kind, run_id, question, options, expires_at)
    values (${m.workspaceId}, 'run_choice', ${runId}, 'Which tagline should we use?', ${getSql().json(["One", "Two", "Three"])}, now() + interval '1 day') returning id`;
  return r.id as string;
}

async function insertAlert(m: Member, launchId: string, variantId: string, kind: "below_threshold" | "tiring" | "not_compliant", day: number, at: Date, seenBy: string | null = null) {
  await getSql()`
    insert into public.performance_alerts (workspace_id, launch_id, variant_id, kind, day, facts, seen_by, seen_at, created_at)
    values (${m.workspaceId}, ${launchId}, ${variantId}, ${kind}, ${day}, ${getSql().json({ note: "A fixture alert for U10-5." })}, ${seenBy}, ${seenBy ? at : null}, ${at})`;
}

/** Two picked ads on a campaign, as Make creative records them. */
async function adsFor(m: Member, brandId: string, campaignId: string, n: number): Promise<string[]> {
  const mk = builder(m, brandId, campaignId);
  const image = await mk.image(`home ${campaignId.slice(0, 8)}`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(await mk.ad(image, await mk.words(`Headline ${i + 1} for home`), i % 2 ? "split" : "card", true));
  return out;
}

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  empty = await createMember();
  brandA = await brandFor(a, "fernhollow-home");
  await productsFor(a, brandA, FERNHOLLOW.products.slice(0, 3).map((p) => ({ name: p.name, pricePence: p.pricePence })));

  // Approvals, oldest first: an expired sign-off, the open sign-off, a launch, then two run choices.
  ids.expired = await campaignTitled(a, brandA, names.expired, "draft");
  approvals.expired = await signoff(a, ids.expired, names.expired, minutesAgo(90), minutesAgo(1));
  ids.waiting = await campaignTitled(a, brandA, names.waiting, "draft");
  approvals.signoff = await signoff(a, ids.waiting, names.waiting, minutesAgo(30), new Date(Date.now() + 7 * 86_400_000));
  ids.launchWaiting = await campaignTitled(a, brandA, names.launchWaiting, "signed off");
  ({ launchId: launches.waiting, approvalId: approvals.launch } = await rawLaunch(a, ids.launchWaiting, [FAKE_AD], { status: "awaiting_approval" }));
  // A choice whose run has finished is no longer waiting; the tagline run waiting for its choice is.
  runs.finishedTagline = await insertRun(a, "tagline", { brandName: "Larkspur Mill" }, "Larkspur Mill", "completed", minutesAgo(15));
  approvals.staleChoice = await runChoice(a, runs.finishedTagline);
  runs.tagline = await insertRun(a, "tagline", { brandName: "Larkspur Mill" }, "Larkspur Mill", "awaiting_approval", minutesAgo(1));
  approvals.choice = await runChoice(a, runs.tagline);

  // Live and ended launches with alerts at known times.
  ids.liveA = await campaignTitled(a, brandA, names.liveA, "signed off");
  const adsA = await adsFor(a, brandA, ids.liveA, 2);
  ({ launchId: launches.liveA } = await rawLaunch(a, ids.liveA, adsA));
  await insertAlert(a, launches.liveA, adsA[0], "below_threshold", 6, minutesAgo(12));
  await insertAlert(a, launches.liveA, adsA[0], "tiring", 9, minutesAgo(10));
  await insertAlert(a, launches.liveA, adsA[1], "below_threshold", 4, minutesAgo(14), a.userId);
  ids.liveB = await campaignTitled(a, brandA, names.liveB, "signed off");
  const [adB] = await adsFor(a, brandA, ids.liveB, 1);
  ({ launchId: launches.liveB } = await rawLaunch(a, ids.liveB, [adB]));
  await insertAlert(a, launches.liveB, adB, "below_threshold", 7, minutesAgo(5));
  ids.ended = await campaignTitled(a, brandA, names.ended, "signed off");
  const [adE] = await adsFor(a, brandA, ids.ended, 1);
  ({ launchId: launches.ended } = await rawLaunch(a, ids.ended, [adE], { status: "ended" }));
  await insertAlert(a, launches.ended, adE, "tiring", 8, minutesAgo(2));

  // Runs naming campaigns: by campaignId, by a question's launch, by a campaign still being written; and odd inputs.
  ids.writing = await asUser(a.userId, async (tx) => {
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by) values (${a.workspaceId}, ${brandA}, ${writingObjective}, ${a.userId}) returning id`;
    return c.id as string;
  });
  runs.brief = await insertRun(a, "brief", { mode: "draft", campaignId: ids.waiting }, "Brief");
  runs.writing = await insertRun(a, "brief", { mode: "draft", campaignId: ids.writing }, "Brief");
  const questionId = randomUUID();
  runs.ask = await insertRun(a, "monitorPlan", { questionId }, "Ask");
  await getSql()`insert into public.performance_questions (id, workspace_id, launch_id, question, run_id, created_by)
    values (${questionId}, ${a.workspaceId}, ${launches.liveA}, 'Which ad had the lowest cost per acquisition last week?', ${runs.ask}, ${a.userId})`;
  runs.malformed = await insertRun(a, "brief", { mode: "draft", campaignId: "not-a-uuid' or '1'='1" }, "Brief");
  runs.missing = await insertRun(a, "brief", { mode: "draft", campaignId: "11111111-1111-4111-8111-111111111111" }, "Brief");
  runs.market = await insertRun(a, "market", { brandId: brandA }, "Market notes");

  // Workspace B: its own live campaign with an unseen alert, a sign-off waiting, and a run that names A's campaign.
  const brandB = await brandFor(b, "fernhollow-home-b");
  ids.theirs = await campaignTitled(b, brandB, names.theirs, "signed off");
  const [adT] = await adsFor(b, brandB, ids.theirs, 1);
  ({ launchId: launches.theirs } = await rawLaunch(b, ids.theirs, [adT]));
  await insertAlert(b, launches.theirs, adT, "below_threshold", 6, minutesAgo(3));
  ids.theirWaiting = await campaignTitled(b, brandB, "Theirs: waiting for sign-off", "draft");
  approvals.theirs = await signoff(b, ids.theirWaiting, "Theirs: waiting for sign-off", minutesAgo(4), new Date(Date.now() + 7 * 86_400_000));
  runs.hostile = await insertRun(b, "brief", { mode: "draft", campaignId: ids.liveA }, "Brief");
}, 300_000);

afterAll(closeSql);

describe("U10-5 #1 homeNeedsFor() lists the approvals waiting and the unseen alerts per live campaign, each linked to its place", () => {
  it("the approvals the inbox lists, newest first, then each live campaign with unseen alerts, newest alert first", async () => {
    expect(await homeNeedsFor(a.userId)).toEqual([
      { key: `run-choice:${approvals.choice}`, kind: "run-choice", text: "Choose on the run: Larkspur Mill", href: `/runs/${runs.tagline}`, campaignId: null },
      { key: `approve-launch:${approvals.launch}`, kind: "approve-launch", text: `Approve or refuse the launch (simulated): ${names.launchWaiting}`, href: `/approvals#approval-${approvals.launch}`, campaignId: ids.launchWaiting },
      { key: `decide-signoff:${approvals.signoff}`, kind: "decide-signoff", text: `Decide the sign-off of version 1: ${names.waiting}`, href: `/campaigns/${ids.waiting}/brief`, campaignId: ids.waiting },
      { key: `alerts:${ids.liveB}`, kind: "alerts", text: `1 unseen alert (simulated): ${names.liveB}`, href: `/campaigns/${ids.liveB}/performance`, campaignId: ids.liveB },
      { key: `alerts:${ids.liveA}`, kind: "alerts", text: `2 unseen alerts (simulated): ${names.liveA}`, href: `/campaigns/${ids.liveA}/performance`, campaignId: ids.liveA },
    ]);
  });

  it("#1 only what waits: the approvals are the inbox's own, and the alerts add up to the home count", async () => {
    const needs = await homeNeedsFor(a.userId);
    const inbox = await listInbox(a.userId);
    expect(needs.filter((n) => n.kind !== "alerts").map((n) => n.key.split(":")[1])).toEqual(inbox.map((i) => i.id));
    // An expired sign-off, a choice whose run has finished and a decided launch are not there.
    for (const id of [approvals.expired, approvals.staleChoice]) expect(needs.some((n) => n.key.endsWith(id)), id).toBe(false);
    // The ended launch's alert doesn't count; a seen one doesn't either.
    expect(needs.some((n) => n.campaignId === ids.ended)).toBe(false);
    const counted = needs.filter((n) => n.kind === "alerts").reduce((sum, n) => sum + Number(/^(\d+) unseen/.exec(n.text)![1]), 0);
    expect(counted).toBe(await unseenAlertCount(a.userId));
  });
});

describe("U10-5 #2 nothing waiting: an empty list", () => {
  it("a workspace with nothing waiting has nothing that needs it, and nothing live", async () => {
    expect(await homeNeedsFor(empty.userId)).toEqual([]);
    expect(await homeHealth(empty.userId)).toBeNull();
    expect(await listRuns(empty.userId, 5)).toEqual([]);
  });
});

describe("U10-5 #3 the alerts item links to the campaign's Performance page", () => {
  it("each alerts item names its campaign and goes to its own Performance page, which shows those alerts", async () => {
    for (const n of (await homeNeedsFor(a.userId)).filter((x) => x.kind === "alerts")) {
      expect(n.href).toBe(`/campaigns/${n.campaignId}/performance`);
      const view = await performanceFor(a.userId, n.campaignId!);
      expect(view, n.key).not.toBeNull();
    }
  });
});

describe("U10-5 #4 listRuns() names each run's campaign", () => {
  it("by the campaign its input names, by its question's launch, or none; a campaign still being written by its objective", async () => {
    const byId = new Map((await listRuns(a.userId, 50)).map((r) => [r.id, r.campaign]));
    expect(byId.get(runs.brief)).toEqual({ id: ids.waiting, name: names.waiting });
    expect(byId.get(runs.writing)).toEqual({ id: ids.writing, name: writingObjective });
    expect(byId.get(runs.ask)).toEqual({ id: ids.liveA, name: names.liveA });
    for (const key of ["tagline", "finishedTagline", "market"]) expect(byId.get(runs[key]), key).toBeNull();
  });

  it("a malformed or missing campaign id names no campaign, and doesn't break the list", async () => {
    const byId = new Map((await listRuns(a.userId, 50)).map((r) => [r.id, r.campaign]));
    expect(byId.get(runs.malformed)).toBeNull();
    expect(byId.get(runs.missing)).toBeNull();
  });
});

describe("U10-5 live campaigns on home: each with its simulated day and its own share", () => {
  it("every live launch's campaign, in the order they launched, with the day and the share its Performance page shows", async () => {
    ids.advanced = await campaignTitled(a, brandA, names.advanced, "signed off");
    const ads = await adsFor(a, brandA, ids.advanced, 1);
    ({ launchId: launches.advanced } = await rawLaunch(a, ids.advanced, ads));
    await advance(a, launches.advanced, 7, 0);

    const health = (await homeHealth(a.userId))!;
    expect(health).not.toBeNull();
    expect(health.live.map((l) => l.campaignId)).toEqual([ids.liveA, ids.liveB, ids.advanced]);
    expect(health.live.map((l) => l.launchId)).toEqual([launches.liveA, launches.liveB, launches.advanced]);
    expect(health.live.map((l) => l.name)).toEqual([names.liveA, names.liveB, names.advanced]);
    expect(health.live.map((l) => [l.simDay, l.days])).toEqual([[0, 30], [0, 30], [7, 30]]);
    // Nothing simulated yet: nothing to judge. A week on: the share its own Performance page shows.
    expect(health.live[0].share).toBeNull();
    expect(health.live[1].share).toBeNull();
    const perf = (await performanceFor(a.userId, ids.advanced))!;
    expect(health.live[2].share).toBe(perf.latest!.share);
    // The pooled line still counts every live campaign.
    expect(health.campaigns).toBe(3);
  }, 120_000);
});

describe("U10-5 rule 7: another workspace sees none of A's approvals, alerts, live campaigns or runs", () => {
  it("B's home lists only B's own work; a run in B naming A's campaign names no campaign", async () => {
    expect(await homeNeedsFor(b.userId)).toEqual([
      { key: `decide-signoff:${approvals.theirs}`, kind: "decide-signoff", text: "Decide the sign-off of version 1: Theirs: waiting for sign-off", href: `/campaigns/${ids.theirWaiting}/brief`, campaignId: ids.theirWaiting },
      { key: `alerts:${ids.theirs}`, kind: "alerts", text: `1 unseen alert (simulated): ${names.theirs}`, href: `/campaigns/${ids.theirs}/performance`, campaignId: ids.theirs },
    ]);
    const health = (await homeHealth(b.userId))!;
    expect(health.live.map((l) => l.campaignId)).toEqual([ids.theirs]);
    const theirRuns = await listRuns(b.userId, 50);
    expect(theirRuns.map((r) => r.id)).toEqual([runs.hostile]);
    expect(theirRuns[0].campaign).toBeNull();
    // And A's lists hold nothing of B's.
    const mine = JSON.stringify([await homeNeedsFor(a.userId), (await homeHealth(a.userId))!.live, await listRuns(a.userId, 50)]);
    for (const id of [ids.theirs, ids.theirWaiting, approvals.theirs, runs.hostile]) expect(mine, id).not.toContain(id);
    expect(mine).not.toContain("Theirs:");
  });

  it("the empty workspace still sees nothing of A's or B's", async () => {
    expect(await homeNeedsFor(empty.userId)).toEqual([]);
    expect(await homeHealth(empty.userId)).toBeNull();
  });
});
