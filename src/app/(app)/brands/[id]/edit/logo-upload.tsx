"use client";

// F-10: a brand's logo, uploaded as SVG or PNG. It is saved as soon as it is
// uploaded (not with the kit's Save), previewed on a light and a dark
// background so a dark logo on a dark layout is caught by eye, and a refusal
// says why, with nothing stored.

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { useToast } from "@/components/ui/toast";
import { removeLogo, uploadLogo } from "../../actions";
import { BrandLogo } from "../../brand-logo";

const SVG_MAX = 200_000;
const PNG_MAX = 1024 * 1024;

type Logo = { svg: string | null; pngSrc: string | null };

/** Refuses a file that can't pass before it is sent, with the same reasons the server gives. */
function checkBeforeSending(file: File): string | null {
  const name = file.name.toLowerCase();
  if (file.size === 0) return "The file is empty.";
  if (name.endsWith(".png") && file.size > PNG_MAX) return "The PNG is too large (1 MB at most).";
  if (name.endsWith(".svg") && file.size > SVG_MAX) return "The SVG is too large (200 KB at most).";
  if (!name.endsWith(".png") && !name.endsWith(".svg") && file.type !== "image/svg+xml" && file.type !== "image/png") {
    return "Upload the logo as an SVG or a PNG.";
  }
  if (file.size > PNG_MAX) return "The file is too large: an SVG can be 200 KB and a PNG 1 MB at most.";
  return null;
}

export function LogoUpload({ brandId, brandName, initial }: { brandId: string; brandName: string; initial: Logo }) {
  const [logo, setLogo] = useState<Logo>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [doing, setDoing] = useState<"upload" | "remove" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const id = useId();
  const has = !!(logo.svg || logo.pngSrc);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const file = input.current?.files?.[0];
    if (!file) {
      setError("Choose an SVG or PNG file first.");
      input.current?.focus();
      return;
    }
    const early = checkBeforeSending(file);
    if (early) {
      setError(`${early} Nothing was changed.`);
      input.current?.focus();
      return;
    }
    const form = new FormData();
    form.set("logo", file);
    setError(null);
    setDoing("upload");
    start(async () => {
      try {
        const r = await uploadLogo(brandId, form);
        if (!r.ok) {
          setError(r.error);
          input.current?.focus();
          return;
        }
        setLogo(r.logo?.kind === "svg" ? { svg: r.logo.svg, pngSrc: null } : r.logo ? { svg: null, pngSrc: r.logo.src } : { svg: null, pngSrc: null });
        if (input.current) input.current.value = "";
        toast({ message: r.done, tone: "good" });
      } catch {
        setError("Couldn't upload the logo. Nothing was changed; check the file is an SVG or PNG under its limit, and try again.");
      }
    });
  }

  function onRemove() {
    setError(null);
    setDoing("remove");
    start(async () => {
      const r = await removeLogo(brandId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLogo({ svg: null, pngSrc: null });
      toast({ message: r.done, tone: "good" });
    });
  }

  return (
    <Card as="section" aria-labelledby={`${id}-title`} className="space-y-4" data-logo-upload="">
      <div>
        <h2 id={`${id}-title`} className="text-2xl font-strong tracking-tight">
          Logo
        </h2>
        <p className="mt-1 max-w-prose text-ink-2">
          Ads draw it in code, top left. An upload is saved straight away, separately from the rest of the kit. Ads already
          made keep the logo they were drawn with.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3" data-logo-preview="">
        <Preview label="On a light background" dark={false} name={brandName} logo={logo} has={has} />
        <Preview label="On a dark background" dark name={brandName} logo={logo} has={has} />
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-file`} className="font-semibold">
            {has ? "Replace the logo" : "Upload a logo"}
          </label>
          <p id={`${id}-hint`} className="text-sm text-ink-2">
            An SVG up to 200 KB, or a PNG up to 1 MB. A PNG is re-encoded without its metadata, at most 1024 px on its
            longest side. An SVG loses anything that could run or load from elsewhere.
          </p>
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept=".svg,.png,image/svg+xml,image/png"
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
            <p id={`${id}-error`} role="alert" className="text-sm font-medium text-attention-ink" data-logo-error="">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={pending}>{pending && doing === "upload" ? "Uploading…" : "Upload logo"}</Button>
          {has && (
            <Button type="button" variant="quiet" disabled={pending} onClick={onRemove}>
              {pending && doing === "remove" ? "Removing…" : "Remove logo"}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function Preview({ label, dark, name, logo, has }: { label: string; dark: boolean; name: string; logo: Logo; has: boolean }) {
  return (
    <figure className="min-w-0">
      <div
        className={cx(
          "grid h-20 place-items-center rounded-field p-3 ring-1 ring-inset sm:h-28 sm:p-4",
          dark ? "bg-ink ring-ink" : "bg-surface ring-line",
        )}
      >
        {has ? (
          <BrandLogo name={name} svg={logo.svg} pngSrc={logo.pngSrc} decorative={dark} className="h-10 w-auto max-w-full object-center sm:h-16" />
        ) : (
          <span className={cx("text-sm", dark ? "text-surface" : "text-ink-2")}>No logo yet</span>
        )}
      </div>
      <figcaption className="mt-1.5 text-sm text-ink-2">{label}</figcaption>
    </figure>
  );
}
