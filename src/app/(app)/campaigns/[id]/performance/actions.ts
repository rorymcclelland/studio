"use server";

// P9-4 on the Performance view: Mark as seen on an alert, and Ask about this
// campaign. Alerts never act (rule 3): marking one as seen records who and
// when, nothing else. A question starts the Monitor's run, which goes through
// runModelStep and generate() (rules 4 and 5). Each returns a brief action's
// state, so the page's forms show the error.
import { revalidatePath } from "next/cache";
import { revalidateCampaign } from "@/lib/campaigns/revalidate";
import { sendEvent } from "@/inngest/client";
import { StartRunError } from "@/lib/agents/runs";
import { requireMember } from "@/lib/auth/session";
import { AlertError, markAlertSeen } from "@/lib/performance/alerts-store";
import { AskError, askQuestion } from "@/lib/performance/ask";
import type { BriefActionState } from "../../actions";

/** Marks one of the campaign's alerts as seen by the signed-in member. */
export async function markAlertAsSeen(campaignId: string, alertId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await markAlertSeen(member, alertId);
    revalidateCampaign(campaignId);
    revalidatePath("/");
    return { done: "Marked as seen." };
  } catch (err) {
    if (err instanceof AlertError) return { error: err.message };
    console.error("[markAlertAsSeen]", err);
    return { error: "Couldn't mark the alert as seen. Try again." };
  }
}

/** Asks a question about the campaign's simulated results; the answer follows on the page. */
export async function askAboutCampaign(campaignId: string, question: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await askQuestion(member, campaignId, question, sendEvent);
    revalidateCampaign(campaignId);
    return { done: "Question asked. The answer appears below in a few seconds." };
  } catch (err) {
    if (err instanceof AskError || err instanceof StartRunError) return { error: err.message };
    console.error("[askAboutCampaign]", err);
    return { error: "Couldn't ask the question. Nothing was saved; try again." };
  }
}
