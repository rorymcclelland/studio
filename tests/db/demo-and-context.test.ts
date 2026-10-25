// S2-4 test case 5 and S2-5 test cases 1 to 5: loading the demo brands, and the Business Context store.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { DemoAlreadyLoadedError, loadDemoBrands } from "@/lib/demo/load";
import { getBrand, listBrands, updateBrand } from "@/lib/brands/repo";
import { searchContext } from "@/lib/context/store";
import { getCustomerSummary } from "@/lib/brands/summary";
import { getSql } from "@/lib/db/client";
import { createMember, truncateAll } from "../helpers/db";

// A past load date: every window must count back from the data's own date,
// not from today (review finding 5).
const REF = new Date("2026-03-15T10:30:00Z");
let a: { userId: string; workspaceId: string };
let b: { userId: string; workspaceId: string };

describe("demo brands and the Business Context store", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
    await loadDemoBrands(a, { refDate: REF });
  }, 120_000);
  afterAll(closeSql);

  it("S2-4 #5: loading adds both brands with their catalogue; loading again adds nothing and says why", async () => {
    const brands = await listBrands(a.userId);
    expect(brands.map((x) => x.slug).sort()).toEqual(["fernhollow", "quillmoor"]);
    expect(brands.every((x) => x.isSimulated)).toBe(true);
    const [c] = await asUser(a.userId, (tx) => tx`select
      (select count(*)::int from public.customers) as customers,
      (select count(*)::int from public.orders) as orders,
      (select count(*)::int from public.order_lines) as lines`);
    expect(c.customers).toBe(4000);
    expect(c.orders).toBeGreaterThan(9000);
    expect(c.lines).toBeGreaterThan(c.orders);
    await expect(loadDemoBrands(a, { refDate: REF })).rejects.toThrow(DemoAlreadyLoadedError);
    expect(await listBrands(a.userId)).toHaveLength(2);
  });

  it("S2-5 #1: searching 'lapsed' on the outdoor brand finds the lapsed-segment summary first", async () => {
    const fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!;
    const hits = await searchContext(a.userId, { query: "lapsed", brandId: fern.id });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].kind).toBe("segment");
    expect(hits[0].title.toLowerCase()).toContain("lapsed");
    expect(hits[0].body).toMatch(/\d/); // carries the figures, not just a label
  });

  it("S2-5 #2: editing a brand rule updates its context item; the old wording no longer matches", async () => {
    const fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!;
    const before = await searchContext(a.userId, { query: "mock people new outdoors", brandId: fern.id, kinds: ["brand_rule"] });
    expect(before.length).toBeGreaterThan(0);
    const kit = (await getBrand(a.userId, fern.id))!;
    const dontRules = kit.dontRules.map((r) => (r.startsWith("Mock people") ? "Talk down to beginners" : r));
    await updateBrand(a, fern.id, { ...kit, dontRules });
    expect(await searchContext(a.userId, { query: "mock people new outdoors", brandId: fern.id, kinds: ["brand_rule"] })).toHaveLength(0);
    const after = await searchContext(a.userId, { query: "beginners", brandId: fern.id, kinds: ["brand_rule"] });
    expect(after.map((h) => h.body)).toContain("Talk down to beginners");
  });

  it("S2-5 #3: kind and brand filters narrow results; another brand's items never appear", async () => {
    const all = await listBrands(a.userId);
    const fern = all.find((x) => x.slug === "fernhollow")!;
    const quill = all.find((x) => x.slug === "quillmoor")!;
    const any = await searchContext(a.userId, { query: "plan" });
    const quillOnly = await searchContext(a.userId, { query: "plan", brandId: quill.id });
    expect(quillOnly.length).toBeGreaterThan(0);
    expect(quillOnly.every((h) => h.brandId === quill.id)).toBe(true);
    const products = await searchContext(a.userId, { query: "plan", brandId: quill.id, kinds: ["product"] });
    expect(products.every((h) => h.kind === "product")).toBe(true);
    expect(products.length).toBeGreaterThan(0);
    expect(products.length).toBeLessThan(quillOnly.length);
    const fernJackets = await searchContext(a.userId, { query: "jacket", brandId: fern.id });
    expect(fernJackets.every((h) => h.brandId === fern.id)).toBe(true);
    expect(any.length).toBeGreaterThanOrEqual(quillOnly.length);
  });

  it("S2-3 #4: the customer summary matches direct queries on the data", async () => {
    const fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!;
    const s = (await getCustomerSummary(a.userId, fern.id))!;
    const sql = getSql();
    const [d] = await sql`select (select count(*)::int from public.customers where brand_id = ${fern.id}) as c,
      (select count(*)::int from public.orders where brand_id = ${fern.id}) as o`;
    expect(s.customers).toBe(d.c);
    expect(s.orders).toBe(d.o);
    expect(s.byRegion.reduce((t, r) => t + r.count, 0)).toBe(d.c);
    expect(s.byAgeBand.reduce((t, r) => t + r.count, 0)).toBe(d.c);
    expect(s.ordersByMonth).toHaveLength(24);
    expect(s.ordersByMonth[23].month).toBe("2026-03");
    expect(s.ordersByMonth[0].month).toBe("2024-04");
    expect(s.asOf).toBe(REF.toISOString());
    // Orders within the 24 visible months: every order, since the data covers exactly that window.
    expect(s.ordersByMonth.reduce((t, r) => t + r.count, 0)).toBe(d.o);
    const monthly = await sql`select to_char(ordered_at at time zone 'UTC', 'YYYY-MM') as month, count(*)::int as n
      from public.orders where brand_id = ${fern.id} group by 1`;
    for (const m of monthly) expect(s.ordersByMonth.find((x) => x.month === m.month)?.count, m.month).toBe(m.n);
    const [direct] = await sql`with per as (select customer_id, count(*) n, max(ordered_at) last_at from public.orders where brand_id = ${fern.id} group by 1)
      select (select count(*)::int from per where n >= 2) as repeaters,
             (select count(*)::int from per where last_at < ${REF}::timestamptz - interval '12 months') as lapsed`;
    expect(s.repeatRate).toBeCloseTo(direct.repeaters / d.c, 6);
    expect(s.lapsed).toBe(direct.lapsed);
    expect(s.lapsed / d.c).toBeGreaterThanOrEqual(0.15);
    expect(await getCustomerSummary(b.userId, fern.id)).toBeNull();
  });

  it("review 5: the lapsed context item counts back from the data date", async () => {
    const fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!;
    const s = (await getCustomerSummary(a.userId, fern.id))!;
    const [hit] = await searchContext(a.userId, { query: "lapsed", brandId: fern.id, kinds: ["segment"] });
    expect(hit.body).toContain(s.lapsed.toLocaleString("en-GB"));
    expect(hit.body).toContain("15 March 2026");
  });

  it("review 7: two loads at once add the brands once; the other is told they are already there", async () => {
    const c = await createMember();
    const results = await Promise.allSettled([loadDemoBrands(c, { refDate: REF }), loadDemoBrands(c, { refDate: REF })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(DemoAlreadyLoadedError);
    expect(await listBrands(c.userId, c.workspaceId)).toHaveLength(2);
  }, 120_000);

  it("S2-5 #4: another workspace gets nothing from search", async () => {
    expect(await searchContext(b.userId, { query: "lapsed" })).toEqual([]);
    const fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!;
    expect(await searchContext(b.userId, { query: "jacket", brandId: fern.id })).toEqual([]);
  });

  it("S2-5 #5: hostile search strings return normally, never an error", async () => {
    for (const q of ["' or 1=1 --", "&", ":*", "a & (b | !c)", "x".repeat(1000), "", "   ", "<script>alert(1)</script>"]) {
      const hits = await searchContext(a.userId, { query: q });
      expect(Array.isArray(hits), q.slice(0, 20)).toBe(true);
    }
  });
});
