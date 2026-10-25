// S3-2 test case 6: campaigns and brief versions stay inside their workspace; versions are append-only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
let a: Member;
let b: Member;
let brandA: string;
let brandB: string;
let campaignA: string;

const briefJson = { title: "T", summary: "S", story: "S", insights: [], audiences: [], channels: [], kpi: { metric: "reach" }, mustInclude: [], avoid: [] };

describe("campaigns tenancy", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
    [{ id: brandA }] = await asUser(a.userId, (tx) => tx`insert into public.brands (workspace_id, name, slug, created_by) values (${a.workspaceId}, 'A', 'a', ${a.userId}) returning id`) as unknown as [{ id: string }];
    [{ id: brandB }] = await asUser(b.userId, (tx) => tx`insert into public.brands (workspace_id, name, slug, created_by) values (${b.workspaceId}, 'B', 'b', ${b.userId}) returning id`) as unknown as [{ id: string }];
    [{ id: campaignA }] = await asUser(a.userId, (tx) => tx`
      insert into public.campaigns (workspace_id, brand_id, objective, created_by) values (${a.workspaceId}, ${brandA}, 'Win back lapsed walkers', ${a.userId}) returning id`) as unknown as [{ id: string }];
    await asUser(a.userId, (tx) => tx`update public.campaigns set current_version = 1 where id = ${campaignA}`);
    await asUser(a.userId, (tx) => tx`
      insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${a.workspaceId}, ${campaignA}, 1, ${tx.json(briefJson)}, 'agent', ${a.userId})`);
  });
  afterAll(closeSql);

  it("another workspace can't see a campaign or its versions", async () => {
    expect(await asUser(b.userId, (tx) => tx`select id from public.campaigns`)).toHaveLength(0);
    expect(await asUser(b.userId, (tx) => tx`select id from public.brief_versions`)).toHaveLength(0);
    expect(await asUser(a.userId, (tx) => tx`select id from public.brief_versions`)).toHaveLength(1);
  });

  it("a campaign can't be created in another workspace, or for another workspace's brand", async () => {
    await expect(asUser(b.userId, (tx) => tx`
      insert into public.campaigns (workspace_id, brand_id, objective, created_by) values (${a.workspaceId}, ${brandA}, 'Sneaky objective', ${b.userId})`)).rejects.toThrow();
    await expect(asUser(b.userId, (tx) => tx`
      insert into public.campaigns (workspace_id, brand_id, objective, created_by) values (${b.workspaceId}, ${brandA}, 'Sneaky objective', ${b.userId})`)).rejects.toThrow();
  });

  it("a version can't be added to another workspace's campaign", async () => {
    await expect(asUser(b.userId, (tx) => tx`
      insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${b.workspaceId}, ${campaignA}, 2, ${tx.json(briefJson)}, 'person', ${b.userId})`)).rejects.toThrow();
    await expect(asUser(b.userId, (tx) => tx`
      insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${a.workspaceId}, ${campaignA}, 2, ${tx.json(briefJson)}, 'person', ${b.userId})`)).rejects.toThrow();
  });

  it("versions are append-only, even for the workspace's own members", async () => {
    await expect(asUser(a.userId, (tx) => tx`update public.brief_versions set source = 'person' where campaign_id = ${campaignA}`)).rejects.toThrow();
    await expect(asUser(a.userId, (tx) => tx`delete from public.brief_versions where campaign_id = ${campaignA}`)).rejects.toThrow();
  });

  it("review 13: a version must be the campaign's current one, and campaigns can't be deleted", async () => {
    await expect(asUser(a.userId, (tx) => tx`
      insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${a.workspaceId}, ${campaignA}, 7, ${tx.json(briefJson)}, 'person', ${a.userId})`)).rejects.toThrow(/current version/);
    await asUser(a.userId, (tx) => tx`delete from public.campaigns where id = ${campaignA}`).catch(() => {});
    expect(await asUser(a.userId, (tx) => tx`select id from public.campaigns where id = ${campaignA}`)).toHaveLength(1);
  });

  it("review 6: a finished run's output can only gain a person's mark; its input never changes", async () => {
    const [run] = await asUser(a.userId, (tx) => tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by, status, output)
      values (${a.workspaceId}, 'brief', 1, '{"mode":"revise"}', ${a.userId}, 'completed', '{"proposal":{"title":"x"}}') returning id`);
    await expect(asUser(a.userId, (tx) => tx`update public.agent_runs set output = '{"proposal":{"title":"forged"}}' where id = ${run.id}`)).rejects.toThrow(/cannot be changed/);
    await expect(asUser(a.userId, (tx) => tx`update public.agent_runs set input = '{}' where id = ${run.id}`)).rejects.toThrow(/cannot be changed/);
    await asUser(a.userId, (tx) => tx`update public.agent_runs set output = output || '{"resolution":"discarded"}' where id = ${run.id}`);
  });

  it("a campaign's workspace, brand and creator can't be changed", async () => {
    const [{ id: brandA2 }] = await asUser(a.userId, (tx) => tx`insert into public.brands (workspace_id, name, slug, created_by) values (${a.workspaceId}, 'A2', 'a2', ${a.userId}) returning id`);
    await expect(asUser(a.userId, (tx) => tx`update public.campaigns set brand_id = ${brandA2} where id = ${campaignA}`)).rejects.toThrow(/cannot be changed/);
    void brandB;
  });

  it("a campaign can only point at a run in its own workspace", async () => {
    const [run] = await asUser(b.userId, (tx) => tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by) values (${b.workspaceId}, 'brief', 1, '{}', ${b.userId}) returning id`);
    await expect(asUser(a.userId, (tx) => tx`update public.campaigns set run_id = ${run.id} where id = ${campaignA}`)).rejects.toThrow();
  });

  it("anon sees nothing", async () => {
    const sql = getSql();
    await expect(sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select * from public.campaigns`;
    })).rejects.toThrow(/permission denied/);
  });
});
