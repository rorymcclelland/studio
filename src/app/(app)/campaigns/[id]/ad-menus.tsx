"use client";

// U10-3: an ad card's two menus, "Edit" and "More". Each is a disclosure, not
// an ARIA menu: its button says whether it is open (aria-expanded), Enter or
// Space opens it with focus staying on the button, Tab then reaches its tools,
// and Escape on the button or inside the panel closes it and puts focus back
// on its button. The panels open in the card, so the grid reflows; both can
// be open at once. A closed panel stays in the page, hidden, so a tool that is
// working (or the error it showed) keeps its state. A menu is closed again
// when the page is hidden by a navigation (Activity keeps it otherwise).

import { useId, useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";

type Which = "edit" | "more";

const LABEL: Record<Which, string> = { edit: "Edit", more: "More" };

export function AdMenus({
  number,
  pick,
  edit,
  more,
}: {
  number: number;
  /** Pick or Unpick, on the card's face beside the menus. */
  pick: React.ReactNode;
  /** The Edit menu's tools; null when the ad's state allows none (the menu isn't shown). */
  edit: React.ReactNode | null;
  more: React.ReactNode | null;
}) {
  const [open, setOpen] = useState<Record<Which, boolean>>({ edit: false, more: false });
  const buttons = { edit: useRef<HTMLButtonElement>(null), more: useRef<HTMLButtonElement>(null) };
  const base = useId();
  const panelId = (m: Which) => `${base}-${m}`;
  const menus = (["edit", "more"] as const).filter((m) => (m === "edit" ? edit : more) !== null);

  // A transient disclosure: closed when the page is hidden by a navigation.
  useLayoutEffect(() => () => setOpen({ edit: false, more: false }), []);

  const close = (m: Which) => {
    setOpen((o) => ({ ...o, [m]: false }));
    buttons[m].current?.focus();
  };
  const onEscape = (m: Which) => (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || !open[m]) return;
    // The words editor is a modal dialog inside the Edit panel: its own Escape closes it, not the menu.
    if ((e.target as HTMLElement).closest("dialog")) return;
    e.preventDefault();
    close(m);
  };

  return (
    <div className="flex flex-col gap-3" data-ad-menus="">
      <div className="flex flex-wrap items-center gap-2">
        {pick}
        {menus.map((m) => (
          <button
            key={m}
            ref={buttons[m]}
            type="button"
            data-ad-menu-button={m}
            aria-expanded={open[m]}
            aria-controls={panelId(m)}
            aria-label={m === "edit" ? `Edit ad ${number}` : `More for ad ${number}`}
            onClick={() => setOpen((o) => ({ ...o, [m]: !o[m] }))}
            onKeyDown={onEscape(m)}
            className={cx(
              "inline-flex min-h-9 items-center gap-1 rounded-full px-3.5 text-sm font-semibold transition-colors motion-reduce:transition-none",
              open[m] ? "bg-primary-soft text-ink" : "bg-surface-2 text-ink hover:bg-primary-soft",
            )}
          >
            {LABEL[m]}
            <svg aria-hidden viewBox="0 0 16 16" className={cx("size-4 transition-transform motion-reduce:transition-none", open[m] && "rotate-180")}>
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
      {menus.map((m) => (
        <div
          key={m}
          id={panelId(m)}
          data-ad-menu={m}
          hidden={!open[m]}
          onKeyDown={onEscape(m)}
          className="rounded-field border border-line p-3"
        >
          {m === "edit" ? edit : more}
        </div>
      ))}
    </div>
  );
}
