// Sprint 10b, D-2 #1: fictional versus simulated, in the database. After the
// migration, brands.is_fictional says "this brand is invented" and
// brands.is_simulated says only "this brand's data is simulated". The demo
// brands (Fernhollow and Quillmoor) are both; a person's new brand is neither.
// brands.own_names holds up to 5 names the brand's copy may use (D-2's own
// names, such as a parent brand's). The interface is in the header of
// tests/e2e/new-brand.spec.ts. No new table: brands keeps its workspace_id and
// row-level security, checked here for the new columns (rule 7).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BrandInputError, createBrand, FICTIONAL_OWN_NAMES, getBrand, listBrands, updateBrand } from "@/lib/brands/repo";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { BRIGHTWATER, TIDEWELL } from "../fixtures/new-brand";
import { createMember, truncateAll } from "../helpers/db";

const MIGRATIONS = join(process.cwd(), "db/migrations");

const kit = (name: string, slug: string, extra: Record<string, unknown> = {}) => ({
  name, slug, description: "", category: "Home cooking", toneWords: [], voiceNotes: "", doRules: [], dontRules: [],
  palette: [], fontPrimary: "", fontSecondary: "", legalLines: [], bannedTerms: [], evidenceClaims: [], ...extra,
});

describe("D-2 #1 fictional versus simulated, after the migration", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("D-2 #1 the columns: is_fictional boolean not null default false, own_names text[] not null default empty", async () => {
    const cols = await getSql()`
      select column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'brands' and column_name in ('is_fictional', 'own_names', 'is_simulated')
      order by column_name`;
    expect(cols.map((c) => [c.column_name, c.data_type, c.is_nullable])).toEqual([
      ["is_fictional", "boolean", "NO"],
      ["is_simulated", "boolean", "NO"],
      ["own_names", "ARRAY", "NO"],
    ]);
    expect(cols.find((c) => c.column_name === "is_fictional")!.column_default).toBe("false");
    expect(cols.find((c) => c.column_name === "own_names")!.column_default).toMatch(/^'\{\}'::text\[\]$/);
  });

  it("D-2 #1 the migration sets is_fictional for every brand that was simulated (the demo brands) before the guard holds it", () => {
    const file = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .find((f) => /add column (if not exists )?is_fictional/i.test(readFileSync(join(MIGRATIONS, f), "utf8")));
    expect(file, "a migration that adds brands.is_fictional").toBeDefined();
    const sql = readFileSync(join(MIGRATIONS, file!), "utf8");
    const backfill = sql.search(/update\s+public\.brands\s+set\s+is_fictional\s*=\s*true\s+where\s+is_simulated/i);
    expect(backfill, "the backfill of the existing demo brands").toBeGreaterThan(-1);
    const guard = sql.search(/create (or replace )?function public\.brands_guard/i);
    expect(guard, "brands_guard, changed to hold is_fictional").toBeGreaterThan(-1);
    expect(backfill, "the backfill runs before the guard holds is_fictional").toBeLessThan(guard);
    // It comes after every migration that was already applied (the runner refuses edits to those).
    const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(file!)).toBeGreaterThan(all.indexOf("20261109000001_spend_meter.sql"));
  });

  it("D-2 #1 Fernhollow and Quillmoor are fictional and simulated; a new brand is neither", async () => {
    const m = await createMember();
    await loadDemoBrands(m, { refDate: new Date("2026-11-10T00:00:00Z") });
    const own = await createBrand(m, kit(BRIGHTWATER.name, BRIGHTWATER.slug));
    const brands = await listBrands(m.userId, m.workspaceId);
    const flags = Object.fromEntries(brands.map((b) => [b.slug, [b.isFictional, b.isSimulated]]));
    expect(flags).toEqual({ fernhollow: [true, true], quillmoor: [true, true], [BRIGHTWATER.slug]: [false, false] });
    expect((await getBrand(m.userId, own))!.ownNames).toEqual([]);
  });

  it("D-2 #1 is_fictional never changes; is_simulated may become true (D-3) but never false again", async () => {
    const m = await createMember();
    const id = await createBrand(m, kit(BRIGHTWATER.name, BRIGHTWATER.slug));
    await expect(asUser(m.userId, (tx) => tx`update public.brands set is_fictional = true where id = ${id}`)).rejects.toThrow(/cannot be changed/);
    await asUser(m.userId, (tx) => tx`update public.brands set is_simulated = true where id = ${id}`);
    expect((await getBrand(m.userId, id))!.isSimulated).toBe(true);
    await expect(asUser(m.userId, (tx) => tx`update public.brands set is_simulated = false where id = ${id}`)).rejects.toThrow(/cannot be changed/);
    // A demo brand stays fictional.
    await loadDemoBrands(m, { refDate: new Date("2026-11-10T00:00:00Z") });
    const fern = (await listBrands(m.userId)).find((b) => b.slug === "fernhollow")!.id;
    await expect(asUser(m.userId, (tx) => tx`update public.brands set is_fictional = false where id = ${fern}`)).rejects.toThrow(/cannot be changed/);
    expect((await getBrand(m.userId, id))!.isFictional).toBe(false);
  });

  it("D-2 #1 own names are saved with the kit; the database holds at most 5", async () => {
    const m = await createMember();
    const id = await createBrand(m, kit(TIDEWELL.name, TIDEWELL.slug, { ownNames: [...TIDEWELL.ownNames] }));
    expect((await getBrand(m.userId, id))!.ownNames).toEqual(["Brightwater"]);
    const six = ["One", "Two", "Three", "Four", "Five", "Six"];
    await expect(asUser(m.userId, (tx) => tx`update public.brands set own_names = ${six} where id = ${id}`)).rejects.toMatchObject({ code: "23514" });
    expect((await getBrand(m.userId, id))!.ownNames).toEqual(["Brightwater"]);
  });

  it("D-2 #1 another workspace can't read or change a brand's flags or own names", async () => {
    const a = await createMember();
    const b = await createMember();
    const id = await createBrand(a, kit(TIDEWELL.name, TIDEWELL.slug, { ownNames: [...TIDEWELL.ownNames] }));
    expect(await asUser(b.userId, (tx) => tx`select own_names, is_fictional from public.brands where id = ${id}`)).toHaveLength(0);
    const res = await asUser(b.userId, (tx) => tx`update public.brands set own_names = ${["Taken"]} where id = ${id}`);
    expect(res.count).toBe(0);
    expect((await getBrand(a.userId, id))!.ownNames).toEqual(["Brightwater"]);
  });

  it("review fix S1 (rule 2): a fictional brand has no own names: the database refuses them (23514) and updateBrand refuses them with a field error; the demo brands load", async () => {
    const m = await createMember();
    await loadDemoBrands(m, { refDate: new Date("2026-11-10T00:00:00Z") });
    const demo = (await listBrands(m.userId, m.workspaceId)).filter((b) => b.isFictional);
    expect(demo.map((b) => b.slug).sort()).toEqual(["fernhollow", "quillmoor"]);
    for (const b of demo) expect(b.ownNames).toEqual([]);
    const fern = demo.find((b) => b.slug === "fernhollow")!;

    await expect(asUser(m.userId, (tx) => tx`update public.brands set own_names = ${["Brightwater"]} where id = ${fern.id}`)).rejects.toMatchObject({
      code: "23514",
      constraint_name: "brands_fictional_no_own_names",
    });
    const [check] = await getSql()`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'brands_fictional_no_own_names'`;
    expect(check.def).toMatch(/NOT is_fictional\)? OR \(?cardinality\(own_names\) = 0/);

    const kitOf = kit(fern.name, fern.slug, {
      description: fern.description, category: fern.category, toneWords: fern.toneWords, voiceNotes: fern.voiceNotes, doRules: fern.doRules, dontRules: fern.dontRules,
      palette: fern.palette, fontPrimary: fern.fontPrimary, fontSecondary: fern.fontSecondary, legalLines: fern.legalLines, bannedTerms: fern.bannedTerms, evidenceClaims: fern.evidenceClaims,
    });
    const err = await updateBrand(m, fern.id, { ...kitOf, ownNames: ["Brightwater"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BrandInputError);
    expect((err as BrandInputError).fieldErrors).toEqual({ ownNames: FICTIONAL_OWN_NAMES });
    expect((await getBrand(m.userId, fern.id))!.ownNames).toEqual([]);
    // The same kit without own names saves, as before.
    expect(await updateBrand(m, fern.id, { ...kitOf, ownNames: [] })).toBe(true);
    // A person's own brand keeps them (D-2).
    const own = await createBrand(m, kit(TIDEWELL.name, TIDEWELL.slug, { ownNames: [...TIDEWELL.ownNames] }));
    expect((await getBrand(m.userId, own))!.ownNames).toEqual(["Brightwater"]);
  });
});
