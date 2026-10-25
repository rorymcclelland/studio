"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { startTaglineRun, type FormState } from "./actions";

export function StartRunForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(startTaglineRun, null);
  const error = state && "error" in state ? state.error : undefined;
  return (
    <form action={action} className="mt-6 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
      <Field id="brand-name" label="Brand name" error={error} className="flex-1">
        <Input name="brandName" required maxLength={80} placeholder="For example, Fernhollow Outfitters" />
      </Field>
      <Button disabled={pending} className={error ? "sm:mb-7" : undefined}>
        {pending ? "Starting…" : "Propose taglines"}
      </Button>
    </form>
  );
}
