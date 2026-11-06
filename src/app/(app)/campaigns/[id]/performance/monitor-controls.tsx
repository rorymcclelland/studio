"use client";

// P9-4: the Performance view's two controls. Mark as seen on an alert (the
// only thing a person can do with one: alerts never act, rule 3), and the Ask
// about this campaign box, which shows the cost before the click and starts
// the Monitor's run. The server checks everything again.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { ActionError } from "../brief-actions";
import { useBriefAction } from "../use-brief-action";
import { askAboutCampaign, markAlertAsSeen } from "./actions";

export function MarkSeenButton({ campaignId, alertId, describedBy }: { campaignId: string; alertId: string; describedBy: string }) {
  const { run, pending, error } = useBriefAction();
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button type="button" size="sm" variant="quiet" disabled={pending} aria-describedby={describedBy} onClick={() => run(() => markAlertAsSeen(campaignId, alertId))}>
        Mark as seen
      </Button>
      <ActionError error={error} />
    </div>
  );
}

export function AskForm({ campaignId, cost, reason, maxLength }: { campaignId: string; cost: string; reason: string | null; maxLength: number }) {
  const { run, pending, error } = useBriefAction();
  const [question, setQuestion] = useState("");
  const blocked = reason !== null;
  const over = question.trim().length > maxLength;
  return (
    <form
      className="space-y-3"
      data-ask=""
      onSubmit={(e) => {
        e.preventDefault();
        if (blocked || pending) return;
        run(
          () => askAboutCampaign(campaignId, question),
          () => setQuestion(""),
        );
      }}
    >
      <Field
        id="ask-question"
        label="Ask about this campaign"
        hint={
          <>
            {`Ask in plain English, for example "Which ad had the lowest cost per acquisition last week?". Answers come only from this campaign's simulated results. Each question costs `}
            <span className="font-semibold text-ink" data-ask-cost="">
              {cost}
            </span>
            {" (AI)."}
          </>
        }
      >
        <Textarea rows={3} maxLength={maxLength} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={blocked} />
      </Field>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={blocked || pending || question.trim().length === 0 || over}>
          {pending ? "Asking…" : "Ask"}
        </Button>
        <span className="text-sm text-ink-2 tabular-nums" aria-live="polite">{`${question.length} of ${maxLength} characters`}</span>
      </div>
      {reason && (
        <p className="font-medium text-attention-ink" data-ask-reason="">
          {reason}
        </p>
      )}
      <ActionError error={error} />
    </form>
  );
}
