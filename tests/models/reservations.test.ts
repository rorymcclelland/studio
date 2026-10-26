// F-21 test cases 1 to 3: spend is reserved before a call, so the cap holds when calls start together.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { costPence } from "@/lib/models/cost";
import { CapExceededError, generate, ProviderError, spendPosition } from "@/lib/models/generate";
import { mockBehaviour } from "@/lib/models/mock";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

const charge = (m: Member, pence: number) =>
  asUser(m.userId, (tx) => tx`
    insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
    values (${m.workspaceId}, 'tagline', 'mock', 'mock-model', 0, 0, ${pence})`);

const reservations = (m: Member) => asUser(m.userId, (tx) => tx`select * from public.spend_reservations`);
const ledger = (m: Member) => asUser(m.userId, (tx) => tx`select * from public.usage_ledger order by id`);

// A prompt whose estimate is about 3p on the mock model (a pessimistic 3 characters a token at $1/M, 79p a dollar).
const BIG = "x".repeat(110_000);

describe("F-21 reserve spend before a call", () => {
  beforeEach(async () => {
    await truncateAll();
    mockBehaviour.reset();
  });
  afterEach(() => mockBehaviour.reset());
  afterAll(closeSql);

  it("#1 two calls that each fit but together don't, started together: one runs, the other stops with the cap message and is not charged", async () => {
    const m = await createMember();
    await charge(m, 45); // 5p left of the workspace's 50p; each call is estimated at about 3p
    mockBehaviour.delayMs = 300; // both calls are in flight at once
    const results = await Promise.allSettled([
      generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: BIG }),
      generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: BIG }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBeInstanceOf(CapExceededError);
    expect(String(refused[0].reason.message)).toMatch(/Daily AI cap reached/);
    expect(mockBehaviour.calls).toBe(1);
    const rows = await ledger(m);
    expect(rows).toHaveLength(2); // the 45p and the one call that ran
    expect(await reservations(m)).toHaveLength(0);
  });

  it("#2 a finished call leaves no reservation, and its ledger row holds the real cost", async () => {
    const m = await createMember();
    mockBehaviour.next({ text: "done", inputTokens: 1200, outputTokens: 300 });
    const res = await generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: "Say done" });
    expect(await reservations(m)).toHaveLength(0);
    const [row] = await ledger(m);
    expect(Number(row.cost_pence)).toBeCloseTo(costPence("mock", "mock-model", 1200, 300), 4);
    expect(Number(row.cost_pence)).toBeCloseTo(res.costPence, 4);
  });

  it("#2b while a call is in flight its reservation counts as spent, then gives way to the real charge", async () => {
    const m = await createMember();
    mockBehaviour.delayMs = 300;
    const call = generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: BIG });
    await new Promise((r) => setTimeout(r, 150));
    const during = await spendPosition(m.userId, m.workspaceId);
    expect(during.workspace).toBeGreaterThan(2.5);
    expect((await reservations(m)).length).toBe(1);
    const res = await call;
    const after = await spendPosition(m.userId, m.workspaceId);
    expect(after.workspace).toBeCloseTo(res.costPence, 4);
  });

  it("#3 a call that throws leaves no reservation and no charge", async () => {
    const m = await createMember();
    mockBehaviour.fail("Overloaded", 2);
    await expect(generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: "hi" })).rejects.toBeInstanceOf(ProviderError);
    expect(await reservations(m)).toHaveLength(0);
    expect(await ledger(m)).toHaveLength(0);
  });

  it("#3b a reservation older than 10 minutes isn't counted; a live one is", async () => {
    const m = await createMember();
    const sql = getSql();
    await sql`insert into public.spend_reservations (workspace_id, pence, created_at) values (${m.workspaceId}, 40, now() - interval '11 minutes')`;
    expect((await spendPosition(m.userId, m.workspaceId)).workspace).toBe(0);
    expect((await spendPosition(m.userId, m.workspaceId)).total).toBe(0);
    await sql`insert into public.spend_reservations (workspace_id, pence, created_at) values (${m.workspaceId}, 7, now() - interval '9 minutes')`;
    const p = await spendPosition(m.userId, m.workspaceId);
    expect(p.workspace).toBeCloseTo(7, 4);
    expect(p.total).toBeCloseTo(7, 4);
    const [{ v }] = await asUser(m.userId, (tx) => tx`select public.spend_today_pence('Europe/London') as v`);
    expect(Number(v)).toBeCloseTo(7, 4);
  });

  it("#3c a guest's reservations count against the app-wide share too, so the owner's reserve holds", async () => {
    const guest = await createMember();
    const other = await createMember();
    // Another guest workspace has a live 60p reservation; the default owner reserve is 50p of the £1 cap.
    await getSql()`insert into public.spend_reservations (workspace_id, pence) values (${other.workspaceId}, 60)`;
    const p = await spendPosition(guest.userId, guest.workspaceId);
    expect(p.total).toBeCloseTo(60, 4);
    expect(p.scope).toBe("app");
    await expect(generate({ agent: "tagline", userId: guest.userId, workspaceId: guest.workspaceId, prompt: "hi" })).rejects.toBeInstanceOf(CapExceededError);
  });
});
