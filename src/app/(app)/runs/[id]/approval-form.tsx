"use client";

import { useActionState } from "react";
import { decide, type FormState } from "../../actions";

export function ApprovalForm({ approvalId, options }: { approvalId: string; options: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decide, null);
  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="approvalId" value={approvalId} />
      <fieldset className="space-y-2">
        <legend className="sr-only">Taglines</legend>
        {options.map((o, i) => (
          <label key={i} className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2.5 has-[:checked]:border-accent">
            <input type="radio" name="choice" value={i} className="mt-1" required={false} />
            <span>{o}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Note (optional)</span>
        <input name="reason" maxLength={500} className="rounded-md border border-line bg-surface px-3 py-2" />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          name="intent"
          value="approve"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-60 dark:text-black"
        >
          Approve tagline
        </button>
        <button
          name="intent"
          value="reject"
          disabled={pending}
          className="rounded-md border border-line px-4 py-2 font-medium disabled:opacity-60"
        >
          Reject all
        </button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}
