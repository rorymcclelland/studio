"use client";

// U10-4: tabs, as the ARIA tabs pattern: a tablist named by a heading, one
// tab button per panel with a roving tabindex (the selected tab is the one
// tab stop), ArrowLeft and ArrowRight move and select (wrapping), Home and
// End go to the first and last, and Tab moves on into the selected panel.
// Every panel is server-rendered and stays in the page; the unselected ones
// are hidden, so an element in one (a chart's table alternative) can still
// be referred to. Built from the segmented nav's parts.
import { useId, useRef, useState } from "react";
import { cx } from "./cx";

export type TabItem = {
  id: string;
  label: string;
  panel: React.ReactNode;
  /** Data attributes for the tab and its panel, for tests and styling hooks. */
  tabData?: Record<`data-${string}`, string>;
  panelData?: Record<`data-${string}`, string>;
  /** False when the panel holds its own focusable content, so it isn't a tab stop itself. */
  panelFocusable?: boolean;
};

export function Tabs({ items, labelledBy, className }: { items: TabItem[]; labelledBy: string; className?: string }) {
  const base = useId();
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (i: number) => `${base}-tab-${items[i].id}`;
  const panelId = (i: number) => `${base}-panel-${items[i].id}`;

  const select = (i: number) => {
    setSelected(i);
    tabs.current[i]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = items.length - 1;
    const next = { ArrowRight: selected === last ? 0 : selected + 1, ArrowLeft: selected === 0 ? last : selected - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next);
  };

  return (
    <div className={cx("space-y-4", className)}>
      <div role="tablist" aria-labelledby={labelledBy} className="flex w-max max-w-full gap-1 rounded-full bg-surface-2 p-1" onKeyDown={onKeyDown}>
        {items.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(i)}
            aria-selected={i === selected}
            aria-controls={panelId(i)}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => select(i)}
            className={cx(
              "inline-flex min-h-9 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none",
              i === selected ? "bg-surface text-ink" : "text-ink-2 hover:text-ink",
            )}
            {...t.tabData}
          >
            {t.label}
          </button>
        ))}
      </div>
      {items.map((t, i) => (
        <div key={t.id} role="tabpanel" id={panelId(i)} aria-labelledby={tabId(i)} hidden={i !== selected} tabIndex={t.panelFocusable === false ? undefined : 0} {...t.panelData}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
