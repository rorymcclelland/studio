"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { refreshMarketNotes } from "../actions";

/**
 * S4-3: starts the Market agent. Within a day of the last refresh the server
 * asks for confirmation first (each refresh costs money), and the person can
 * refresh anyway.
 */
export function RefreshMarketButton({ brandId, running }: { brandId: string; running: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const busy = pending || running;

  const go = (confirm: boolean) =>
    start(async () => {
      setError(null);
      const r = await refreshMarketNotes(brandId, confirm);
      if (r && "done" in r) {
        setConfirming(null);
        toast({ message: r.done, tone: "good" });
      } else if (r && "error" in r) {
        if (r.needsConfirm && !confirm) setConfirming(r.error);
        else {
          setConfirming(null);
          setError(r.error);
        }
      }
    });

  return (
    <div className="flex max-w-md min-w-0 flex-col items-start">
      <Button ref={refreshButton} type="button" disabled={busy || !!confirming} aria-describedby="market-progress" onClick={() => go(false)}>
        {busy ? "Researching the market…" : "Refresh market notes"}
      </Button>
      <p id="market-progress" role="status" className={busy ? "mt-2 text-sm text-ink-2" : undefined}>
        {busy ? "The Market agent is searching the web. This takes about a minute." : ""}
      </p>
      {confirming && !busy && (
        <div role="alert" className="mt-3 rounded-field bg-review-soft px-4 py-3 text-review-ink" data-market-confirm="">
          <p className="font-medium">{confirming}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => go(true)}>
              Refresh anyway
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => {
                setConfirming(null);
                requestAnimationFrame(() => refreshButton.current?.focus());
              }}
            >
              Keep the current notes
            </Button>
          </div>
        </div>
      )}
      {error && !busy && (
        <p role="alert" className="mt-2 font-medium text-attention-ink">
          {error}
        </p>
      )}
    </div>
  );
}
