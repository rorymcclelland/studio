// S5-2 (rule 7): copy_sets carry workspace_id with row-level security, attach
// only within their workspace, and are append-only except the discard mark.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
let a: Member;
let b: Member;
let campaignA: string;
let runA: string;
let setA: string;

const brief = { title: "T", summary: "s".repeat(20), story: "s".repeat(20), insights: [], audiences: [], channels: [], kpi: { metric: "reach" }, mustInclude: [], avoid: [] };

async function campaignFor(m: Member) {
  return asUser(m.userId, async (tx) => {
    const [br] = await tx`insert into public.brands (workspace_id, name, slug, created_by) values (${m.workspaceId}, 'Brand', ${`brand-${m.userId.slice(0, 8)}`}, ${m.userId}) returning id`;
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${br.id}, 'Win back lapsed savers', ${m.userId}, 1) returning id`;
    await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief)}, 'agent', ${m.userId})`;
    const [r] = await tx`insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
      values (${m.workspaceId}, 'copy', 1, ${tx.json({ mode: "all", campaignId: c.id })}, ${m.userId}) returning id`;
    return { campaign: c.id as string, run: r.id as string };
  });
}

const insertSet = (m: Member, workspaceId: string, campaignId: string, runId: string | null, basedOn: string | null = null, source = "agent") =>
  asUser(m.userId, async (tx) => {
    const [s] = await tx`
      insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_ref, segment_title, set, legal_lines, source, based_on, created_by)
      values (${workspaceId}, ${campaignId}, 1, ${runId}, 'email', null, 'Everyone in the brief',
              ${tx.json({ subject: "Hello", preview: "A calm look at your money." })}, ${["Rates can change."]}, ${source}, ${basedOn}, ${m.userId})
      returning id`;
    return s.id as string;
  });

describe("copy_sets tenancy", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
    ({ campaign: campaignA, run: runA } = await campaignFor(a));
    setA = await insertSet(a, a.workspaceId, campaignA, runA);
  });
  afterAll(closeSql);

  it("another workspace reads none of them, and can't add one to this workspace's campaign", async () => {
    expect(await asUser(a.userId, (tx) => tx`select id from public.copy_sets`)).toHaveLength(1);
    expect(await asUser(b.userId, (tx) => tx`select id from public.copy_sets`)).toHaveLength(0);
    // Into A's workspace: refused by row-level security.
    await expect(insertSet(b, a.workspaceId, campaignA, runA)).rejects.toThrow(/row-level security/);
    // Into B's workspace but pointing at A's campaign, run or set: refused by the (id, workspace_id) keys.
    const own = await campaignFor(b);
    await expect(insertSet(b, b.workspaceId, campaignA, own.run)).rejects.toThrow(/foreign key/);
    await expect(insertSet(b, b.workspaceId, own.campaign, runA)).rejects.toThrow(/foreign key/);
    await expect(insertSet(b, b.workspaceId, own.campaign, null, setA, "person")).rejects.toThrow(/foreign key/);
    // B can't mark A's set discarded.
    const res = await asUser(b.userId, (tx) => tx`update public.copy_sets set discarded_at = now() where id = ${setA}`);
    expect(res.count).toBe(0);
  });

  it("is append-only: only the discard mark changes, and nothing is deleted", async () => {
    await expect(asUser(a.userId, (tx) => tx`update public.copy_sets set set = ${tx.json({ subject: "Changed", preview: "Changed text." })} where id = ${setA}`)).rejects.toThrow();
    await expect(asUser(a.userId, (tx) => tx`update public.copy_sets set legal_lines = '{}' where id = ${setA}`)).rejects.toThrow();
    await expect(asUser(a.userId, (tx) => tx`delete from public.copy_sets where id = ${setA}`)).rejects.toThrow();
    // Even the table owner can't rewrite a set (the guard trigger).
    await expect(getSql()`update public.copy_sets set channel = 'search' where id = ${setA}`).rejects.toThrow(/Only a copy set's discard mark can change/);
    const done = await asUser(a.userId, (tx) => tx`update public.copy_sets set discarded_at = now() where id = ${setA} returning discarded_at`);
    expect(done[0].discarded_at).toBeInstanceOf(Date);
    await asUser(a.userId, (tx) => tx`update public.copy_sets set discarded_at = null where id = ${setA}`);
  });

  it("a person's edit must say what it is based on, and a set can't be for a brief version that doesn't exist", async () => {
    await expect(insertSet(a, a.workspaceId, campaignA, null, null, "person")).rejects.toThrow(/copy_sets_person_based_on/);
    await expect(asUser(a.userId, (tx) => tx`
      insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_title, set, source, created_by)
      values (${a.workspaceId}, ${campaignA}, 9, ${runA}, 'email', 'All', '{}'::jsonb, 'agent', ${a.userId})`)).rejects.toThrow(/foreign key/);
    const edit = await insertSet(a, a.workspaceId, campaignA, null, setA, "person");
    expect(edit).toBeTruthy();
  });

  it("a deleted run leaves its sets, without the run", async () => {
    await getSql()`delete from public.agent_runs where id = ${runA}`;
    const [s] = await asUser(a.userId, (tx) => tx`select run_id from public.copy_sets where id = ${setA}`);
    expect(s.run_id).toBeNull();
  });

  it("the anonymous role sees nothing", async () => {
    const result = await getSql().begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select * from public.copy_sets`;
    }).catch((e: Error) => e);
    if (result instanceof Error) expect(result.message).toMatch(/permission denied/);
    else expect(result).toHaveLength(0);
  });
});
