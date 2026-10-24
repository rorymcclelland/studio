"use client";

import { useActionState } from "react";
import { startTaglineRun, type FormState } from "./actions";

export function StartRunForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(startTaglineRun, null);
  return (
    <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1.5 text-sm">
        <span className="font-medium">Brand name</span>
        <input
          name="brandName"
          required
          maxLength={80}
          placeholder="For example, Fernhollow Outfitters"
          className="rounded-md border border-line bg-surface px-3 py-2 text-base"
          aria-describedby={state?.error ? "start-error" : undefined}
        />
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-60 dark:text-black"
      >
        {pending ? "Starting…" : "Propose taglines"}
      </button>
      {state?.error && (
        <p id="start-error" role="alert" className="text-sm text-bad sm:basis-full">
          {state.error}
        </p>
      )}
    </form>
  );
}
