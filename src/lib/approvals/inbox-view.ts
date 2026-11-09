// U10-5 (answer B1): the one line a sign-off card in the approvals inbox gives
// for its personas and test plan, which open on request. Pure.

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
