// Sprint 5 review, finding 1 (rules 4 and 5): a charge write that fails after a
// paid call must not make the call again, and must leave the reservation in
// place so the spend still counts until the reservation expires.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { generate, generateImage, ProviderError, spendPosition } from "@/lib/models/generate";
import { mockBehaviour } from "@/lib/models/mock";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
const ledger = (m: Member) => asUser(m.userId, (tx) => tx`select * from public.usage_ledger`);
const reservations = (m: Member) => asUser(m.userId, (tx) => tx`select * from public.spend_reservations`);

// A sequence, not a counter in a table: the failed insert's transaction rolls
// back, and a counter would roll back with it, while nextval does not.
async function failLedgerInserts(times: number) {
  const sql = getSql();
  await sql`drop sequence if exists public.test_ledger_failures`;
  await sql`create sequence public.test_ledger_failures`;
  await sql.unsafe(`
    create or replace function public.test_fail_ledger() returns trigger
    language plpgsql security definer set search_path = public as $$
    begin
      if nextval('public.test_ledger_failures') <= ${times} then
        raise exception 'simulated ledger write failure';
      end if;
      return new;
    end $$`);
  await sql`drop trigger if exists test_fail_ledger on public.usage_ledger`;
  await sql`create trigger test_fail_ledger before insert on public.usage_ledger for each row execute function public.test_fail_ledger()`;
}

async function restoreLedger() {
  const sql = getSql();
  await sql`drop trigger if exists test_fail_ledger on public.usage_ledger`;
  await sql`drop function if exists public.test_fail_ledger()`;
  await sql`drop sequence if exists public.test_ledger_failures`;
}

describe("finding 1: a failed charge write after a paid call", () => {
  beforeEach(async () => {
    await truncateAll();
    mockBehaviour.reset();
  });
  afterEach(async () => {
    await restoreLedger();
    mockBehaviour.reset();
  });
  afterAll(closeSql);

  it("generate(): the model is called once, the error is not a provider failure, and the reservation survives", async () => {
    const m = await createMember();
    await failLedgerInserts(1);
    mockBehaviour.next({ text: "done", inputTokens: 1200, outputTokens: 300 });
    const err = await generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: "Say done" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProviderError);
    expect(String((err as Error).message)).toMatch(/simulated ledger write failure/);
    expect(mockBehaviour.calls).toBe(1);
    expect(await ledger(m)).toHaveLength(0);
    const held = await reservations(m);
    expect(held).toHaveLength(1);
    expect(Number(held[0].pence)).toBeGreaterThan(0);
    // The spend still counts against the cap while the reservation lives.
    expect((await spendPosition(m.userId, m.workspaceId)).workspace).toBeCloseTo(Number(held[0].pence), 4);
  });

  it("generate(): a provider failure is still retried once, and a working ledger then records one row", async () => {
    const m = await createMember();
    mockBehaviour.fail("Overloaded", 1);
    const res = await generate({ agent: "tagline", userId: m.userId, workspaceId: m.workspaceId, prompt: "Say done" });
    expect(mockBehaviour.calls).toBe(2);
    expect(await ledger(m)).toHaveLength(1);
    expect(await reservations(m)).toHaveLength(0);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("generateImage(): one picture is drawn, the error says so, and the reservation survives", async () => {
    const m = await createMember();
    await failLedgerInserts(1);
    const err = await generateImage({ agent: "imagery", userId: m.userId, workspaceId: m.workspaceId, prompt: "A calm still life", aspect: "1:1", palette: ["#14213D"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProviderError);
    expect(mockBehaviour.imageCalls).toBe(1);
    expect(await ledger(m)).toHaveLength(0);
    const held = await reservations(m);
    expect(held).toHaveLength(1);
    expect((await spendPosition(m.userId, m.workspaceId)).workspace).toBeGreaterThan(2);
  });

  it("generateImage(): a billed provider failure whose charge write fails keeps the reservation too", async () => {
    const m = await createMember();
    await failLedgerInserts(1);
    mockBehaviour.failImage("Internal error", 1);
    await expect(
      generateImage({ agent: "imagery", userId: m.userId, workspaceId: m.workspaceId, prompt: "A calm still life", aspect: "1:1", palette: ["#14213D"] }),
    ).rejects.toThrow(/simulated ledger write failure/);
    expect(mockBehaviour.imageCalls).toBe(1);
    expect(await reservations(m)).toHaveLength(1);
  });
});
