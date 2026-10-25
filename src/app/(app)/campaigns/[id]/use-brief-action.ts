"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import type { BriefActionState } from "../actions";

export type BriefError = Extract<NonNullable<BriefActionState>, { error: string }>;

/** The stale-version refusal (S3-3 #7), which gets a reload button beside it. */
export function isStale(e: BriefError | null): boolean {
  return !!e && /changed since/i.test(e.error);
}

/**
 * Runs a brief action: a toast for the done message, the error (with its
 * problems and field errors) kept for the form to show.
 */
export function useBriefAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<BriefError | null>(null);
  const toast = useToast();
  const run = (call: () => Promise<BriefActionState>, onDone?: (r: { done: string; version?: number }) => void) =>
    start(async () => {
      setError(null);
      const r = await call();
      if (r && "done" in r) {
        toast({ message: r.done, tone: "good" });
        onDone?.(r);
      } else if (r && "error" in r) setError(r);
    });
  return { run, pending, error, clearError: () => setError(null) };
}
