"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import type { FormState } from "../actions";
import { newCampaign } from "./actions";

/**
 * S3-2: brand plus objective in, a campaign out. The action starts the Brief
 * agent and opens the campaign. On a brand page the brand is fixed.
 */
export function NewCampaignForm({
  brands,
  brandId,
  limits,
  idPrefix = "new-campaign",
}: {
  /** OBJECTIVE_MIN and OBJECTIVE_MAX from the brief repo (server only), passed down by the page. */
  limits: { min: number; max: number };
  /** Brands to choose from; leave out when `brandId` fixes the brand. */
  brands?: { id: string; name: string }[];
  brandId?: string;
  idPrefix?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(newCampaign, null);
  const [objective, setObjective] = useState("");
  const error = state && "error" in state ? state.error : undefined;
  const length = objective.trim().length;
  const { min, max } = limits;
  const countId = `${idPrefix}-count`;
  return (
    <form action={action} className="mt-5 flex flex-col gap-4">
      {brandId ? (
        <input type="hidden" name="brandId" value={brandId} />
      ) : (
        <Field id={`${idPrefix}-brand`} label="Brand" className="max-w-sm">
          <Select name="brandId" required defaultValue={brands?.[0]?.id}>
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field
        id={`${idPrefix}-objective`}
        label="Objective"
        hint={`What should the campaign achieve, and for whom? Between ${min} and ${max} characters.`}
        error={error}
      >
        <Textarea
          name="objective"
          rows={3}
          required
          minLength={min}
          maxLength={max}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="For example, launch the winter range to lapsed customers"
          aria-describedby={countId}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button disabled={pending}>{pending ? "Starting the Brief agent…" : "Write the brief"}</Button>
        <p
          id={countId}
          className={cx("text-sm tabular-nums", length > max ? "font-medium text-attention-ink" : "text-ink-2")}
        >
          {length} of {max} characters{length > 0 && length < min ? `, at least ${min} needed` : ""}
        </p>
      </div>
    </form>
  );
}
