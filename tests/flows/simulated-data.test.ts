// Sprint 10b, D-3 Simulated data for a new brand, against the real database:
// generateSimulatedData() (src/lib/demo/simulated.ts) saves a profile's
// products, customers and orders in one transaction through asUser(), marks
// the brand simulated (never fictional), syncs the context store as the demo
// loader does, and makes no model call (rule 5). The Audience agent (mock
// model) then sizes segments that match direct SQL counts. Refusals save
// nothing; another workspace's brand id is refused (rule 7); 20,000 customers
// take under 20 seconds.
//
// Outside tests/db, as the Sprint 10 flows are: it writes tens of thousands of
// rows, too slow for CI's Neon job from a US runner. The interface is in the
// header of tests/e2e/new-brand.spec.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRun, getRun } from "@/lib/agents/runs";
import type { StepTools } from "@/lib/agents/workflow";
import { executeRun } from "@/lib/agents/workflows";
import { computeCandidates, MIN_SEGMENT_SIZE } from "@/lib/audience/candidates";
import { createBrand, getBrand } from "@/lib/brands/repo";
import { parseBrandInput } from "@/lib/brands/schema";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { profileToBrief, simulatedDataDay } from "@/lib/demo/profile";
import { generateSimulatedData, SimulatedDataError } from "@/lib/demo/simulated";
import { mockBehaviour } from "@/lib/models/mock";
import { BRIGHTWATER, BRIGHTWATER_PROFILE, HOSTILE_PRODUCT_NAME, TIDEWELL, TIDEWELL_PROFILE } from "../fixtures/new-brand";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
const inline: StepTools = { run: async (_id, fn) => fn(), waitForEvent: async () => null };
const NOW = new Date("2026-11-10T09:40:00Z");
const DAY = new Date("2026-11-10T00:00:00Z");
/** "New" is exactly 90 × 24 hours before the data date, as computeCandidates() counts it. `interval '90 days'` would count
 * calendar days in the session's time zone, an hour out across a change of the clocks. */
const NEW_SINCE = new Date(DAY.getTime() - 90 * 86_400_000);
/** 6 and 12 months before the data date in UTC calendar months, as computeCandidates()'s monthsBefore() counts them. */
const utcMonthsBefore = (d: Date, months: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() - months); return x; };
const MONTHS_6 = utcMonthsBefore(DAY, 6);
const MONTHS_12 = utcMonthsBefore(DAY, 12);

const kit = (b: { name: string; slug: string; category: string; description: string }) => ({
  name: b.name, slug: b.slug, description: b.description, category: b.category, toneWords: ["warm"], voiceNotes: "", doRules: [], dontRules: [],
  palette: [], fontPrimary: "", fontSecondary: "", legalLines: [], bannedTerms: [], evidenceClaims: [],
});

const counts = (m: Member, brandId: string) =>
  asUser(m.userId, async (tx) => {
    const [r] = await tx`
      select
        (select count(*)::int from public.products where brand_id = ${brandId}) as products,
        (select count(*)::int from public.customers where brand_id = ${brandId}) as customers,
        (select count(*)::int from public.orders where brand_id = ${brandId}) as orders,
        (select count(*)::int from public.order_lines l join public.orders o on o.id = l.order_id where o.brand_id = ${brandId}) as lines`;
    return r as { products: number; customers: number; orders: number; lines: number };
  });

const promised = (profile: typeof BRIGHTWATER_PROFILE, b: { name: string; slug: string; category: string }) => {
  const r = parseBrandInput({ name: b.name, slug: b.slug, category: b.category });
  if (!r.ok) throw new Error(JSON.stringify(r.fieldErrors));
  return profileToBrief(profile, r.data).targetOrders;
};

/** A refusal: a SimulatedDataError, with the field errors when the profile is the reason. */
async function refusal(p: Promise<unknown>): Promise<SimulatedDataError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SimulatedDataError);
  return err as SimulatedDataError;
}

let a: Member;
let b: Member;

describe("D-3 simulated data for a new brand", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
  });
  beforeEach(() => mockBehaviour.reset());
  afterAll(closeSql);

  it("D-3 #1 a profile with 3 products and 2,000 customers saves them, with the orders within 5% of the generator's promise, the brand simulated and its context synced", async () => {
    const id = await createBrand(a, kit(BRIGHTWATER));
    const calls = mockBehaviour.calls;
    const result = await generateSimulatedData(a, id, BRIGHTWATER_PROFILE, { now: NOW });
    const c = await counts(a, id);
    expect(result).toEqual({ products: 3, customers: 2000, orders: c.orders, asOf: DAY.toISOString() });
    expect(c).toMatchObject({ products: 3, customers: 2000 });
    expect(c.lines).toBeGreaterThanOrEqual(c.orders);
    const ratio = c.orders / promised(BRIGHTWATER_PROFILE, BRIGHTWATER);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
    // Rule 5: no model call.
    expect(mockBehaviour.calls).toBe(calls);

    const brand = (await getBrand(a.userId, id))!;
    expect(brand).toMatchObject({ isSimulated: true, isFictional: false, dataAsOf: DAY.toISOString() });
    expect(simulatedDataDay(NOW).toISOString()).toBe(DAY.toISOString());

    const rows = await asUser(a.userId, (tx) => tx`select name, category, price_pence, workspace_id from public.products where brand_id = ${id} order by name`);
    expect(rows.map((r) => [r.name, r.category, r.price_pence])).toEqual(
      [...BRIGHTWATER_PROFILE.products].sort((x, y) => x.name.localeCompare(y.name)).map((p) => [p.name, p.category, p.pricePence]),
    );
    expect(new Set(rows.map((r) => r.workspace_id))).toEqual(new Set([a.workspaceId]));

    // The context store, as for the demo brands: products, the customer base and the segments, labelled simulated (rule 1).
    const items = await asUser(a.userId, (tx) => tx`select kind, title, body, source_ref from public.context_items where brand_id = ${id}`);
    expect(items.filter((i) => i.kind === "product")).toHaveLength(3);
    const base = items.find((i) => i.source_ref === "insight:base");
    expect(base?.body).toContain("2,000 customers");
    expect(base?.body).toMatch(/simulated/i);
    expect(items.find((i) => i.source_ref === "segment:lapsed")?.body).toMatch(/simulated/i);
  });

  it("D-3 #4 refused with field errors, and nothing saved: no products, 11 products, a price of 0 or over £10,000, and a customer count outside 500 to 20,000", async () => {
    const id = await createBrand(a, kit({ ...BRIGHTWATER, name: "Brightwater Pantry", slug: "brightwater-pantry" }));
    const one = BRIGHTWATER_PROFILE.products[0];
    const bad: [string, unknown][] = [
      ["products", { ...BRIGHTWATER_PROFILE, products: [] }],
      ["products", { ...BRIGHTWATER_PROFILE, products: Array.from({ length: 11 }, (_, i) => ({ ...one, name: `Recipe box ${i + 1}` })) }],
      ["products.0.pricePence", { ...BRIGHTWATER_PROFILE, products: [{ ...one, pricePence: 0 }] }],
      ["products.0.pricePence", { ...BRIGHTWATER_PROFILE, products: [{ ...one, pricePence: 1_000_001 }] }],
      ["customers", { ...BRIGHTWATER_PROFILE, customers: 499 }],
      ["customers", { ...BRIGHTWATER_PROFILE, customers: 20_001 }],
    ];
    for (const [field, profile] of bad) {
      const err = await refusal(generateSimulatedData(a, id, profile, { now: NOW }));
      expect(Object.keys(err.fieldErrors), field).toEqual([field]);
      expect(await counts(a, id), field).toEqual({ products: 0, customers: 0, orders: 0, lines: 0 });
      expect((await getBrand(a.userId, id))!.isSimulated, field).toBe(false);
    }
  });

  it("D-3 #4 a brand that already has customers is refused, and nothing changes", async () => {
    const id = await createBrand(a, kit({ ...BRIGHTWATER, name: "Brightwater Bakery", slug: "brightwater-bakery" }));
    await generateSimulatedData(a, id, { ...BRIGHTWATER_PROFILE, customers: 500 }, { now: NOW });
    const before = await counts(a, id);
    const err = await refusal(generateSimulatedData(a, id, BRIGHTWATER_PROFILE, { now: new Date("2026-11-11T09:00:00Z") }));
    expect(err.message).toBe("This brand already has customers, so no simulated data can be added.");
    expect(await counts(a, id)).toEqual(before);
    // A brand with a customer of its own (not simulated) is refused the same way.
    const own = await createBrand(a, kit({ ...BRIGHTWATER, name: "Brightwater Deli", slug: "brightwater-deli" }));
    await asUser(a.userId, (tx) => tx`insert into public.customers (workspace_id, brand_id, external_ref) values (${a.workspaceId}, ${own}, 'C-1')`);
    const err2 = await refusal(generateSimulatedData(a, own, BRIGHTWATER_PROFILE, { now: NOW }));
    expect(err2.message).toBe("This brand already has customers, so no simulated data can be added.");
    expect((await counts(a, own)).customers).toBe(1);
    expect((await getBrand(a.userId, own))!.isSimulated).toBe(false);
  });

  it("D-3 #5 a product name with markup or SQL is stored as text", async () => {
    const id = await createBrand(a, kit({ ...BRIGHTWATER, name: "Brightwater Grill", slug: "brightwater-grill" }));
    const profile = { ...BRIGHTWATER_PROFILE, customers: 500, products: [{ ...BRIGHTWATER_PROFILE.products[0], name: HOSTILE_PRODUCT_NAME }] };
    await generateSimulatedData(a, id, profile, { now: NOW });
    const rows = await asUser(a.userId, (tx) => tx`select name from public.products where brand_id = ${id}`);
    expect(rows.map((r) => r.name)).toEqual([HOSTILE_PRODUCT_NAME]);
    // The products table is still there, and the context store holds the name as text.
    expect((await counts(a, id)).products).toBe(1);
    const item = await asUser(a.userId, (tx) => tx`select title from public.context_items where brand_id = ${id} and kind = 'product'`);
    expect(item.map((r) => r.title)).toEqual([HOSTILE_PRODUCT_NAME]);
  });

  it("D-3 #5 another workspace's brand id, or a malformed one, is refused and nothing is saved in either workspace", async () => {
    const id = await createBrand(a, kit({ ...BRIGHTWATER, name: "Brightwater Cafe", slug: "brightwater-cafe" }));
    for (const target of [id, "not-a-uuid", "00000000-0000-4000-8000-000000000000"]) {
      const err = await refusal(generateSimulatedData(b, target, BRIGHTWATER_PROFILE, { now: NOW }));
      expect(err.message, target).toBe("That brand isn't in your workspace.");
    }
    expect(await counts(a, id)).toEqual({ products: 0, customers: 0, orders: 0, lines: 0 });
    expect((await getBrand(a.userId, id))!.isSimulated).toBe(false);
    const leaked = await asUser(b.userId, (tx) => tx`select count(*)::int as n from public.customers`);
    expect(leaked[0].n).toBe(0);
  });

  it("D-3 #3 the Audience agent (mock model) finds sized segments for the new brand, each size equal to a direct SQL count", async () => {
    const id = await createBrand(a, kit({ ...TIDEWELL, description: TIDEWELL.description }));
    await generateSimulatedData(a, id, TIDEWELL_PROFILE, { now: NOW });
    const set = (await asUser(a.userId, (tx) => computeCandidates(tx, id)))!;
    expect(set.asOf).toBe(DAY.toISOString());
    const [direct] = await asUser(a.userId, (tx) => tx`
      with last as (
        select c.id, c.marketing_consent, max(o.ordered_at) as last_at, min(o.ordered_at) as first_at
        from public.customers c left join public.orders o on o.customer_id = c.id and o.ordered_at <= ${DAY}
        where c.brand_id = ${id} group by c.id)
      select
        count(*) filter (where last_at < ${MONTHS_12}::timestamptz)::int as lapsed,
        count(*) filter (where last_at >= ${MONTHS_12}::timestamptz and last_at < ${MONTHS_6}::timestamptz)::int as at_risk,
        count(*) filter (where first_at >= ${NEW_SINCE}::timestamptz)::int as new,
        count(*) filter (where marketing_consent)::int as consenting,
        count(*)::int as customers
      from last`);
    const size = (k: string) => set.candidates.find((c) => c.key === k)?.size ?? set.tooSmall.find((c) => c.key === k)?.size;
    expect(set.customers).toBe(TIDEWELL_PROFILE.customers);
    expect(set.customers).toBe(direct.customers);
    expect(size("lapsed")).toBe(direct.lapsed);
    expect(size("at-risk")).toBe(direct.at_risk);
    expect(size("new")).toBe(direct.new);
    expect(size("consenting")).toBe(direct.consenting);
    expect(size("not-consenting")).toBe(direct.customers - direct.consenting);
    for (const c of set.candidates) expect(c.size).toBeGreaterThanOrEqual(MIN_SEGMENT_SIZE);

    // The agent's run, with the mock model: completed, and each segment it saved states its candidate's size.
    const runId = await createRun(a, "audience", { brandId: id }, async () => {}, { brandId: id, label: "test" });
    await executeRun("audience", { runId, workspaceId: a.workspaceId, userId: a.userId }, inline);
    const run = (await getRun(a.userId, runId))!;
    expect(run.status, run.error ?? "").toBe("completed");
    const saved = await asUser(a.userId, (tx) => tx`
      select source_ref, body from public.context_items where brand_id = ${id} and kind = 'segment' and created_by_kind = 'agent' order by source_ref`);
    expect(saved.length).toBeGreaterThan(0);
    for (const s of saved) {
      const key = (s.source_ref as string).replace(/^audience:/, "");
      const c = set.candidates.find((x) => x.key === key);
      expect(c, key).toBeDefined();
      expect(s.body, key).toContain(`${c!.size.toLocaleString("en-GB")} of ${set.customers.toLocaleString("en-GB")} customers`);
      expect(s.body, key).toContain("Simulated data.");
    }
  }, 60_000);

  it("D-3 #6 generating 20,000 customers finishes in under 20 seconds", async () => {
    const id = await createBrand(a, kit({ ...BRIGHTWATER, name: "Brightwater Market", slug: "brightwater-market" }));
    const started = Date.now();
    const result = await generateSimulatedData(a, id, { ...BRIGHTWATER_PROFILE, customers: 20_000 }, { now: NOW });
    const took = Date.now() - started;
    expect(result.customers).toBe(20_000);
    expect((await counts(a, id)).customers).toBe(20_000);
    expect(took, `${took} ms`).toBeLessThan(20_000);
  }, 90_000);
});
