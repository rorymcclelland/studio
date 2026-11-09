import { spendMeterReading } from "@/lib/models/generate";
import { SpendMeterView } from "./spend-meter-view";

/**
 * Today's AI spend against the cap that applies to this person (S1-4, F-3):
 * the owner sees the app against the daily cap; others see their workspace
 * against its own limit (review 8). Spend from the mock models is marked
 * simulated (rule 1, review finding 4); the cap counts it like any other.
 * Calls in flight are said as calls running, never shown as spend (U10-1).
 */
export async function SpendMeter({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const r = await spendMeterReading(userId, workspaceId);
  return <SpendMeterView owner={r.owner} chargedPence={r.chargedPence} simulatedPence={r.simulatedPence} callsInFlight={r.callsInFlight} capPence={r.capPence} />;
}
