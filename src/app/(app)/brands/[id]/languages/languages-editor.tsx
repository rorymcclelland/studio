"use client";

// C7-2: the Languages form. One fieldset per supported language: whether the
// brand's ads are translated into it, and its legal lines and banned terms, one
// per line. Nothing is saved unless every language is valid.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { Lang } from "@/lib/creative/languages";
import { addDemoLanguagesAction, saveLanguages, type LanguagesState } from "../../actions";

type Row = { lang: Lang; name: string; chosen: boolean; legalLines: string[]; bannedTerms: string[]; writtenForDemo: boolean };

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function LanguagesEditor({
  brandId,
  languages,
  englishLegal,
  englishBanned,
  writtenForDemoNote,
}: {
  brandId: string;
  languages: Row[];
  englishLegal: string[];
  englishBanned: string[];
  writtenForDemoNote: string;
}) {
  const [rows, setRows] = useState(() => languages.map((l) => ({ ...l, legalText: l.legalLines.join("\n"), bannedText: l.bannedTerms.join("\n") })));
  const [result, setResult] = useState<LanguagesState | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const change = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const chosen = rows.filter((r) => r.chosen);
  // Unsaved: the form differs from the languages the page was given (a save refreshes those).
  const shape = (x: { lang: Lang; chosen: boolean }, legal: string[], banned: string[]) => JSON.stringify([x.lang, x.chosen, x.chosen ? legal : [], x.chosen ? banned : []]);
  const dirty =
    rows.map((r) => shape(r, lines(r.legalText), lines(r.bannedText))).join() !== languages.map((l) => shape(l, l.legalLines, l.bannedTerms)).join();
  const errors = result && !result.ok ? result.fieldErrors : {};
  const errorFor = (lang: Lang, field: "legalLines" | "bannedTerms") => {
    const n = chosen.findIndex((r) => r.lang === lang);
    const key = Object.keys(errors).find((k) => k.startsWith(`${n}.${field}`));
    return key ? errors[key] : undefined;
  };

  const save = () =>
    start(async () => {
      const r = await saveLanguages(
        brandId,
        chosen.map((x) => ({ lang: x.lang, legalLines: lines(x.legalText), bannedTerms: lines(x.bannedText) })),
      );
      setResult(r);
      if (r.ok) {
        toast({ message: r.done, tone: "good" });
        router.refresh();
      }
    });

  return (
    <form
      // Controls scrolled into view by focus stop above the sticky save bar, not under it.
      className="space-y-5 [&_:is(input,textarea,button)]:scroll-mb-36"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Card className="space-y-2">
        <h2 className="text-lg font-strong">The English kit</h2>
        <p className="max-w-prose text-ink-2">
          Write each language&apos;s lines to say what the English ones say. English legal lines:{" "}
          {englishLegal.length ? <span className="text-ink">{englishLegal.join(" ")}</span> : "none."}
        </p>
        {englishBanned.length > 0 && (
          <p className="max-w-prose text-sm text-ink-2 wrap-anywhere">The English banned terms stay banned in every language: {englishBanned.join(", ")}.</p>
        )}
      </Card>
      {rows.map((r, i) => {
        const id = `lang-${r.lang}`;
        return (
          <Card as="fieldset" key={r.lang} className="min-w-0 space-y-3" data-language-form={r.lang}>
            <legend className="sr-only">{r.name}</legend>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="inline-flex min-h-11 items-center gap-3 text-lg font-strong">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={r.chosen}
                  onChange={(e) => change(i, { chosen: e.target.checked })}
                />
                Translate ads into {r.name}
              </label>
              {r.writtenForDemo && r.chosen && (
                <Pill tone="review" wrap>
                  Written for the demo
                </Pill>
              )}
            </div>
            {r.writtenForDemo && r.chosen && <p className="max-w-prose text-sm text-ink-2">{writtenForDemoNote}</p>}
            {r.chosen && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  id={`${id}-legal`}
                  label={`${r.name} legal lines`}
                  hint={englishLegal.length ? "One per line. Required while the English kit has legal lines." : "One per line."}
                  error={errorFor(r.lang, "legalLines")}
                >
                  <Textarea rows={3} lang={r.lang} value={r.legalText} onChange={(e) => change(i, { legalText: e.target.value })} />
                </Field>
                <Field id={`${id}-banned`} label={`${r.name} banned terms`} hint="One per line." error={errorFor(r.lang, "bannedTerms")}>
                  <Textarea rows={3} lang={r.lang} value={r.bannedText} onChange={(e) => change(i, { bannedText: e.target.value })} />
                </Field>
              </div>
            )}
            {r.chosen && englishLegal.length > 0 && lines(r.legalText).length === 0 && (
              <p className="text-sm font-medium text-attention-ink" data-no-legal="">
                Without {r.name} legal lines, ads can&apos;t be translated into {r.name}.
              </p>
            )}
          </Card>
        );
      })}
      {/* Answer B1: Save stays on screen while editing, at every width, as the kit editor's does. */}
      <div
        data-save-bar=""
        className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-surface px-4 py-3 shadow-lg ring-1 shadow-ink/10 ring-line sm:flex-nowrap sm:p-4 sm:px-6"
      >
        <div className="min-w-0 basis-full text-sm sm:flex-1 sm:basis-auto">
          {result && !result.ok ? (
            <p role="alert" className="font-medium text-attention-ink">
              {result.error}
            </p>
          ) : (
            <p role="status" className="text-ink-2">
              {pending ? "Saving…" : dirty ? "You have unsaved changes." : "No changes yet."}
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save languages"}
        </Button>
      </div>
    </form>
  );
}

/** For a demo brand added before languages: its three languages, written for the demo. */
export function AddDemoLanguages({ brandId }: { brandId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await addDemoLanguagesAction(brandId);
            if (r.ok) {
              setError(null);
              toast({ message: r.done, tone: "good" });
              router.refresh();
            } else setError(r.error);
          })
        }
      >
        {pending ? "Adding…" : "Add the demo languages"}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-attention-ink">
          {error}
        </p>
      )}
    </div>
  );
}
