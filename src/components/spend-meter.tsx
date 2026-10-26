import { dailyCapPence, spendTodayPence } from "@/lib/models/cap";
import { formatPence } from "@/lib/format";
import { cx } from "@/components/ui/cx";

/** Today's AI spend against the daily cap (S1-4). */
export async function SpendMeter({ userId }: { userId: string }) {
  const spent = await spendTodayPence(userId);
  const cap = dailyCapPence();
  const share = cap > 0 ? Math.min(1, spent / cap) : 1;
  const tone = share >= 1 ? "bg-attention" : share >= 0.8 ? "bg-review" : "bg-good";
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm"
      title="AI spend today, across the app, against the daily cap"
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
