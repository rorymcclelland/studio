"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Asks before leaving a page with unsaved changes (S2-3 #3), however the
 * person leaves:
 *
 * - closing or reloading the tab, or going to another site: the browser's own
 *   "leave site?" prompt (beforeunload);
 * - a link inside the app: a confirm before the navigation starts;
 * - the back button: while there are changes, one extra history entry for
 *   this same address sits on top, so back first lands here, where we ask.
 *   Staying puts the entry back; leaving goes back for real.
 *
 * Returns leaveTo(href), for leaving on purpose (after a save) without being
 * asked, which also takes the extra history entry away first.
 */
export function useLeaveGuard(dirty: boolean, message: string) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  /** True while the extra history entry is the current one. */
  const guarding = useRef(false);
  /** Where to go once the extra entry has been taken away. */
  const after = useRef<string | null>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const pushGuard = useCallback(() => {
    // Keep the router's own state on the entry, so it treats it as this page.
    window.history.pushState({ ...window.history.state, leaveGuard: true }, "", window.location.href);
    guarding.current = true;
  }, []);

  const leaveTo = useCallback(
    (href: string) => {
      dirtyRef.current = false;
      if (guarding.current) {
        after.current = href;
        window.history.back();
      } else {
        router.push(href);
      }
    },
    [router],
  );

  // Tab close, reload, other sites.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // The back button: add the extra entry once there is something to lose.
  useEffect(() => {
    if (dirty && !guarding.current) pushGuard();
  }, [dirty, pushGuard]);

  useEffect(() => {
    const onPopState = () => {
      if (!guarding.current) return;
      // Back from the extra entry: we are still on this page.
      guarding.current = false;
      const target = after.current;
      if (target) {
        after.current = null;
        router.push(target);
        return;
      }
      if (dirtyRef.current && !window.confirm(message)) {
        pushGuard();
        return;
      }
      window.history.back();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [message, pushGuard, router]);

  // Links inside the app. Capture phase on window runs before the router's own
  // click handling, so a "stay" stops the navigation before it starts.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return; // another site: beforeunload asks
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page
      if (!dirtyRef.current && !guarding.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (dirtyRef.current && !window.confirm(message)) return;
      leaveTo(url.pathname + url.search + url.hash);
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [leaveTo, message]);

  return { leaveTo };
}
