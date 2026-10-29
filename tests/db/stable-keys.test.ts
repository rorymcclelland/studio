// F-11 test cases 1 to 6: kit context items keyed by their own text.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBrand, listBrands, updateBrand } from "@/lib/brands/repo";
import { parseBrandInput } from "@/lib/brands/schema";
import { textKey } from "@/lib/context/keys";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { createMember, truncateAll } from "../helpers/db";

let a: { userId: string; workspaceId: string };
let fernId: string;

async function ruleItems(brandId: string) {
  return asUser(a.userId, (tx) => tx`
    select id, source_ref, body from public.context_items
    where brand_id = ${brandId} and kind = 'brand_rule' order by source_ref`);
}

describe("F-11 stable kit keys", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    await loadDemoBrands(a, { refDate: new Date("2026-03-15T10:30:00Z") });
    fernId = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!.id;
  }, 120_000);
  afterAll(closeSql);

  it("#1 deleting the first do rule leaves the other rules' keys and ids alone", async () => {
    const kit = (await getBrand(a.userId, fernId))!;
    expect(kit.doRules.length).toBeGreaterThanOrEqual(3);
    const before = await ruleItems(fernId);
    await updateBrand(a, fernId, { ...kit, doRules: kit.doRules.slice(1) });
    const after = await ruleItems(fernId);
    const removed = before.find((r) => r.body === kit.doRules[0])!;
    expect(after.find((r) => r.id === removed.id)).toBeUndefined();
    for (const r of before.filter((x) => x.id !== removed.id)) {
      expect(after.find((x) => x.id === r.id)?.source_ref).toBe(r.source_ref);
    }
    await updateBrand(a, fernId, kit); // put it back
  });

  it("#2 reordering rules changes no keys", async () => {
    const kit = (await getBrand(a.userId, fernId))!;
    const before = await ruleItems(fernId);
    await updateBrand(a, fernId, { ...kit, doRules: [...kit.doRules].reverse(), dontRules: [...kit.dontRules].reverse() });
    const after = await ruleItems(fernId);
    expect(after.map((r) => [r.id, r.source_ref])).toEqual(before.map((r) => [r.id, r.source_ref]));
  });

  it("#3 editing a rule's text makes a new key and removes the old item and its edges", async () => {
    const kit = (await getBrand(a.userId, fernId))!;
    const [old] = (await ruleItems(fernId)).filter((r) => r.body === kit.doRules[0]);
    // An edge from the old rule to another item, as an agent might add.
    await asUser(a.userId, (tx) => tx`
      insert into public.context_edges (workspace_id, from_item, to_item, relation)
      select ${a.workspaceId}, ${old.id}, id, 'supports' from public.context_items
      where brand_id = ${fernId} and source_ref = 'voice'`);
    await updateBrand(a, fernId, { ...kit, doRules: [`${kit.doRules[0]} Always.`, ...kit.doRules.slice(1)] });
    const after = await ruleItems(fernId);
    expect(after.find((r) => r.id === old.id)).toBeUndefined();
    expect(after.find((r) => r.source_ref === `rule:do:${textKey(`${kit.doRules[0]} Always.`)}`)).toBeDefined();
    const [{ n }] = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.context_edges where from_item = ${old.id}`);
    expect(n).toBe(0);
    await updateBrand(a, fernId, kit);
  });

  it("#4 a duplicate rule, even differing only in case or spacing, is refused on the second copy", () => {
    const base = { name: "Test", slug: "test" };
    const r = parseBrandInput({ ...base, doRules: ["Show real weather", "  show   REAL weather "] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors["doRules.1"]).toMatch(/already in the list/);
    const legal = parseBrandInput({ ...base, legalLines: ["Terms apply.", "terms apply."] });
    expect(legal.ok).toBe(false);
    if (!legal.ok) expect(legal.fieldErrors["legalLines.1"]).toBeDefined();
    expect(parseBrandInput({ ...base, doRules: ["Show real weather"], dontRules: ["Show real weather"] }).ok).toBe(true);
  });

  it("#5 the migration re-keys items stored under the old positional scheme, keeping ids; a re-sync then changes nothing", async () => {
    const sql = getSql();
    // The SQL key matches the app's key for the same text.
    for (const t of ["Show real weather", "  Mixed   CASE\ttext ", "Café crème — naïve VIVID", "CAFÉ", "x".repeat(300)]) {
      const [{ k }] = await sql`select public.kit_text_key(${t}) as k`;
      expect(k).toBe(textKey(t));
    }
    // Put Fernhollow's rules back to positional keys, with a duplicate, as an old load would have.
    const kit = (await getBrand(a.userId, fernId))!;
    for (const [i, r] of kit.doRules.entries()) {
      await sql`update public.context_items set source_ref = ${`rule:do:${i}`} where brand_id = ${fernId} and source_ref = ${`rule:do:${textKey(r)}`}`;
    }
    await sql`insert into public.context_items (workspace_id, brand_id, kind, title, body, source, source_ref, created_by_kind)
      values (${a.workspaceId}, ${fernId}, 'brand_rule', 'Do: dup', ${kit.doRules[0]}, 'Brand kit', ${`rule:do:${kit.doRules.length}`}, 'system')`;
    const before = await ruleItems(fernId);
    const migration = readFileSync("db/migrations/20261026000001_stable_kit_keys.sql", "utf8");
    await sql.unsafe(migration.slice(migration.indexOf("$$;") + 3));
    const after = await ruleItems(fernId);
    expect(after.length).toBe(before.length - 1);
    for (const r of after) {
      expect(r.source_ref).toMatch(/^rule:(do|dont):[0-9a-f]{12}$/);
      expect(before.find((b) => b.id === r.id)).toBeDefined();
    }
    await updateBrand(a, fernId, kit);
    const resynced = await ruleItems(fernId);
    expect(resynced.map((r) => [r.id, r.source_ref])).toEqual(after.map((r) => [r.id, r.source_ref]));
  });

  it("#6 a long rule full of SQL and markup is stored and keyed safely", async () => {
    const kit = (await getBrand(a.userId, fernId))!;
    const nasty = `'); drop table public.brands; -- <script>alert(1)</script> ${"%_\\".repeat(60)}`.slice(0, 300);
    await updateBrand(a, fernId, { ...kit, dontRules: [...kit.dontRules, nasty] });
    const items = await ruleItems(fernId);
    expect(items.find((r) => r.source_ref === `rule:dont:${textKey(nasty)}`)?.body).toBe(nasty);
    await updateBrand(a, fernId, kit);
  });
});
