import type { RunSummary } from "@/lib/agents/runs";
import type { SegmentItem } from "@/lib/context/store";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge, ACTIVE_STATUSES } from "@/components/status-badge";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { segmentCardParts } from "@/lib/brands/segment-card";
import { formatWhen } from "@/lib/format";
import { FindAudiencesButton, RemoveSegmentButton, SegmentDisclosure } from "./segment-actions";

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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 id="segments" className="scroll-mt-6 text-2xl font-strong tracking-tight">
              Segments
            </h2>
            {/* Rule 1: once for the section, not on every card (U10-7). */}
            {simulated && <Pill tone="review">Simulated data</Pill>}
          </div>
          <p className="mt-1 max-w-prose text-ink-2">
            Audiences the Brief agent can choose from. Sizes are counted from the customer data, never estimated by
            the AI.
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
          <ul aria-label={`Segments (${segments.length})`} className="grid gap-2 md:grid-cols-2">
            {segments.map((s) => {
              const parts = segmentCardParts(s.body);
              const fromAgent = s.createdBy === "agent";
              const detailsId = `segment-${s.id}-details`;
              return (
                <li
                  key={s.id}
                  data-segment={s.createdBy}
                  data-segment-card={s.createdBy}
                  className="flex min-w-0 flex-col gap-0.5 rounded-card border-2 border-transparent bg-surface px-4 py-2.5 sm:px-5"
                >
                  <SegmentDisclosure
                    id={detailsId}
                    name={s.title}
                    head={<h3 className="font-semibold wrap-anywhere">{s.title}</h3>}
                    size={
                      parts.size && (
                        <p className="mt-0.5 text-sm font-medium text-ink-2 tabular-nums" data-segment-size="">
                          {parts.size}
                        </p>
                      )
                    }
                    definition={
                      <p className="wrap-anywhere" data-segment-definition="">
                        {parts.definition}
                      </p>
                    }
                  >
                    <div className="space-y-2 text-sm text-ink-2">
                      {parts.description && <p className="text-ink wrap-anywhere">{parts.description}</p>}
                      {parts.facts.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 marker:text-ink-2">
                          {parts.facts.map((f, i) => (
                            <li key={i} className="wrap-anywhere">
                              {f}
                            </li>
                          ))}
                        </ul>
                      )}
                      {fromAgent && s.tags.length > 0 && (
                        <p>
                          Suggested use: <span className="font-medium text-ink">{s.tags[0]}</span>
                        </p>
                      )}
                      <p className="flex flex-wrap gap-x-3 gap-y-1">
                        <span>{fromAgent ? "Proposed by the Audience agent" : "From the customer summary"}</span>
                        {parts.asOf && <span>As of {parts.asOf}</span>}
                      </p>
                      {fromAgent && <RemoveSegmentButton brandId={brandId} itemId={s.id} title={s.title} />}
                    </div>
                  </SegmentDisclosure>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
