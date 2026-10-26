"use client";

import { Button, type ButtonVariant } from "@/components/ui/button";
import type { BriefActionState } from "../actions";
import { askPersonas, makeTestPlan, sendForSignoff, withdrawFromSignoff } from "../actions";
import { ActionError } from "./brief-actions";
import { useBriefAction } from "./use-brief-action";

/** One button for one campaign action, with its error (and any problems) shown beneath it. */
function CampaignAction({
  call,
  label,
  pendingLabel,
  variant,
  busy = false,
  busyLabel,
}: {
  call: () => Promise<BriefActionState>;
  label: string;
  pendingLabel: string;
  variant?: ButtonVariant;
  /** A run is already doing this: the button stays disabled and says so. */
  busy?: boolean;
  busyLabel?: string;
}) {
  const { run, pending, error } = useBriefAction();
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button type="button" variant={variant} disabled={pending || busy} onClick={() => run(call)}>
        {pending ? pendingLabel : busy ? (busyLabel ?? pendingLabel) : label}
      </Button>
      {!busy && <ActionError error={error} />}
    </div>
  );
}

/** S4-1: sends the current version for sign-off. A refusal lists the evidence problems. */
export function SendForSignoffButton({ campaignId, version }: { campaignId: string; version: number }) {
  return (
    <CampaignAction
      call={() => sendForSignoff(campaignId, version)}
      label={`Send version ${version} for sign-off`}
      pendingLabel="Sending…"
    />
  );
}

export function WithdrawSignoffButton({ campaignId }: { campaignId: string }) {
  return (
    <CampaignAction call={() => withdrawFromSignoff(campaignId)} label="Withdraw" pendingLabel="Withdrawing…" variant="quiet" />
  );
}

/** S4-2: asks the personas about the current version. */
export function AskPersonasButton({ campaignId, running }: { campaignId: string; running: boolean }) {
  return (
    <CampaignAction
      call={() => askPersonas(campaignId)}
      label="Ask the personas"
      pendingLabel="Starting…"
      busy={running}
      busyLabel="The personas are reading…"
      variant="quiet"
    />
  );
}

/** S4-4: makes a test plan for the current version. */
export function MakeTestPlanButton({ campaignId, running }: { campaignId: string; running: boolean }) {
  return (
    <CampaignAction
      call={() => makeTestPlan(campaignId)}
      label="Make a test plan"
      pendingLabel="Starting…"
      busy={running}
      busyLabel="Writing the test plan…"
      variant="quiet"
    />
  );
}
