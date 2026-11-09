// U10-1 #3 and #4 (BUG-13) against the database: listCampaigns() reads, for
// each campaign, the facts campaignStatusLabel() needs (its status, version
// and every launch with its simulated day), on /campaigns and on the brand
// page alike, so each state's label comes out right from real rows. The pure
// function's words and precedence are tests/lib/campaign-status.test.ts; the
// browser test is tests/e2e/quick-fixes.spec.ts.
//
// Outside tests/db on purpose: building eight campaigns with launches is about
// a hundred statements, and CI's Neon job (tests/db from a US runner, about
// 100 ms a query) is for the database's own rules. Plain Postgres in CI's first
// job runs this. The database is real; nothing is mocked.
//
// The interface (also at the top of tests/e2e/quick-fixes.spec.ts):
// - CampaignSummary (src/lib/brief/repo.ts) gains `launches: { status: string; simDay: number }[]`
//   (every launch of the campaign, any order), and `status` widens to `string`,
//   so CampaignSummary satisfies CampaignStatusFacts (src/lib/campaigns/status.ts).
// - listCampaigns(userId, brandId?) fills it in the same query (no query per
//   campaign), through asUser() (rule 7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listCampaigns, type CampaignSummary } from "@/lib/brief/repo";
import { campaignStatusLabel } from "@/lib/campaigns/status";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, brief, campaignFor, rawLaunch, type Member } from "../helpers/launch";

// Launches only need their ads' ids here; the list never reads the ads.
const AD = ["a1111111-1111-4111-8111-111111111111"];

let a: Member;
let b: Member;
let brandA = "";
let otherBrandA = "";
const ids: Record<string, string> = {};

/** A campaign whose brief is still being written: no version yet. */
async function writing(m: Member, brandId: string, objective: string): Promise<string> {
  return asUser(m.userId, async (tx) => {
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by) values (${m.workspaceId}, ${brandId}, ${objective}, ${m.userId}) returning id`;
    return c.id as string;
  });
}

/** A brief at version 1 that nobody has sent for sign-off: status draft (the shared helper leaves it as inserted). */
async function draft(m: Member, brandId: string, objective: string): Promise<string> {
  const id = await campaignFor(m, brandId, "draft", objective);
  await asUser(m.userId, (tx) => tx`update public.campaigns set status = 'draft' where id = ${id}`);
  return id;
}

/** A draft at version 1 sent for sign-off, as requestSignoff leaves it: a pending sign-off approval and status awaiting_signoff. */
async function waiting(m: Member, brandId: string, objective: string): Promise<string> {
  const id = await draft(m, brandId, objective);
  await asUser(m.userId, async (tx) => {
    await tx`insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
      values (${m.workspaceId}, 'brief_signoff', ${id}, 1, ${`Sign off version 1: ${brief("Long way round 1").title}`}, '[]'::jsonb, now() + interval '7 days')`;
    await tx`update public.campaigns set status = 'awaiting_signoff' where id = ${id}`;
  });
  return id;
}

async function moveClock(m: Member, launchId: string, day: number) {
  await asUser(m.userId, (tx) => tx`update public.launches set sim_day = ${day} where id = ${launchId}`);
}

const labelsOf = (rows: CampaignSummary[]) => Object.fromEntries(rows.map((r) => [r.id, campaignStatusLabel(r)]));

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  brandA = await brandFor(a, "fernhollow-status");
  otherBrandA = await brandFor(a, "fernhollow-status-other");

  ids.writing = await writing(a, brandA, "A brief the Brief agent is still writing");
  ids.draft = await draft(a, brandA, "A draft nobody has sent for sign-off");
  ids.edited = await campaignFor(a, brandA, "edited", "Signed off, then edited to version 2");
  ids.waiting = await waiting(a, brandA, "A draft waiting for sign-off in the inbox");
  ids.signedOff = await campaignFor(a, brandA, "signed off", "Signed off and not launched yet");
  ids.refused = await campaignFor(a, brandA, "signed off", "Signed off, its only launch refused");
  await rawLaunch(a, ids.refused, AD, { status: "refused" });
  ids.launchWaiting = await campaignFor(a, brandA, "signed off", "Signed off, its launch waiting for approval");
  await rawLaunch(a, ids.launchWaiting, AD, { status: "awaiting_approval" });
  ids.live = await campaignFor(a, brandA, "signed off", "Signed off and live on simulated day 14");
  await moveClock(a, (await rawLaunch(a, ids.live, AD, { status: "live" })).launchId, 14);
  ids.liveDay0 = await campaignFor(a, brandA, "signed off", "Live, before its first simulated day");
  await rawLaunch(a, ids.liveDay0, AD, { status: "live" });
  ids.ended = await campaignFor(a, brandA, "signed off", "Signed off, launched and ended");
  await rawLaunch(a, ids.ended, AD, { status: "ended" });
  ids.endedThenAsked = await campaignFor(a, brandA, "signed off", "Ended once, and a new launch asked for");
  await rawLaunch(a, ids.endedThenAsked, AD, { status: "ended" });
  await rawLaunch(a, ids.endedThenAsked, AD, { status: "awaiting_approval" });
  // Another brand of the same workspace, for the brand page's list.
  ids.otherBrandLive = await campaignFor(a, otherBrandA, "signed off", "The other brand's live campaign");
  await moveClock(a, (await rawLaunch(a, ids.otherBrandLive, AD, { status: "live" })).launchId, 3);
}, 120_000);

afterAll(closeSql);

const EXPECTED: Record<string, string> = {
  writing: "Writing the brief",
  draft: "Draft",
  edited: "Draft",
  waiting: "Waiting for sign-off",
  signedOff: "Signed off",
  refused: "Signed off",
  launchWaiting: "Launch waiting",
  live: "Live (simulated day 14)",
  liveDay0: "Live (simulated, before day 1)",
  ended: "Ended",
  endedThenAsked: "Launch waiting",
  otherBrandLive: "Live (simulated day 3)",
};

describe("U10-1 #3 listCampaigns() reads each campaign's status facts", () => {
  it("#3 /campaigns: each state's label comes out right from the stored rows", async () => {
    const rows = await listCampaigns(a.userId);
    const labels = labelsOf(rows);
    for (const [key, id] of Object.entries(ids)) expect(labels[id], key).toBe(EXPECTED[key]);
    expect(rows).toHaveLength(Object.keys(ids).length);
  });

  it("#3 the brand page: the same labels, for that brand's campaigns only", async () => {
    const rows = await listCampaigns(a.userId, brandA);
    const labels = labelsOf(rows);
    expect(Object.keys(labels).sort()).toEqual(Object.entries(ids).filter(([k]) => k !== "otherBrandLive").map(([, id]) => id).sort());
    for (const [key, id] of Object.entries(ids)) if (key !== "otherBrandLive") expect(labels[id], key).toBe(EXPECTED[key]);
    expect(labelsOf(await listCampaigns(a.userId, otherBrandA))).toEqual({ [ids.otherBrandLive]: "Live (simulated day 3)" });
  });

  it("#3 each summary carries every launch of its campaign with its simulated day, refused ones included, and no other campaign's", async () => {
    const rows = await listCampaigns(a.userId);
    const by = (key: string) => rows.find((r) => r.id === ids[key])!;
    expect(by("signedOff").launches).toEqual([]);
    expect(by("refused").launches).toEqual([{ status: "refused", simDay: 0 }]);
    expect(by("live").launches).toEqual([{ status: "live", simDay: 14 }]);
    expect([...by("endedThenAsked").launches].sort((x, y) => x.status.localeCompare(y.status))).toEqual([
      { status: "awaiting_approval", simDay: 0 },
      { status: "ended", simDay: 0 },
    ]);
  });

  it("rule 7: another workspace lists none of these campaigns or their launches, and its own campaign shows its own status", async () => {
    expect(await listCampaigns(b.userId)).toEqual([]);
    expect(await listCampaigns(b.userId, brandA)).toEqual([]);
    const brandB = await brandFor(b, "fernhollow-status-b");
    const own = await campaignFor(b, brandB, "signed off", "Workspace B's signed-off campaign");
    const rows = await listCampaigns(b.userId);
    expect(rows.map((r) => r.id)).toEqual([own]);
    expect(rows[0].launches).toEqual([]);
    expect(campaignStatusLabel(rows[0])).toBe("Signed off");
  });
});
