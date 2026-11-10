"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { parseNewBrand, slugFromName } from "@/lib/brands/schema";
import { createNewBrand } from "./actions";

const REFUSED = "Some fields need changing. Nothing was saved.";
const FIELDS = ["name", "slug", "category", "description"] as const;
type Key = (typeof FIELDS)[number];
const fieldId = (k: Key) => `new-brand-${k}`;

/**
 * D-1: a brand of your own. The short name follows the name until the person
 * edits it. Errors are said beside their fields, and focus goes to the first.
 */
export function NewBrandForm() {
  const [draft, setDraft] = useState<Record<Key, string>>({
    name: "",
    slug: "",
    category: "",
    description: "",
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The id to focus after the next render (a field to fix, or a new row).
  const focusNext = useRef<string | null>(null);
  const setFocusTo = (id: string) => {
    focusNext.current = id;
  };

  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const change = (k: Key, value: string) => {
    setDraft((d) => ({
      ...d,
      [k]: value,
      ...(k === "name" && !slugEdited ? { slug: slugFromName(value) } : {}),
    }));
    if (k === "slug") setSlugEdited(true);
    setErrors((e) => {
      const next = { ...e };
      delete next[k];
      if (k === "name" && !slugEdited) delete next.slug;
      return next;
    });
  };

  const refuse = (message: string, fieldErrors: Record<string, string>) => {
    setErrors(fieldErrors);
    setFormError(message);
    const first = FIELDS.find((k) => fieldErrors[k]);
    if (first) setFocusTo(fieldId(first));
    else setFocusTo("new-brand-alert");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const checked = parseNewBrand(draft);
    if (!checked.ok) return refuse(REFUSED, checked.fieldErrors);
    setFormError(null);
    startTransition(async () => {
      // On success the action opens the kit editor; it only returns when nothing was saved.
      const state = await createNewBrand(draft);
      if (state) refuse(state.error, state.fieldErrors);
    });
  };

  return (
    <Card as="section" aria-label="New brand" className="max-w-2xl">
      <form data-new-brand-form="" noValidate onSubmit={submit} className="flex flex-col gap-5">
        {formError && (
          <p id="new-brand-alert" tabIndex={-1} role="alert" className="font-medium text-attention-ink">
            {formError}
          </p>
        )}
        <Field id={fieldId("name")} label="Name" hint="Up to 80 characters." error={errors.name}>
          <Input value={draft.name} autoComplete="off" onChange={(e) => change("name", e.target.value)} aria-required="true" />
        </Field>
        <Field
          id={fieldId("slug")}
          label="Short name"
          hint="Filled in from the name. Lower-case letters, numbers and hyphens; agents and addresses use it."
          error={errors.slug}
        >
          <Input value={draft.slug} autoCapitalize="none" spellCheck={false} onChange={(e) => change("slug", e.target.value)} />
        </Field>
        <Field id={fieldId("category")} label="Category" hint="For example, home cooking. Up to 60 characters." error={errors.category}>
          <Input value={draft.category} onChange={(e) => change("category", e.target.value)} />
        </Field>
        <Field id={fieldId("description")} label="Description" hint="One or two sentences. Up to 500 characters." error={errors.description}>
          <Textarea rows={2} value={draft.description} onChange={(e) => change("description", e.target.value)} />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create brand"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
