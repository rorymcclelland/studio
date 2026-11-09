// U10-2: a campaign is an overview and five stage pages, and every one of them
// shows the stage bar, whose states any campaign action can change (a sign-off
// unlocks Creative; a pick changes Creative's count and Launch's ads ready; a
// launch decision changes Launch and Performance). So a server action that
// changes a campaign refreshes its overview and every stage page.
import { revalidatePath } from "next/cache";
import { STAGES, stageHref } from "./stages";

export function revalidateCampaign(campaignId: string): void {
  revalidatePath(`/campaigns/${campaignId}`);
  for (const s of STAGES) revalidatePath(stageHref(campaignId, s.id));
}
