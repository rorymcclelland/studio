"use server";

// C8-4: Pre-test picked ads, from the campaign's Creative section. The click
// is the person's choice, with the cost on the button (rule 3); startPretest
// checks the workspace, the sign-off and the panel, and the run goes through
// the daily cap (rule 5). Nothing is published, replaced or ranked.

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { StartRunError } from "@/lib/agents/runs";
import { sendEvent } from "@/inngest/client";
import { PretestError, startPretest } from "@/lib/creative/pretest";
import type { BriefActionState } from "./actions";

export async function pretestPicked(campaignId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await startPretest(member, campaignId, sendEvent);
    revalidatePath(`/campaigns/${campaignId}`);
    return { done: "Pre-testing the picked ads. The synthetic panel's scores appear under each ad in a few seconds." };
  } catch (err) {
    if (err instanceof PretestError || err instanceof StartRunError) return { error: err.message };
    console.error("[pretestPicked]", err);
    return { error: "Couldn't start the pre-test. Nothing was started; try again." };
  }
}
