"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { decide, type FormState } from "../../actions";

export function ApprovalForm({ approvalId, options }: { approvalId: string; options: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decide, null);
  const toast = useToast();
  const done = state && "done" in state ? state.done : null;
  const error = state && "error" in state ? state.error : null;
  useEffect(() => {
    if (done) toast({ message: done, tone: "good" });
  }, [done, toast]);
  return (
    <form action={action} className="mt-5 space-y-5">
      <input type="hidden" name="approvalId" value={approvalId} />
      <fieldset className="grid gap-2">
        <legend className="sr-only">Taglines</legend>
        {options.map((o, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-start gap-3 rounded-field border-2 border-line bg-surface px-4 py-3 transition-colors hover:border-primary-soft has-checked:border-primary has-checked:bg-primary-soft"
          >
            <input type="radio" name="choice" value={i} className="mt-1 size-4 shrink-0 accent-primary" />
            <span className="min-w-0 font-medium wrap-anywhere">{o}</span>
          </label>
        ))}
      </fieldset>
      <Field id={`reason-${approvalId}`} label="Note (optional)" hint="Saved with the decision in the run's trail.">
        <Input name="reason" maxLength={500} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button name="intent" value="approve" disabled={pending}>
          Approve tagline
        </Button>
        <Button name="intent" value="reject" variant="quiet" disabled={pending}>
          Reject all
        </Button>
      </div>
      {error && (
        <p role="alert" className="font-medium text-attention-ink">
          {error}
        </p>
      )}
    </form>
  );
}
