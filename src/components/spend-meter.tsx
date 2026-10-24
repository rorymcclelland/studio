import { dailyCapPence, spendTodayPence } from "@/lib/models/cap";
import { formatPence } from "@/lib/format";

/** Today's AI spend against the daily cap (S1-4). */
export async function SpendMeter({ userId }: { userId: string }) {
  const spent = await spendTodayPence(userId);
  const cap = dailyCapPence();
  const share = cap > 0 ? Math.min(1, spent / cap) : 1;
  const tone = share >= 1 ? "bg-bad" : share >= 0.8 ? "bg-warn" : "bg-good";
  return (
    <div className="flex items-center gap-2" title="AI spend today, across the app, against the daily cap">
      <span className="text-ink-2">AI today</span>
      <span
        className="relative h-1.5 w-16 overflow-hidden rounded-full bg-line"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Number(spent.toFixed(2))}
        aria-label="AI spend today"
      >
        <span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${share * 100}%` }} />
      </span>
      <span className="tabular-nums">
        {formatPence(spent)} of {formatPence(cap)}
      </span>
    </div>
  );
}
