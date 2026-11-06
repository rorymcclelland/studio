// P9-1 Launch a simulated campaign: what the database itself enforces on
// public.launches and the launch approvals, as the non-superuser owner role on
// Neon's Postgres 17 too (CI's Neon job runs tests/db). Test cases 4 (the check
// constraints), 5 (the unique indexes), 6 (the guard trigger, and the approval's
// kind and subject checks) and 8 (row-level security, grants and the composite
// foreign key).
//
// The fixtures are cheap on purpose: two campaigns written straight to the
// database and launches written with rawLaunch (tests/helpers/launch.ts), so
// each test runs in a few dozen queries and fits inside the Neon job's time
// allowed from a US runner. The ads in a launch are jsonb, not references, so no
// creative is made here. The app's flows (eligibility built on the pack, Ask to
// launch, approve, refuse, end, the server actions and hostile input through
// them) make hundreds of queries each and test the same SQL, so they are
// tests/flows/launch.test.ts, which runs on plain Postgres in CI's first job.
// The interface the builder follows is written at the top of that file.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser, type Tx } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";
import { setWaitingLaunchTerms } from "../e2e/launch-fixture";
import { brandFor, campaignFor, rawLaunch, SOCIAL, type Member } from "../helpers/launch";

let a: Member;
let b: Member;
let ids: { main: string; other: string };
/** Ads by id only: a launch's ads are jsonb, so these need no creative. */
const AD = randomUUID();
const OTHER_AD = randomUUID();

/** A launch written straight to the database as a member: waiting for approval unless `over` says otherwise. */
const raw = (m: Member, campaignId: string, over: Record<string, unknown> = {}) => rawLaunch(m, campaignId, [AD], { status: "awaiting_approval", ...over });

/** A launch's terms, read as the table's owner. */
async function terms(launchId: string) {
  const [l] = await getSql()`
    select status, ads, daily_budget_pence, days, to_char(starts_on, 'YYYY-MM-DD') as starts_on, kpi_measure, kpi_value::text as kpi_value, seed::text as seed
    from public.launches where id = ${launchId}`;
  return l;
}

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  const brand = await brandFor(a, "fernhollow");
  const main = await campaignFor(a, brand, "signed off", "Bring walkers back for autumn, launched in a simulation");
  const other = await campaignFor(a, brand, "signed off", "Another campaign of the same brand");
  ids = { main, other };
});

beforeEach(async () => {
  // Each test starts with no launches (as the table's owner: the app can't delete them).
  await getSql()`delete from public.launches`;
  await getSql()`delete from public.approvals where kind = 'launch'`;
});
afterAll(closeSql);

describe("P9-1 the launches table", () => {
  it("#4 the database refuses out-of-range launch settings with its check constraints, and allows the limits themselves", async () => {
    // Straight to the database: the action's limits are check constraints.
    for (const over of [
      { daily_budget_pence: 0 },
      { daily_budget_pence: 50_100 },
      { days: 0 },
      { days: 61 },
      { starts_on: "2025-12-31" },
      { starts_on: "2028-01-01" },
      { kpi_value: 0 },
      { kpi_measure: "ctr", kpi_value: 100.5 },
      { kpi_measure: "conversion_rate", kpi_value: 101 },
      { kpi_measure: "clicks" },
      { status: "paused" },
    ]) {
      await expect(raw(a, ids.main, over), JSON.stringify(over)).rejects.toMatchObject({ code: "23514" });
    }
    // The limits themselves are allowed.
    await expect(raw(a, ids.main, { daily_budget_pence: 50_000, days: 60, starts_on: "2027-12-31", kpi_measure: "ctr", kpi_value: 100 })).resolves.toMatchObject({ launchId: expect.any(String) });
  });

  it("#5 the database's unique indexes allow one open and one live launch per campaign; ended and refused ones don't count", async () => {
    // The database holds the line even without the app: one open and one live launch per campaign.
    await raw(a, ids.main, { status: "live" });
    await expect(raw(a, ids.main, { status: "live" })).rejects.toMatchObject({ code: "23505" });
    const open = await raw(a, ids.other);
    await expect(raw(a, ids.other)).rejects.toMatchObject({ code: "23505" });
    // Ended or refused launches don't count (each is asked for, then decided, so the open one is refused first).
    await asUser(a.userId, async (tx) => {
      await tx`update public.approvals set status = 'rejected', reason = 'Not now', decided_by = ${a.userId}, decided_at = now() where id = ${open.approvalId}`;
      await tx`update public.launches set status = 'refused' where id = ${open.launchId}`;
    });
    await raw(a, ids.other, { status: "ended" });
    await raw(a, ids.other, { status: "ended" });
    await raw(a, ids.other, { status: "refused" });
    await raw(a, ids.other);
  });

  it("#6 an approved launch's budget, ads and threshold can't be changed, even by an update straight to the database", async () => {
    // Review fix 4: nor, since then, while it waits for approval: a launch's terms are fixed once it is asked for.
    const { launchId, approvalId } = await raw(a, ids.main);
    const before = await terms(launchId);
    expect(before.status).toBe("awaiting_approval");

    const changes: [string, string][] = [
      ["ads", `'[]'::jsonb`],
      ["ads", `jsonb_build_array(jsonb_build_object('variantId', '${OTHER_AD}', 'sizes', jsonb_build_array('1080x1080'), 'langs', jsonb_build_array('en-GB')))`],
      ["daily_budget_pence", "10000"],
      ["days", "60"],
      ["starts_on", "'2027-01-01'"],
      ["kpi_measure", "'roas'"],
      ["kpi_value", "1"],
      ["seed", "seed + 1"],
    ];
    const guarded = /can't change once it is asked for/;
    const attempt = (run: (q: string) => Promise<unknown>, column: string, value: string) => run(`update public.launches set ${column} = ${value} where id = '${launchId}'`);
    for (const status of ["awaiting_approval", "live", "ended"] as const) {
      // Approved as decideLaunch approves it (the approval first), as the member.
      if (status === "live") {
        await asUser(a.userId, async (tx) => {
          await tx`update public.approvals set status = 'approved', decided_by = ${a.userId}, decided_at = now() where id = ${approvalId}`;
          await tx`update public.launches set status = 'live', approved_at = now() where id = ${launchId}`;
        });
      }
      // Ended as endLaunch ends it, as the member.
      if (status === "ended") await asUser(a.userId, (tx) => tx`update public.launches set status = 'ended', ended_by = ${a.userId}, ended_at = now() where id = ${launchId} and status = 'live'`);
      for (const [column, value] of changes) {
        // As the member, through row-level security, and as the table's owner: the trigger refuses both.
        await expect(asUser(a.userId, (tx) => attempt((q) => tx.unsafe(q), column, value)), `${status} ${column} as the member`).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(guarded) });
        await expect(attempt((q) => getSql().unsafe(q), column, value), `${status} ${column} as the owner`).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(guarded) });
      }
    }
    // Nothing changed but the status.
    const after = await terms(launchId);
    const kept = (l: typeof before) => ({ ads: l.ads, dailyBudgetPence: l.daily_budget_pence, days: l.days, startsOn: l.starts_on, kpiMeasure: l.kpi_measure, kpiValue: l.kpi_value, seed: l.seed });
    expect(after.status).toBe("ended");
    expect(kept(after)).toEqual(kept(before));

    // A refused launch is guarded too.
    const refused = await raw(a, ids.other, { status: "refused" });
    await expect(getSql()`update public.launches set daily_budget_pence = 6000 where id = ${refused.launchId}`).rejects.toMatchObject({ code: "42501" });

    // The launch's approval is decided, and approvals_guard keeps it so.
    await expect(getSql()`update public.approvals set reason = 'changed later' where id = ${approvalId}`).rejects.toThrow(/A decided approval cannot be changed/);
    await expect(getSql()`update public.approvals set campaign_id = ${ids.other} where id = ${approvalId}`).rejects.toThrow(/subject cannot be changed/);
    // A launch approval must be about a campaign, and nothing else; an unknown kind is refused.
    const approval = (kind: string, campaignId: string | null, briefVersion: number | null) =>
      asUser(a.userId, (tx) => tx`insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
        values (${a.workspaceId}, ${kind}, ${campaignId}, ${briefVersion}, 'x', '[]'::jsonb, now() + interval '1 day')`);
    await expect(approval("launch", null, null)).rejects.toMatchObject({ code: "23514" });
    await expect(approval("launch", ids.other, 1)).rejects.toMatchObject({ code: "23514" });
    await expect(approval("rocket", ids.other, null)).rejects.toMatchObject({ code: "23514" });
  });

  it("review fix: a launch is inserted waiting for approval, never already live, ended or refused, for any role", async () => {
    for (const status of ["live", "ended", "refused"]) {
      for (const as of ["member", "owner"] as const) {
        const insert = async () => {
          const { approvalId } = await raw(a, ids.main);
          // Only the decided row is offered: the waiting one made with the approval goes, so nothing else stands in the way.
          await getSql()`delete from public.launches where approval_id = ${approvalId}`;
          const values = (tx: Tx) => tx`
            insert into public.launches (workspace_id, campaign_id, ads, daily_budget_pence, days, starts_on, kpi_measure, kpi_value, seed, status, approval_id, created_by, approved_at, ended_at)
            values (${a.workspaceId}, ${ids.main}, ${tx.json([{ variantId: AD, sizes: SOCIAL, langs: ["en-GB"] }])}, 5000, 30, '2026-11-06', 'cpa', 20, 7, ${status}, ${approvalId}, ${a.userId},
                    ${status === "refused" ? null : new Date()}, ${status === "ended" ? new Date() : null})`;
          return as === "owner" ? values(getSql() as unknown as Tx) : asUser(a.userId, values);
        };
        await expect(insert(), `${status} as the ${as}`).rejects.toMatchObject({ code: "23514", message: "A launch is asked for first: it starts waiting for approval" });
        await getSql()`delete from public.approvals where kind = 'launch'`;
      }
    }
    expect(await getSql()`select id from public.launches`).toHaveLength(0);
  });

  it("review fix: a launch goes live only once its own launch approval is approved, for any role; refusing and ending need no more", async () => {
    const { launchId, approvalId } = await raw(a, ids.main);
    const goLive = (as: "member" | "owner") =>
      as === "owner"
        ? getSql()`update public.launches set status = 'live', approved_at = now() where id = ${launchId}`
        : asUser(a.userId, (tx) => tx`update public.launches set status = 'live', approved_at = now() where id = ${launchId}`);
    const refusedLive = { code: "42501", message: "A launch goes live only once its launch approval is approved" };
    // Pending: refused as the member and as the owner.
    await expect(goLive("member")).rejects.toMatchObject(refusedLive);
    await expect(goLive("owner")).rejects.toMatchObject(refusedLive);
    // Rejected or expired: still refused.
    for (const decided of ["rejected", "expired"]) {
      const other = await raw(a, ids.other);
      await getSql()`update public.approvals set status = ${decided}, decided_at = now() where id = ${other.approvalId}`;
      await expect(getSql()`update public.launches set status = 'live', approved_at = now() where id = ${other.launchId}`, decided).rejects.toMatchObject(refusedLive);
      await getSql()`update public.launches set status = 'refused' where id = ${other.launchId}`;
    }
    expect((await terms(launchId)).status).toBe("awaiting_approval");
    // Approved: it goes live, and ends.
    await asUser(a.userId, (tx) => tx`update public.approvals set status = 'approved', decided_by = ${a.userId}, decided_at = now() where id = ${approvalId}`);
    await goLive("member");
    expect((await terms(launchId)).status).toBe("live");
    await asUser(a.userId, (tx) => tx`update public.launches set status = 'ended', ended_by = ${a.userId}, ended_at = now() where id = ${launchId}`);
    expect((await terms(launchId)).status).toBe("ended");
  });

  it("review fix: the browser tests' fixture sets a waiting launch's seed and threshold only as the tables' owner, and the rule is back straight after", async () => {
    const { launchId, approvalId } = await raw(a, ids.main);
    await setWaitingLaunchTerms(getSql(), launchId, { seed: "8675309", kpi_measure: "ctr", kpi_value: 0.01 });
    expect(await terms(launchId)).toMatchObject({ status: "awaiting_approval", seed: "8675309", kpi_measure: "ctr", kpi_value: "0.01" });
    const [{ enabled }] = await getSql()`select tgenabled as enabled from pg_trigger where tgrelid = 'public.launches'::regclass and tgname = 'launches_terms'`;
    expect(enabled).toBe("O");
    await expect(getSql()`update public.launches set seed = 1 where id = ${launchId}`).rejects.toMatchObject({ code: "42501" });
    // The app's role can't switch the trigger off.
    await expect(asUser(a.userId, (tx) => tx`alter table public.launches disable trigger launches_terms`)).rejects.toMatchObject({ code: "42501" });
    // Not waiting: refused, nothing changed, and the trigger still on.
    await asUser(a.userId, async (tx) => {
      await tx`update public.approvals set status = 'approved', decided_by = ${a.userId}, decided_at = now() where id = ${approvalId}`;
      await tx`update public.launches set status = 'live', approved_at = now() where id = ${launchId}`;
    });
    await expect(setWaitingLaunchTerms(getSql(), launchId, { seed: 5 })).rejects.toThrow(/waiting for approval/);
    expect((await terms(launchId)).seed).toBe("8675309");
    const [{ enabled: after }] = await getSql()`select tgenabled as enabled from pg_trigger where tgrelid = 'public.launches'::regclass and tgname = 'launches_terms'`;
    expect(after).toBe("O");
  });

  it("#8 another workspace can't read, change or write a launch in the database: row-level security, the grants and the composite foreign key", async () => {
    const { launchId, approvalId } = await raw(a, ids.main, { status: "live" });

    // As B: no rows to read or change, and none can be written into A's workspace or about A's campaign.
    expect(await asUser(b.userId, (tx) => tx`select id from public.launches`)).toHaveLength(0);
    expect((await asUser(b.userId, (tx) => tx`update public.launches set status = 'ended' where id = ${launchId}`)).count).toBe(0);
    expect((await asUser(b.userId, (tx) => tx`update public.approvals set status = 'rejected' where id = ${approvalId}`)).count).toBe(0);
    const insertAs = (workspaceId: string) =>
      asUser(b.userId, (tx) => tx`
        insert into public.launches (workspace_id, campaign_id, ads, daily_budget_pence, days, starts_on, kpi_measure, kpi_value, seed, status, approval_id, created_by)
        values (${workspaceId}, ${ids.main}, ${tx.json([{ variantId: AD, sizes: SOCIAL, langs: ["en-GB"] }])}, 5000, 30, '2026-11-06', 'cpa', 20, 7, 'awaiting_approval', ${approvalId}, ${b.userId})`);
    await expect(insertAs(a.workspaceId)).rejects.toThrow(/row-level security/);
    await expect(insertAs(b.workspaceId)).rejects.toMatchObject({ code: "23503" });
    // Nobody deletes a launch through the app, and the anonymous role has no access at all.
    await expect(asUser(a.userId, (tx) => tx`delete from public.launches where id = ${launchId}`)).rejects.toThrow(/permission denied/);
    expect(await asAnon((tx) => tx`select has_table_privilege('anon', 'public.launches', 'select') as ok`)).toEqual([{ ok: false }]);
    // A's launch is as it was, and its approval still approved.
    expect(await asUser(a.userId, (tx) => tx`select l.id, l.status, l.ended_by, a.status as decision from public.launches l join public.approvals a on a.id = l.approval_id`)).toEqual([
      { id: launchId, status: "live", ended_by: null, decision: "approved" },
    ]);
  });
});
