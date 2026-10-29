import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createMember, createUser, truncateAll } from "../helpers/db";

// Cutover day (29 Oct): an abandoned transaction holding a member's advisory
// lock must not stop their pages loading (migration 20261029000003).
describe("ensure_workspace takes no lock for an existing member", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("returns the member's workspace while another transaction holds their lock", async () => {
    const m = await createMember();
    const sql = getSql();
    const holder = await sql.reserve();
    try {
      await holder`begin`;
      await holder`select pg_advisory_xact_lock(hashtextextended(${m.userId}::text, 0))`;
      const ws = await asUser(m.userId, async (tx) => {
        await tx`set local lock_timeout = '2s'`;
        const [r] = await tx`select public.ensure_workspace() as id`;
        return r.id as string;
      });
      expect(ws).toBe(m.workspaceId);
    } finally {
      await holder`rollback`;
      holder.release();
    }
  });

  it("a new user still gets exactly one workspace when two first requests race", async () => {
    const userId = await createUser();
    const [a, b] = await Promise.all([
      asUser(userId, async (tx) => (await tx`select public.ensure_workspace() as id`)[0].id as string),
      asUser(userId, async (tx) => (await tx`select public.ensure_workspace() as id`)[0].id as string),
    ]);
    expect(a).toBe(b);
    const [{ n }] = await getSql()`select count(*)::int as n from public.workspace_members where user_id = ${userId}`;
    expect(n).toBe(1);
  });
});
