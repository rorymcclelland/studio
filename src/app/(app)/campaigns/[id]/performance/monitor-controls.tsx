"use client";

// P9-4: the Performance view's controls. Mark as seen on an alert, and
// U10-4's Mark all as seen (the only things a person can do with alerts: they
// never act, rule 3), and the Ask about this campaign box, which shows the cost before the click and starts
// the Monitor's run. The server checks everything again.
import { useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { ActionError } from "../brief-actions";
import { useBriefAction } from "../use-brief-action";
import { MARK_ALL_LABEL } from "@/lib/performance/attention";
import { askAboutCampaign, markAlertAsSeen, markAllAlertsAsSeen } from "./actions";

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

/** U10-4: marks every unseen alert of the launch shown as seen, in one go. */
export function MarkAllSeenButton({ campaignId }: { campaignId: string }) {
  const { run, pending, error } = useBriefAction();
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button type="button" size="sm" variant="quiet" disabled={pending} data-mark-all-seen="" onClick={() => run(() => markAllAlertsAsSeen(campaignId))}>
        {MARK_ALL_LABEL}
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

/**
 * R1 (10 November): the alerts list, with the alerts past the first few
 * (li[data-alert-more]) hidden until "Show all N alerts" reveals them in place.
 * The cut-off is CSS on the list, so every alert is rendered once, on the
 * server, and stays in the page (newest first) while hidden.
 */
export function AlertsReveal({ total, more, showAllLabel, children }: { total: number; more: number; showAllLabel: string; children: React.ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const [all, setAll] = useState(false);
  const collapsed = !all && more > 0;
  const showAll = () => {
    setAll(true);
    // Focus moves to the first alert revealed, so a keyboard user carries on from where the list was cut.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(":scope > li[data-alert-more] :is(summary, a, button)")?.focus());
  };
  return (
    <div className="space-y-2">
      <ul
        ref={list}
        aria-label={`Alerts, ${total} in all`}
        data-alerts-list=""
        data-collapsed={collapsed ? "" : undefined}
        className="divide-y divide-line data-collapsed:[&>[data-alert-more]]:hidden"
      >
        {children}
      </ul>
      {collapsed && (
        <button type="button" data-show-all-alerts="" onClick={showAll} className={buttonClass("quiet", "sm", "w-full sm:w-auto")}>
          {showAllLabel}
        </button>
      )}
    </div>
  );
}
