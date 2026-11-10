// Sprint 10b, D-1 New brand, against the real database: createBrand() (as the
// New brand form calls it, through asUser()) makes a person's own brand in the
// reader's workspace, neither fictional nor simulated; a short name the
// workspace already uses is refused and nothing is made; markup and SQL in a
// name are stored as text; and another workspace never sees the brand (rule 7).
// The interface is in the header of tests/e2e/new-brand.spec.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BrandInputError, createBrand, deleteBrand, getBrand, listBrands, updateBrand } from "@/lib/brands/repo";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { BRIGHTWATER, HOSTILE_BRAND_NAME } from "../fixtures/new-brand";
import { createMember, truncateAll } from "../helpers/db";

const kit = (name: string, slug: string) => ({
  name, slug, description: BRIGHTWATER.description, category: BRIGHTWATER.category, toneWords: [], voiceNotes: "", doRules: [], dontRules: [],
  palette: [], fontPrimary: "", fontSecondary: "", legalLines: [], bannedTerms: [], evidenceClaims: [],
});

const count = async (m: { userId: string }) => Number((await asUser(m.userId, (tx) => tx`select count(*)::int as n from public.brands`))[0].n);

describe("D-1 a new brand in the database", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("D-1 #1 createBrand() makes the brand in the reader's workspace, neither fictional nor simulated, with no data", async () => {
    const m = await createMember();
    const id = await createBrand(m, kit(BRIGHTWATER.name, BRIGHTWATER.slug));
    const brand = await getBrand(m.userId, id);
    expect(brand).toMatchObject({ id, workspaceId: m.workspaceId, name: BRIGHTWATER.name, category: BRIGHTWATER.category, isFictional: false, isSimulated: false, ownNames: [], dataAsOf: null });
    const [row] = await asUser(m.userId, (tx) => tx`
      select b.is_fictional, b.is_simulated, b.own_names,
        (select count(*)::int from public.customers c where c.brand_id = b.id) as customers,
        (select count(*)::int from public.products p where p.brand_id = b.id) as products
      from public.brands b where b.id = ${id}`);
    expect(row).toMatchObject({ is_fictional: false, is_simulated: false, own_names: [], customers: 0, products: 0 });
    expect((await listBrands(m.userId, m.workspaceId)).map((b) => b.name)).toEqual([BRIGHTWATER.name]);
  });

  it("D-1 #2 a short name another brand in the workspace uses is refused with the field error, and nothing is made", async () => {
    const m = await createMember();
    await createBrand(m, kit(BRIGHTWATER.name, BRIGHTWATER.slug));
    const before = await count(m);
    const err = await createBrand(m, kit("Brightwater Kitchen Two", BRIGHTWATER.slug)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BrandInputError);
    expect((err as BrandInputError).fieldErrors).toEqual({ slug: "Already used by another brand." });
    expect(await count(m)).toBe(before);
    // Another workspace may use the same short name for its own brand.
    const other = await createMember();
    await expect(createBrand(other, kit("Brightwater Kitchen", BRIGHTWATER.slug))).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("D-1 #4 markup and SQL in a name are stored as text, exactly as typed", async () => {
    const m = await createMember();
    const id = await createBrand(m, kit(HOSTILE_BRAND_NAME, "hostile-name"));
    expect((await getBrand(m.userId, id))!.name).toBe(HOSTILE_BRAND_NAME);
    // The brands table is still there, with both brands in it.
    await createBrand(m, kit(BRIGHTWATER.name, BRIGHTWATER.slug));
    expect(await count(m)).toBe(2);
  });

  it("D-1 #4 another workspace never sees, changes or removes the new brand", async () => {
    const a = await createMember();
    const b = await createMember();
    const id = await createBrand(a, kit(BRIGHTWATER.name, BRIGHTWATER.slug));
    expect(await getBrand(b.userId, id)).toBeNull();
    expect(await listBrands(b.userId)).toEqual([]);
    expect(await listBrands(b.userId, a.workspaceId)).toEqual([]);
    expect(await updateBrand(b, id, kit("Taken over", "taken"))).toBe(false);
    expect(await deleteBrand(b.userId, id)).toBe(false);
    expect(await asUser(b.userId, (tx) => tx`select id from public.brands where id = ${id}`)).toHaveLength(0);
    // B can't make a brand in A's workspace either: createBrand writes the reader's member workspace, and RLS refuses another.
    await expect(createBrand({ userId: b.userId, workspaceId: a.workspaceId }, kit("Planted", "planted"))).rejects.toThrow(/row-level security/);
    expect((await getBrand(a.userId, id))!.name).toBe(BRIGHTWATER.name);
    expect(await count(a)).toBe(1);
  });
});
