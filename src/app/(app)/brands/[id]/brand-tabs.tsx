"use client";

import { useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { BRAND_TAB_PARAM, BRAND_TABS, parseBrandTab, type BrandTabId } from "@/lib/brands/tabs";

/**
 * U10-7: the brand page's reference data as tabs. The page renders every
 * panel and picks the first tab from ?tab=; choosing another puts it in the
 * address without a reload (keeping any search), so a reload or a shared link
 * opens it again. The address leads: a page kept from an earlier visit follows
 * a link to another tab (saving the kit returns to Voice and visual).
 */
export function BrandTabs({ selected, panels }: { selected: BrandTabId; panels: Record<BrandTabId, React.ReactNode> }) {
  const params = useSearchParams();
  const fromAddress = params.has(BRAND_TAB_PARAM) ? parseBrandTab(params.getAll(BRAND_TAB_PARAM)) : selected;
  return (
    <div data-brand-tabs="" className="space-y-4">
      <h2 id="brand-tabs-heading" className="text-2xl font-strong tracking-tight">
        About the brand
      </h2>
      <Tabs
        labelledBy="brand-tabs-heading"
        layout="grid"
        selected={fromAddress}
        onChange={(id) => {
          const url = new URL(window.location.href);
          url.searchParams.set(BRAND_TAB_PARAM, id);
          url.hash = "";
          window.history.replaceState(null, "", url.toString());
        }}
        items={BRAND_TABS.map((t) => ({
          id: t.id,
          label: t.label,
          tabData: { "data-brand-tab": t.id },
          panelData: { "data-brand-tabpanel": t.id },
          panel: panels[t.id],
        }))}
      />
    </div>
  );
}
