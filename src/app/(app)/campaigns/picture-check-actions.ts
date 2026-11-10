"use server";

// C8-2: Check pictures, from the campaign's Creative section. The click is the
// person's choice, with the cost on the button (rule 3); startPictureCheck
// checks the workspace and the sign-off, and the run goes through the daily cap
// (rule 5). It writes picture-check results only: nothing is replaced.

import { revalidateCampaign } from "@/lib/campaigns/revalidate";
import { requireMember } from "@/lib/auth/session";
import { StartRunError } from "@/lib/agents/runs";
import { sendEvent } from "@/inngest/client";
import { PictureCheckError, startPictureCheck } from "@/lib/creative/picture-check";
import type { BriefActionState } from "./actions";

export async function checkPictures(campaignId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await startPictureCheck(member, campaignId, sendEvent);
    revalidateCampaign(campaignId);
    return { done: "Checking the pictures. Each ad's Compliance view shows what the AI found in a few seconds." };
  } catch (err) {
    if (err instanceof PictureCheckError || err instanceof StartRunError) return { error: err.message };
    console.error("[checkPictures]", err);
    return { error: "Couldn't start Check pictures. Nothing was started; try again." };
  }
}
