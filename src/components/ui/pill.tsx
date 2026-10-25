import { cx } from "./cx";

export type PillTone = "good" | "review" | "attention" | "neutral" | "active";

const TONES: Record<PillTone, { pill: string; dot: string }> = {
  good: { pill: "bg-good-soft text-good-ink", dot: "bg-good" },
  review: { pill: "bg-review-soft text-review-ink", dot: "bg-review" },
  attention: { pill: "bg-attention-soft text-attention-ink", dot: "bg-attention" },
  neutral: { pill: "bg-surface-2 text-ink-2", dot: "bg-ink-2" },
  active: { pill: "bg-primary-soft text-primary", dot: "bg-primary" },
};

/** A short status label. The words carry the meaning; colour only supports it. */
export function Pill({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-0.5 text-sm font-semibold whitespace-nowrap",
        t.pill,
        className,
      )}
    >
      {dot && <span aria-hidden className={cx("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}
