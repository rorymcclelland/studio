"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { decideBriefSignoff } from "../campaigns/actions";
import { ActionError } from "../campaigns/[id]/brief-actions";
import { useBriefAction } from "../campaigns/[id]/use-brief-action";

const REASON_MAX = 500;

/**
 * S4-1: Approve or Reject a brief sign-off, from the inbox or the campaign
 * page. Reject asks for the reason in place, since the brief goes back to
 * draft with it.
 */
export function SignoffDecision({ approvalId, version }: { approvalId: string; version: number }) {
  const { run, pending, error, clearError } = useBriefAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const reasonId = `reason-${approvalId}`;

  const cancel = () => {
    setRejecting(false);
    setReasonError(null);
    clearError();
    // Back to where the person was.
    requestAnimationFrame(() => rejectButton.current?.focus());
  };

  if (rejecting) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = reason.trim();
          if (!text) {
            setReasonError("Say why, so the brief can be fixed.");
            return;
          }
          setReasonError(null);
          run(() => decideBriefSignoff(approvalId, "rejected", text));
        }}
      >
        <Field
          id={reasonId}
          label={`Why isn't version ${version} ready?`}
          hint="The brief goes back to draft, and this reason is shown on the campaign."
          error={reasonError ?? undefined}
        >
          <Textarea
            name="reason"
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="flex flex-wrap items-start gap-3">
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? "Saving…" : "Reject with this reason"}
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
        <Button type="button" disabled={pending} onClick={() => run(() => decideBriefSignoff(approvalId, "approved"))}>
          {pending ? "Signing off…" : `Approve version ${version}`}
        </Button>
        <Button
          ref={rejectButton}
          type="button"
          variant="quiet"
          disabled={pending}
          onClick={() => {
            clearError();
            setRejecting(true);
          }}
        >
          Reject
        </Button>
      </div>
      <ActionError error={error} />
    </div>
  );
}
