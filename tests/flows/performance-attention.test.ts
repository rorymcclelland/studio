// U10-4 Performance: what needs action first. Case 4's Mark all as seen
// against the real database, through the alerts store and the server action
// (the session is the only thing mocked; nothing here calls a model): it marks
// every unseen alert of the launch the Performance page shows, and only those,
// records who and when, leaves alerts already seen as they were, lowers the
// home count by exactly those, is one guarded statement (two at once mark
// nothing twice), and another workspace, a missing or a malformed campaign get
// the same refusal (rule 7). U10-4 adds no table: it reads and writes
// performance_alerts (P9-4) through asUser(). The alerts are written straight
// to the database as the table's owner, as the monitor would store them, so no
// clock has to move. This is outside tests/db, as every Sprint 10 flow is (CI's
// Neon job runs tests/db from a US runner). The pure parts are
// tests/lib/performance-attention.test.ts; the page is
// tests/e2e/performance-attention.spec.ts, whose header holds the interface.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ member: null as null | { id: string; email: string; userId: string; workspaceId: string } }));
vi.mock("@/lib/auth/session", () => ({
  requireMember: async () => {
    if (!session.member) throw new Error("No one is signed in for this test");
    return session.member;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));
vi.mock("@/inngest/client", () => ({ inngest: {}, sendEvent: async () => {} }));

import { markAllAlertsAsSeen } from "@/app/(app)/campaigns/[id]/performance/actions";
import { closeSql, getSql } from "@/lib/db/client";
import { ALERT_CAMPAIGN_NOT_FOUND, AlertError, listAlerts, markAllAlertsSeen, unseenAlertCount } from "@/lib/performance/alerts-store";
import { markedAllLine } from "@/lib/performance/attention";
import { createMember, createUser, truncateAll } from "../helpers/db";
import { brandFor, builder, campaignFor, rawLaunch, type Member } from "../helpers/launch";

type Kind = "below_threshold" | "tiring" | "not_compliant";

let a: Member;
let b: Member;
/** A second member of A's workspace, so "who" is not simply the campaign's maker. */
let c: Member;
let emails: Record<"a" | "b" | "c", string>;

let ids: {
  /** A's campaign: an earlier launch, ended, and the live one the Performance page shows. */
  main: string;
  mainAds: string[];
  mainEnded: string;
  mainLive: string;
  /** A's other campaign, live. */
  other: string;
  otherLive: string;
  /** A's campaign whose only launch has ended. */
  endedOnly: string;
  endedOnlyLaunch: string;
  /** A's campaign with no launch. */
  noLaunch: string;
  /** B's campaign, live. */
  theirs: string;
  theirLive: string;
};
let launchAd: Record<string, string>;

/** Long ago, so a "who and when" kept from before is told apart from one set by the test. */
const EARLIER = new Date("2026-11-01T09:00:00Z");

/** The fixture's alerts, as the monitor stores them (keyed by a name the tests use). */
let alertIds: Record<string, string>;

async function insertAlert(m: Member, launchId: string, variantId: string, kind: Kind, day: number, seenBy: string | null = null): Promise<string> {
  const facts = kind === "not_compliant" ? { reason: "Fails: banned term 'Dry' in English." } : { note: "A fixture alert for U10-4; no clock moved." };
  const [r] = await getSql()`
    insert into public.performance_alerts (workspace_id, launch_id, variant_id, kind, day, facts, seen_by, seen_at)
    values (${m.workspaceId}, ${launchId}, ${variantId}, ${kind}, ${day}, ${getSql().json(facts)}, ${seenBy}, ${seenBy ? EARLIER : null})
    returning id`;
  return r.id as string;
}

/** Every alert's who and when, by the fixture's names. */
async function seenState(): Promise<Record<string, { seenBy: string | null; seenAt: Date | null }>> {
  const rows = await getSql()`select id, seen_by, seen_at from public.performance_alerts`;
  const byId = new Map(rows.map((r) => [r.id as string, { seenBy: (r.seen_by as string | null) ?? null, seenAt: (r.seen_at as Date | null) ?? null }]));
  return Object.fromEntries(Object.entries(alertIds).map(([name, id]) => [name, byId.get(id)!]));
}

function signedInAs(m: Member, email: string) {
  session.member = { id: m.userId, email, userId: m.userId, workspaceId: m.workspaceId };
}

const countOf = async (table: string) => Number((await getSql()`select count(*)::int as n from ${getSql()(table)}`)[0].n);

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  const cUser = await createUser();
  await getSql()`insert into public.workspace_members (workspace_id, user_id) values (${a.workspaceId}, ${cUser})`;
  c = { userId: cUser, workspaceId: a.workspaceId };
  const email = async (m: Member) => (await getSql()`select email from auth.users where id = ${m.userId}`)[0].email as string;
  emails = { a: await email(a), b: await email(b), c: await email(c) };

  const brandA = await brandFor(a, "fernhollow");
  const main = await campaignFor(a, brandA, "signed off", "Bring walkers back for autumn, what needs action first");
  const mk = builder(a, brandA, main);
  const image = await mk.image("attention main");
  const mainAds = [await mk.ad(image, await mk.words("Made for the long way round"), "card", true), await mk.ad(image, await mk.words("Dry on the high ground"), "split", true)];
  const { launchId: mainEnded } = await rawLaunch(a, main, [mainAds[0]], { status: "ended" });
  const { launchId: mainLive } = await rawLaunch(a, main, mainAds);

  const other = await campaignFor(a, brandA, "signed off", "Another live campaign in the same workspace");
  const ok = builder(a, brandA, other);
  const otherAd = await ok.ad(await ok.image("attention other"), await ok.words("Mended, not replaced"), "card", true);
  const { launchId: otherLive } = await rawLaunch(a, other, [otherAd]);

  const endedOnly = await campaignFor(a, brandA, "signed off", "A campaign whose launch has ended");
  const ke = builder(a, brandA, endedOnly);
  const endedAd = await ke.ad(await ke.image("attention ended"), await ke.words("Built for wet weekends"), "card", true);
  const { launchId: endedOnlyLaunch } = await rawLaunch(a, endedOnly, [endedAd], { status: "ended" });

  const noLaunch = await campaignFor(a, brandA, "signed off", "A campaign never launched");

  const brandB = await brandFor(b, "fernhollow");
  const theirs = await campaignFor(b, brandB, "signed off", "Their own campaign");
  const kb = builder(b, brandB, theirs);
  const theirAd = await kb.ad(await kb.image("attention theirs"), await kb.words("Their own headline"), "card", true);
  const { launchId: theirLive } = await rawLaunch(b, theirs, [theirAd]);

  ids = { main, mainAds, mainEnded, mainLive, other, otherLive, endedOnly, endedOnlyLaunch, noLaunch, theirs, theirLive };
  launchAd = { otherAd, endedAd, theirAd };
}, 300_000);

beforeEach(async () => {
  session.member = null;
  // An alert can only be marked as seen, once (performance_alerts_guard), so each test starts from fresh alerts,
  // cleared and written as the table's owner.
  await getSql()`delete from public.performance_alerts`;
  const [m1, m2] = ids.mainAds;
  alertIds = {
    // The ended launch of the same campaign: another launch, so never marked from the live one's page.
    mainEndedBelow: await insertAlert(a, ids.mainEnded, m1, "below_threshold", 5),
    // The live launch the Performance page shows: two unseen, one seen by A two weeks ago.
    mainBelow: await insertAlert(a, ids.mainLive, m1, "below_threshold", 6),
    mainTiring: await insertAlert(a, ids.mainLive, m1, "tiring", 9),
    mainSeen: await insertAlert(a, ids.mainLive, m2, "below_threshold", 8, a.userId),
    // A's other live campaign, A's ended-only campaign, and B's live campaign.
    otherTiring: await insertAlert(a, ids.otherLive, launchAd.otherAd, "tiring", 7),
    endedBelow: await insertAlert(a, ids.endedOnlyLaunch, launchAd.endedAd, "below_threshold", 4),
    theirBelow: await insertAlert(b, ids.theirLive, launchAd.theirAd, "below_threshold", 5),
  };
});
afterAll(closeSql);

describe("U10-4 #4 Mark all as seen", () => {
  it("U10-4 #4 Mark all as seen marks every unseen alert of the launch the Performance page shows, records who, and leaves every other launch's alerts as they were", async () => {
    const before = await seenState();
    const started = Date.now();
    expect(await markAllAlertsSeen(c, ids.main)).toBe(2);
    const after = await seenState();
    // This launch's two unseen alerts: seen by C, now.
    for (const name of ["mainBelow", "mainTiring"]) {
      expect(after[name].seenBy, name).toBe(c.userId);
      expect(after[name].seenAt!.getTime(), name).toBeGreaterThanOrEqual(started - 5_000);
    }
    // The one A had already seen keeps A and its time.
    expect(after.mainSeen).toEqual({ seenBy: a.userId, seenAt: EARLIER });
    // The same campaign's ended launch, A's other campaigns and B's: as they were.
    for (const name of ["mainEndedBelow", "otherTiring", "endedBelow", "theirBelow"]) expect(after[name], name).toEqual(before[name]);
    // The Performance page's list reads them as seen, by C's email.
    const list = (await listAlerts(a.userId, ids.main))!;
    expect(list.map((x) => x.id).sort()).toEqual([alertIds.mainBelow, alertIds.mainTiring, alertIds.mainSeen].sort());
    expect(list.filter((x) => x.seenAt === null)).toEqual([]);
    expect(list.find((x) => x.id === alertIds.mainTiring)).toMatchObject({ seenBy: c.userId, seenByName: emails.c });
  });

  it("#4 the home count goes down by exactly the alerts marked; another workspace's count is its own", async () => {
    // Unseen alerts on live launches: the main campaign's two and the other campaign's one (ended launches don't count).
    expect(await unseenAlertCount(a.userId)).toBe(3);
    expect(await unseenAlertCount(b.userId)).toBe(1);
    await markAllAlertsSeen(a, ids.main);
    expect(await unseenAlertCount(a.userId)).toBe(1);
    expect(await unseenAlertCount(c.userId)).toBe(1);
    expect(await unseenAlertCount(b.userId)).toBe(1);
  });

  it("#4 one guarded statement: two at once, or again, mark nothing twice and keep the first who and when", async () => {
    const counts = await Promise.all([markAllAlertsSeen(a, ids.main), markAllAlertsSeen(c, ids.main)]);
    expect(counts[0] + counts[1]).toBe(2);
    const first = await seenState();
    for (const name of ["mainBelow", "mainTiring"]) expect([a.userId, c.userId], name).toContain(first[name].seenBy);
    // Again: nothing left to mark, and nothing changes.
    expect(await markAllAlertsSeen(c, ids.main)).toBe(0);
    expect(await seenState()).toEqual(first);
  });

  it("#4 another workspace is refused: B can't mark A's alerts, and a missing or malformed campaign is the same refusal", async () => {
    const before = await seenState();
    for (const campaignId of [ids.main, ids.other, randomUUID(), "not-an-id"]) {
      await expect(markAllAlertsSeen(b, campaignId), campaignId).rejects.toThrow(new AlertError(ALERT_CAMPAIGN_NOT_FOUND));
    }
    expect(ALERT_CAMPAIGN_NOT_FOUND).toBe("That campaign isn't in your workspace.");
    expect(await seenState()).toEqual(before);
    // B's own campaign: B's one alert, and nothing of A's.
    expect(await markAllAlertsSeen(b, ids.theirs)).toBe(1);
    const after = await seenState();
    expect(after.theirBelow.seenBy).toBe(b.userId);
    for (const name of Object.keys(before).filter((n) => n !== "theirBelow")) expect(after[name], name).toEqual(before[name]);
  });

  it("#4 a campaign whose launch has ended marks that launch's alerts; a campaign with no launch has nothing to mark", async () => {
    expect(await markAllAlertsSeen(a, ids.endedOnly)).toBe(1);
    expect((await seenState()).endedBelow.seenBy).toBe(a.userId);
    expect(await markAllAlertsSeen(a, ids.noLaunch)).toBe(0);
  });

  it("#4 the server action says how many were marked, or refuses another workspace's campaign", async () => {
    signedInAs(a, emails.a);
    expect(await markAllAlertsAsSeen(ids.main)).toEqual({ done: markedAllLine(2) });
    expect(markedAllLine(2)).toBe("Marked 2 alerts as seen.");
    expect(await markAllAlertsAsSeen(ids.main)).toEqual({ done: "No unseen alerts to mark." });
    signedInAs(b, emails.b);
    expect(await markAllAlertsAsSeen(ids.other)).toEqual({ error: ALERT_CAMPAIGN_NOT_FOUND });
    expect(await markAllAlertsAsSeen("not-an-id")).toEqual({ error: ALERT_CAMPAIGN_NOT_FOUND });
    expect((await seenState()).otherTiring.seenBy).toBeNull();
  });

  it("rule 3: Mark all as seen changes only who saw the alerts and when: no approval, run or spend, and the launch is as it was", async () => {
    const launch = () => getSql()`select ads, daily_budget_pence, days, kpi_measure, kpi_value::text as kpi_value, status, sim_day from public.launches where id = ${ids.mainLive}`;
    const alerts = () => getSql()`select id, launch_id, variant_id, kind, day, facts from public.performance_alerts order by id`;
    const counts = async () => ({ approvals: await countOf("public.approvals"), runs: await countOf("public.agent_runs"), ledger: await countOf("public.usage_ledger") });
    const before = { launch: await launch(), alerts: await alerts(), counts: await counts() };
    await markAllAlertsSeen(a, ids.main);
    expect({ launch: await launch(), alerts: await alerts(), counts: await counts() }).toEqual(before);
  });
});
