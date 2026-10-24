"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the page every couple of seconds while a run is in progress. */
export function AutoRefresh({ active, intervalMs = 1500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
