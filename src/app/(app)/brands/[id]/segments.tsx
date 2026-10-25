import type { RunSummary } from "@/lib/agents/runs";
import type { SegmentItem } from "@/lib/context/store";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge, ACTIVE_STATUSES } from "@/components/status-badge";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { formatWhen } from "@/lib/format";
import { FindAudiencesButton, RemoveSegmentButton } from "./segment-actions";

/**
 * S3-1: the brand's segments. The customer summary's two are always there;
 * the Audience agent adds named, sized ones, saved straight to the store
 * (Sprint 3, Q1) and removable. Sizes come from code, never from the model.
 */
export function Segments({
  brandId,
  segments,
  latestRun,
  simulated,
}: {
  brandId: string;
  segments: SegmentItem[];
  latestRun: RunSummary | null;
  simulated: boolean;
}) {
  const active = !!latestRun && ACTIVE_STATUSES.has(latestRun.status);
  const fromAgent = segments.filter((s) => s.createdBy === "agent").length;
  return (
    <section aria-labelledby="segments" className="scroll-mt-6 space-y-4">
      <AutoRefresh active={active} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="segments" className="scroll-mt-6 text-2xl font-strong tracking-tight">
            Segments
          </h2>
          <p className="mt-1 max-w-prose text-ink-2">
            Audiences the Brief agent can choose from. The Audience agent counts candidate segments in the customer
            data, then names them; the sizes always come from the count.
          </p>
        </div>
        <FindAudiencesButton brandId={brandId} running={active} />
      </div>

      {latestRun && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-2">
          <span>Last Audience agent run, {formatWhen(latestRun.created_at)}:</span>
          <StatusBadge status={latestRun.status} />
          <TextLink href={`/runs/${latestRun.id}`}>See the run&apos;s trail</TextLink>
        </p>
      )}

      {segments.length === 0 ? (
        <Card>
          <p className="text-ink-2">
            No segments yet. They come from customer data, which this brand doesn&apos;t have yet.
          </p>
        </Card>
      ) : (
        <>
          {fromAgent === 0 && !active && (
            <p className="text-sm text-ink-2">Find audiences to add segments such as new, at-risk or high-value customers.</p>
          )}
          <ul aria-label={`Segments (${segments.length})`} className="grid gap-3 md:grid-cols-2">
            {segments.map((s) => (
              <Card as="li" key={s.id} data-segment={s.createdBy} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 font-semibold wrap-anywhere">{s.title}</h3>
                  {s.createdBy === "agent" && <RemoveSegmentButton brandId={brandId} itemId={s.id} title={s.title} />}
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.createdBy === "agent" ? (
                    <Pill tone="active" className="whitespace-normal">Proposed by the Audience agent</Pill>
                  ) : (
                    <Pill tone="neutral" className="whitespace-normal">From the customer summary</Pill>
                  )}
                  {simulated && <Pill tone="review">Simulated data</Pill>}
                </div>
                <p className="text-ink-2 wrap-anywhere">{s.body}</p>
                {s.tags.length > 0 && s.createdBy === "agent" && (
                  <p className="text-sm text-ink-2">
                    Suggested use: <span className="font-medium text-ink">{s.tags[0]}</span>
                  </p>
                )}
              </Card>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
