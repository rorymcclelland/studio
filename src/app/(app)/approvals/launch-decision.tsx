"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { ActionError } from "../campaigns/[id]/brief-actions";
import { useBriefAction } from "../campaigns/[id]/use-brief-action";
import { decideLaunchRequest } from "./launch-actions";

const REASON_MAX = 500;
const NEEDS_REASON = "Say why, so the launch can be fixed.";

/**
 * P9-1: Approve or Refuse a launch request in the inbox. Refuse asks for the
 * reason in place, since the campaign shows it.
 */
export function LaunchDecision({ approvalId }: { approvalId: string }) {
  const { run, pending, error, clearError } = useBriefAction();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const refuseButton = useRef<HTMLButtonElement>(null);

  const cancel = () => {
    setRefusing(false);
    setReasonError(null);
    clearError();
    requestAnimationFrame(() => refuseButton.current?.focus());
  };

  if (refusing) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = reason.trim();
          if (!text) {
            setReasonError(NEEDS_REASON);
            return;
          }
          setReasonError(null);
          run(() => decideLaunchRequest(approvalId, "refused", text));
        }}
      >
        <Field id={`launch-reason-${approvalId}`} label="Why not launch?" hint="The campaign isn't launched, and this reason is shown on it." error={reasonError ?? undefined}>
          <Textarea name="reason" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <div className="flex flex-wrap items-start gap-3">
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? "Saving…" : "Refuse with this reason"}
          </Button>
          <Button type="button" variant="quiet" disabled={pending} onClick={cancel}>
            Cancel
          </Button>
        </div>
        <ActionError error={error} />
      </form>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <Button type="button" disabled={pending} onClick={() => run(() => decideLaunchRequest(approvalId, "approved"))}>
          {pending ? "Approving…" : "Approve"}
        </Button>
        <Button
          ref={refuseButton}
          type="button"
          variant="quiet"
          disabled={pending}
          onClick={() => {
            clearError();
            setRefusing(true);
          }}
        >
          Refuse
        </Button>
      </div>
      <ActionError error={error} />
    </div>
  );
}
