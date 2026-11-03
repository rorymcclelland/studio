"use client";

// C8-3: the Check an ad form. A PNG or JPEG up to 4 MB, the channel and the
// language the ad is for; the button shows what the check costs before the
// click (rule 3). The file goes to the upload route (its own limit), not a
// server action. A refusal says why, and nothing is stored.

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const MAX_BYTES = 4 * 1024 * 1024;

/** Refuses a file that can't pass before it is sent, with the same reasons the server gives. */
function checkBeforeSending(file: File): string | null {
  const name = file.name.toLowerCase();
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_BYTES) return "The file is too large (4 MB at most).";
  if (name.endsWith(".svg") || file.type === "image/svg+xml") return "An SVG can't be checked. Upload the ad as a PNG or JPEG.";
  return null;
}

export function UploadForm({ brandId, languages, cost }: { brandId: string; languages: { lang: string; name: string }[]; cost: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();
  const id = useId();

  function fail(message: string) {
    setError(message);
    input.current?.focus();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const file = input.current?.files?.[0];
    if (!file) return fail("Choose a PNG or JPEG file first.");
    const early = checkBeforeSending(file);
    if (early) return fail(`${early} Nothing was stored.`);
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      try {
        const res = await fetch(`/brands/${brandId}/check/upload`, { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as { ok: boolean; error?: string; done?: string; href?: string } | null;
        if (!body) {
          // A body the host refused before Studio saw it (for example over its own request limit) isn't JSON.
          return fail(res.status === 413 ? "The file is too large to send. Nothing was stored." : "Couldn't upload the ad. Nothing was stored; try again.");
        }
        if (!body.ok) return fail(body.error ?? "Couldn't upload the ad. Nothing was stored; try again.");
        toast({ message: body.done ?? "Uploaded.", tone: "good" });
        router.push(body.href!);
      } catch {
        fail("Couldn't upload the ad. Nothing was stored; check the file is a PNG or JPEG under 4 MB, and try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" data-upload-form="">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-file`} className="font-semibold">
          The ad
        </label>
        <p id={`${id}-hint`} className="max-w-prose text-sm text-ink-2">
          A PNG or JPEG up to 4 MB and 4096 pixels on each side. It is re-encoded without its metadata and kept only for this
          brand&apos;s checks: it never goes into Studio&apos;s ads or a launch pack.
        </p>
        <input
          ref={input}
          id={`${id}-file`}
          name="ad"
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          aria-describedby={cx(`${id}-hint`, error && `${id}-error`)}
          aria-invalid={error ? true : undefined}
          onChange={() => setError(null)}
          className={cx(
            "w-full min-w-0 rounded-field border border-field-line bg-surface px-2 py-2 text-base text-ink",
            "file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-full file:border-0 file:bg-primary-soft file:px-4 file:font-semibold file:text-ink",
            "aria-invalid:border-attention-ink aria-invalid:ring-2 aria-invalid:ring-attention-soft",
          )}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm font-medium text-attention-ink" data-upload-error="">
            {error}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-channel`} label="Channel">
          <Select name="channel" defaultValue="paid social">
            <option value="paid social">Paid social</option>
            <option value="display">Display (banners)</option>
          </Select>
        </Field>
        <Field id={`${id}-lang`} label="Language">
          <Select name="lang" defaultValue="en-GB">
            {languages.map((l) => (
              <option key={l.lang} value={l.lang}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button disabled={pending}>{pending ? "Uploading…" : `Upload and check (${cost})`}</Button>
      </div>
    </form>
  );
}
