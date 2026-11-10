// S4-2 and S4-4: the persona review and the test plan, read-only. Shared by
// the campaign page and the approvals inbox. No hooks.
import type { PersonaReview, TestPlan } from "@/lib/strategy/reviews";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/pill";

export const SYNTHETIC_LABEL = "Synthetic persona, not a real customer";

const CRITERIA = [
  ["relevance", "Relevance"],
  ["clarity", "Clarity"],
  ["credibility", "Credibility"],
  ["brandFit", "Brand fit"],
] as const;

const VARIABLE_LABEL: Record<string, string> = {
  message: "Message",
  offer: "Offer",
  channel: "Channel",
  timing: "Timing",
};

/** A score out of 5: the number in words, and a small bar beside it. */
function Score({ label, value }: { label: string; value: number }) {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <dt className="w-24 shrink-0 text-sm text-ink-2">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className="relative h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-2">
          <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(value / 5) * 100}%` }} />
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {shown}
          <span className="font-normal text-ink-2"> out of 5</span>
        </span>
      </dd>
    </div>
  );
}

/** What a persona said, with the brief text it is about shown as a quote. */
function Said({ label, text, quote }: { label: string; text: string; quote: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-0.5 wrap-anywhere">{text}</p>
      <blockquote className="mt-2 border-l-4 border-primary-soft pl-3 text-sm text-ink-2 wrap-anywhere">
        <span className="sr-only">Quoting the brief: </span>&ldquo;{quote}&rdquo;
      </blockquote>
    </div>
  );
}

/** The averages across personas (worked out in code, never by the model) and the overall score. */
export function PersonaAverages({ review, compact = false }: { review: PersonaReview; compact?: boolean }) {
  const overall = Number.isInteger(review.overall) ? String(review.overall) : review.overall.toFixed(1);
  return (
    <div className={cx("grid gap-4", !compact && "md:grid-cols-[auto_1fr] md:items-center md:gap-8")}>
      <p className="flex items-baseline gap-2" data-persona-overall="">
        <span className={cx("font-strong tabular-nums", compact ? "text-2xl" : "text-display")}>{overall}</span>
        <span className="text-ink-2">out of 5 overall</span>
      </p>
      <dl className={cx("grid min-w-0 gap-2", !compact && "sm:grid-cols-2 sm:gap-x-8")}>
        {CRITERIA.map(([key, label]) => (
          <Score key={key} label={label} value={review.averages[key]} />
        ))}
      </dl>
    </div>
  );
}

/** The four persona cards. */
export function PersonaCards({ review, headingLevel = 3 }: { review: PersonaReview; headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <ul aria-label="Personas" className="grid gap-4 lg:grid-cols-2">
      {review.personas.map((p) => (
        <Card as="li" key={p.key} data-persona="" className="flex flex-col gap-4">
          <div>
            <H className="text-xl font-strong tracking-tight wrap-anywhere">{p.name}</H>
            <p className="mt-0.5 text-ink-2 wrap-anywhere">{p.segment.title}</p>
            <Pill tone="review" className="mt-2 whitespace-normal">
              {SYNTHETIC_LABEL}
            </Pill>
          </div>
          <div className="space-y-1.5">
            <p className="wrap-anywhere">{p.about}</p>
            <p className="wrap-anywhere">
              <span className="font-semibold">Wants: </span>
              {p.wants}
            </p>
          </div>
          <dl aria-label={`${p.name}'s scores`} className="space-y-2 rounded-field bg-bg p-3">
            {CRITERIA.map(([key, label]) => (
              <Score key={key} label={label} value={p.scores[key]} />
            ))}
          </dl>
          <Said label="Objection" text={p.objection.text} quote={p.objection.quote} />
          <Said label="Would win them over" text={p.winOver.text} quote={p.winOver.quote} />
        </Card>
      ))}
    </ul>
  );
}

/** The test plan's hypotheses as cards. */
export function TestPlanCards({ plan, headingLevel = 3 }: { plan: TestPlan; headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <ol aria-label="Hypotheses" className="space-y-4">
      {plan.hypotheses.map((h, i) => (
        <Card as="li" key={i} data-hypothesis="" className="space-y-4">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-2">
              Hypothesis {i + 1}
              <Pill tone="active">{VARIABLE_LABEL[h.variable] ?? h.variable}</Pill>
            </p>
            <H className="mt-1 text-lg font-strong wrap-anywhere">{h.statement}</H>
          </div>
          <dl className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-sm font-semibold">Tests the insight</dt>
              <dd className="mt-1">
                {h.insight ? (
                  <blockquote className="border-l-4 border-primary-soft pl-3 text-ink-2 wrap-anywhere">
                    &ldquo;{h.insight}&rdquo;
                  </blockquote>
                ) : (
                  <span className="text-ink-2">An insight no longer in the brief</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm font-semibold">Audience</dt>
              <dd className="mt-1 wrap-anywhere">{h.audience?.title ?? "Everyone the brief reaches"}</dd>
            </div>
          </dl>
          <div>
            <p className="text-sm font-semibold" id={`cells-${i}`}>
              Cells
            </p>
            <ul aria-labelledby={`cells-${i}`} className={cx("mt-2 grid gap-3", h.cells.length === 3 ? "md:grid-cols-3" : "sm:grid-cols-2")}>
              {h.cells.map((c, j) => (
                <li key={j} className="min-w-0 rounded-field border border-line bg-bg p-3">
                  <p className="font-semibold wrap-anywhere">{c.label}</p>
                  <p className="mt-0.5 text-sm text-ink-2 wrap-anywhere">{c.differs}</p>
                </li>
              ))}
            </ul>
          </div>
          <dl className="grid gap-4 md:grid-cols-[auto_1fr] md:gap-8">
            <div>
              <dt className="text-sm font-semibold">Success metric</dt>
              <dd className="mt-1 first-letter:uppercase">{h.successMetric}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm font-semibold">Decision rule</dt>
              <dd className="mt-1 wrap-anywhere">{h.decisionRule}</dd>
            </div>
          </dl>
        </Card>
      ))}
    </ol>
  );
}

/** One line per hypothesis, for the inbox. */
export function TestPlanSummary({ plan }: { plan: TestPlan }) {
  return (
    <ol aria-label="Hypotheses" className="list-decimal space-y-1.5 pl-5 marker:text-ink-2">
      {plan.hypotheses.map((h, i) => (
        <li key={i} className="wrap-anywhere">
          {h.statement}{" "}
          <span className="text-sm text-ink-2">
            ({VARIABLE_LABEL[h.variable] ?? h.variable}, judged on {h.successMetric})
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Sample sizes are deliberately left out of the plan; this says why, wherever it is shown. */
export const PLAN_NOTE =
  "The plan has no sample sizes or run lengths on purpose. A simulated launch has its own daily budget and length in days, which a person approves; Studio does not work out sample sizes.";
