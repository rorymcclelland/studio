"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { removeSegment, startAudienceRun } from "../actions";

/** S3-1: starts the Audience agent. The page refreshes itself while the run is active. */
export function FindAudiencesButton({ brandId, running }: { brandId: string; running: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const busy = pending || running;
  return (
    <div className="flex flex-col items-start">
      <Button
        type="button"
        disabled={busy}
        aria-describedby="audience-progress"
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await startAudienceRun(brandId);
            if (result && "done" in result) toast({ message: result.done, tone: "good" });
            else if (result && "error" in result) setError(result.error);
          })
        }
      >
        {busy ? "Finding audiences…" : "Find audiences"}
      </Button>
      <p id="audience-progress" role="status" className={busy ? "mt-2 max-w-prose text-sm text-ink-2" : undefined}>
        {busy ? "The Audience agent is counting and naming segments from the customer data." : ""}
      </p>
      {error && !busy && (
        <p role="alert" className="mt-2 max-w-prose font-medium text-attention-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** Removes one of the Audience agent's segments from the context store. */
export function RemoveSegmentButton({ brandId, itemId, title }: { brandId: string; itemId: string; title: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="quiet"
        size="sm"
        disabled={pending}
        aria-label={`Remove the segment ${title}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await removeSegment(brandId, itemId);
            if (result && "done" in result) toast({ message: result.done, tone: "good" });
            else if (result && "error" in result) setError(result.error);
          })
        }
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-attention-ink">
          {error}
        </p>
      )}
    </div>
  );
}
