import { cx } from "./cx";

export type RingTone = "good" | "review" | "attention";

const STROKE: Record<RingTone, string> = {
  good: "stroke-good",
  review: "stroke-review",
  attention: "stroke-attention",
};

const SIZES = { sm: "size-32", md: "size-44", lg: "size-56" };

/**
 * The Soft machine health ring: one segment per item (a live variant, a run),
 * coloured by its state, with a figure and a caption in the middle.
 *
 * Segments appear one after another, once; with reduced motion they are
 * simply there. The SVG is an image with a full text alternative, so the
 * colours never carry the meaning alone.
 */
export function Ring({
  segments,
  value,
  caption,
  label,
  size = "md",
  className,
}: {
  /** One entry per item, in display order. */
  segments: RingTone[];
  /** The figure in the middle, for example "78%". */
  value: string;
  /** A few words under the figure, for example "of spend is healthy". */
  caption: string;
  /** What the ring says, in words, for screen readers. */
  label: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const r = 92;
  const c = 2 * Math.PI * r;
  const n = segments.length;
  const seg = n > 0 ? c / n : c;
  // A small gap between segments, none when there is only one.
  const gap = n > 1 ? Math.min(4, seg / 3) : 0;
  return (
    <svg viewBox="0 0 220 220" role="img" aria-label={label} className={cx(SIZES[size], "shrink-0", className)}>
      <circle cx="110" cy="110" r={r} fill="none" strokeWidth="18" className="stroke-surface-2" />
      {segments.map((tone, i) => (
        <circle
          key={i}
          cx="110"
          cy="110"
          r={r}
          fill="none"
          strokeWidth="18"
          data-ring-segment=""
          className={cx("ring-seg", STROKE[tone])}
          style={{ "--i": i } as React.CSSProperties}
          strokeDasharray={`${seg - gap} ${c - seg + gap}`}
          strokeDashoffset={-i * seg}
          transform="rotate(-90 110 110)"
        />
      ))}
      <text x="110" y="106" textAnchor="middle" fontSize="40" fontWeight="700" className="fill-ink">
        {value}
      </text>
      <text x="110" y="134" textAnchor="middle" fontSize="15" className="fill-ink-2">
        {caption}
      </text>
    </svg>
  );
}

/** Counts of each tone, for building a ring's label. */
export function countTones(segments: RingTone[]) {
  return {
    good: segments.filter((s) => s === "good").length,
    review: segments.filter((s) => s === "review").length,
    attention: segments.filter((s) => s === "attention").length,
  };
}
