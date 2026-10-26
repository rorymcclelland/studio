"use server";

// S5-4: the Creative section's actions. Each one calls the gallery or copy
// functions (src/lib/creative), which check the workspace, the sign-off and
// the cap; these only turn their refusals into messages for the page.
// Picking and discarding are marks; the costed ones (Make creative, New
// picture, New words) go through the cap. Nothing here spends ad money or
// publishes (rule 3).

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { StartRunError, type Member } from "@/lib/agents/runs";
import { sendEvent } from "@/inngest/client";
import { CopyError, discardCopySet, restoreCopySet, saveCopyEdit, startNewWords } from "@/lib/creative/copy";
import {
  CopyEditError,
  CreativeError,
  discardVariant,
  editWords,
  keepWords,
  newPicture,
  newWords,
  pickVariant,
  restoreVariant,
  setLayout,
  startMakeCreative,
  unpickVariant,
} from "@/lib/creative/gallery";
import type { BriefActionState } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function known(err: unknown): BriefActionState | null {
  if (err instanceof CopyEditError) {
    return { error: "The words weren't saved. Fix the problems below.", problems: err.problems, fieldErrors: err.fieldErrors };
  }
  if (err instanceof CreativeError || err instanceof CopyError || err instanceof StartRunError) return { error: err.message };
  return null;
}

/** Runs one action, refreshes the campaign page, and turns a refusal into its message. */
async function act(campaignId: string, what: string, fallback: string, fn: (member: Member) => Promise<string>): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const done = await fn(member);
    revalidatePath(`/campaigns/${campaignId}`);
    return { done };
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error(`[${what}]`, err);
    return { error: fallback };
  }
}

export async function makeCreative(campaignId: string): Promise<BriefActionState> {
  return act(campaignId, "makeCreative", "Couldn't start Make creative. Nothing was started; try again.", async (member) => {
    await startMakeCreative(member, campaignId, sendEvent);
    return "Making creative: four pictures, then the ads. This takes a minute or so.";
  });
}

export async function pickAd(campaignId: string, variantId: string, picked: boolean): Promise<BriefActionState> {
  return act(campaignId, "pickAd", "Couldn't change the shortlist. Nothing was changed; try again.", async (member) => {
    if (picked) await pickVariant(member, variantId);
    else await unpickVariant(member, variantId);
    return picked ? "Picked for the shortlist." : "Taken off the shortlist.";
  });
}

export async function discardAd(campaignId: string, variantId: string): Promise<BriefActionState> {
  return act(campaignId, "discardAd", "Couldn't discard the ad. Nothing was changed; try again.", async (member) => {
    await discardVariant(member, variantId);
    return "Ad discarded. It is under Discarded, where you can restore it.";
  });
}

export async function restoreAd(campaignId: string, variantId: string): Promise<BriefActionState> {
  return act(campaignId, "restoreAd", "Couldn't restore the ad. Nothing was changed; try again.", async (member) => {
    await restoreVariant(member, variantId);
    return "Ad restored to the gallery.";
  });
}

export async function switchLayout(campaignId: string, variantId: string, layout: string): Promise<BriefActionState> {
  return act(campaignId, "switchLayout", "Couldn't change the layout. Nothing was changed; try again.", async (member) => {
    await setLayout(member, variantId, layout);
    return "Layout changed.";
  });
}

export async function newAdPicture(campaignId: string, variantId: string): Promise<BriefActionState> {
  return act(campaignId, "newAdPicture", "Couldn't start a new picture. Nothing was started; try again.", async (member) => {
    await newPicture(member, variantId, sendEvent);
    return "Drawing a new picture for this ad.";
  });
}

export async function newAdWords(campaignId: string, variantId: string): Promise<BriefActionState> {
  return act(campaignId, "newAdWords", "Couldn't start new words. Nothing was started; try again.", async (member) => {
    await newWords(member, variantId, sendEvent);
    return "Writing new words. They will wait beside the current ones until you choose.";
  });
}

export async function keepAdWords(campaignId: string, variantId: string, keep: "new" | "old"): Promise<BriefActionState> {
  return act(campaignId, "keepAdWords", "Couldn't keep those words. Nothing was changed; try again.", async (member) => {
    const { variantIds } = await keepWords(member, variantId, keep === "new" ? "new" : "old");
    return keep === "new" ? `New words kept. ${plural(variantIds.length, "ad")} now use them.` : "Old words kept. The new ones are discarded.";
  });
}

export async function editAdWords(
  campaignId: string,
  variantId: string,
  fields: { headline: string; body: string; cta: string },
): Promise<BriefActionState> {
  return act(campaignId, "editAdWords", "Couldn't save the words. Nothing was changed; try again.", async (member) => {
    const { variantIds } = await editWords(member, variantId, fields);
    return `Words saved. ${plural(variantIds.length, "ad")} now use them.`;
  });
}

/** A hand edit of a text-only set (search, email, app push) or another audience's ad words. */
export async function editCopySet(campaignId: string, setId: string, fields: Record<string, unknown>): Promise<BriefActionState> {
  return act(campaignId, "editCopySet", "Couldn't save the words. Nothing was changed; try again.", async (member) => {
    await saveCopyEdit(member, setId, fields);
    return "Words saved.";
  });
}

export async function newSetWords(campaignId: string, setId: string): Promise<BriefActionState> {
  return act(campaignId, "newSetWords", "Couldn't start new words. Nothing was started; try again.", async (member) => {
    await startNewWords(member, setId, sendEvent);
    return "Writing new words. They will wait beside the current ones until you choose.";
  });
}

const DISCARD_DONE = {
  discard: "Words discarded. Restore them under Discarded.",
  "keep-new": "New words kept. The old ones are under Discarded.",
  "keep-old": "Old words kept. The new ones are under Discarded.",
} as const;

/** Discards a set: by hand, or to keep the other of two sets after New words on a text-only set. */
export async function discardSet(campaignId: string, setId: string, why: keyof typeof DISCARD_DONE = "discard"): Promise<BriefActionState> {
  return act(campaignId, "discardSet", "Couldn't discard those words. Nothing was changed; try again.", async (member) => {
    await discardCopySet(member, setId);
    return DISCARD_DONE[why] ?? DISCARD_DONE.discard;
  });
}

export async function restoreSet(campaignId: string, setId: string): Promise<BriefActionState> {
  return act(campaignId, "restoreSet", "Couldn't restore those words. Nothing was changed; try again.", async (member) => {
    await restoreCopySet(member, setId);
    return "Words restored.";
  });
}
