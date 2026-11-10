// U10-2: history on request. Finished things (brief versions, discarded ads
// and words, creative runs and their AI cost) collapse to one line with a
// count, and open in place. A native <details>, so it works without script and
// by keyboard; the chevron turns, except under reduced motion.
export function HistoryDetails({
  kind,
  id,
  title,
  count,
  open = false,
  children,
}: {
  kind: "versions" | "discarded" | "runs";
  /** The old one-page campaign's section id, so its links still land here. */
  id: string;
  title: string;
  /** How many rows are inside. */
  count: number;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} data-history={kind} open={open} className="group scroll-mt-6 rounded-card bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-card px-5 py-2.5 font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-4 shrink-0 text-primary transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          {title}{" "}
          <span className="font-normal text-ink-2">
            (<span data-history-count="" className="tabular-nums">
              {count}
            </span>
            )
          </span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-line px-5 pt-3 pb-5 sm:px-6">{children}</div>
    </details>
  );
}
