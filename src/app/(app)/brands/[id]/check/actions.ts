"use server";

import { revalidatePath } from "next/cache";
import { sendEvent } from "@/inngest/client";
import { requireMember } from "@/lib/auth/session";
import { checkAgain, UploadError } from "@/lib/uploads/repo";

export type CheckAgainState = { ok: true; done: string } | { ok: false; error: string };

/** C8-3: checks an uploaded ad again (the button shows the cost), for a channel and language. */
export async function checkUploadAgain(brandId: string, assetId: string, channel: string, lang: string): Promise<CheckAgainState> {
  const member = await requireMember();
  try {
    await checkAgain(member, brandId, assetId, { channel, lang }, sendEvent);
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    console.error("[checkUploadAgain]", { brandId, assetId }, err);
    return { ok: false, error: "Couldn't start the check. Nothing was started; try again." };
  }
  revalidatePath(`/brands/${brandId}/check/${assetId}`);
  revalidatePath(`/brands/${brandId}/check`);
  return { ok: true, done: "Checking the ad again. This takes a few seconds." };
}
