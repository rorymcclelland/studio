import { formatPence } from "@/lib/format";

// The spend meter's words (U10-1, F-36, rule 1). Pure, so the header and the
// tests read the same words. A reservation for a call in flight is an
// estimate: it is said as a call running, never added to the figure or called
// spend. The cap still counts it (src/lib/models/generate.ts).

export type SpendMeterFacts = {
  /** Charged today (usage_ledger), without live reservations. */
  chargedPence: number;
  /** The mock models' part of what was charged. */
  simulatedPence: number;
  /** Live reservations: model calls in flight. */
  callsInFlight: number;
  /** The cap this person is measured against. */
  capPence: number;
};

export type SpendMeterText = {
  /** "42.62p of £10.00" */
  figure: string;
  /** "Simulated", "<amount> simulated" when some charged spend is real, or null when nothing simulated is charged. */
  pill: string | null;
  /** "1 call running", "<n> calls running", or null. */
  running: string | null;
  /** The meter's accessible value. */
  label: string;
};

/** Sums from the database may differ in the last places; within this, everything charged is simulated. */
const SAME = 0.0001;

export function callsRunning(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 call running" : `${n} calls running`;
}

export function spendMeterText(f: SpendMeterFacts): SpendMeterText {
  const figure = `${formatPence(f.chargedPence)} of ${formatPence(f.capPence)}`;
  const charged = f.chargedPence > 0;
  const allSimulated = charged && f.simulatedPence >= f.chargedPence - SAME;
  // Real spend only (no mock calls today) has nothing to label as simulated.
  const pill = !charged || f.simulatedPence <= 0 ? null : allSimulated ? "Simulated" : `${formatPence(f.simulatedPence)} simulated`;
  const running = callsRunning(f.callsInFlight);
  const parts = [figure];
  if (pill) parts.push(allSimulated ? "all simulated" : pill);
  if (running) parts.push(running);
  return { figure, pill, running, label: parts.join(", ") };
}
