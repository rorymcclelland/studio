"use client";

// C8-1: Accept or Not acceptable on a review item, with an optional note
// (cut to 500 characters, here and on the server). The decision is recorded
// with the person's name and the time (rule 4), and applies only while the
// item is unchanged.

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useBriefAction } from "../../../use-brief-action";
import { decideCompliance } from "./actions";

const NOTE_MAX = 500;

export function DecisionForm(props: {
  campaignId: string;
  variantId: string;
  lang: string | null;
  size: string | null;
  rule: string;
  hash: string;
  /** What the item is, for the buttons' accessible names ("Don't rule: ..."). */
  label: string;
  decided: "accept" | "reject" | null;
}) {
  const { run, pending, error } = useBriefAction();
  const [note, setNote] = useState("");
  const [doing, setDoing] = useState<"accept" | "reject" | null>(null);
  const id = useId();
  const go = (decision: "accept" | "reject") => {
    setDoing(decision);
    run(() =>
      decideCompliance(props.campaignId, props.variantId, { lang: props.lang, size: props.size, rule: props.rule, hash: props.hash, decision, note }),
      () => setNote(""),
    );
  };
  return (
    <div className="space-y-2" data-decision-form="">
      <div className="space-y-1">
        <label htmlFor={`${id}-note`} className="text-sm font-semibold">
          Note <span className="font-normal text-ink-2">(optional, up to {NOTE_MAX} characters)</span>
        </label>
        <Textarea id={`${id}-note`} rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className="text-sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        {props.decided !== "accept" && (
          <Button type="button" size="sm" disabled={pending} onClick={() => go("accept")}>
            {pending && doing === "accept" ? "Saving…" : "Accept"}
            <span className="sr-only">: {props.label}</span>
          </Button>
        )}
        {props.decided !== "reject" && (
          <Button type="button" size="sm" variant="quiet" disabled={pending} onClick={() => go("reject")}>
            {pending && doing === "reject" ? "Saving…" : "Not acceptable"}
            <span className="sr-only">: {props.label}</span>
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-attention-ink wrap-anywhere">
          {error.error}
        </p>
      )}
    </div>
  );
}
