import { spendPosition } from "@/lib/models/generate";
import { workspaceCapPence } from "@/lib/env";
import { formatPence } from "@/lib/format";
import { cx } from "@/components/ui/cx";

/**
 * Today's AI spend against the cap that applies to this person (S1-4, F-3):
 * the owner sees the app against the daily cap; others see their workspace
 * against its own limit (review 8).
 */
export async function SpendMeter({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const p = await spendPosition(userId, workspaceId);
  const spent = p.owner ? p.total : p.workspace;
  const cap = p.owner ? p.limit : workspaceCapPence();
  const share = cap > 0 ? Math.min(1, spent / cap) : 1;
  const tone = share >= 1 ? "bg-attention" : share >= 0.8 ? "bg-review" : "bg-good";
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm"
      title={p.owner ? "AI spend today, across the app, against the daily cap" : "AI spend today in your workspace, against its daily limit"}
    >
      <span className="text-ink-2">AI today</span>
      <span
        className="relative h-2 w-10 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Number(spent.toFixed(2))}
        aria-valuetext={`${formatPence(spent)} of ${formatPence(cap)}`}
        aria-label="AI spend today"
      >
        <span className={cx("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${share * 100}%` }} />
      </span>
      <span className="font-medium whitespace-nowrap tabular-nums">
        {formatPence(spent)} of {formatPence(cap)}
      </span>
    </div>
  );
}
