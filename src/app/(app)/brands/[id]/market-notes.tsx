// S4-3: the brand's market notes, from the Market agent's web search, each
// with its sources and the date it was checked.
import type { RunSummary } from "@/lib/agents/runs";
import type { MarketNote } from "@/lib/strategy/market";
import { AutoRefresh } from "@/components/auto-refresh";
import { daysSince, formatDay } from "@/components/format-day";
import { ACTIVE_STATUSES, StatusBadge } from "@/components/status-badge";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/ui/pill";
import { formatWhen } from "@/lib/format";
import { WebLinks } from "../../campaigns/[id]/brief-view";
import { RefreshMarketButton } from "./market-actions";

const KINDS: { kind: string; label: string; tone: PillTone }[] = [
  { kind: "trend", label: "Trend", tone: "active" },
  { kind: "timing", label: "Timing", tone: "good" },
  { kind: "rival_move", label: "Rival move", tone: "review" },
  { kind: "gap", label: "Gap", tone: "neutral" },
];

export function MarketNotes({
  brandId,
  notes,
  latestRun,
  runError,
  staleDays,
}: {
  brandId: string;
  notes: MarketNote[];
  latestRun: RunSummary | null;
  /** The latest run's error, when it failed. */
  runError: string | null;
  staleDays: number;
}) {
  const active = !!latestRun && ACTIVE_STATUSES.has(latestRun.status);
  const failed = !!latestRun && !active && latestRun.status !== "completed";
  const checked = notes.length ? new Date(Math.max(...notes.map((n) => n.checkedAt.getTime()))) : null;
  const age = checked ? daysSince(checked) : 0;
  const stale = !!checked && age > staleDays;
  // Tagged by kind, in a fixed order: trends, timing, rival moves, gaps.
  const rank = (kind: string) => {
    const i = KINDS.findIndex((k) => k.kind === kind);
    return i === -1 ? KINDS.length : i;
  };
  const ordered = [...notes].sort((a, b) => rank(a.kind) - rank(b.kind));

  return (
    <section aria-labelledby="market" className="scroll-mt-6 space-y-4">
      <AutoRefresh active={active} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="market" className="scroll-mt-6 text-2xl font-strong tracking-tight">
            Market notes
          </h2>
          <p className="mt-1 max-w-prose text-ink-2">
            Outside evidence the Brief agent can cite: category trends, seasonal timing, what rivals are doing and gaps.
            The Market agent searches the web about the category, never this brand, and every note links to the pages it
            rests on. Real company names stay in these notes; the brief&apos;s checks keep them out of briefs.
          </p>
        </div>
        <RefreshMarketButton brandId={brandId} running={active} />
      </div>

      {latestRun && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-2">
          <span>Last Market agent run, {formatWhen(latestRun.created_at)}:</span>
          <StatusBadge status={latestRun.status} />
          <TextLink href={`/runs/${latestRun.id}`}>See the run&apos;s trail</TextLink>
        </p>
      )}

      {failed && (
        <Card tone="attention" className="bg-attention-soft">
          <p className="font-semibold text-attention-ink">The last refresh didn&apos;t finish</p>
          <p className="mt-1 max-w-prose wrap-anywhere">{runError ?? "The Market agent stopped before it finished."}</p>
          <p className="mt-1 text-sm">
            {latestRun.status === "stopped_cap" ? "Nothing more was charged. " : ""}
            {notes.length > 0 ? "The notes below are from the refresh before it." : "No notes were saved."}
          </p>
        </Card>
      )}

      {stale && (
        <p className="max-w-prose rounded-field bg-review-soft px-4 py-3 text-review-ink" data-market-stale="">
          <span className="font-semibold">Getting old.</span> These notes were checked {age} days ago. Refresh them before
          relying on them in a new brief.
        </p>
      )}

      {notes.length === 0 ? (
        !active && (
          <Card>
            <p className="max-w-prose text-ink-2">
              No market notes yet. Refresh market notes to have the Market agent search the web. Each refresh costs up to
              about 10p and counts against the daily cap.
            </p>
          </Card>
        )
      ) : (
        <>
          {checked && (
            <p className="text-sm text-ink-2">
              {notes.length} {notes.length === 1 ? "note" : "notes"}, from the web, checked {formatDay(checked)}.
            </p>
          )}
          <ul aria-label={`Market notes (${notes.length})`} className="grid gap-3 md:grid-cols-2">
            {ordered.map((n) => {
              const k = KINDS.find((x) => x.kind === n.kind) ?? { label: "Note", tone: "neutral" as PillTone };
              return (
                <Card as="li" key={n.id} data-market-note={n.kind} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={k.tone}>{k.label}</Pill>
                    {daysSince(n.checkedAt) > staleDays && <Pill tone="review">Getting old</Pill>}
                  </div>
                  <h3 className="font-semibold wrap-anywhere">{n.title}</h3>
                  <p className="text-ink-2 wrap-anywhere">{n.text}</p>
                  {n.names.length > 0 && (
                    <p className="text-sm wrap-anywhere" data-real-names="">
                      <span className="font-semibold">Names real companies:</span> {n.names.join(", ")}
                    </p>
                  )}
                  <div className="mt-auto border-t border-line pt-3">
                    <WebLinks
                      web={{ checkedAt: n.checkedAt.toISOString(), links: n.sources.map((x) => ({ url: x.url, title: x.title })) }}
                      label={`Sources for ${n.title}`}
                    />
                  </div>
                </Card>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
