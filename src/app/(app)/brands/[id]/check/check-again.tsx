"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { checkUploadAgain } from "./actions";

// C8-3: check an uploaded ad again, for the same or another channel and
// language (after a failed check, or a change to the kit). The cost is on the button.

export function CheckAgain({
  brandId,
  assetId,
  cost,
  languages,
  channel,
  lang,
}: {
  brandId: string;
  assetId: string;
  cost: string;
  languages: { lang: string; name: string }[];
  channel: string;
  lang: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const id = useId();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = await checkUploadAgain(brandId, assetId, String(form.get("channel")), String(form.get("lang")));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ message: r.done, tone: "good" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" data-check-again="">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-channel`} label="Channel">
          <Select name="channel" defaultValue={channel}>
            <option value="paid social">Paid social</option>
            <option value="display">Display (banners)</option>
          </Select>
        </Field>
        <Field id={`${id}-lang`} label="Language">
          <Select name="lang" defaultValue={lang}>
            {languages.map((l) => (
              <option key={l.lang} value={l.lang}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-attention-ink">
          {error}
        </p>
      )}
      <div>
        <Button variant="quiet" disabled={pending}>
          {pending ? "Starting…" : `Check again (${cost})`}
        </Button>
      </div>
    </form>
  );
}
