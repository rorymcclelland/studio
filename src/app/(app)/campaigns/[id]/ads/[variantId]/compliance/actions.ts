"use server";

// C8-1: a person's decision on a compliance review item, from the ad's
// Compliance view (Q3: inline, not in the approvals inbox; it changes what a
// download holds, not what is published or spent). decideFinding checks the
// workspace and that the item is still the one the person saw; this only turns
// its refusal into a message for the page.

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { acceptDontRuleForPicked, ComplianceError, decideFinding } from "@/lib/compliance/compute";
import type { BriefActionState } from "../../../../actions";

export type DecisionPayload = { lang: string | null; size: string | null; rule: string; hash: string; decision: "accept" | "reject"; note: string };

export async function decideCompliance(campaignId: string, variantId: string, payload: DecisionPayload): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const f = await decideFinding(member, variantId, payload);
    revalidatePath(`/campaigns/${campaignId}/ads/${variantId}/compliance`);
    revalidatePath(`/campaigns/${campaignId}`);
    return { done: f.outcome === "accepted" ? `Accepted: ${f.name.toLowerCase()}.` : `Marked not acceptable: ${f.name.toLowerCase()}.` };
  } catch (err) {
    if (err instanceof ComplianceError) return { error: err.message };
    console.error("[decideCompliance]", err);
    return { error: "The decision wasn't saved. Nothing was changed; try again." };
  }
}

/**
 * Rory, while building: a don't rule accepted for every picked ad at once,
 * from the campaign. Each ad still records its own decision, with name and time.
 */
export async function acceptRuleForPicked(campaignId: string, key: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const r = await acceptDontRuleForPicked(member, campaignId, key);
    revalidatePath(`/campaigns/${campaignId}`);
    const ads = (n: number) => `${n} picked ${n === 1 ? "ad" : "ads"}`;
    const kept = r.rejected ? ` ${ads(r.rejected)} marked not acceptable ${r.rejected === 1 ? "is" : "are"} left as ${r.rejected === 1 ? "it is" : "they are"}.` : "";
    if (r.accepted === 0) return { done: `Nothing to accept: every picked ad already has a decision on that rule.${kept}` };
    return { done: `Accepted for ${ads(r.accepted)}: don't rule.${kept}` };
  } catch (err) {
    if (err instanceof ComplianceError) return { error: err.message };
    console.error("[acceptRuleForPicked]", err);
    return { error: "The rule wasn't accepted. Nothing was changed; try again." };
  }
}
