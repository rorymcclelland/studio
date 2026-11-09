"use client";

// U10-3 (Rory's choices a and b, 9 November 2026): what keeps the Creative
// stage within its length budget without hiding anything a link points at.
// - GalleryReveal: an audience's ads show the first few (the server orders
//   them, launched first), then "Show all N ads" reveals the rest in place,
//   without a reload, and moves focus to the first ad it revealed.
// - PickedChecks: the checks on the picked ads, folded into one <details>
//   whose summary is their one-line state.
// Either opens by itself when the address's fragment points inside it: an ad
// (#ad-7 by its number, or #ad-<id> as the ad's Sizes and Compliance pages link
// back), or one of the checks (#picked-checks, #languages, #pretest, ...), so a
// link always lands on something visible.

import { useCallback, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";

const AD_BY_ID = /^ad-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The element the address's fragment points at: an id, or an ad by its id (#ad-<uuid>). */
function hashTarget(): HTMLElement | null {
  let raw = window.location.hash.slice(1);
  if (!raw) return null;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const byId = document.getElementById(raw);
  if (byId) return byId;
  const ad = AD_BY_ID.exec(raw);
  return ad ? document.querySelector<HTMLElement>(`[data-ad="${ad[1]}"]`) : null;
}

/**
 * Calls `reveal` when the fragment points inside `ref`, then brings the target
 * into view: as the page opens (also when it is shown again after a
 * navigation), and when the fragment changes.
 */
function useRevealOnHash(ref: React.RefObject<HTMLElement | null>, reveal: () => void) {
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      // A frame later: the router may still be writing the address, and the revealed ads need laying out before the scroll.
      frame = requestAnimationFrame(() => {
        const target = hashTarget();
        if (!target || !ref.current?.contains(target)) return;
        reveal();
        frame = requestAnimationFrame(() => {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
        });
      });
    };
    check();
    window.addEventListener("hashchange", check);
    window.addEventListener("popstate", check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", check);
      window.removeEventListener("popstate", check);
    };
  }, [ref, reveal]);
}

/**
 * An audience's ads, the first `preview` shown and the rest behind "Show all N
 * ads". `preview` equal to the number of ads shows them all, with no button.
 * The list is the ul[data-gallery] the cards sit in; its classes come from the
 * gallery. The cut-off is CSS on the list, so the cards are rendered once, on
 * the server, and revealing them is instant.
 */
export function GalleryReveal({
  label,
  total,
  preview,
  showAllLabel,
  className,
  wrapClassName,
  children,
}: {
  label: string;
  total: number;
  preview: number;
  showAllLabel: string;
  className: string;
  /** The group's box, list and button together (the gallery is wider than the page column on large screens). */
  wrapClassName?: string;
  children: React.ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  // Whether the person asked for every ad (or a link pointed past the first few); ads that arrive later follow the same cut-off.
  const [all, setAll] = useState(false);
  const collapsed = !all && preview < total;
  const reveal = useCallback(() => setAll(true), []);
  useRevealOnHash(list, reveal);

  const showAll = () => {
    setAll(true);
    // Focus moves to the first ad revealed, so a keyboard user carries on from where the list was cut.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`:scope > li:nth-child(${preview + 1}) a[data-ad-full]`)?.focus());
  };

  return (
    <div className={cx("space-y-3", wrapClassName)}>
      <ul
        ref={list}
        aria-label={label}
        data-gallery=""
        data-collapsed={collapsed ? "" : undefined}
        // Six is GROUP_PREVIEW (src/lib/creative/gallery-filter.ts); a class can't be built from a number at run time.
        className={cx(className, "data-collapsed:[&>li:nth-child(n+7)]:hidden")}
      >
        {children}
      </ul>
      {collapsed && (
        <button type="button" data-show-all-ads="" onClick={showAll} className={buttonClass("quiet", "md", "w-full sm:w-auto")}>
          {showAllLabel}
        </button>
      )}
    </div>
  );
}

/** The checks on the picked ads, folded into one line; open from the start with `defaultOpen` (?show=decide), or when a link points inside. */
export function PickedChecks({ defaultOpen, summary, children }: { defaultOpen: boolean; summary: React.ReactNode; children: React.ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const reveal = useCallback(() => {
    if (details.current) details.current.open = true;
  }, []);
  useRevealOnHash(details, reveal);
  return (
    <details ref={details} id="picked-checks" open={defaultOpen} data-picked-checks="" className="group/checks scroll-mt-6">
      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 rounded-card bg-surface px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="mt-1 size-4 shrink-0 text-primary transition-transform group-open/checks:rotate-90 motion-reduce:transition-none"
        >
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {summary}
      </summary>
      <div className="space-y-3 pt-3">{children}</div>
    </details>
  );
}
