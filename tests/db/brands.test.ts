// S2-2 test cases 1 to 4: brand tables, tenancy and cascades.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { createBrand, deleteBrand, getBrand, listBrands, updateBrand } from "@/lib/brands/repo";
import { createMember, truncateAll } from "../helpers/db";

const NEW_TABLES = ["brands", "products", "customers", "orders", "order_lines"];
const ALL_NEW_TABLES = [...NEW_TABLES, "context_items", "context_edges"];

const input = (name = "Fernhollow Outfitters", slug = "fernhollow") => ({
  name, slug, description: "Outdoor clothing.", category: "Outdoor apparel",
  toneWords: ["warm"], voiceNotes: "", doRules: [], dontRules: [],
  palette: [{ name: "Moss", hex: "#3F5B3A" }], fontPrimary: "Figtree", fontSecondary: "",
  legalLines: [], bannedTerms: [], evidenceClaims: [],
});

async function addCatalogue(userId: string, workspaceId: string, brandId: string) {
  return asUser(userId, async (tx) => {
    const [p] = await tx`insert into public.products (workspace_id, brand_id, name, category, price_pence)
      values (${workspaceId}, ${brandId}, 'Ridge jacket', 'Jackets', 18900) returning id`;
    const [c] = await tx`insert into public.customers (workspace_id, brand_id, external_ref, region, age_band, first_order_on)
      values (${workspaceId}, ${brandId}, 'C-0001', 'Scotland', '35-44', '2025-01-10') returning id`;
    const [o] = await tx`insert into public.orders (workspace_id, brand_id, customer_id, ordered_at, channel)
      values (${workspaceId}, ${brandId}, ${c.id}, '2025-01-10', 'web') returning id`;
    await tx`insert into public.order_lines (workspace_id, order_id, product_id, quantity, price_pence)
      values (${workspaceId}, ${o.id}, ${p.id}, 1, 18900)`;
  });
}

async function counts(userId: string) {
  const out: Record<string, number> = {};
  for (const t of NEW_TABLES) {
    const [r] = await asUser(userId, (tx) => tx.unsafe(`select count(*)::int as n from public.${t}`));
    out[t] = r.n;
  }
  return out;
}

describe("brand data model", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("S2-2 #1: a member reads and writes their workspace's brands and catalogue", async () => {
    const m = await createMember();
    const id = await createBrand(m, input());
    await addCatalogue(m.userId, m.workspaceId, id);
    expect(await counts(m.userId)).toEqual({ brands: 1, products: 1, customers: 1, orders: 1, order_lines: 1 });
    await updateBrand(m, id, { ...input(), toneWords: ["warm", "plain-spoken"] });
    expect((await getBrand(m.userId, id))!.toneWords).toEqual(["warm", "plain-spoken"]);
    expect((await listBrands(m.userId)).map((b) => b.name)).toEqual(["Fernhollow Outfitters"]);
  });

  it("S2-2 #2: workspace A sees none of B's rows and cannot write into B", async () => {
    const a = await createMember();
    const b = await createMember();
    const bBrand = await createBrand(b, input());
    await addCatalogue(b.userId, b.workspaceId, bBrand);
    expect(await counts(a.userId)).toEqual({ brands: 0, products: 0, customers: 0, orders: 0, order_lines: 0 });
    expect(await getBrand(a.userId, bBrand)).toBeNull();
    // Writing with B's workspace id is refused by row-level security.
    await expect(createBrand({ ...a, workspaceId: b.workspaceId }, input("Intruder", "intruder"))).rejects.toThrow(/row-level security/);
    // Attaching A's rows to B's brand is refused too (brand and workspace must match).
    await expect(asUser(a.userId, (tx) => tx`insert into public.products (workspace_id, brand_id, name, category, price_pence)
      values (${a.workspaceId}, ${bBrand}, 'Smuggled', 'X', 1)`)).rejects.toThrow(/foreign key/);
    // Updates and deletes across workspaces change nothing.
    expect(await updateBrand(a, bBrand, input("Renamed", "renamed"))).toBe(false);
    expect(await deleteBrand(a.userId, bBrand)).toBe(false);
    expect(await getBrand(b.userId, bBrand)).not.toBeNull();
  });

  it("S2-2 #2b: no new table accepts a row for another workspace", async () => {
    const a = await createMember();
    const b = await createMember();
    const bBrand = await createBrand(b, input());
    await addCatalogue(b.userId, b.workspaceId, bBrand);
    const [ids] = await asUser(b.userId, (tx) => tx`select
      (select id from public.customers limit 1) as customer, (select id from public.orders limit 1) as "order",
      (select id from public.products limit 1) as product, (select id from public.context_items limit 1) as item`);
    const attempts: [string, (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => Promise<unknown>][] = [
      ["customers", (tx) => tx`insert into public.customers (workspace_id, brand_id, external_ref) values (${b.workspaceId}, ${bBrand}, 'X-1')`],
      ["orders", (tx) => tx`insert into public.orders (workspace_id, brand_id, customer_id, ordered_at, channel) values (${b.workspaceId}, ${bBrand}, ${ids.customer}, now(), 'web')`],
      ["order_lines", (tx) => tx`insert into public.order_lines (workspace_id, order_id, product_id, quantity, price_pence) values (${b.workspaceId}, ${ids.order}, ${ids.product}, 1, 1)`],
      ["context_items", (tx) => tx`insert into public.context_items (workspace_id, brand_id, kind, title, source) values (${b.workspaceId}, ${bBrand}, 'insight', 'x', 'x')`],
      ["context_edges", (tx) => tx`insert into public.context_edges (workspace_id, from_item, to_item, relation) values (${b.workspaceId}, ${ids.item}, ${ids.item}, 'mentions')`],
    ];
    for (const [table, write] of attempts) {
      await expect(asUser(a.userId, write), table).rejects.toThrow(/row-level security/);
    }
  });

  it("review 4: the simulated flag, creator and workspace cannot change; the database checks palettes", async () => {
    const m = await createMember();
    const id = await createBrand(m, input(), { simulated: true });
    await expect(asUser(m.userId, (tx) => tx`update public.brands set is_simulated = false where id = ${id}`)).rejects.toThrow(/cannot be changed/);
    await expect(asUser(m.userId, (tx) => tx`update public.brands set palette = ${tx.json([{ name: "x", hex: "red;background:url(x)" }])} where id = ${id}`)).rejects.toThrow(/brands_palette_valid/);
    await expect(asUser(m.userId, (tx) => tx`update public.brands set palette = ${tx.json([{ name: "x", hex: "#112233", extra: "y" }])} where id = ${id}`)).rejects.toThrow(/brands_palette_valid/);
    expect((await getBrand(m.userId, id))!.isSimulated).toBe(true);
  });

  it("review 3: a kit at every list limit still saves (context text is capped)", async () => {
    const m = await createMember();
    const big = { ...input(), bannedTerms: Array.from({ length: 50 }, (_, i) => `${i}`.padEnd(80, "x")),
      doRules: Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(300, "d")) };
    await expect(createBrand(m, big)).resolves.toBeTruthy();
  });

  it("S2-2 #3: the anonymous role reads nothing from any new table", async () => {
    const m = await createMember();
    await addCatalogue(m.userId, m.workspaceId, await createBrand(m, input()));
    for (const t of ALL_NEW_TABLES) {
      const r = await asAnon((tx) => tx.unsafe(`select 1 from public.${t}`)).catch((e: Error) => e);
      if (r instanceof Error) expect(r.message).toMatch(/permission denied/);
      else expect(r.length, t).toBe(0);
    }
  });

  it("S2-2 #4: deleting a brand removes its catalogue and nothing of another brand", async () => {
    const m = await createMember();
    const one = await createBrand(m, input());
    const two = await createBrand(m, input("Ledgerly", "ledgerly"));
    await addCatalogue(m.userId, m.workspaceId, one);
    await addCatalogue(m.userId, m.workspaceId, two);
    expect(await deleteBrand(m.userId, one)).toBe(true);
    expect(await counts(m.userId)).toEqual({ brands: 1, products: 1, customers: 1, orders: 1, order_lines: 1 });
    expect((await listBrands(m.userId)).map((b) => b.slug)).toEqual(["ledgerly"]);
  });

  it("slugs are unique within a workspace but may repeat across workspaces", async () => {
    const a = await createMember();
    const b = await createMember();
    await createBrand(a, input());
    await expect(createBrand(a, input("Other", "fernhollow"))).rejects.toThrow(/already used/);
    await expect(createBrand(b, input())).resolves.toBeTruthy();
  });

  it("stores a sanitised logo and refuses invalid input", async () => {
    const m = await createMember();
    const id = await createBrand(m, { ...input(), logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><rect width="1" height="1"/></svg>' });
    expect((await getBrand(m.userId, id))!.logoSvg).not.toMatch(/onload/);
    await expect(createBrand(m, { ...input("Bad", "bad"), palette: [{ name: "x", hex: "nope" }] })).rejects.toThrow(/hex/i);
  });
});
