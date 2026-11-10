"use server";

// P9-1 in the inbox: Approve or Refuse a launch request (rule 3).
import { revalidatePath } from "next/cache";
import { revalidateCampaign } from "@/lib/campaigns/revalidate";
import { requireMember } from "@/lib/auth/session";
import { decideLaunch, LaunchError } from "@/lib/performance/launch";
import type { BriefActionState } from "../campaigns/actions";

/** Approves a launch request, or refuses it with a reason; the campaign page shows the outcome. */
export async function decideLaunchRequest(approvalId: string, decision: "approved" | "refused", reason?: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const { campaignId, status } = await decideLaunch(member, approvalId, decision, reason);
    revalidateCampaign(campaignId);
    revalidatePath("/approvals");
    return {
      done: status === "live" ? "Approved. The campaign is live in the simulation." : "Refused. The campaign isn't launched, and your reason is shown on it.",
    };
  } catch (err) {
    if (err instanceof LaunchError) return err.problems ? { error: err.message, problems: err.problems } : { error: err.message };
    console.error("[decideLaunchRequest]", err);
    return { error: "Couldn't record the decision. Nothing was changed; try again." };
  }
}
