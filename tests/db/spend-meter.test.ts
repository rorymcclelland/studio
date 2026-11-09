// U10-1 #2 (F-36, rule 1) against the database: the spend meter's reading.
// What has been charged today leaves out the reservations of calls in flight
// (an estimate is never shown as spend); those count as calls running. The
// owner reads the app's figures, a guest their own workspace's (rules 5 and 7),
// and the cap still counts reservations. The words are tests/lib/spend-meter.test.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { spendMeterReading, spendPosition } from "@/lib/models/generate";
import { createMember, createUser, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

const OWNER = "owner-meter@example.test";

const charge = (m: Member, provider: string, pence: number) =>
  asUser(m.userId, (tx) => tx`
    insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
    values (${m.workspaceId}, 'tagline', ${provider}, 'x', 0, 0, ${pence})`);
const reserve = (m: Member, pence: number) =>
  asUser(m.userId, (tx) => tx`insert into public.spend_reservations (workspace_id, pence) values (${m.workspaceId}, ${pence})`);

describe("U10-1 #2 the spend meter's reading", () => {
  let saved: string | undefined;
  beforeEach(async () => {
    await truncateAll();
    saved = process.env.OWNER_EMAIL;
    process.env.OWNER_EMAIL = OWNER;
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.OWNER_EMAIL;
    else process.env.OWNER_EMAIL = saved;
    await closeSql();
  });

  it("charged spend leaves out live reservations, which count as calls running; the cap still counts them", async () => {
    const ownerId = await createUser(OWNER);
    const owner: Member = { userId: ownerId, workspaceId: await asUser(ownerId, async (tx) => (await tx`select public.ensure_workspace() as id`)[0].id as string) };
    const guest = await createMember();
    await charge(owner, "mock", 3);
    await charge(guest, "mock", 4);
    await charge(guest, "anthropic", 1);
    await reserve(guest, 5);
    await reserve(guest, 2);
    await reserve(owner, 5);
    // A reservation left by a crashed call stops counting after 10 minutes, as in the cap.
    await getSql()`insert into public.spend_reservations (workspace_id, pence, created_at) values (${guest.workspaceId}, 9, now() - interval '11 minutes')`;

    const g = await spendMeterReading(guest.userId, guest.workspaceId);
    expect(g.owner).toBe(false);
    expect(g.chargedPence).toBeCloseTo(5, 6);
    expect(g.simulatedPence).toBeCloseTo(4, 6);
    expect(g.callsInFlight).toBe(2);
    // The cap arithmetic is unchanged: the workspace's spend includes its live reservations.
    expect((await spendPosition(guest.userId, guest.workspaceId)).workspace).toBeCloseTo(12, 6);

    const o = await spendMeterReading(owner.userId, owner.workspaceId);
    expect(o.owner).toBe(true);
    expect(o.chargedPence).toBeCloseTo(8, 6);
    expect(o.simulatedPence).toBeCloseTo(7, 6);
    expect(o.callsInFlight).toBe(3);
    expect((await spendPosition(owner.userId, owner.workspaceId)).total).toBeCloseTo(20, 6);
  });

  it("rule 7: a guest naming another workspace reads nothing of it", async () => {
    const guest = await createMember();
    const other = await createMember();
    await charge(other, "mock", 6);
    await reserve(other, 5);
    const r = await spendMeterReading(guest.userId, other.workspaceId);
    expect(r).toMatchObject({ owner: false, chargedPence: 0, simulatedPence: 0, callsInFlight: 0 });
  });
});
