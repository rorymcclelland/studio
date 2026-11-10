// U10-7 #3 in CI: the brand page's tabs, as a pure module. The page reads its
// tab from the address (?tab=<id>), so a shared link opens that tab, and an
// unknown, missing or malformed tab shows the first (Audience). The browser test
// of the same case is "U10-7 #3" in tests/e2e/brand-page.spec.ts, whose header
// has the whole interface.
//
// src/lib/brands/tabs.ts (NEW, PURE: no imports at all, so the page, the tabs
// and these tests share it):
//   BRAND_TAB_PARAM = "tab"
//   BRAND_TABS: readonly { id: BrandTabId; label: string }[], in this order:
//     audience "Audience" (segments and market notes), voice "Voice and visual" (the kit summary, linking to
//     the kit editor), legal "Legal and languages", products "Products and data" (products, charts)
//   type BrandTabId = "audience" | "voice" | "legal" | "products"
//   DEFAULT_BRAND_TAB: BrandTabId = "audience" (the first)
//   parseBrandTab(value: string | string[] | undefined | null) => BrandTabId: a known id, exactly as written,
//     gives that tab; an array (?tab=a&tab=b) is read by its first value; anything else (missing, empty, unknown,
//     another case, padded with spaces) gives DEFAULT_BRAND_TAB. Never throws.
//   brandTabHref(brandId: string, tab: BrandTabId) => string: `/brands/<brandId>?tab=<tab>`, the address a tab
//     shows and a person shares.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_TAB_PARAM, BRAND_TABS, brandTabHref, DEFAULT_BRAND_TAB, parseBrandTab } from "@/lib/brands/tabs";

const BRAND = "f0000000-0000-4000-8000-000000000002";

describe("U10-7 #3 the brand page's tabs and their address", () => {
  it("has the four agreed tabs, in order, with their labels; the first is the default", () => {
    expect(BRAND_TABS.map((t) => [t.id, t.label])).toEqual([
      ["audience", "Audience"],
      ["voice", "Voice and visual"],
      ["legal", "Legal and languages"],
      ["products", "Products and data"],
    ]);
    expect(DEFAULT_BRAND_TAB).toBe("audience");
    expect(BRAND_TABS[0].id).toBe(DEFAULT_BRAND_TAB);
    expect(BRAND_TAB_PARAM).toBe("tab");
  });

  it("the ids are the ones U10-6's budgets measure (tests/e2e/page-budgets.ts: brand-quillmoor-<id>)", async () => {
    const { PAGE_BUDGETS } = await import("../e2e/page-budgets");
    const measured = PAGE_BUDGETS.map((b) => b.key)
      .filter((k) => k.startsWith("brand-quillmoor-"))
      .map((k) => k.slice("brand-quillmoor-".length));
    expect(measured).toEqual(BRAND_TABS.map((t) => t.id));
  });

  it("a known tab, exactly as written, opens that tab", () => {
    for (const t of BRAND_TABS) expect(parseBrandTab(t.id), t.id).toBe(t.id);
  });

  it("an unknown, missing or malformed tab shows the first", () => {
    for (const value of [undefined, null, "", " ", "nope", "Audience", "VOICE", " voice", "voice ", "products/", "legal&x=1", "__proto__", "constructor", "toString", "0", "1"]) {
      expect(parseBrandTab(value), JSON.stringify(value)).toBe("audience");
    }
  });

  it("a repeated tab (?tab=voice&tab=legal) is read by its first value", () => {
    expect(parseBrandTab(["voice", "legal"])).toBe("voice");
    expect(parseBrandTab(["nope", "legal"])).toBe("audience");
    expect(parseBrandTab([])).toBe("audience");
  });

  it("each tab's address is the brand page with ?tab=<id>, and reads back as the same tab", () => {
    for (const t of BRAND_TABS) {
      const href = brandTabHref(BRAND, t.id);
      expect(href, t.id).toBe(`/brands/${BRAND}?tab=${t.id}`);
      const url = new URL(href, "http://x");
      expect(url.pathname).toBe(`/brands/${BRAND}`);
      expect(parseBrandTab(url.searchParams.getAll(BRAND_TAB_PARAM)), t.id).toBe(t.id);
    }
  });

  it("is pure: the module imports nothing, so the server page and the client tabs can both use it", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/brands/tabs.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(/);
  });
});
