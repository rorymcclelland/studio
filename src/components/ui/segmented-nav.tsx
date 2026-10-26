"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./cx";

export type SegmentedNavItem = {
  href: string;
  label: string;
  /** A shorter label for narrow screens; the full label stays the accessible name. */
  short?: string;
  /** "exact" for the home link; "prefix" (the default) also matches child pages. */
  match?: "exact" | "prefix";
  /** A count shown beside the label (for example, items waiting), with its meaning for screen readers. */
  count?: { value: number; label: string };
};

/** Rounded segmented links; the current page is marked with aria-current. */
export function SegmentedNav({
  items,
  label,
  className,
}: {
  items: SegmentedNavItem[];
  label: string;
  className?: string;
}) {
  const path = usePathname();
  return (
    <nav aria-label={label} className={cx("min-w-0", className)}>
      <ul className="flex w-max max-w-full rounded-full bg-surface p-1 sm:gap-1">
        {items.map((item) => {
          const current =
            item.match === "exact" ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
          const count = item.count && item.count.value > 0 ? item.count : null;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  // Smaller on narrow screens, so the main nav fits on one row at 375 px.
                  "inline-flex min-h-9 items-center gap-1 rounded-full px-1.25 text-sm font-medium whitespace-nowrap transition-colors sm:gap-1.5 sm:px-4 sm:text-base lg:px-2.5",
                  current ? "bg-primary-soft text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                {item.short ? (
                  <>
                    <span className="sm:hidden" aria-hidden>
                      {item.short}
                    </span>
                    <span className="max-sm:sr-only">{item.label}</span>
                  </>
                ) : (
                  item.label
                )}
                {count && (
                  <span
                    data-nav-count=""
                    className="inline-grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs leading-5 font-bold text-on-primary tabular-nums"
                  >
                    {count.value > 99 ? "99+" : count.value}
                    <span className="sr-only"> {count.label}</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
