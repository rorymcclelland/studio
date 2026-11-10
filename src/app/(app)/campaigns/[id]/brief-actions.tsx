"use client";

import { useRouter } from "next/navigation";
import { Button, type ButtonVariant } from "@/components/ui/button";
import type { BriefActionState } from "../actions";
import {
  discardBriefProposal,
  dismissFailedRevision,
  restoreBriefVersion,
  retryBrief,
  useProposal as acceptProposal,
} from "../actions";
import { isStale, useBriefAction, type BriefError } from "./use-brief-action";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What went wrong with a brief action, its problems, and a reload when the brief moved on. */
export function ActionError({ error, id }: { error: BriefError | null; id?: string }) {
  const router = useRouter();
  if (!error) return null;
  const problems = (error.problems ?? []).filter((p) => p !== error.error);
  return (
    <div id={id} role="alert" className="rounded-field border-2 border-attention-soft bg-attention-soft px-4 py-3 text-attention-ink">
      <p className="font-semibold">{error.error}</p>
      {problems.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {problems.map((p, i) => (
            <li key={i} className="wrap-anywhere">
              {capitalise(p)}
            </li>
          ))}
        </ul>
      )}
      {isStale(error) && (
        <Button type="button" size="sm" variant="quiet" className="mt-3" onClick={() => router.refresh()}>
          Reload the latest version
        </Button>
      )}
    </div>
  );
}

/** A button that runs one brief action, toasts its result and shows its error. */
function ActionButton({
  call,
  label,
  pendingLabel,
  variant,
  srLabel,
  onDone,
}: {
  call: () => Promise<BriefActionState>;
  label: string;
  pendingLabel: string;
  variant?: ButtonVariant;
  srLabel?: string;
  onDone?: (r: { done: string; version?: number }) => void;
}) {
  const { run, pending, error } = useBriefAction();
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        aria-label={srLabel && !pending ? `${label} ${srLabel}` : undefined}
        onClick={() => run(call, onDone)}
      >
        {pending ? pendingLabel : label}
      </Button>
      <ActionError error={error} />
    </div>
  );
}

export function RetryBriefButton({ campaignId }: { campaignId: string }) {
  return <ActionButton call={() => retryBrief(campaignId)} label="Try again" pendingLabel="Starting the Brief agent…" />;
}

export function RestoreVersionButton({ campaignId, version, currentVersion }: { campaignId: string; version: number; currentVersion: number }) {
  const router = useRouter();
  return (
    <ActionButton
      call={() => restoreBriefVersion(campaignId, version, currentVersion)}
      label="Make this the current version"
      pendingLabel="Restoring…"
      onDone={() => router.push(`/campaigns/${campaignId}/brief`)}
    />
  );
}

export function ProposalButtons({ campaignId, runId }: { campaignId: string; runId: string }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionButton call={() => acceptProposal(campaignId, runId)} label="Use this version" pendingLabel="Saving…" />
      <ActionButton call={() => discardBriefProposal(campaignId, runId)} label="Discard" pendingLabel="Discarding…" variant="quiet" />
    </div>
  );
}

export function DismissRevisionButton({ campaignId, runId }: { campaignId: string; runId: string }) {
  return (
    <ActionButton
      call={() => dismissFailedRevision(campaignId, runId)}
      label="Dismiss"
      pendingLabel="Dismissing…"
      variant="quiet"
      srLabel="this failed revision"
    />
  );
}
