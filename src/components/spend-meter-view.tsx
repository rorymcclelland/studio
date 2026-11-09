import { Pill } from "@/components/ui/pill";
import { cx } from "@/components/ui/cx";
import { SIMULATED_COST_NOTE } from "@/lib/format";
import { spendMeterText, type SpendMeterFacts } from "./spend-meter-text";

/**
 * The header's spend meter, drawn from its facts (U10-1). The figure and the
 * bar show what has been charged; calls in flight are said beside them, never
 * as spend (rule 1). The two halves wrap onto a second line rather than widen
 * a phone's page (F-36).
 */
export function SpendMeterView({ owner, ...facts }: SpendMeterFacts & { owner: boolean }) {
  const t = spendMeterText(facts);
  const { chargedPence: charged, capPence: cap } = facts;
  const share = cap > 0 ? Math.min(1, charged / cap) : 1;
  const tone = share >= 1 ? "bg-attention" : share >= 0.8 ? "bg-review" : "bg-good";
  return (
    <div
      data-spend-meter=""
      className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-card bg-surface px-3 py-1.5 text-sm"
      title={
        (owner ? "AI spend today, across the app, against the daily cap" : "AI spend today in your workspace, against its daily limit") +
        (t.pill ? `. ${SIMULATED_COST_NOTE}` : "")
      }
    >
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-ink-2">AI today</span>
        <span
          className="relative h-2 w-10 overflow-hidden rounded-full bg-surface-2"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={Number(charged.toFixed(2))}
          aria-valuetext={t.label}
          aria-label="AI spend today"
        >
          <span className={cx("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${share * 100}%` }} />
        </span>
        <span className="font-medium tabular-nums" data-spend-figure="">
          {t.figure}
        </span>
      </span>
      {(t.pill || t.running) && (
        <span className="flex items-center gap-2 whitespace-nowrap">
          {t.pill && (
            <Pill tone="review">
              <span data-simulated-spend="">{t.pill}</span>
            </Pill>
          )}
          {t.running && (
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
              <span data-calls-running="">{t.running}</span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}
