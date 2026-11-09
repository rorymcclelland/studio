"use client";

// U10-2's stage bar scrolls sideways inside itself on a phone. This brings the
// current stage (the link with aria-current) into the bar's view when the
// page shows, by scrolling the bar itself: the page never scrolls sideways or
// moves, and it happens before paint, so nothing shifts. Instant, so reduced
// motion is respected. Runs again when Activity shows the page after a
// navigation (layout effects re-run then).

import { useLayoutEffect, useRef } from "react";

export function StageBarScroller({ children, ...props }: React.ComponentProps<"nav">) {
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = nav.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !current || bar.scrollWidth <= bar.clientWidth) return;
    const box = bar.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    // Already fully in view: leave the bar where it is.
    if (item.left >= box.left && item.right <= box.right) return;
    // Otherwise centre it, within the bar's scroll range (the browser clamps scrollLeft).
    bar.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
  }, []);
  return (
    <nav ref={nav} {...props}>
      {children}
    </nav>
  );
}
