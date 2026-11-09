"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useLeaveGuard } from "@/components/use-leave-guard";
import { parseBrandInput } from "@/lib/brands/schema";
import { saveBrand, type BrandDraft } from "../../actions";

type ListKey = "toneWords" | "doRules" | "dontRules" | "legalLines" | "bannedTerms" | "evidenceClaims";
type Row = { key: number; value: string };
type ColourRow = { key: number; name: string; hex: string };
type Draft = Omit<Required<BrandDraft>, ListKey | "palette"> & Record<ListKey, Row[]> & { palette: ColourRow[] };
type Errors = Record<string, string>;

const LEAVE_MESSAGE = "You have unsaved changes to this brand kit. Leave without saving them?";
const HEX = /^#[0-9a-fA-F]{6}$/;

let nextKey = 1;
const rows = (xs: string[] = []): Row[] => xs.map((value) => ({ key: nextKey++, value }));

function toDraft(k: BrandDraft): Draft {
  return {
    name: k.name,
    slug: k.slug,
    description: k.description ?? "",
    category: k.category ?? "",
    voiceNotes: k.voiceNotes ?? "",
    fontPrimary: k.fontPrimary ?? "",
    fontSecondary: k.fontSecondary ?? "",
    toneWords: rows(k.toneWords),
    doRules: rows(k.doRules),
    dontRules: rows(k.dontRules),
    legalLines: rows(k.legalLines),
    bannedTerms: rows(k.bannedTerms),
    evidenceClaims: rows(k.evidenceClaims),
    palette: (k.palette ?? []).map((c) => ({ key: nextKey++, name: c.name, hex: c.hex })),
  };
}

function toInput(d: Draft): BrandDraft {
  const values = (xs: Row[]) => xs.map((r) => r.value);
  return {
    name: d.name,
    slug: d.slug,
    description: d.description,
    category: d.category,
    toneWords: values(d.toneWords),
    voiceNotes: d.voiceNotes,
    doRules: values(d.doRules),
    dontRules: values(d.dontRules),
    palette: d.palette.map((c) => ({ name: c.name, hex: c.hex })),
    fontPrimary: d.fontPrimary,
    fontSecondary: d.fontSecondary,
    legalLines: values(d.legalLines),
    bannedTerms: values(d.bannedTerms),
    evidenceClaims: values(d.evidenceClaims),
  };
}

/** The id of the control an error path belongs to: "palette.0.hex" → "f-palette-0-hex". */
const fieldId = (path: string) => `f-${path.replaceAll(".", "-")}`;

/**
 * Compares two kits as they would be saved: spaces at the ends are trimmed on
 * save, and key order does not count (the database returns palette colours
 * as {hex, name}; the editor builds {name, hex}).
 */
const same = (a: BrandDraft, b: BrandDraft) => canonical(a) === canonical(b);
function canonical(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.trim());
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * The kit editor. `lead` (the logo section, which saves on its own) is shown
 * above the form, inside the same block as the save bar, so the bar stays in
 * view from the top of the page to the bottom (U10-1).
 */
export function BrandEditor({ brandId, initial, lead }: { brandId: string; initial: BrandDraft; lead?: React.ReactNode }) {
  const formId = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [baseline, setBaseline] = useState<BrandDraft>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const toast = useToast();
  const focusNext = useRef<string | null>(null);
  const focusLater = (id: string) => {
    focusNext.current = id;
  };

  const input = useMemo(() => toInput(draft), [draft]);
  const dirty = !same(input, baseline);
  const { leaveTo } = useLeaveGuard(dirty, LEAVE_MESSAGE);

  // The page is kept (hidden) when you leave it, so a later visit would show
  // this draft. Leaving means it was saved or discarded, so on hiding, mark
  // the draft for a fresh start; the next render rebuilds it from the kit the
  // server sent, so draft and baseline always come from the same kit.
  const [left, setLeft] = useState(false);
  useLayoutEffect(() => () => setLeft(true), []);

  // When the server sends a newer kit (after a save, or on coming back to a
  // kept page), show it, unless there is a draft that would be lost.
  const initialKey = JSON.stringify(initial);
  const [seenInitial, setSeenInitial] = useState(initialKey);
  if (left || seenInitial !== initialKey) {
    setLeft(false);
    setSeenInitial(initialKey);
    if (left || !dirty) {
      setDraft(toDraft(initial));
      setBaseline(initial);
      setErrors({});
      setFormError(null);
    }
  }

  // Move focus after adding or removing a row, once the row exists.
  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function clearError(path: string) {
    if (!errors[path]) return;
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== path)));
  }

  /** Errors for a list are dropped when a row goes, since rows move up. */
  function clearListErrors(list: string) {
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== list && !k.startsWith(`${list}.`))));
  }

  function showErrors(fieldErrors: Errors, message: string) {
    setErrors(fieldErrors);
    setFormError(message);
    const first = Object.keys(fieldErrors)[0];
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const checked = parseBrandInput(input);
    if (!checked.ok) {
      const n = Object.keys(checked.fieldErrors).length;
      showErrors(
        checked.fieldErrors,
        `${n === 1 ? "One field needs" : `${n} fields need`} changing before the kit can be saved. Nothing has been saved.`,
      );
      return;
    }
    setFormError(null);
    startSaving(async () => {
      const res = await saveBrand(brandId, input);
      if (!res.ok) {
        showErrors(res.fieldErrors, res.error);
        return;
      }
      setErrors({});
      setBaseline(input);
      toast({ message: res.done, tone: "good" });
      leaveTo(`/brands/${brandId}`);
    });
  }

  return (
    // Controls scrolled into view by focus stop above the sticky save bar, not under it.
    <div className="space-y-8 [&_:is(input,textarea,select,button,a)]:scroll-mb-36">
      {lead}
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-6" aria-describedby={formError ? "form-error" : undefined}>
        <Section id="identity" title="Identity" intro="How the brand is named and described to agents.">
          <div className="grid gap-6 md:grid-cols-2">
            <Field id={fieldId("name")} label="Name" hint="As customers see it." error={errors.name}>
              <Input
                value={draft.name}
                maxLength={120}
                onChange={(e) => {
                  set("name", e.target.value);
                  clearError("name");
                }}
              />
            </Field>
            <Field
              id={fieldId("slug")}
              label="Short name"
              hint="Lower-case letters, numbers and hyphens. Agents and addresses use it."
              error={errors.slug}
            >
              <Input
                value={draft.slug}
                maxLength={60}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => {
                  set("slug", e.target.value);
                  clearError("slug");
                }}
              />
            </Field>
            <Field id={fieldId("category")} label="Category" hint="For example, outdoor apparel." error={errors.category}>
              <Input
                value={draft.category}
                maxLength={80}
                onChange={(e) => {
                  set("category", e.target.value);
                  clearError("category");
                }}
              />
            </Field>
            <Field
              id={fieldId("description")}
              label="Description"
              hint="One or two sentences. Up to 500 characters."
              error={errors.description}
              className="md:col-span-2"
            >
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(e) => {
                  set("description", e.target.value);
                  clearError("description");
                }}
              />
            </Field>
          </div>
        </Section>

        <Section id="voice" title="Voice" intro="How the brand sounds, and what it always or never does.">
          <ListField
            field="toneWords"
            label="Tone words"
            itemLabel="Tone word"
            hint="Up to 12 words, 30 characters each."
            max={12}
            rows={draft.toneWords}
            errors={errors}
            onChange={(v) => set("toneWords", v)}
            clearError={clearError}
            clearListErrors={clearListErrors}
            focusLater={focusLater}
          />
          <Field
            id={fieldId("voiceNotes")}
            label="Voice notes"
            hint="Anything a writer should know. Up to 2,000 characters."
            error={errors.voiceNotes}
          >
            <Textarea
              rows={4}
              value={draft.voiceNotes}
              onChange={(e) => {
                set("voiceNotes", e.target.value);
                clearError("voiceNotes");
              }}
            />
          </Field>
          <ListField
            field="doRules"
            label="Do"
            itemLabel="Do rule"
            hint="Up to 20 rules, 300 characters each."
            max={20}
            long
            rows={draft.doRules}
            errors={errors}
            onChange={(v) => set("doRules", v)}
            clearError={clearError}
            clearListErrors={clearListErrors}
            focusLater={focusLater}
          />
          <ListField
            field="dontRules"
            label="Don't"
            itemLabel="Don't rule"
            hint="Up to 20 rules, 300 characters each."
            max={20}
            long
            rows={draft.dontRules}
            errors={errors}
            onChange={(v) => set("dontRules", v)}
            clearError={clearError}
            clearListErrors={clearListErrors}
            focusLater={focusLater}
          />
        </Section>

        <Section id="visual" title="Visual" intro="The colours and type every design uses.">
          <PaletteField
            colours={draft.palette}
            errors={errors}
            onChange={(v) => set("palette", v)}
            clearError={clearError}
            clearListErrors={clearListErrors}
            focusLater={focusLater}
          />
          <div className="grid gap-6 md:grid-cols-2">
            <Field id={fieldId("fontPrimary")} label="Primary font" hint="For headings." error={errors.fontPrimary}>
              <Input
                value={draft.fontPrimary}
                maxLength={80}
                onChange={(e) => {
                  set("fontPrimary", e.target.value);
                  clearError("fontPrimary");
                }}
              />
            </Field>
            <Field id={fieldId("fontSecondary")} label="Secondary font" hint="For body text." error={errors.fontSecondary}>
              <Input
                value={draft.fontSecondary}
                maxLength={80}
                onChange={(e) => {
                  set("fontSecondary", e.target.value);
                  clearError("fontSecondary");
                }}
              />
            </Field>
          </div>
        </Section>

        <Section id="legal" title="Legal" intro="What must always appear, what must never appear, and what needs proof.">
          <ListField
            field="legalLines"
            label="Required legal lines"
            itemLabel="Legal line"
            hint="Up to 20 lines, 500 characters each."
            max={20}
            long
            rows={draft.legalLines}
            errors={errors}
            onChange={(v) => set("legalLines", v)}
            clearError={clearError}
            clearListErrors={clearListErrors}
            focusLater={focusLater}
          />
          <ListField
            field="bannedTerms"
            label="Banned terms"
            itemLabel="Banned term"
            hint="Words or phrases agents must never use. Up to 50, 80 characters each."
            max={50}
            rows={draft.bannedTerms}
            errors={errors}
            onChange={(v) => set("bannedTerms", v)}
            clearError={clearError}
            clearListErrors={clearListErrors}
            focusLater={focusLater}
          />
          <ListField
            field="evidenceClaims"
            label="Claims that need evidence"
            itemLabel="Claim"
            hint="Claims agents may only make with proof, such as “lightest”. Up to 20, 120 characters each."
            max={20}
            rows={draft.evidenceClaims}
            errors={errors}
            onChange={(v) => set("evidenceClaims", v)}
            clearError={clearError}
            clearListErrors={clearListErrors}
            focusLater={focusLater}
          />
        </Section>
      </form>

      {/* Stays in view while editing, at every width (U10-1). On a phone it is
          one short line of status above the buttons, so it hides little of the form. */}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-surface px-4 py-3 shadow-lg ring-1 shadow-ink/10 ring-line sm:flex-nowrap sm:p-4 sm:px-6">
        <div className="min-w-0 basis-full text-sm sm:flex-1 sm:basis-auto">
          {formError ? (
            <p id="form-error" role="alert" className="font-medium text-attention-ink">
              {formError}
            </p>
          ) : (
            <p role="status" className="text-ink-2">
              {saving ? "Saving…" : dirty ? "You have unsaved changes." : "No changes yet."}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? "Saving…" : "Save brand kit"}
          </Button>
          <ButtonLink href={`/brands/${brandId}`} variant="quiet">
            Cancel
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <Card as="section" aria-labelledby={id} className="space-y-6">
      <div>
        <h2 id={id} className="text-2xl font-strong tracking-tight">
          {title}
        </h2>
        <p className="mt-1 text-ink-2">{intro}</p>
      </div>
      {children}
    </Card>
  );
}

/** Focuses the element with this id after the next render (once a new row exists). */
type FocusLater = (id: string) => void;

function ListField({
  field,
  label,
  itemLabel,
  hint,
  max,
  long = false,
  rows: items,
  errors,
  onChange,
  clearError,
  clearListErrors,
  focusLater,
}: {
  field: ListKey;
  label: string;
  itemLabel: string;
  hint: string;
  max: number;
  long?: boolean;
  rows: Row[];
  errors: Errors;
  onChange: (rows: Row[]) => void;
  clearError: (path: string) => void;
  clearListErrors: (list: string) => void;
  focusLater: FocusLater;
}) {
  const listError = errors[field];
  const full = items.length >= max;
  return (
    <fieldset
      id={fieldId(field)}
      tabIndex={-1}
      aria-describedby={cx(`${field}-hint`, listError && `${field}-error`)}
      className="min-w-0 space-y-3"
    >
      <legend className="font-semibold">{label}</legend>
      <p id={`${field}-hint`} className="-mt-1.5 text-sm text-ink-2">
        {hint}
      </p>
      {items.length === 0 && <p className="text-ink-2">None yet.</p>}
      <ol className="space-y-3">
        {items.map((row, i) => {
          const path = `${field}.${i}`;
          const id = fieldId(path);
          const err = errors[path];
          const Control = long ? Textarea : Input;
          return (
            <li key={row.key} className="min-w-0">
              <div className="flex items-start gap-2">
                <Control
                  id={id}
                  {...(long ? { rows: 1, className: "min-h-11 field-sizing-content" } : {})}
                  aria-label={`${itemLabel} ${i + 1}`}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `${id}-error` : undefined}
                  value={row.value}
                  onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    onChange(items.map((r) => (r.key === row.key ? { ...r, value: e.target.value } : r)));
                    clearError(path);
                  }}
                />
                <RemoveButton
                  label={`${itemLabel} ${i + 1}`}
                  onClick={() => {
                    onChange(items.filter((r) => r.key !== row.key));
                    clearListErrors(field);
                    focusLater(i > 0 ? fieldId(`${field}.${i - 1}`) : `${field}-add`);
                  }}
                />
              </div>
              {err && (
                <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm font-medium text-attention-ink">
                  {err}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {listError && (
        <p id={`${field}-error`} role="alert" className="text-sm font-medium text-attention-ink">
          {listError}
        </p>
      )}
      <AddButton
        id={`${field}-add`}
        full={full}
        max={max}
        onClick={() => {
          onChange([...items, { key: nextKey++, value: "" }]);
          focusLater(fieldId(`${field}.${items.length}`));
        }}
      >
        Add {article(itemLabel)} {itemLabel.toLowerCase()}
      </AddButton>
    </fieldset>
  );
}

function PaletteField({
  colours,
  errors,
  onChange,
  clearError,
  clearListErrors,
  focusLater,
}: {
  colours: ColourRow[];
  errors: Errors;
  onChange: (rows: ColourRow[]) => void;
  clearError: (path: string) => void;
  clearListErrors: (list: string) => void;
  focusLater: FocusLater;
}) {
  const max = 12;
  const update = (key: number, patch: Partial<ColourRow>) =>
    onChange(colours.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  return (
    <fieldset
      id={fieldId("palette")}
      tabIndex={-1}
      aria-describedby={cx("palette-hint", errors.palette && "palette-error")}
      className="min-w-0 space-y-3"
    >
      <legend className="font-semibold">Palette</legend>
      <p id="palette-hint" className="-mt-1.5 text-sm text-ink-2">
        Up to 12 colours, each with a name and a hex value such as #3F5B3A.
      </p>
      {colours.length === 0 && <p className="text-ink-2">None yet.</p>}
      <ol className="space-y-3">
        {colours.map((c, i) => {
          const nameId = fieldId(`palette.${i}.name`);
          const hexId = fieldId(`palette.${i}.hex`);
          const nameErr = errors[`palette.${i}.name`];
          const hexErr = errors[`palette.${i}.hex`];
          return (
            <li key={c.key} className="min-w-0">
              <div className="flex items-start gap-2">
                {/* The swatch shows the brand's own colour, which is data, not a design token. */}
                <span
                  aria-hidden
                  className={cx(
                    "mt-0.5 size-10 shrink-0 rounded-field ring-1 ring-line ring-inset",
                    !HEX.test(c.hex.trim()) && "bg-surface-2",
                  )}
                  style={HEX.test(c.hex.trim()) ? { backgroundColor: c.hex.trim() } : undefined}
                />
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <Input
                    id={nameId}
                    aria-label={`Colour ${i + 1} name`}
                    aria-invalid={nameErr ? true : undefined}
                    aria-describedby={nameErr ? `${nameId}-error` : undefined}
                    value={c.name}
                    placeholder="Name"
                    onChange={(e) => {
                      update(c.key, { name: e.target.value });
                      clearError(`palette.${i}.name`);
                    }}
                  />
                  <Input
                    id={hexId}
                    aria-label={`Colour ${i + 1} hex value`}
                    aria-invalid={hexErr ? true : undefined}
                    aria-describedby={hexErr ? `${hexId}-error` : undefined}
                    value={c.hex}
                    placeholder="#000000"
                    spellCheck={false}
                    autoCapitalize="none"
                    className="font-mono"
                    onChange={(e) => {
                      update(c.key, { hex: e.target.value });
                      clearError(`palette.${i}.hex`);
                    }}
                  />
                </div>
                <RemoveButton
                  label={`colour ${i + 1}`}
                  onClick={() => {
                    onChange(colours.filter((x) => x.key !== c.key));
                    clearListErrors("palette");
                    focusLater(i > 0 ? fieldId(`palette.${i - 1}.name`) : "palette-add");
                  }}
                />
              </div>
              {nameErr && (
                <p id={`${nameId}-error`} role="alert" className="mt-1.5 pl-12 text-sm font-medium text-attention-ink">
                  {nameErr}
                </p>
              )}
              {hexErr && (
                <p id={`${hexId}-error`} role="alert" className="mt-1.5 pl-12 text-sm font-medium text-attention-ink">
                  {hexErr}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {errors.palette && (
        <p id="palette-error" role="alert" className="text-sm font-medium text-attention-ink">
          {errors.palette}
        </p>
      )}
      <AddButton
        id="palette-add"
        full={colours.length >= max}
        max={max}
        onClick={() => {
          onChange([...colours, { key: nextKey++, name: "", hex: "" }]);
          focusLater(fieldId(`palette.${colours.length}.name`));
        }}
      >
        Add a colour
      </AddButton>
    </fieldset>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="quiet" size="sm" className="mt-1 px-3" onClick={onClick}>
      Remove<span className="sr-only"> {label}</span>
    </Button>
  );
}

function AddButton({
  id,
  full,
  max,
  onClick,
  children,
}: {
  id: string;
  full: boolean;
  max: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button id={id} type="button" variant="quiet" size="sm" disabled={full} onClick={onClick}>
        <span aria-hidden>+</span> {children}
      </Button>
      {full && <span className="text-sm text-ink-2">That&apos;s the most allowed ({max}).</span>}
    </div>
  );
}

function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
