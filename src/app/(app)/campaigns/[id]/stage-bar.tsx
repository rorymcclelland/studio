// U10-2: the stage bar, under the campaign's title on the overview, every
// stage page and the Performance page. Each stage is a link with its name and
// its state in a word or a count; the current stage carries aria-current. A
// locked stage stays a link (its page says why and what unlocks it). Built
// from the segmented nav's parts (the soft surface, the primary-soft current
// item); below 640 px it scrolls sideways inside itself, never the page, and
// opens scrolled so the current stage is in view (StageBarScroller).
import Link from "next/link";
import { cx } from "@/components/ui/cx";
import type { StageId, StageView } from "@/lib/campaigns/stages";
import { StageBarScroller } from "./stage-bar-scroller";

export function StageBar({ stages, current }: { stages: StageView[]; current: StageId | null }) {
  return (
    <StageBarScroller aria-label="Campaign stages" data-stage-bar="" className="min-w-0 overflow-x-auto rounded-card bg-surface">
      {/* The padding keeps each link's focus ring inside the scrolling bar. */}
      <ol className="flex w-max min-w-full gap-1 p-1.5">
        {stages.map((s, i) => {
          const isCurrent = s.id === current;
          return (
            <li key={s.id} className="flex-1">
              <Link
                href={s.href}
                data-stage={s.id}
                data-stage-locked={s.locked ? "" : undefined}
                aria-current={isCurrent ? "page" : undefined}
                className={cx(
                  "flex min-h-11 flex-col justify-center rounded-field px-3 py-1.5 whitespace-nowrap transition-colors motion-reduce:transition-none sm:px-4",
                  isCurrent ? "bg-primary-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                <span className="text-sm font-semibold sm:text-base">
                  <span aria-hidden className="mr-1.5 tabular-nums">
                    {i + 1}
                  </span>
                  <span data-stage-name="">{s.name}</span>
                </span>
                <span className={cx("text-sm", isCurrent ? "text-ink" : "text-ink-2")} data-stage-state="">
                  {s.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </StageBarScroller>
  );
}
