// U10-7: the brand page's reference data, as tabs whose address is ?tab=<id>,
// so a shared link opens the same tab. Pure, with no imports, so the server
// page, the client tabs and the tests all share it.

export const BRAND_TAB_PARAM = "tab";

export type BrandTabId = "audience" | "voice" | "legal" | "products";

export const BRAND_TABS: readonly { id: BrandTabId; label: string }[] = [
  { id: "audience", label: "Audience" },
  { id: "voice", label: "Voice and visual" },
  { id: "legal", label: "Legal and languages" },
  { id: "products", label: "Products and data" },
];

/** The first tab, shown when the address names none, or one that doesn't exist. */
export const DEFAULT_BRAND_TAB: BrandTabId = "audience";

/** The tab an address asks for: a known id exactly as written, else the first. A repeated ?tab= is read by its first value. */
export function parseBrandTab(value: string | string[] | undefined | null): BrandTabId {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return DEFAULT_BRAND_TAB;
  const found = BRAND_TABS.find((t) => t.id === first);
  return found ? found.id : DEFAULT_BRAND_TAB;
}

/** The address of a brand page opened on a tab. */
export function brandTabHref(brandId: string, tab: BrandTabId): string {
  return `/brands/${brandId}?${BRAND_TAB_PARAM}=${tab}`;
}
