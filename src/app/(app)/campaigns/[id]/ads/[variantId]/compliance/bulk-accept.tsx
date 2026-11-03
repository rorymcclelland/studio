"use client";

// Rory, while building C8-1: each of the brand's don't rules can be accepted
// for every picked ad at once, from the campaign. Each ad still records its
// own decision with the person's name and the time (rule 4), tied to its own
// finding, so a redraw or new words make it Review again for that ad alone.

import { Button } from "@/components/ui/button";
import type { PickedDontRule } from "@/lib/compliance/compute";
import { useBriefAction } from "../../../use-brief-action";
import { acceptRuleForPicked } from "./actions";

export function BulkAcceptDontRules({ campaignId, rules }: { campaignId: string; rules: PickedDontRule[] }) {
  if (rules.length === 0) return null;
  return (
    <div className="space-y-2" data-bulk-dont-rules="">
      <p className="text-sm text-ink-2">
        The brand&apos;s don&apos;t rules need a person to confirm each picked ad keeps them. Accept one for every picked ad at once, or on
        each ad&apos;s Compliance view.
      </p>
      <ul className="space-y-2">
        {rules.map((r) => (
          <BulkRow key={r.key} campaignId={campaignId} rule={r} />
        ))}
      </ul>
    </div>
  );
}

function BulkRow({ campaignId, rule }: { campaignId: string; rule: PickedDontRule }) {
  const { run, pending, error } = useBriefAction();
  const plural = (n: number) => `${n} picked ${n === 1 ? "ad" : "ads"}`;
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-field bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between" data-bulk-dont-rule={rule.key} data-open={rule.open}>
      <div className="min-w-0 text-sm">
        <p className="font-semibold wrap-anywhere">{rule.rule}</p>
        <p className="text-ink-2" data-bulk-status="">
          {rule.open === 0
            ? `Decided on all ${plural(rule.picked)}.`
            : `Waits on ${rule.open} of ${plural(rule.picked)}.`}
          {rule.rejected > 0 && ` Marked not acceptable on ${plural(rule.rejected)}.`}
        </p>
        {error && (
          <p role="alert" className="text-attention-ink wrap-anywhere">
            {error.error}
          </p>
        )}
      </div>
      {rule.open > 0 && (
        <Button type="button" size="sm" className="self-start sm:self-center" disabled={pending} onClick={() => run(() => acceptRuleForPicked(campaignId, rule.key))}>
          {pending ? "Saving…" : "Accept for every picked ad"}
          <span className="sr-only">: {rule.rule}</span>
        </Button>
      )}
    </li>
  );
}
