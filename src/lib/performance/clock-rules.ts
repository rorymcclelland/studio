// P9-2: the simulated clock's steps and wording. Pure code with no database,
// so the Launch (simulated) panel uses the same words as the server
// (src/lib/performance/clock.ts re-exports all of it).

/** Next day, Next week, or Run to the end. */
export type ClockStep = 1 | 7 | "end";

export const CLOCK_STEPS: readonly ClockStep[] = [1, 7, "end"];

export const isClockStep = (by: unknown): by is ClockStep => by === 1 || by === 7 || by === "end";

/** Not live, ended, waiting, refused, missing, malformed or another workspace's: the same refusal for each. */
export const SIM_NOT_LIVE = "There's no live launch to move on.";
export const SIM_AT_END = "The simulation has reached its last day";
export const SIM_STEP_NOT_VALID = "Move the simulation on by a day, a week or to the end.";

/** "No simulated days yet (30 to run)" before the first day, then "Simulated day 12 of 30". */
export function clockLabel(simDay: number, days: number): string {
  return simDay === 0 ? `No simulated days yet (${days} to run)` : `Simulated day ${simDay} of ${days}`;
}

/** The day a step reaches from `simDay`, never past the last day. */
export function stepTo(simDay: number, days: number, by: ClockStep): number {
  return by === "end" ? days : Math.min(simDay + by, days);
}
