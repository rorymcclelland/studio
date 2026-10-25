"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CHANNELS, KPI_METRICS, type BriefCore, type BriefSection, type StoredBrief } from "@/lib/brief/schema";
import { contextKind } from "@/components/context-kind";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { reviseBrief, saveBrief } from "../actions";
import { ActionError } from "./brief-actions";
import {
  coreOf,
  KitLists,
  SECTION_LABEL,
  SectionBody,
  sectionPhrase,
  UnsourcedNote,
  type Sources,
  type Unsourced,
} from "./brief-view";
import { useBriefAction, type BriefError } from "./use-brief-action";

export type ContextOption = { id: string; kind: string; title: string };

type Props = {
  campaignId: string;
  brandId: string;
  currentVersion: number;
  brief: StoredBrief;
  sources: Sources;
  unsourced: Unsourced[];
  /** Items an insight may cite: what it cites now, plus the brand's segments, insights and products. */
  citeOptions: ContextOption[];
  /** The brand's segments, for audiences. */
  segments: ContextOption[];
};

const SECTIONS: BriefSection[] = ["title", "summary", "story", "insights", "audiences", "channels", "kpi"];
const REVISE_MAX = 500;

let nextKey = 1;
const keyed = <T,>(xs: T[]) => xs.map((x) => ({ ...x, key: nextKey++ }));

/**
 * S3-3: the current brief, section by section. Each section can be edited by
 * hand (saved as a new version after the same checks the agent passes) or
 * revised by the Brief agent (the result waits as a proposal). The parent
 * keys this by version, so a new version closes any open form.
 */
export function BriefWorkspace(props: Props) {
  return (
    <>
      <ReviseWhole campaignId={props.campaignId} currentVersion={props.currentVersion} />
      <section aria-labelledby="brief" className="space-y-4">
        <div>
          <h2 id="brief" className="text-2xl font-strong tracking-tight">
            The brief
          </h2>
          <p className="mt-1 max-w-prose text-ink-2">
            Every insight cites the context it comes from; open a source to read it. Saving an edit makes a new version,
            and every version is kept.
          </p>
        </div>
        {SECTIONS.map((s) => (
          <SectionCard key={s} section={s} {...props} />
        ))}
        <KitLists brief={props.brief} brandId={props.brandId} />
      </section>
    </>
  );
}

function ReviseWhole({ campaignId, currentVersion }: { campaignId: string; currentVersion: number }) {
  const [text, setText] = useState("");
  const { run, pending, error } = useBriefAction();
  return (
    <Card as="section" tone="primary" aria-labelledby="revise-all">
      <h2 id="revise-all" className="text-xl font-strong tracking-tight">
        Revise with AI
      </h2>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => reviseBrief(campaignId, currentVersion, null, text), () => setText(""));
        }}
      >
        <Field
          id="revise-all-text"
          label="What should change in the whole brief?"
          hint="For example, focus on base layers. The Brief agent proposes a new version; nothing changes until you use it."
        >
          <Textarea rows={2} maxLength={REVISE_MAX} required value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div>
          <Button disabled={pending}>{pending ? "Asking the Brief agent…" : "Ask the Brief agent"}</Button>
        </div>
        <ActionError error={error} />
      </form>
    </Card>
  );
}

type Mode = "view" | "edit" | "revise";

function SectionCard({ section, ...props }: Props & { section: BriefSection }) {
  const [mode, setMode] = useState<Mode>("view");
  const editButton = useRef<HTMLButtonElement>(null);
  const reviseButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<"edit" | "revise" | null>(null);
  const label = SECTION_LABEL[section];
  const phrase = sectionPhrase(section);
  const headingId = `section-${section}`;

  useEffect(() => {
    if (mode !== "view" || !returnFocus.current) return;
    (returnFocus.current === "edit" ? editButton : reviseButton).current?.focus();
    returnFocus.current = null;
  }, [mode]);
  const close = (from: "edit" | "revise") => {
    returnFocus.current = from;
    setMode("view");
  };

  return (
    <Card as="section" aria-labelledby={headingId} data-section={section} tone={mode === "edit" ? "primary" : "plain"}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={headingId} className="text-lg font-strong">
          {label}
        </h3>
        {mode !== "edit" && (
          <div className="flex flex-wrap gap-2">
            <Button ref={editButton} type="button" size="sm" variant="quiet" onClick={() => setMode("edit")} aria-label={`Edit ${phrase}`}>
              Edit
            </Button>
            {mode === "view" && (
              <Button ref={reviseButton} type="button" size="sm" variant="quiet" onClick={() => setMode("revise")} aria-label={`Revise with AI: ${phrase}`}>
                Revise with AI
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="mt-3">
        {mode === "edit" ? (
          <SectionForm section={section} {...props} onClose={() => close("edit")} />
        ) : (
          <>
            <SectionBody section={section} brief={props.brief} sources={props.sources} unsourced={props.unsourced} />
            <UnsourcedNote unsourced={props.unsourced} section={section} />
            {mode === "revise" && (
              <ReviseSection
                campaignId={props.campaignId}
                currentVersion={props.currentVersion}
                section={section}
                onClose={() => close("revise")}
              />
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function ReviseSection({
  campaignId,
  currentVersion,
  section,
  onClose,
}: {
  campaignId: string;
  currentVersion: number;
  section: BriefSection;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const { run, pending, error } = useBriefAction();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const phrase = sectionPhrase(section);
  return (
    <form
      className="mt-4 flex flex-col gap-3 rounded-field bg-primary-soft/50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reviseBrief(campaignId, currentVersion, section, text), onClose);
      }}
    >
      <Field id={`revise-${section}`} label={`What should change in ${phrase}?`} hint="Only this section changes. Nothing is saved until you use the proposal.">
        <Textarea ref={ref} rows={2} maxLength={REVISE_MAX} required value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button size="sm" disabled={pending}>
          {pending ? "Asking the Brief agent…" : "Ask the Brief agent"}
        </Button>
        <Button type="button" size="sm" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <ActionError error={error} />
    </form>
  );
}

/* ---------- Hand editing ---------- */

type FormProps = Props & { section: BriefSection; onClose: () => void };

function SectionForm(props: FormProps) {
  const { section, brief, campaignId, currentVersion, onClose } = props;
  const [draft, setDraft] = useState(() => toDraft(brief));
  const { run, pending, error } = useBriefAction();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")?.focus();
  }, []);
  const fe = error?.fieldErrors ?? {};
  const errorId = useId();

  const save = () => {
    const core: BriefCore = { ...coreOf(brief), [section]: fromDraft(draft, section) } as BriefCore;
    run(() => saveBrief(campaignId, currentVersion, core));
  };

  return (
    <form
      ref={formRef}
      noValidate
      aria-describedby={error ? errorId : undefined}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {section === "title" && (
        <Field id="edit-title" label="Title" error={fe.title}>
          <Input maxLength={100} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
      )}
      {section === "summary" && (
        <Field id="edit-summary" label="Summary" hint={`${draft.summary.trim().length} of 600 characters`} error={fe.summary}>
          <Textarea rows={5} maxLength={600} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        </Field>
      )}
      {section === "story" && (
        <Field id="edit-story" label="Story" hint={`The creative idea. ${draft.story.trim().length} of 1,200 characters`} error={fe.story}>
          <Textarea rows={7} maxLength={1200} value={draft.story} onChange={(e) => setDraft({ ...draft, story: e.target.value })} />
        </Field>
      )}
      {section === "insights" && <InsightsForm {...props} draft={draft} setDraft={setDraft} fe={fe} />}
      {section === "audiences" && <AudiencesForm {...props} draft={draft} setDraft={setDraft} fe={fe} />}
      {section === "channels" && <ChannelsForm draft={draft} setDraft={setDraft} fe={fe} />}
      {section === "kpi" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="edit-kpi-metric" label="Metric" error={fe["kpi.metric"]}>
            <Select value={draft.kpi.metric} onChange={(e) => setDraft({ ...draft, kpi: { ...draft.kpi, metric: e.target.value as BriefCore["kpi"]["metric"] } })}>
              {KPI_METRICS.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="edit-kpi-target" label="Target (optional)" hint="For example, 5% of the audience reactivated" error={fe["kpi.target"]}>
            <Input maxLength={80} value={draft.kpi.target} onChange={(e) => setDraft({ ...draft, kpi: { ...draft.kpi, target: e.target.value } })} />
          </Field>
        </div>
      )}

      <ActionError error={error} id={errorId} />
      <div className="flex flex-wrap gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : `Save ${sectionPhrase(section)}`}</Button>
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="text-sm text-ink-2">Saving checks the brief again and makes version {currentVersion + 1}.</p>
    </form>
  );
}

type Draft = {
  title: string;
  summary: string;
  story: string;
  insights: { key: number; text: string; cites: string[] }[];
  audiences: { key: number; segmentRef: string; why: string }[];
  channels: { key: number; channel: BriefCore["channels"][number]["channel"]; role: string }[];
  kpi: { metric: BriefCore["kpi"]["metric"]; target: string };
};

function toDraft(b: StoredBrief): Draft {
  return {
    title: b.title,
    summary: b.summary,
    story: b.story,
    insights: keyed(b.insights.map((i) => ({ text: i.text, cites: [...i.cites] }))),
    audiences: keyed(b.audiences.map((a) => ({ ...a }))),
    channels: keyed(b.channels.map((c) => ({ ...c }))),
    kpi: { metric: b.kpi.metric, target: b.kpi.target ?? "" },
  };
}

function fromDraft(d: Draft, section: BriefSection): BriefCore[BriefSection] {
  switch (section) {
    case "title":
      return d.title;
    case "summary":
      return d.summary;
    case "story":
      return d.story;
    case "insights":
      return d.insights.map(({ text, cites }) => ({ text, cites }));
    case "audiences":
      return d.audiences.map(({ segmentRef, why }) => ({ segmentRef, why }));
    case "channels":
      return d.channels.map(({ channel, role }) => ({ channel, role }));
    case "kpi":
      return d.kpi.target.trim() ? { metric: d.kpi.metric, target: d.kpi.target } : { metric: d.kpi.metric };
  }
}

type ListProps = { draft: Draft; setDraft: (d: Draft) => void; fe: NonNullable<BriefError["fieldErrors"]> };

/** Moves focus after a row is added or removed, once React has drawn it. */
function useFocusAfter() {
  const target = useRef<string | null>(null);
  useEffect(() => {
    if (!target.current) return;
    document.getElementById(target.current)?.focus();
    target.current = null;
  });
  return (id: string) => {
    target.current = id;
  };
}

function ListError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm font-medium text-attention-ink">
      {message}
    </p>
  );
}

function InsightsForm({ draft, setDraft, fe, citeOptions, sources }: ListProps & Props) {
  const focusLater = useFocusAfter();
  const [adding, setAdding] = useState<Record<number, string>>({});
  const set = (i: number, patch: Partial<Draft["insights"][number]>) =>
    setDraft({ ...draft, insights: draft.insights.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  const titleOf = (id: string) => sources[id]?.title ?? citeOptions.find((o) => o.id === id)?.title ?? "A source no longer in the context";
  const groups = groupByKind(citeOptions);
  return (
    <fieldset className="flex flex-col gap-5">
      <legend className="sr-only">Insights</legend>
      <p className="text-sm text-ink-2">Three to six insights, each citing one to four items from the context.</p>
      {draft.insights.map((ins, i) => {
        const pick = adding[ins.key] ?? "";
        return (
          <div key={ins.key} className="flex flex-col gap-3 rounded-field border border-line p-4" data-insight-edit="">
            <Field id={`edit-insight-${i}`} label={`Insight ${i + 1}`} error={fe[`insights.${i}.text`]}>
              <Textarea rows={2} maxLength={300} value={ins.text} onChange={(e) => set(i, { text: e.target.value })} />
            </Field>
            <div className="flex flex-col gap-2">
              <p className="font-semibold" id={`edit-insight-${i}-sources`}>
                Sources for insight {i + 1}
              </p>
              {ins.cites.length === 0 ? (
                <p className="text-sm text-ink-2">No sources yet. Add at least one.</p>
              ) : (
                <ul aria-labelledby={`edit-insight-${i}-sources`} className="flex flex-col gap-2">
                  {ins.cites.map((c, n) => (
                    <li key={c} className="flex items-center justify-between gap-3 rounded-field bg-bg px-3 py-2">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        {sources[c] && <Pill tone={contextKind(sources[c].kind).tone}>{contextKind(sources[c].kind).label}</Pill>}
                        <span className="min-w-0 text-sm font-medium wrap-anywhere">{titleOf(c)}</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="quiet"
                        id={`edit-insight-${i}-remove-${n}`}
                        aria-label={`Remove source ${titleOf(c)} from insight ${i + 1}`}
                        onClick={() => {
                          set(i, { cites: ins.cites.filter((x) => x !== c) });
                          focusLater(`edit-insight-${i}-add`);
                        }}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <ListError message={fe[`insights.${i}.cites`]} />
              {ins.cites.length < 4 && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field id={`edit-insight-${i}-add`} label={`Add a source to insight ${i + 1}`} className="flex-1">
                    <Select value={pick} onChange={(e) => setAdding({ ...adding, [ins.key]: e.target.value })}>
                      <option value="">Choose a source</option>
                      {groups.map(([kind, items]) => (
                        <optgroup key={kind} label={contextKind(kind).label}>
                          {items
                            .filter((o) => !ins.cites.includes(o.id))
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.title}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    className="sm:mb-1"
                    disabled={!pick || ins.cites.includes(pick)}
                    aria-label={`Add source to insight ${i + 1}`}
                    onClick={() => {
                      set(i, { cites: [...ins.cites, pick] });
                      setAdding({ ...adding, [ins.key]: "" });
                    }}
                  >
                    Add source
                  </Button>
                </div>
              )}
            </div>
            <div>
              <Button
                type="button"
                size="sm"
                variant="quiet"
                onClick={() => {
                  setDraft({ ...draft, insights: draft.insights.filter((_, n) => n !== i) });
                  focusLater(draft.insights.length > 1 ? `edit-insight-${Math.max(0, i - 1)}` : "edit-insight-add");
                }}
              >
                Remove insight {i + 1}
              </Button>
            </div>
          </div>
        );
      })}
      <ListError message={fe.insights} />
      {draft.insights.length < 6 && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="quiet"
            id="edit-insight-add"
            onClick={() => {
              setDraft({ ...draft, insights: [...draft.insights, ...keyed([{ text: "", cites: [] as string[] }])] });
              focusLater(`edit-insight-${draft.insights.length}`);
            }}
          >
            Add an insight
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function AudiencesForm({ draft, setDraft, fe, segments, sources }: ListProps & Props) {
  const focusLater = useFocusAfter();
  const set = (i: number, patch: Partial<Draft["audiences"][number]>) =>
    setDraft({ ...draft, audiences: draft.audiences.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  // A segment the brief names that has since left the store still shows, so it can be swapped.
  const options = [...segments];
  for (const a of draft.audiences) {
    if (a.segmentRef && !options.some((o) => o.id === a.segmentRef)) {
      options.push({ id: a.segmentRef, kind: "segment", title: sources[a.segmentRef]?.title ?? "A segment no longer in the context" });
    }
  }
  return (
    <fieldset className="flex flex-col gap-5">
      <legend className="sr-only">Audiences</legend>
      <p className="text-sm text-ink-2">One to three segments from the brand&apos;s context, each with why it fits.</p>
      {segments.length === 0 && <p className="text-ink-2">This brand has no segments, so the brief can&apos;t name an audience.</p>}
      {draft.audiences.map((a, i) => (
        <div key={a.key} className="flex flex-col gap-3 rounded-field border border-line p-4">
          <Field id={`edit-audience-${i}`} label={`Audience ${i + 1}`} error={fe[`audiences.${i}.segmentRef`]}>
            <Select value={a.segmentRef} onChange={(e) => set(i, { segmentRef: e.target.value })}>
              <option value="">Choose a segment</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`edit-audience-${i}-why`} label={`Why audience ${i + 1}`} error={fe[`audiences.${i}.why`]}>
            <Textarea rows={2} maxLength={300} value={a.why} onChange={(e) => set(i, { why: e.target.value })} />
          </Field>
          <div>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => {
                setDraft({ ...draft, audiences: draft.audiences.filter((_, n) => n !== i) });
                focusLater(draft.audiences.length > 1 ? `edit-audience-${Math.max(0, i - 1)}` : "edit-audience-add");
              }}
            >
              Remove audience {i + 1}
            </Button>
          </div>
        </div>
      ))}
      <ListError message={fe.audiences} />
      {draft.audiences.length < 3 && segments.length > 0 && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="quiet"
            id="edit-audience-add"
            onClick={() => {
              setDraft({ ...draft, audiences: [...draft.audiences, ...keyed([{ segmentRef: "", why: "" }])] });
              focusLater(`edit-audience-${draft.audiences.length}`);
            }}
          >
            Add an audience
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function ChannelsForm({ draft, setDraft, fe }: ListProps) {
  const focusLater = useFocusAfter();
  const set = (i: number, patch: Partial<Draft["channels"][number]>) =>
    setDraft({ ...draft, channels: draft.channels.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  const unused = CHANNELS.filter((c) => !draft.channels.some((x) => x.channel === c));
  return (
    <fieldset className="flex flex-col gap-5">
      <legend className="sr-only">Channels</legend>
      <p className="text-sm text-ink-2">One to four channels, each with the job it does in the campaign.</p>
      {draft.channels.map((c, i) => (
        <div key={c.key} className="grid gap-3 rounded-field border border-line p-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <Field id={`edit-channel-${i}`} label={`Channel ${i + 1}`} error={fe[`channels.${i}.channel`]}>
            <Select value={c.channel} onChange={(e) => set(i, { channel: e.target.value as Draft["channels"][number]["channel"] })}>
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch.charAt(0).toUpperCase() + ch.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`edit-channel-${i}-role`} label={`Role of channel ${i + 1}`} error={fe[`channels.${i}.role`]}>
            <Input maxLength={200} value={c.role} onChange={(e) => set(i, { role: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => {
                setDraft({ ...draft, channels: draft.channels.filter((_, n) => n !== i) });
                focusLater(draft.channels.length > 1 ? `edit-channel-${Math.max(0, i - 1)}` : "edit-channel-add");
              }}
            >
              Remove channel {i + 1}
            </Button>
          </div>
        </div>
      ))}
      <ListError message={fe.channels} />
      {draft.channels.length < 4 && unused.length > 0 && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="quiet"
            id="edit-channel-add"
            onClick={() => {
              setDraft({ ...draft, channels: [...draft.channels, ...keyed([{ channel: unused[0], role: "" }])] });
              focusLater(`edit-channel-${draft.channels.length}`);
            }}
          >
            Add a channel
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function groupByKind(options: ContextOption[]): [string, ContextOption[]][] {
  const order = ["segment", "insight", "product", "brand_rule", "brand_voice", "legal", "result"];
  const by = new Map<string, ContextOption[]>();
  for (const o of options) by.set(o.kind, [...(by.get(o.kind) ?? []), o]);
  return [...by.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
}
