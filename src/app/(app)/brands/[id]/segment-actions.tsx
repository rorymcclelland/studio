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
    <div className="flex flex-col items-start gap-1">
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

/**
 * U10-7: a segment card's disclosure. The name and Details share the first row, the size and one-sentence
 * definition follow, and the rest of the card (the agent's description, its facts, where it came from and
 * Remove) is hidden until opened, in place.
 */
export function SegmentDisclosure({
  id,
  name,
  head,
  size,
  definition,
  children,
}: {
  id: string;
  name: string;
  /** The card's heading. */
  head: React.ReactNode;
  /** The size, below the heading and beside Details. */
  size: React.ReactNode;
  /** The one-sentence definition, the card's full width. */
  definition: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pt-1.5">
          {head}
          {size}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          data-segment-open=""
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full text-sm font-semibold text-primary"
        >
          <span aria-hidden className={open ? "inline-block rotate-90 motion-safe:transition-transform" : "inline-block motion-safe:transition-transform"}>
            ›
          </span>
          {open ? "Hide" : "Details"}
          <span className="sr-only">{open ? ` the details of ${name}` : ` of ${name}`}</span>
        </button>
      </div>
      {definition}
      <div id={id} hidden={!open} data-segment-details="" className="mt-2 border-t border-line pt-2">
        {children}
      </div>
    </>
  );
}
