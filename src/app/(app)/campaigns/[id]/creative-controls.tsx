"use client";

// S5-4: the Creative section's buttons and the words editor. Every action
// shows its error beneath it and toasts its result; the costed ones say
// roughly what they cost before the click (rule 3).

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { BriefActionState } from "../actions";
import {
  discardAd,
  discardAdTranslation,
  discardSet,
  editAdWords,
  editCopySet,
  keepAdWords,
  makeCreative,
  newAdPicture,
  newAdWords,
  newSetWords,
  pickAd,
  redrawAd,
  redrawAllAds,
  restoreAd,
  restoreSet,
  switchLayout,
  translateAd,
  translatePicked,
} from "../creative-actions";
import { ActionError } from "./brief-actions";
import { useBriefAction } from "./use-brief-action";

/** One editable field of a set of words, with its limit (from the channel limits). */
export type FieldSpec = { path: string; label: string; limit: number; multiline: boolean };

/** A costed button's label: what it does, then roughly what it costs. */
function Costed({ label, estimate }: { label: string; estimate: string }) {
  return (
    // Each part stays on one line; on a narrow screen the estimate moves below the label as a whole.
    <span className="inline-flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0 text-center">
      <span className="whitespace-nowrap">{label}</span>
      <span className="font-medium whitespace-nowrap opacity-90">({estimate})</span>
    </span>
  );
}

/** Make creative, with its estimate; disabled with the reason when it can't run. */
export function MakeCreativeButton({
  campaignId,
  estimate,
  allowed,
  reason,
  running,
}: {
  campaignId: string;
  estimate: string;
  allowed: boolean;
  reason: string | null;
  running: boolean;
}) {
  const { run, pending, error } = useBriefAction();
  const reasonId = useId();
  const blocked = !allowed || running;
  return (
    <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
      <Button
        type="button"
        disabled={pending || blocked}
        aria-describedby={blocked && reason && !running ? reasonId : undefined}
        onClick={() => run(() => makeCreative(campaignId))}
      >
        {pending ? "Starting…" : running ? "Making creative…" : <Costed label="Make creative" estimate={estimate} />}
      </Button>
      {!running && blocked && reason && (
        <p id={reasonId} className="max-w-xs text-sm text-ink-2 sm:text-right" data-make-creative-reason="">
          {reason}
        </p>
      )}
      {!blocked && (
        <p className="max-w-xs text-sm text-ink-2 sm:text-right">AI costs only, within the daily cap. Nothing is published.</p>
      )}
      <ActionError error={error} />
    </div>
  );
}

type AdProps = {
  campaignId: string;
  variantId: string;
  number: number;
  picked: boolean;
  layout: string;
  layouts: { id: string; name: string }[];
  estimates: { newPicture: string; newWords: string };
  busy: { picture: string | null; words: string | null };
  /** How many current ads share these words (New words and Edit words change them all). */
  usedIn: number;
  words: { headline: string; body: string; cta: string };
  fields: FieldSpec[];
  pendingWords: boolean;
  /** F-26: made with an older kit, so Redraw with current kit is offered. */
  olderKit: boolean;
};

/** The layout switcher, Redraw with current kit (F-26), Pick, Discard, New picture, New words and Edit words for one ad. */
export function AdControls(p: AdProps) {
  const { run, pending, error } = useBriefAction();
  const [doing, setDoing] = useState<string | null>(null);
  const go = (what: string, call: () => Promise<BriefActionState>) => {
    setDoing(what);
    run(call);
  };
  const busyNow = (what: string) => pending && doing === what;
  const name = `ad ${p.number}`;
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-sm font-semibold">Layout</legend>
        <div className="flex flex-wrap gap-1.5">
          {p.layouts.map((l) => {
            const current = l.id === p.layout;
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={current}
                aria-label={`${l.name} layout for ${name}`}
                disabled={pending}
                onClick={() => !current && go(`layout-${l.id}`, () => switchLayout(p.campaignId, p.variantId, l.id))}
                className={cx(
                  "min-h-9 rounded-full px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
                  current ? "bg-primary text-on-primary" : "bg-surface-2 text-ink hover:bg-primary-soft disabled:opacity-50",
                )}
              >
                {busyNow(`layout-${l.id}`) ? "Drawing…" : l.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-2">
        {p.olderKit && (
          <Button
            type="button"
            size="sm"
            className="col-span-2 flex-wrap px-3"
            disabled={pending || !!p.busy.picture}
            aria-label={`Redraw ${name} with the current kit, no AI cost`}
            onClick={() => go("redraw", () => redrawAd(p.campaignId, p.variantId))}
          >
            {busyNow("redraw") ? "Redrawing…" : <Costed label="Redraw with current kit" estimate="no AI cost" />}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="quiet"
          disabled={pending}
          aria-label={p.picked ? `Unpick ${name}` : `Pick ${name}`}
          onClick={() => go("pick", () => pickAd(p.campaignId, p.variantId, !p.picked))}
        >
          {busyNow("pick") ? "Saving…" : p.picked ? "Unpick" : "Pick"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          disabled={pending}
          aria-label={`Discard ${name}`}
          onClick={() => go("discard", () => discardAd(p.campaignId, p.variantId))}
        >
          {busyNow("discard") ? "Discarding…" : "Discard"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          className="col-span-2 flex-wrap px-3"
          disabled={pending || !!p.busy.picture}
          aria-label={p.busy.picture ? `Drawing a new picture for ${name}` : `New picture for ${name}, ${p.estimates.newPicture}`}
          onClick={() => go("picture", () => newAdPicture(p.campaignId, p.variantId))}
        >
          {busyNow("picture") ? "Starting…" : p.busy.picture ? "Drawing a new picture…" : <Costed label="New picture" estimate={p.estimates.newPicture} />}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          className="col-span-2 flex-wrap px-3"
          disabled={pending || !!p.busy.words || p.pendingWords}
          aria-label={
            p.busy.words
              ? `Writing new words for ${name}`
              : p.pendingWords
                ? `New words for ${name}: choose the waiting words first`
                : `New words for ${name}, ${p.estimates.newWords}`
          }
          onClick={() => go("words", () => newAdWords(p.campaignId, p.variantId))}
        >
          {busyNow("words") ? "Starting…" : p.busy.words ? "Writing new words…" : <Costed label="New words" estimate={p.estimates.newWords} />}
        </Button>
        <WordsDialog
          className="col-span-2"
          openLabel="Edit words"
          openAriaLabel={`Edit the words for ${name}`}
          disabled={pending || !!p.busy.words || p.pendingWords}
          title={`Edit the words for ad ${p.number}`}
          note={
            p.usedIn > 1
              ? `These words are used in ${p.usedIn} ads. Saving changes all of them.`
              : "These words are used in this ad only."
          }
          fields={p.fields}
          initial={p.words}
          save={(values) => editAdWords(p.campaignId, p.variantId, values as AdProps["words"])}
        />
      </div>
      {p.usedIn > 1 && <p className="text-sm text-ink-2">Words used in {p.usedIn} ads: New words and Edit words change them all.</p>}
      <ActionError error={error} />
    </div>
  );
}

/**
 * C7-2: Translate, on one picked ad or on the whole pick, with its cost before
 * the click (rule 3). Disabled with the reason when the brand's languages
 * can't be used (no legal lines for one, say) or there is nothing to translate.
 */
export function TranslateButton({
  campaignId,
  variantId,
  label,
  estimate,
  reason,
  note = null,
  running,
  align = "start",
}: {
  campaignId: string;
  /** One ad; the whole pick when left out. */
  variantId?: string;
  label: string;
  estimate: string;
  reason: string | null;
  /** Shown beside the button while it works: why some of the brand's languages are left out (test case 5). */
  note?: string | null;
  running: boolean;
  align?: "start" | "end";
}) {
  const { run, pending, error } = useBriefAction();
  const reasonId = useId();
  const noteId = useId();
  const blocked = !!reason || running;
  return (
    <div className={cx("flex min-w-0 flex-col gap-2", align === "end" ? "items-start sm:items-end" : "items-start")}>
      <Button
        type="button"
        size="sm"
        variant={variantId ? "quiet" : "primary"}
        className="flex-wrap px-3"
        disabled={pending || blocked}
        aria-describedby={reason && !running ? reasonId : note ? noteId : undefined}
        onClick={() => run(() => (variantId ? translateAd(campaignId, variantId) : translatePicked(campaignId)))}
      >
        {pending ? "Starting…" : running ? "Translating…" : <Costed label={label} estimate={estimate} />}
      </Button>
      {reason && !running && (
        <p id={reasonId} className={cx("max-w-sm text-sm text-ink-2 wrap-anywhere", align === "end" && "sm:text-right")} data-translate-reason="">
          {reason}
        </p>
      )}
      {!reason && note && (
        <p id={noteId} className={cx("max-w-sm text-sm text-ink-2 wrap-anywhere", align === "end" && "sm:text-right")} data-translate-note="">
          {note}
        </p>
      )}
      <ActionError error={error} />
    </div>
  );
}

/** C7-2: discards one translation of an ad's words (every ad on those words loses it); Translate can write it again. */
export function DiscardTranslationButton({ campaignId, setId, what }: { campaignId: string; setId: string; what: string }) {
  const { run, pending, error } = useBriefAction();
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        aria-label={`Discard ${what}`}
        onClick={() => run(() => discardAdTranslation(campaignId, setId))}
        className="min-h-9 rounded-full text-sm font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
      >
        {pending ? "Discarding…" : "Discard"}
      </button>
      <ActionError error={error} />
    </div>
  );
}

/** F-26: redraws every ad made with an older kit, in code (no AI cost); each can be undone under Discarded. */
export function RedrawAllButton({ campaignId, count }: { campaignId: string; count: number }) {
  const { run, pending, error } = useBriefAction();
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-start gap-2 sm:items-end">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => redrawAllAds(campaignId))} className="flex-wrap">
        {pending ? "Redrawing…" : <Costed label={count === 1 ? "Redraw the older ad" : `Redraw all ${count} older ads`} estimate="no AI cost" />}
      </Button>
      <ActionError error={error} />
    </div>
  );
}

/** Keep the new words or the old, after New words on an ad. */
export function KeepWordsButtons({ campaignId, variantId, usedIn }: { campaignId: string; variantId: string; usedIn: number }) {
  const { run, pending, error } = useBriefAction();
  const [doing, setDoing] = useState<"new" | "old" | null>(null);
  const keep = (k: "new" | "old") => {
    setDoing(k);
    run(() => keepAdWords(campaignId, variantId, k));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => keep("new")}>
          {pending && doing === "new" ? "Keeping…" : "Keep the new words"}
        </Button>
        <Button type="button" size="sm" variant="quiet" disabled={pending} onClick={() => keep("old")}>
          {pending && doing === "old" ? "Keeping…" : "Keep the old words"}
        </Button>
      </div>
      <p className="text-sm">
        {usedIn > 1 ? `Either choice applies to all ${usedIn} ads that use these words. ` : ""}New words and Edit words wait until
        you choose.
      </p>
      <ActionError error={error} />
    </div>
  );
}

/** Keep one of two sets of words on a text-only channel: the other set is discarded (and can be restored). */
export function KeepSetButtons({ campaignId, oldSetId, newSetId }: { campaignId: string; oldSetId: string; newSetId: string }) {
  const { run, pending, error } = useBriefAction();
  const [doing, setDoing] = useState<"new" | "old" | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            setDoing("new");
            run(() => discardSet(campaignId, oldSetId, "keep-new"));
          }}
        >
          {pending && doing === "new" ? "Keeping…" : "Keep the new words"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          disabled={pending}
          onClick={() => {
            setDoing("old");
            run(() => discardSet(campaignId, newSetId, "keep-old"));
          }}
        >
          {pending && doing === "old" ? "Keeping…" : "Keep the old words"}
        </Button>
      </div>
      <ActionError error={error} />
    </div>
  );
}

/** Edit, New words and Discard for a set of words in the copy lists. */
export function CopySetControls({
  campaignId,
  setId,
  title,
  fields,
  initial,
  newWordsEstimate,
  busy,
  waiting,
}: {
  campaignId: string;
  setId: string;
  /** "the email words for Lapsed customers", for the buttons' names. */
  title: string;
  fields: FieldSpec[];
  initial: Record<string, string>;
  /** Null: New words isn't offered here. */
  newWordsEstimate: string | null;
  busy: boolean;
  /** New words are waiting beside this set: choose them first. */
  waiting: boolean;
}) {
  const { run, pending, error } = useBriefAction();
  const [doing, setDoing] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <WordsDialog
          openLabel="Edit"
          openAriaLabel={`Edit ${title}`}
          disabled={pending || busy || waiting}
          title={`Edit ${title}`}
          note="Saving keeps the current words under Discarded, so you can go back to them."
          fields={fields}
          initial={initial}
          save={(values) => editCopySet(campaignId, setId, toPayload(fields, values))}
        />
        {newWordsEstimate && (
          <Button
            type="button"
            size="sm"
            variant="quiet"
            className="flex-wrap"
            disabled={pending || busy || waiting}
            aria-label={busy ? `Writing new words for ${title}` : `New words for ${title}, ${newWordsEstimate}`}
            onClick={() => {
              setDoing("words");
              run(() => newSetWords(campaignId, setId));
            }}
          >
            {pending && doing === "words" ? "Starting…" : busy ? "Writing new words…" : <Costed label="New words" estimate={newWordsEstimate} />}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="quiet"
          disabled={pending || busy}
          aria-label={`Discard ${title}`}
          onClick={() => {
            setDoing("discard");
            run(() => discardSet(campaignId, setId));
          }}
        >
          {pending && doing === "discard" ? "Discarding…" : "Discard"}
        </Button>
      </div>
      <ActionError error={error} />
    </div>
  );
}

/** Undo for a discarded ad or set of words. */
export function RestoreButton({ campaignId, id, kind, what }: { campaignId: string; id: string; kind: "ad" | "set"; what: string }) {
  const { run, pending, error } = useBriefAction();
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button
        type="button"
        size="sm"
        variant="quiet"
        disabled={pending}
        aria-label={`Restore ${what}`}
        onClick={() => run(() => (kind === "ad" ? restoreAd(campaignId, id) : restoreSet(campaignId, id)))}
      >
        {pending ? "Restoring…" : "Restore"}
      </Button>
      <ActionError error={error} />
    </div>
  );
}

/** Builds the saved shape from the editor's fields: "headlines.0" goes into headlines[0]. */
function toPayload(fields: FieldSpec[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const [key, index] = f.path.split(".");
    if (index === undefined) out[key] = values[f.path] ?? "";
    else {
      const list = (out[key] as string[] | undefined) ?? [];
      list[Number(index)] = values[f.path] ?? "";
      out[key] = list;
    }
  }
  return out;
}

/** Counted as the checks count: after trimming the ends. */
const length = (s: string) => s.trim().length;

/**
 * The words editor, in a modal dialog: each field with its live character
 * count and limit, the checks' messages inline after a refused save, and
 * nothing saved unless every check passes.
 */
function WordsDialog({
  openLabel,
  openAriaLabel,
  disabled,
  title,
  note,
  fields,
  initial,
  save,
  className,
}: {
  openLabel: string;
  openAriaLabel: string;
  disabled: boolean;
  title: string;
  note: string;
  fields: FieldSpec[];
  initial: Record<string, string>;
  save: (values: Record<string, string>) => Promise<BriefActionState>;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [tooLong, setTooLong] = useState(false);
  const { run, pending, error, clearError } = useBriefAction();
  const base = useId();
  const id = (path: string) => `${base}-${path.replace(".", "-")}`;

  const open = () => {
    setValues(initial);
    setTooLong(false);
    clearError();
    dialog.current?.showModal();
  };
  const close = () => {
    dialog.current?.close();
    opener.current?.focus();
  };

  const over = fields.filter((f) => length(values[f.path] ?? "") > f.limit);
  const empty = fields.filter((f) => length(values[f.path] ?? "") === 0);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (over.length || empty.length) {
      setTooLong(true);
      document.getElementById(id((over[0] ?? empty[0]).path))?.focus();
      return;
    }
    run(
      () => save(Object.fromEntries(fields.map((f) => [f.path, (values[f.path] ?? "").trim()]))),
      () => close(),
    );
  }

  const serverFieldErrors = error?.fieldErrors ?? {};
  // A check that names its field ("The headline uses the banned term ...") is shown on that field too.
  const named = (f: FieldSpec) => error?.problems?.find((x) => x.toLowerCase().startsWith(`the ${f.label.toLowerCase()} `));
  return (
    <>
      <Button
        ref={opener}
        type="button"
        size="sm"
        variant="quiet"
        className={className}
        disabled={disabled}
        aria-label={openAriaLabel}
        aria-haspopup="dialog"
        onClick={open}
      >
        {openLabel}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${base}-title`}
        onClose={() => opener.current?.focus()}
        className="m-auto w-[min(100vw-2rem,36rem)] max-w-none rounded-card bg-surface p-0 text-ink shadow-lg ring-1 shadow-ink/10 ring-line backdrop:bg-ink/40"
      >
        <form onSubmit={onSubmit} noValidate className="flex max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-y-auto p-5 sm:p-6">
          <div>
            <h2 id={`${base}-title`} className="text-xl font-strong tracking-tight">
              {title}
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              {note} The words pass the same checks as the Copy agent&apos;s: banned terms, claims that need evidence and
              names. A figure you type is allowed and marked as added by a person.
            </p>
          </div>
          {fields.map((f) => {
            const value = values[f.path] ?? "";
            const n = length(value);
            const isOver = n > f.limit;
            const local = tooLong && isOver ? `Keep this to ${f.limit} characters or fewer.` : tooLong && n === 0 ? "This can't be empty." : undefined;
            const Control = f.multiline ? Textarea : Input;
            return (
              <Field
                key={f.path}
                id={id(f.path)}
                label={f.label}
                hint={
                  <span className={cx("tabular-nums", isOver && "font-semibold text-attention-ink")} data-count={f.path}>
                    {n} of {f.limit} characters{isOver ? `, ${n - f.limit} over` : ""}
                  </span>
                }
                error={local ?? serverFieldErrors[f.path] ?? named(f)}
              >
                <Control
                  name={f.path}
                  value={value}
                  {...(f.multiline ? { rows: 3 } : {})}
                  onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [f.path]: e.target.value }))}
                />
              </Field>
            );
          })}
          {tooLong && (over.length > 0 || empty.length > 0) && (
            <p role="alert" className="font-medium text-attention-ink">
              Nothing was saved. {over.length > 0 ? "Shorten the fields marked above." : "Fill in every field."}
            </p>
          )}
          <ActionError error={error} />
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending}>{pending ? "Checking and saving…" : "Save the words"}</Button>
            <Button type="button" variant="quiet" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
