"use client";

// C8-2: Check pictures, with its cost before the click (rule 3). Disabled with
// the reason when every picture has a result, so a second click can't check
// (or charge for) anything.

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { checkPictures } from "../picture-check-actions";
import { ActionError } from "./brief-actions";
import { useBriefAction } from "./use-brief-action";

export function PictureCheckButton({ campaignId, estimate, reason, running }: { campaignId: string; estimate: string; reason: string | null; running: boolean }) {
  const { run, pending, error } = useBriefAction();
  const reasonId = useId();
  const blocked = !!reason || running;
  return (
    <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
      <Button
        type="button"
        size="sm"
        className="flex-wrap px-3"
        disabled={pending || blocked}
        aria-describedby={reason && !running ? reasonId : undefined}
        onClick={() => run(() => checkPictures(campaignId))}
      >
        {pending ? (
          "Starting…"
        ) : running ? (
          "Checking pictures…"
        ) : (
          <span className="inline-flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0 text-center">
            <span className="whitespace-nowrap">Check pictures</span>
            {!reason && <span className="font-medium whitespace-nowrap opacity-90">({estimate})</span>}
          </span>
        )}
      </Button>
      {reason && !running && (
        <p id={reasonId} className="max-w-sm text-sm text-ink-2 wrap-anywhere sm:text-right" data-picture-check-reason="">
          {reason}
        </p>
      )}
      <ActionError error={error} />
    </div>
  );
}
