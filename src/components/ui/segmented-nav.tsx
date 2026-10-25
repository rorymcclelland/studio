"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./cx";

export type SegmentedNavItem = {
  href: string;
  label: string;
  /** "exact" for the home link; "prefix" (the default) also matches child pages. */
  match?: "exact" | "prefix";
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
      <ul className="flex w-max max-w-full gap-0.5 rounded-full bg-surface p-1 sm:gap-1">
        {items.map((item) => {
          const current =
            item.match === "exact" ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  // Smaller on narrow screens, so the main nav fits on one row at 375 px.
                  "inline-flex min-h-9 items-center rounded-full px-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-4 sm:text-base lg:px-3",
                  current ? "bg-primary-soft text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
