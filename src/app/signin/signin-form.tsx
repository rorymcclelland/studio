"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

export function SignInForm({ dev }: { dev: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null);
  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded-md border border-line bg-surface px-3 py-2 text-base"
        />
      </label>
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-white disabled:opacity-60 dark:text-black">
        {pending ? "Sending…" : dev ? "Sign in" : "Send sign-in link"}
      </button>
      {state && (
        <p role="status" className={`text-sm ${state.tone === "error" ? "text-bad" : "text-ink-2"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
