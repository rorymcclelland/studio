"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn, type SignInState } from "./actions";

export function SignInForm({ dev }: { dev: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null);
  const error = state?.tone === "error" ? state.message : undefined;
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <Field id="email" label="Email" error={error}>
        <Input type="email" name="email" required autoComplete="email" />
      </Field>
      <Button disabled={pending} className="w-full">
        {pending ? "Sending…" : dev ? "Sign in" : "Send sign-in link"}
      </Button>
      {state?.tone === "info" && (
        <p role="status" className="rounded-field bg-good-soft px-4 py-3 text-sm font-medium text-good-ink">
          {state.message}
        </p>
      )}
    </form>
  );
}
