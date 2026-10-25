"use client";

import { createContext, useActionState, useContext, useEffect } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { FormState } from "../actions";
import { addDemoBrands } from "./actions";

type DemoAction = { action: () => void; pending: boolean; error: string | null };
const DemoContext = createContext<DemoAction | null>(null);

/**
 * S2-4: holds the "Add demo brands" action for the whole Brands page. The
 * page swaps its empty state for the list once the brands are in, which
 * replaces the button; keeping the action's state up here means the result
 * still shows (a toast on success).
 */
export function DemoBrandsProvider({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<FormState>(addDemoBrands, null);
  const toast = useToast();
  const done = state && "done" in state ? state.done : null;
  const error = state && "error" in state ? state.error : null;
  useEffect(() => {
    if (done) toast({ message: done, tone: "good" });
  }, [done, toast]);
  return <DemoContext.Provider value={{ action, pending, error }}>{children}</DemoContext.Provider>;
}

/**
 * The button. Loading takes a few seconds, so it says what is happening while
 * it runs. A refusal (already loaded) is shown beside it.
 */
export function AddDemoBrands({ variant = "primary" }: { variant?: ButtonVariant }) {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("AddDemoBrands needs a DemoBrandsProvider around it.");
  const { action, pending, error } = ctx;
  return (
    <form action={action} className="flex flex-col items-start">
      <Button variant={variant} size={variant === "primary" ? "md" : "sm"} disabled={pending} aria-describedby="demo-progress">
        {pending ? "Adding demo brands…" : "Add demo brands"}
      </Button>
      {/* Always in the page, so screen readers announce the progress when it appears. */}
      <p id="demo-progress" role="status" className={pending ? "mt-3 max-w-prose text-sm text-ink-2" : undefined}>
        {pending ? "Building each brand's products, customers and two years of orders. This takes a few seconds." : ""}
      </p>
      {error && !pending && (
        <p role="alert" className="mt-3 max-w-prose font-medium text-attention-ink">
          {error}
        </p>
      )}
    </form>
  );
}
