"use client";

// U10-4: tabs, as the ARIA tabs pattern: a tablist named by a heading, one
// tab button per panel with a roving tabindex (the selected tab is the one
// tab stop), ArrowLeft and ArrowRight move and select (wrapping), Home and
// End go to the first and last, and Tab moves on into the selected panel.
// Every panel is server-rendered and stays in the page; the unselected ones
// are hidden, so an element in one (a chart's table alternative) can still
// be referred to. Built from the segmented nav's parts.
//
// U10-7: `selected` sets the tab shown first (by id; an unknown id shows the
// first), and `onChange` reports each new selection, so a page can keep the
// tab in its address. `layout="grid"` sets the tabs out two to a row on a
// phone, for labels too long to fit on one line.
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

export function Tabs({
  items,
  labelledBy,
  className,
  selected: initial,
  onChange,
  layout = "inline",
}: {
  items: TabItem[];
  labelledBy: string;
  className?: string;
  /** The id of the tab shown first, and later whenever it changes; the first tab when missing or unknown. */
  selected?: string;
  /** Called with the id of each newly selected tab. */
  onChange?: (id: string) => void;
  /** "grid": two tabs to a row on narrow screens, one row from the sm breakpoint. */
  layout?: "inline" | "grid";
}) {
  const base = useId();
  const indexOf = (id: string | undefined) => Math.max(0, items.findIndex((t) => t.id === id));
  const [selected, setSelected] = useState(() => indexOf(initial));
  // A new `selected` from the page (a link to another tab of a page that was kept) moves the selection.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setSelected(indexOf(initial));
  }
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (i: number) => `${base}-tab-${items[i].id}`;
  const panelId = (i: number) => `${base}-panel-${items[i].id}`;

  const select = (i: number) => {
    if (i !== selected) onChange?.(items[i].id);
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
      <div
        role="tablist"
        aria-labelledby={labelledBy}
        className={cx(
          "gap-1 bg-surface-2 p-1",
          layout === "grid" ? "grid grid-cols-2 rounded-card sm:flex sm:w-max sm:max-w-full sm:rounded-full" : "flex w-max max-w-full rounded-full",
        )}
        onKeyDown={onKeyDown}
      >
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
              "inline-flex min-h-9 items-center rounded-full text-sm font-semibold transition-colors motion-reduce:transition-none",
              layout === "grid" ? "justify-center px-3 py-1 text-center sm:px-4 sm:whitespace-nowrap" : "px-4 whitespace-nowrap",
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
