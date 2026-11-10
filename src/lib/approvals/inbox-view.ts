// U10-5 (answer B1): the one line a sign-off card in the approvals inbox gives
// for its personas and test plan, which open on request; and (Rory's decision,
// 9 November 2026) the order the inbox and home's "Needs you" list what waits.
// Pure.

export const REVIEWS_SUMMARY_LABEL = "Personas and test plan";

/** For the sign-off's own version: how many synthetic personas reviewed it, and whether it has a test plan. */
export function reviewsSummary({ personas, plan, preparing }: { personas: number; plan: boolean; preparing: boolean }): string {
  if (preparing) return "Being prepared";
  const people = `${personas} synthetic ${personas === 1 ? "persona" : "personas"}`;
  if (personas > 0 && plan) return `${people} and a test plan`;
  if (personas > 0) return `${people}; no test plan`;
  if (plan) return "A test plan; no persona review";
  return "No persona review or test plan";
}

/** The heading over the run choices, which the inbox lists in their own group after everything with an Approve button. */
export const RUN_CHOICES_HEADING = "Runs waiting for your choice";

/** Whether an approval of this kind is decided with an Approve button in the inbox (sign-offs and launches). */
export function hasApprove(kind: string): boolean {
  return kind === "brief_signoff" || kind === "launch";
}

/**
 * Rory's decision (9 November 2026): what has an Approve button first (sign-offs
 * and launches), newest first; then the run choices, newest first. Two asked for
 * at the same moment go by id, so the order never changes between reads. Returns
 * a new array; what it is given is left as it was.
 */
export function inboxOrder<T extends { kind: string; id: string; createdAt: Date }>(items: readonly T[]): T[] {
  return [...items].sort(
    (x, y) =>
      Number(hasApprove(y.kind)) - Number(hasApprove(x.kind)) ||
      y.createdAt.getTime() - x.createdAt.getTime() ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
}
