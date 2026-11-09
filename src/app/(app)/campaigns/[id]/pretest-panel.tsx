// C8-4 on the campaign page: Pre-test picked ads, and the synthetic panel's
// scores under each ad. Every score carries "Synthetic panel, not real
// customers" (rule 1); the scores are never called results, and nothing here
// predicts clicks or sales. Scores made by the mock model say so.
import { TextLink } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { CreativeView, VariantView } from "@/lib/creative/gallery";
import { PRETEST_SCALES, SCALE_NAMES, SYNTHETIC_PANEL } from "@/lib/agents/pretest";
import { PretestButton } from "./pretest-button";

const listNames = (names: string[]) => names.join(", ").replace(/, ([^,]*)$/, " and $1");

/** The bar beside the gallery: what the panel does, who is on it, and the button with its cost. */
export function PretestBar({ view }: { view: CreativeView }) {
  const p = view.pretest;
  const running = !!p.runningRunId;
  return (
    <div className="flex flex-col gap-3 rounded-field bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between" id="pretest" data-pretest-bar="">
      <div className="min-w-0 max-w-prose space-y-1.5">
        <p className="font-semibold">Pre-test</p>
        <p className="text-sm text-ink-2">
          {p.personas.length > 0 ? `The brief's synthetic personas (${listNames(p.personas)})` : "The brief's synthetic personas"} score each
          picked ad from 1 to 5 on stops the scroll, clear, believable and on brand, each with a reason quoting the ad.{" "}
          <span className="font-semibold text-ink">{SYNTHETIC_PANEL}:</span> scores, not results or predictions, and nothing is ranked
          for launch.
        </p>
        {running && (
          <p role="status" className="text-sm text-primary">
            Pre-testing. <TextLink href={`/runs/${p.runningRunId}`}>See the run</TextLink>
          </p>
        )}
      </div>
      <PretestButton campaignId={view.campaignId} estimate={p.estimate} reason={p.reason} running={running} />
    </div>
  );
}

/** One ad's panel: the average and each persona's scores and reasons, or "Out of date: pre-test again". */
export function PretestScores({ v, number }: { v: VariantView; number: number }) {
  const p = v.pretest;
  if (!p) return null;
  if (p.state === "stale") {
    return (
      <div className="space-y-1.5 rounded-field bg-surface-2 px-3 py-2" data-pretest="" data-pretest-stale="">
        <p className="flex flex-wrap items-center gap-1.5">
          <Pill tone="attention" wrap>
            {p.note}
          </Pill>
        </p>
        <p className="text-sm text-ink-2 wrap-anywhere">
          The synthetic panel scored an earlier version of ad {number} (before a redraw, new words, a new picture or another layout), so
          its scores don&apos;t apply to this one. {SYNTHETIC_PANEL}.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-field bg-surface-2 px-3 py-2" data-pretest="">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="font-semibold" data-pretest-average="">
          Panel average {p.average.toFixed(1)} out of 5
        </span>
        <Pill tone="review" wrap>
          <span data-pretest-label="">{p.simulated ? `${SYNTHETIC_PANEL} (simulated scores)` : SYNTHETIC_PANEL}</span>
        </Pill>
      </p>
      <details className="group text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold text-primary">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          Each persona&apos;s scores for ad {number}
        </summary>
        <p className="mt-2 text-ink-2">
          {SYNTHETIC_PANEL}.{p.simulated ? " These scores were written by the mock model for the demo, not a real one." : ""}{" "}
          <TextLink href={`/runs/${p.runId}`}>The panel&apos;s run</TextLink>
        </p>
        <ul className="mt-2 space-y-3">
          {p.personas.map((x) => (
            <li key={x.key} className="min-w-0" data-pretest-persona={x.key}>
              <p className="wrap-anywhere">
                <span className="font-semibold text-ink">{x.name}</span>
                {x.segment ? <span className="text-ink-2"> ({x.segment})</span> : null}:{" "}
                <span data-pretest-persona-average="">{x.average.toFixed(1)} out of 5</span>
              </p>
              <dl className="mt-1 space-y-1">
                {PRETEST_SCALES.map((s) => (
                  <div key={s} className="min-w-0" data-pretest-score={s}>
                    <dt className="inline font-semibold">
                      {SCALE_NAMES[s]}: {x.scores[s].score} out of 5.
                    </dt>{" "}
                    <dd className="inline wrap-anywhere">
                      {x.scores[s].reason} <q className="text-ink-2">{x.scores[s].quote}</q>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
