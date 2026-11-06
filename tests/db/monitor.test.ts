// P9-4 The monitor: what the database itself enforces on
// public.performance_alerts and public.performance_questions, as the
// non-superuser owner role on Neon's Postgres 17 too (CI's Neon job runs
// tests/db). Test cases 1 (an alert can be marked as seen once, recording who
// and when, and nothing else about it can change), 3 (one alert per ad and
// kind in a launch: the unique key; another kind is its own) and 7 (another
// workspace can't read, mark, ask or answer: row-level security, grants and
// the composite foreign keys), with rule 7's cross-workspace tests for both
// new tables.
//
// The fixtures are cheap on purpose: one ad per workspace (two for A), a
// launch written with rawLaunch, and alert and question rows written straight
// to the database, so each test runs in a few dozen queries and fits inside
// the Neon job's time from a US runner. The clock raising alerts, the
// question's workflow and the query runner make hundreds of queries and test
// the same SQL, so they are tests/flows/monitor.test.ts (plain Postgres, CI's
// first job), where the interface the builder follows is written.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, builder, campaignFor, EN, rawLaunch, type Member } from "../helpers/launch";

let a: Member;
let b: Member;
let ids: { campaign: string; ad: string; otherAd: string; theirCampaign: string; theirAd: string };
let launchA: string;
let launchB: string;

const FACTS = { current: { from: 7, to: 9, value: 0.65, shown: "0.65%" }, best: { from: 3, to: 5, value: 0.9, shown: "0.90%" }, dropPercent: 27.2 };

/** An alert row written as a member, with any field overridden. */
const alertRow = (m: Member, over: Record<string, unknown> = {}) => ({
  workspace_id: m.workspaceId,
  launch_id: m === a ? launchA : launchB,
  variant_id: m === a ? ids.ad : ids.theirAd,
  day: 9,
  kind: "tiring",
  facts: FACTS,
  ...over,
});
const insertAlert = (as: Member, row: Record<string, unknown>) =>
  asUser(as.userId, async (tx) => {
    const [r] = await tx`insert into public.performance_alerts ${tx({ ...row, facts: tx.json(row.facts as never) } as never)} returning id`;
    return r.id as string;
  });

/**
 * asUser() runs at once (a getSql`` query only when awaited), so one listed among
 * changes awaited in turn could reject before its turn: mark it handled where it is
 * made, and the `rejects` check below still sees the rejection.
 */
const later = <T>(p: Promise<T>): Promise<T> => {
  p.catch(() => {});
  return p;
};

const questionRow = (m: Member, over: Record<string, unknown> = {}) => ({
  workspace_id: m.workspaceId,
  launch_id: m === a ? launchA : launchB,
  question: "Which ad had the lowest cost per acquisition last week?",
  created_by: m.userId,
  ...over,
});
const insertQuestion = (as: Member, row: Record<string, unknown>) =>
  asUser(as.userId, async (tx) => {
    const [r] = await tx`insert into public.performance_questions ${tx(row as never)} returning id`;
    return r.id as string;
  });

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  const brandA = await brandFor(a, "fernhollow");
  const campaign = await campaignFor(a, brandA, "signed off", "Watched by the monitor");
  const mk = builder(a, brandA, campaign);
  const image = await mk.image("monitor db");
  const ad = await mk.ad(image, await mk.words(EN.headline), "card", true);
  const otherAd = await mk.ad(image, await mk.words("Kit for wet weekends"), "split", true);
  const brandB = await brandFor(b, "fernhollow");
  const theirCampaign = await campaignFor(b, brandB, "signed off", "Their own campaign");
  const tb = builder(b, brandB, theirCampaign);
  const theirAd = await tb.ad(await tb.image("monitor db theirs"), await tb.words("Their own headline"), "card", true);
  ids = { campaign, ad, otherAd, theirCampaign, theirAd };
  ({ launchId: launchB } = await rawLaunch(b, theirCampaign, [theirAd]));
}, 120_000);

beforeEach(async () => {
  // A's launch, of its first ad only, afresh for each test (as the tables' owner: the app can't delete launches).
  await getSql()`delete from public.launches where workspace_id = ${a.workspaceId}`;
  await getSql()`delete from public.approvals where kind = 'launch' and workspace_id = ${a.workspaceId}`;
  ({ launchId: launchA } = await rawLaunch(a, ids.campaign, [ids.ad]));
});
afterAll(closeSql);

describe("P9-4 performance_alerts in the database", () => {
  it("#3 one alert per ad and kind in a launch: the unique key refuses a second; another kind, or another launch, is its own", async () => {
    await insertAlert(a, alertRow(a));
    await expect(insertAlert(a, alertRow(a, { day: 12, facts: { ...FACTS, dropPercent: 30 } }))).rejects.toMatchObject({ code: "23505" });
    await insertAlert(a, alertRow(a, { kind: "below_threshold", day: 8, facts: { measure: "ctr", threshold: 1, thresholdShown: "1%", previous: FACTS.best, current: FACTS.current } }));
    await insertAlert(a, alertRow(a, { kind: "not_compliant", day: 10, facts: { reason: "Fails: banned term 'x' in English." } }));
    // A later launch of the same campaign starts afresh.
    await getSql()`update public.launches set status = 'ended', ended_by = ${a.userId}, ended_at = now() where id = ${launchA}`;
    const { launchId: next } = await rawLaunch(a, ids.campaign, [ids.ad]);
    await insertAlert(a, alertRow(a, { launch_id: next }));
    const [{ n }] = await getSql()`select count(*)::int as n from public.performance_alerts where variant_id = ${ids.ad}`;
    expect(n).toBe(4);
  });

  it("#3 an alert's kind, day and facts are checked, and its ad must be one of the launch's own", async () => {
    await expect(insertAlert(a, alertRow(a, { kind: "fatigue" }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertAlert(a, alertRow(a, { day: 0 }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertAlert(a, alertRow(a, { day: 61 }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertAlert(a, alertRow(a, { facts: ["not", "an", "object"] }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertAlert(a, alertRow(a, { seen_by: a.userId }))).rejects.toMatchObject({ code: "23514" });
    // Another of the campaign's ads, not in this launch.
    await expect(insertAlert(a, alertRow(a, { variant_id: ids.otherAd }))).rejects.toMatchObject({ code: "23514", message: "An alert is raised only for one of the launch's own ads" });
    expect(await getSql()`select id from public.performance_alerts where workspace_id = ${a.workspaceId}`).toHaveLength(0);
  });

  it("#1 an alert can only be marked as seen, once, recording who and when; nothing else about it changes, for any role", async () => {
    const id = await insertAlert(a, alertRow(a));
    const seenAt = new Date("2026-11-20T10:00:00Z");
    const marked = await asUser(a.userId, (tx) => tx`update public.performance_alerts set seen_by = ${a.userId}, seen_at = ${seenAt} where id = ${id}`);
    expect(marked.count).toBe(1);
    // Marked again, by anyone: refused, and the first who and when are kept.
    await expect(asUser(a.userId, (tx) => tx`update public.performance_alerts set seen_at = now() where id = ${id}`)).rejects.toMatchObject({ code: "42501" });
    await expect(getSql()`update public.performance_alerts set seen_by = null, seen_at = null where id = ${id}`).rejects.toMatchObject({ code: "42501" });
    // Its facts, day, kind, ad and launch never change, not even as the owner.
    const other = await insertAlert(a, alertRow(a, { kind: "below_threshold" }));
    for (const change of [
      getSql()`update public.performance_alerts set day = 3 where id = ${other}`,
      getSql()`update public.performance_alerts set kind = 'not_compliant' where id = ${other}`,
      getSql()`update public.performance_alerts set facts = '{"dropPercent": 99}'::jsonb where id = ${other}`,
      later(asUser(a.userId, (tx) => tx`update public.performance_alerts set facts = '{}'::jsonb where id = ${other}`)),
    ]) {
      await expect(change).rejects.toMatchObject({ code: "42501" });
    }
    // Members can't delete one.
    await expect(asUser(a.userId, (tx) => tx`delete from public.performance_alerts where id = ${id}`)).rejects.toMatchObject({ code: "42501" });
    const [row] = await getSql()`select seen_by, seen_at, day, kind from public.performance_alerts where id = ${id}`;
    expect(row).toEqual({ seen_by: a.userId, seen_at: seenAt, day: 9, kind: "tiring" });
  });

  it("rule 7: another workspace can't read, mark or add an alert, even about a launch it names; the anonymous role has no access", async () => {
    const id = await insertAlert(a, alertRow(a));
    expect(await asUser(b.userId, (tx) => tx`select id from public.performance_alerts`)).toHaveLength(0);
    expect((await asUser(b.userId, (tx) => tx`update public.performance_alerts set seen_by = ${b.userId}, seen_at = now() where id = ${id}`)).count).toBe(0);
    // Into A's workspace: row-level security. Into B's own, about A's launch or ad: refused by the composite foreign
    // keys (23503), or first by the insert check that the ad is the launch's own (23514), whichever runs first.
    await expect(insertAlert(b, alertRow(a))).rejects.toThrow(/row-level security/);
    const refused = { code: expect.stringMatching(/^(23503|23514)$/) };
    await expect(insertAlert(b, alertRow(b, { launch_id: launchA, variant_id: ids.theirAd }))).rejects.toMatchObject(refused);
    await expect(insertAlert(b, alertRow(b, { launch_id: launchA, variant_id: ids.ad }))).rejects.toMatchObject(refused);
    await expect(insertAlert(b, alertRow(b, { variant_id: ids.ad }))).rejects.toMatchObject(refused);
    expect(await asAnon((tx) => tx`select has_table_privilege('anon', 'public.performance_alerts', 'select') as ok`)).toEqual([{ ok: false }]);
    // Row-level security is on, and A reads its own.
    const [{ rls }] = await getSql()`select relrowsecurity as rls from pg_class where oid = 'public.performance_alerts'::regclass`;
    expect(rls).toBe(true);
    expect(await asUser(a.userId, (tx) => tx`select id from public.performance_alerts`)).toEqual([{ id }]);
    const [{ seen_by }] = await getSql()`select seen_by from public.performance_alerts where id = ${id}`;
    expect(seen_by).toBeNull();
  });
});

describe("P9-4 performance_questions in the database", () => {
  it("#4 a question is 1 to 300 characters; the answer up to 600 and the refusal up to 500", async () => {
    await insertQuestion(a, questionRow(a, { question: "x".repeat(300) }));
    await expect(insertQuestion(a, questionRow(a, { question: "" }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertQuestion(a, questionRow(a, { question: "x".repeat(301) }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertQuestion(a, questionRow(a, { answer: "x".repeat(601) }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertQuestion(a, questionRow(a, { refused: "x".repeat(501) }))).rejects.toMatchObject({ code: "23514" });
    await expect(insertQuestion(a, questionRow(a, { launch_id: randomUUID() }))).rejects.toMatchObject({ code: "23503" });
  });

  it("#5 a question is filled in once: its words, launch and asker never change, and an answered or refused question is final", async () => {
    const id = await insertQuestion(a, questionRow(a));
    // The workflow fills in the plan, then the result, then the answer.
    await asUser(a.userId, (tx) => tx`update public.performance_questions set plan = ${tx.json({ answerable: true } as never)} where id = ${id}`);
    await asUser(a.userId, (tx) => tx`update public.performance_questions set result = ${tx.json({ rows: [] } as never)} where id = ${id}`);
    await asUser(a.userId, (tx) => tx`update public.performance_questions set answer = 'Ad 1 was cheapest.' where id = ${id}`);
    for (const change of [
      later(asUser(a.userId, (tx) => tx`update public.performance_questions set answer = 'Ad 2 was cheapest.' where id = ${id}`)),
      later(asUser(a.userId, (tx) => tx`update public.performance_questions set refused = 'Changed my mind.' where id = ${id}`)),
      getSql()`update public.performance_questions set result = '{}'::jsonb where id = ${id}`,
    ]) {
      await expect(change).rejects.toMatchObject({ code: "42501" });
    }
    const open = await insertQuestion(a, questionRow(a));
    for (const change of [
      later(asUser(a.userId, (tx) => tx`update public.performance_questions set question = 'Something else' where id = ${open}`)),
      getSql()`update public.performance_questions set launch_id = ${launchB}, workspace_id = ${b.workspaceId} where id = ${open}`,
      getSql()`update public.performance_questions set created_by = ${b.userId} where id = ${open}`,
    ]) {
      await expect(change).rejects.toMatchObject({ code: "42501" });
    }
    await asUser(a.userId, (tx) => tx`update public.performance_questions set refused = 'The daily AI cap was reached.' where id = ${open}`);
    await expect(asUser(a.userId, (tx) => tx`update public.performance_questions set answer = 'Late.' where id = ${open}`)).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(a.userId, (tx) => tx`delete from public.performance_questions where id = ${open}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("rule 7 and #7: another workspace can't read, answer or ask about a launch it doesn't own; the anonymous role has no access", async () => {
    const id = await insertQuestion(a, questionRow(a));
    expect(await asUser(b.userId, (tx) => tx`select id from public.performance_questions`)).toHaveLength(0);
    expect((await asUser(b.userId, (tx) => tx`update public.performance_questions set answer = 'PWNED' where id = ${id}`)).count).toBe(0);
    await expect(insertQuestion(b, questionRow(a))).rejects.toThrow(/row-level security/);
    await expect(insertQuestion(b, questionRow(b, { launch_id: launchA }))).rejects.toMatchObject({ code: "23503" });
    expect(await asAnon((tx) => tx`select has_table_privilege('anon', 'public.performance_questions', 'select') as ok`)).toEqual([{ ok: false }]);
    const [{ rls }] = await getSql()`select relrowsecurity as rls from pg_class where oid = 'public.performance_questions'::regclass`;
    expect(rls).toBe(true);
    // B's own question about B's own launch is fine, and A still sees only its own.
    await insertQuestion(b, questionRow(b));
    expect(await asUser(a.userId, (tx) => tx`select id from public.performance_questions`)).toEqual([{ id }]);
    const [{ answer }] = await getSql()`select answer from public.performance_questions where id = ${id}`;
    expect(answer).toBeNull();
  });
});
