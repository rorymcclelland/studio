"use client";

// U10-2's stage bar scrolls sideways inside itself on a phone. This brings the
// current stage (the link with aria-current) into the bar's view when the
// page shows, by scrolling the bar itself: the page never scrolls sideways or
// moves, and it happens before paint, so nothing shifts. Instant, so reduced
// motion is respected. Runs again when Activity shows the page after a
// navigation (layout effects re-run then).
//
// U10-4: the position is worked out from the start of the bar, not from where
// it happens to be, and clamped to the bar's own range, so centring a stage
// never scrolls past the first stage or the last one: on the Brief page the
// bar stays at its start. It is worked out again once the web fonts have
// loaded (they change the stages' widths), unless someone has scrolled the
// bar meanwhile.

import { useLayoutEffect, useRef } from "react";

/** Where the bar should be scrolled to so the current stage is in view: 0 when it already fits from the start. */
function targetFor(bar: HTMLElement, current: HTMLElement): number {
  const max = Math.max(0, bar.scrollWidth - bar.clientWidth);
  if (max === 0) return 0;
  const box = bar.getBoundingClientRect();
  const item = current.getBoundingClientRect();
  // The stage's place along the bar's content, whatever the bar is scrolled to now.
  const left = item.left - box.left + bar.scrollLeft;
  const right = left + item.width;
  // In view with the bar at its start: stay there.
  if (right <= bar.clientWidth) return 0;
  const centred = left - (bar.clientWidth - item.width) / 2;
  return Math.min(max, Math.max(0, Math.round(centred)));
}

export function StageBarScroller({ children, ...props }: React.ComponentProps<"nav">) {
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = nav.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !current) return;
    bar.scrollLeft = targetFor(bar, current);
    const set = bar.scrollLeft;
    let live = true;
    // The fonts change the stages' widths: place the bar again, unless it has been scrolled by hand since.
    document.fonts?.ready.then(() => {
      if (!live || bar.scrollLeft !== set) return;
      bar.scrollLeft = targetFor(bar, current);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <nav ref={nav} {...props}>
      {children}
    </nav>
  );
}
