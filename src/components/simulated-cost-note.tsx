import { SIMULATED_COST_NOTE } from "@/lib/format";
import { cx } from "@/components/ui/cx";

/** Says what "(simulated)" beside a cost means (rule 1, review finding 4). Shown only where a simulated cost is. */
export function SimulatedCostNote({ className }: { className?: string }) {
  return (
    <p className={cx("text-sm text-ink-2", className)} data-simulated-cost-note="">
      {SIMULATED_COST_NOTE}
    </p>
  );
}
