// S2-3: the brand overview's product list reads only the member's own brand.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createBrand } from "@/lib/brands/repo";
import { listProducts } from "@/lib/brands/products";
import { createMember, truncateAll } from "../helpers/db";

const input = (slug: string) => ({
  name: `Brand ${slug}`, slug, description: "", category: "", toneWords: [], voiceNotes: "", doRules: [], dontRules: [],
  palette: [], fontPrimary: "", fontSecondary: "", legalLines: [], bannedTerms: [], evidenceClaims: [],
});

async function addProduct(m: { userId: string; workspaceId: string }, brandId: string, name: string, pence: number, active = true) {
  await asUser(m.userId, (tx) => tx`insert into public.products (workspace_id, brand_id, name, category, price_pence, active)
    values (${m.workspaceId}, ${brandId}, ${name}, 'Jackets', ${pence}, ${active})`);
}

describe("listProducts", () => {
  beforeEach(truncateAll);
  afterAll(closeSql);

  it("lists one brand's products by category then name, with price in pence", async () => {
    const m = await createMember();
    const a = await createBrand(m, input("a"));
    const other = await createBrand(m, input("b"));
    await addProduct(m, a, "Ridge jacket", 18900);
    await addProduct(m, a, "Bothy jacket", 15900, false);
    await addProduct(m, other, "Not this one", 100);
    const rows = await listProducts(m.userId, a);
    expect(rows.map((p) => [p.name, p.category, p.pricePence, p.active])).toEqual([
      ["Bothy jacket", "Jackets", 15900, false],
      ["Ridge jacket", "Jackets", 18900, true],
    ]);
  });

  it("returns nothing for another workspace's brand or a malformed id", async () => {
    const m = await createMember();
    const n = await createMember();
    const a = await createBrand(m, input("a"));
    await addProduct(m, a, "Ridge jacket", 18900);
    expect(await listProducts(n.userId, a)).toEqual([]);
    expect(await listProducts(m.userId, "not-a-uuid")).toEqual([]);
  });
});
