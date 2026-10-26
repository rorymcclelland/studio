// F-21 test case 4: another workspace can't read, insert or delete reservations.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";

describe("F-21 spend reservations are per workspace", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("#4 another workspace can't read, insert or delete a workspace's reservations", async () => {
    const a = await createMember();
    const b = await createMember();
    const [r] = await asUser(a.userId, (tx) => tx`insert into public.spend_reservations (workspace_id, pence) values (${a.workspaceId}, 3) returning id`);

    expect(await asUser(a.userId, (tx) => tx`select id from public.spend_reservations`)).toHaveLength(1);
    expect(await asUser(b.userId, (tx) => tx`select id from public.spend_reservations`)).toHaveLength(0);

    await expect(
      asUser(b.userId, (tx) => tx`insert into public.spend_reservations (workspace_id, pence) values (${a.workspaceId}, 3)`),
    ).rejects.toThrow(/row-level security/);

    const del = await asUser(b.userId, (tx) => tx`delete from public.spend_reservations where id = ${r.id}`);
    expect(del.count).toBe(0);
    expect(await asUser(a.userId, (tx) => tx`select id from public.spend_reservations`)).toHaveLength(1);

    // B's own spend figure doesn't include A's reservation; the app-wide figure does (it is the shared budget).
    const [w] = await asUser(b.userId, (tx) => tx`select public.workspace_spend_today_pence(${b.workspaceId}) as p, public.workspace_spend_today_pence(${a.workspaceId}) as other`);
    expect(Number(w.p)).toBe(0);
    expect(Number(w.other)).toBe(0); // B can't see A's rows through the invoker's function
    const [t] = await asUser(b.userId, (tx) => tx`select total_pence from public.spend_split_today(null)`);
    expect(Number(t.total_pence)).toBeCloseTo(3, 4);
  });

  it("a reservation can't point at another workspace's run, and can't be changed", async () => {
    const a = await createMember();
    const b = await createMember();
    const [run] = await asUser(b.userId, (tx) => tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
      values (${b.workspaceId}, 'tagline', 1, '{}', ${b.userId}) returning id`);
    await expect(
      asUser(a.userId, (tx) => tx`insert into public.spend_reservations (workspace_id, run_id, pence) values (${a.workspaceId}, ${run.id}, 1)`),
    ).rejects.toThrow(/foreign key/);
    const [r] = await asUser(a.userId, (tx) => tx`insert into public.spend_reservations (workspace_id, pence) values (${a.workspaceId}, 1) returning id`);
    await expect(asUser(a.userId, (tx) => tx`update public.spend_reservations set pence = 0 where id = ${r.id}`)).rejects.toThrow(/permission denied/);
  });

  it("the anonymous role reads nothing", async () => {
    const a = await createMember();
    await asUser(a.userId, (tx) => tx`insert into public.spend_reservations (workspace_id, pence) values (${a.workspaceId}, 1)`);
    const res = await asAnon((tx) => tx`select 1 from public.spend_reservations`).catch((e: Error) => e);
    if (res instanceof Error) expect(res.message).toMatch(/permission denied/);
    else expect(res).toHaveLength(0);
  });
});
