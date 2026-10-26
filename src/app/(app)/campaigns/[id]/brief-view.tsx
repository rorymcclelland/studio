// Read-only pieces of a brief, shared by the current brief, old versions and
// proposals. No hooks, so server and client components can both use them.
import type { BriefSection, StoredBrief } from "@/lib/brief/schema";
import { contextKind } from "@/components/context-kind";
import { TextLink } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/pill";

/** Where a market note came from (S4-3): its web pages and when they were checked. */
export type WebOrigin = { checkedAt: string; links: { url: string; title: string | null }[] };

/** Context items by id: what a citation or audience points at. Market notes also carry their web origin. */
export type Sources = Record<string, { kind: string; title: string; text: string; web?: WebOrigin }>;

/** "outdoor-trends.example.test" from a URL, or the URL itself if it can't be read. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

/** A market note's source pages, each opening in a new tab, and when they were checked. */
export function WebLinks({ web, label }: { web: WebOrigin; label: string }) {
  return (
    <div className="min-w-0">
      <ul aria-label={label} className="space-y-1">
        {web.links.map((l) => (
          <li key={l.url} className="min-w-0 wrap-anywhere">
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              {l.title ?? domainOf(l.url)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <span className="block text-sm text-ink-2">{domainOf(l.url)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm text-ink-2">From the web, checked {day.format(new Date(web.checkedAt))}</p>
    </div>
  );
}

/** A figure in the brief that the context does not contain (typed by a person). */
export type Unsourced = { where: string; number: string };

export const SECTION_LABEL: Record<BriefSection, string> = {
  title: "Title",
  summary: "Summary",
  story: "Story",
  insights: "Insights",
  audiences: "Audiences",
  channels: "Channels",
  kpi: "KPI",
};

/** "the story", "the KPI": for sentences such as "Revising the story". */
export function sectionPhrase(section: string | null): string {
  if (!section) return "the whole brief";
  if (section === "kpi") return "the KPI";
  return `the ${section}`;
}

/** Which section an unsourced figure's `where` ("insight 2", "the email role") belongs to. */
export function sectionOfWhere(where: string): BriefSection | null {
  if (where === "the title") return "title";
  if (where === "the summary") return "summary";
  if (where === "the story") return "story";
  if (where.startsWith("insight ")) return "insights";
  if (where.startsWith("audience ")) return "audiences";
  if (where === "the KPI target") return "kpi";
  if (where.endsWith(" role")) return "channels";
  return null;
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const normalise = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");

/**
 * Text with the figures a person typed (not found in the context) marked
 * inline. The words say it too, for screen readers and without colour.
 */
export function Figures({ text, unsourced, where }: { text: string; unsourced?: Unsourced[]; where: string }) {
  const marked = new Set((unsourced ?? []).filter((u) => u.where === where).map((u) => u.number));
  if (marked.size === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMBER)) {
    const at = m.index ?? 0;
    if (!marked.has(normalise(m[0]))) continue;
    parts.push(text.slice(last, at));
    parts.push(
      <mark key={at} data-unsourced="" className="rounded bg-review-soft px-1 text-review-ink">
        {m[0]}
        <span className="sr-only"> (added by a person, not from the context)</span>
      </mark>,
    );
    last = at + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** The note under a section listing the figures a person added. */
export function UnsourcedNote({ unsourced, section }: { unsourced?: Unsourced[]; section: BriefSection }) {
  const here = (unsourced ?? []).filter((u) => sectionOfWhere(u.where) === section);
  if (here.length === 0) return null;
  return (
    <p className="mt-3 text-sm text-review-ink">
      <span className="font-semibold">Added by a person, not from the context:</span>{" "}
      {here.map((u) => `${u.number} in ${u.where}`).join("; ")}.
    </p>
  );
}

/** One cited context item: its kind and title; open it to read what it says. */
export function SourceChip({ id, sources }: { id: string; sources: Sources }) {
  const s = sources[id];
  if (!s) {
    return (
      <li>
        <Pill tone="neutral" className="whitespace-normal">
          A source that is no longer in the context
        </Pill>
      </li>
    );
  }
  const kind = s.web ? { label: "From the web", tone: "neutral" as const } : contextKind(s.kind);
  return (
    <li className="min-w-0 has-[details[open]]:basis-full">
      <details className="group min-w-0" data-source-chip="">
        <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-bg py-1 pr-3 pl-1 text-sm [&::-webkit-details-marker]:hidden">
          <Pill tone={kind.tone} className="px-2.5">
            {kind.label}
          </Pill>
          <span className="min-w-0 font-medium wrap-anywhere">{s.title}</span>
          <span aria-hidden className="text-ink-2 transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        {s.web ? (
          <div className="mt-2 space-y-2 rounded-field bg-bg px-4 py-3 text-sm" data-web-source="">
            <p className="text-ink-2 wrap-anywhere">{s.text}</p>
            <WebLinks web={s.web} label={`Web sources for ${s.title}`} />
          </div>
        ) : (
          <p className="mt-2 rounded-field bg-bg px-4 py-3 text-sm text-ink-2 wrap-anywhere">{s.text}</p>
        )}
      </details>
    </li>
  );
}

export function SourceChips({ ids, sources, label }: { ids: string[]; sources: Sources; label: string }) {
  return (
    <ul aria-label={label} className="mt-2 flex flex-wrap gap-2">
      {ids.map((id) => (
        <SourceChip key={id} id={id} sources={sources} />
      ))}
    </ul>
  );
}

/** The body of one section of a brief, read-only. */
export function SectionBody({
  section,
  brief,
  sources,
  unsourced,
  idPrefix,
}: {
  section: BriefSection;
  brief: StoredBrief;
  sources: Sources;
  unsourced?: Unsourced[];
  /** Keeps list labels unique when two briefs are on one page (a proposal beside the current one). */
  idPrefix?: string;
}) {
  const pre = idPrefix ? `${idPrefix}: ` : "";
  switch (section) {
    case "title":
      return (
        <p className="text-xl font-strong tracking-tight wrap-anywhere">
          <Figures text={brief.title} unsourced={unsourced} where="the title" />
        </p>
      );
    case "summary":
      return (
        <p className="max-w-prose whitespace-pre-line wrap-anywhere">
          <Figures text={brief.summary} unsourced={unsourced} where="the summary" />
        </p>
      );
    case "story":
      return (
        <p className="max-w-prose whitespace-pre-line wrap-anywhere">
          <Figures text={brief.story} unsourced={unsourced} where="the story" />
        </p>
      );
    case "insights":
      return (
        <ol aria-label={`${pre}Insights`} className="space-y-4">
          {brief.insights.map((ins, i) => (
            <li key={i} data-insight="" className="min-w-0 rounded-field bg-surface-2/60 px-4 py-3">
              <p className="wrap-anywhere">
                <span className="mr-2 font-semibold text-ink-2 tabular-nums">{i + 1}.</span>
                <Figures text={ins.text} unsourced={unsourced} where={`insight ${i + 1}`} />
              </p>
              <SourceChips ids={ins.cites} sources={sources} label={`${pre}Sources for insight ${i + 1}`} />
            </li>
          ))}
        </ol>
      );
    case "audiences":
      return brief.audiences.length === 0 ? (
        <p className="text-ink-2">No audience: the context has no segments for this brand.</p>
      ) : (
        <ul aria-label={`${pre}Audiences`} className="space-y-3">
          {brief.audiences.map((a, i) => {
            const s = sources[a.segmentRef];
            return (
              <li key={i} data-audience="" className="min-w-0 rounded-field bg-surface-2/60 px-4 py-3">
                <p className="font-semibold wrap-anywhere">{s ? s.title : "A segment that is no longer in the context"}</p>
                <p className="mt-1 text-ink-2 wrap-anywhere">
                  <Figures text={a.why} unsourced={unsourced} where={`audience ${i + 1}`} />
                </p>
                {s && (
                  <ul aria-label={`${pre}Source for audience ${i + 1}`} className="mt-2 flex flex-wrap gap-2">
                    <SourceChip id={a.segmentRef} sources={sources} />
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      );
    case "channels":
      return (
        <dl className="grid gap-3 sm:grid-cols-2">
          {brief.channels.map((c, i) => (
            <div key={i} className="min-w-0 rounded-field bg-surface-2/60 px-4 py-3">
              <dt className="font-semibold first-letter:uppercase">{c.channel}</dt>
              <dd className="mt-0.5 text-ink-2 wrap-anywhere">
                <Figures text={c.role} unsourced={unsourced} where={`the ${c.channel} role`} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "kpi":
      return (
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-sm text-ink-2">Metric</dt>
            <dd className="font-semibold first-letter:uppercase">{brief.kpi.metric}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-ink-2">Target</dt>
            <dd className={cx("wrap-anywhere", brief.kpi.target ? "font-semibold" : "text-ink-2")}>
              {brief.kpi.target ? <Figures text={brief.kpi.target} unsourced={unsourced} where="the KPI target" /> : "No target set"}
            </dd>
          </div>
        </dl>
      );
  }
}

/** Must include and Avoid: copied from the brand kit, so a brief can never drop a legal line. */
export function KitLists({ brief, brandId }: { brief: StoredBrief; brandId: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0 rounded-card bg-surface p-5 sm:p-6">
        <h3 className="text-lg font-strong">Must include</h3>
        <KitNote brandId={brandId} />
        {brief.mustInclude.length === 0 ? (
          <p className="mt-3 text-ink-2">The brand kit has no legal lines.</p>
        ) : (
          <ul aria-label="Must include" className="mt-3 list-disc space-y-1.5 pl-5 marker:text-ink-2">
            {brief.mustInclude.map((l, i) => (
              <li key={i} className="wrap-anywhere">
                {l}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0 rounded-card bg-surface p-5 sm:p-6">
        <h3 className="text-lg font-strong">Avoid</h3>
        <KitNote brandId={brandId} />
        {brief.avoid.length === 0 ? (
          <p className="mt-3 text-ink-2">The brand kit has no banned terms or don&apos;t rules.</p>
        ) : (
          <ul aria-label="Avoid" className="mt-3 list-disc space-y-1.5 pl-5 marker:text-ink-2">
            {brief.avoid.map((l, i) => (
              <li key={i} className="wrap-anywhere">
                {l}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KitNote({ brandId }: { brandId: string }) {
  return (
    <p className="mt-1 text-sm text-ink-2">
      From the brand kit; edit the kit to change these.{" "}
      <TextLink href={`/brands/${brandId}/edit`}>Edit the brand kit</TextLink>
    </p>
  );
}

/** The brief's core (the parts people and the agent edit), without the kit's lists. */
export function coreOf(b: StoredBrief) {
  return {
    title: b.title,
    summary: b.summary,
    story: b.story,
    insights: b.insights,
    audiences: b.audiences,
    channels: b.channels,
    kpi: b.kpi,
  };
}

/** Sections whose content differs between two briefs. */
export function changedSections(a: StoredBrief, b: StoredBrief): BriefSection[] {
  const ca = coreOf(a);
  const cb = coreOf(b);
  return (Object.keys(SECTION_LABEL) as BriefSection[]).filter((s) => canonical(ca[s]) !== canonical(cb[s]));
}

/** JSON with object keys sorted, so key order (jsonb reorders keys) never counts as a change. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== "");
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
