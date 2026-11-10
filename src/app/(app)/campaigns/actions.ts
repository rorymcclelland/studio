"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { revalidateCampaign } from "@/lib/campaigns/revalidate";
import { requireMember } from "@/lib/auth/session";
import { StartRunError } from "@/lib/agents/runs";
import {
  acceptProposal,
  BriefEditError,
  CampaignError,
  createCampaign,
  discardProposal,
  dismissRevision,
  restoreVersion,
  retryDraft,
  saveBriefEdit,
  StaleBriefError,
  startRevision,
} from "@/lib/brief/repo";
import { startSuggestLines } from "@/lib/brief/line";
import { BRIEF_SECTIONS, type BriefCore, type BriefSection } from "@/lib/brief/schema";
import { sendEvent } from "@/inngest/client";
import { decideSignoff, requestSignoff, SignoffError, withdrawSignoff } from "@/lib/approvals/repo";
import { runReviewsForSignoff, startPersonaReview, startTestPlan } from "@/lib/strategy/reviews";
import type { FormState } from "../actions";

/** A brief action's result: an error (with problems or field errors), or a done message for a toast. */
export type BriefActionState =
  | { error: string; problems?: string[]; fieldErrors?: Record<string, string> }
  | { done: string; version?: number }
  | null;

function known(err: unknown): BriefActionState | null {
  if (err instanceof BriefEditError) return { error: "The brief wasn't saved. Fix the problems below.", problems: err.problems, fieldErrors: err.fieldErrors };
  if (err instanceof StaleBriefError || err instanceof CampaignError || err instanceof StartRunError || err instanceof SignoffError) return { error: err.message };
  return null;
}

/** S3-2: creates a campaign from a brand and an objective, starts the Brief agent and opens the campaign. */
export async function newCampaign(_prev: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember();
  let id: string;
  try {
    id = await createCampaign(member, String(form.get("brandId") ?? ""), String(form.get("objective") ?? ""), sendEvent);
  } catch (err) {
    const k = known(err);
    if (k && "error" in k) return { error: k.error };
    console.error("[newCampaign] couldn't create the campaign", err);
    return { error: "Couldn't create the campaign. Nothing was saved; try again." };
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${id}`);
}

export async function retryBrief(campaignId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await retryDraft(member, campaignId, sendEvent);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[retryBrief]", err);
    return { error: "Couldn't start the Brief agent. Try again shortly." };
  }
  revalidateCampaign(campaignId);
  return { done: "The Brief agent is writing the brief." };
}

/** S3-3: saves a person's edit of the whole brief core as the next version. */
export async function saveBrief(campaignId: string, baseVersion: number, brief: BriefCore, note?: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const version = await saveBriefEdit(member, campaignId, baseVersion, brief, note);
    revalidateCampaign(campaignId);
    return { done: `Saved as version ${version}.`, version };
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[saveBrief]", err);
    return { error: "Couldn't save the brief. Nothing was changed; try again." };
  }
}

/** S3-3: asks the Brief agent to revise the whole brief (section null) or one section. */
export async function reviseBrief(campaignId: string, baseVersion: number, section: string | null, instruction: string): Promise<BriefActionState> {
  const member = await requireMember();
  const s = section === null || section === "" ? null : (BRIEF_SECTIONS as readonly string[]).includes(section) ? (section as BriefSection) : undefined;
  // D-4: the campaign line is a person's words; Suggest lines (the Tagline agent) offers some instead.
  if (s === undefined || s === "line") return { error: "Choose a part of the brief to revise." };
  const text = instruction.trim();
  if (text.length < 3) return { error: "Say what to change." };
  if (text.length > 500) return { error: "Keep the instruction to 500 characters or fewer." };
  try {
    await startRevision(member, campaignId, baseVersion, s, text, sendEvent);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[reviseBrief]", err);
    return { error: "Couldn't start the revision. Nothing was changed; try again." };
  }
  revalidateCampaign(campaignId);
  return { done: "The Brief agent is revising. The proposal will appear beside the current brief." };
}

/** D-4: Suggest lines, the Tagline agent on the current version's context; its three lines show on the Brief stage. */
export async function suggestLines(campaignId: string, baseVersion: number): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await startSuggestLines(member, campaignId, baseVersion, sendEvent);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[suggestLines]", err);
    return { error: "Couldn't start Suggest lines. Nothing was changed; try again." };
  }
  revalidateCampaign(campaignId);
  return { done: "The Tagline agent is suggesting lines." };
}

export async function useProposal(campaignId: string, runId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const version = await acceptProposal(member, campaignId, runId);
    revalidateCampaign(campaignId);
    return { done: `Saved as version ${version}.`, version };
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[useProposal]", err);
    return { error: "Couldn't use the proposal. Nothing was changed; try again." };
  }
}

export async function discardBriefProposal(campaignId: string, runId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await discardProposal(member, campaignId, runId);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    throw err;
  }
  revalidateCampaign(campaignId);
  return { done: "Proposal discarded. The current version is unchanged." };
}

export async function dismissFailedRevision(campaignId: string, runId: string): Promise<BriefActionState> {
  const member = await requireMember();
  await dismissRevision(member, campaignId, runId);
  revalidateCampaign(campaignId);
  return { done: "Dismissed." };
}

export async function restoreBriefVersion(campaignId: string, version: number, baseVersion: number): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const v = await restoreVersion(member, campaignId, version, baseVersion);
    revalidateCampaign(campaignId);
    return { done: `Version ${version} restored as version ${v}.`, version: v };
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[restoreBriefVersion]", err);
    return { error: "Couldn't restore that version. Nothing was changed; try again." };
  }
}

/** S4-1: sends the current version for sign-off; the persona review and test plan start for it too (Q4). */
export async function sendForSignoff(campaignId: string, baseVersion: number): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await requestSignoff(member, campaignId, baseVersion, sendEvent, runReviewsForSignoff);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[sendForSignoff]", err);
    return { error: "Couldn't send the brief for sign-off. Nothing was changed; try again." };
  }
  revalidateCampaign(campaignId);
  revalidatePath("/approvals");
  return { done: "Sent for sign-off. The personas and the test plan are being prepared for it." };
}

export async function withdrawFromSignoff(campaignId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await withdrawSignoff(member, campaignId);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    throw err;
  }
  revalidateCampaign(campaignId);
  revalidatePath("/approvals");
  return { done: "Sign-off request withdrawn. The brief is a draft again." };
}

/** S4-1: approve or reject (with a reason) a brief sign-off, from the inbox or the campaign page. */
export async function decideBriefSignoff(approvalId: string, decision: "approved" | "rejected", reason?: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const { campaignId, version } = await decideSignoff(member, approvalId, decision, reason);
    revalidateCampaign(campaignId);
    revalidatePath("/approvals");
    return { done: decision === "approved" ? `Version ${version} signed off.` : "Not signed off. The brief is back in draft with your reason.", version };
  } catch (err) {
    const k = known(err);
    if (k) return k;
    console.error("[decideBriefSignoff]", err);
    return { error: "Couldn't record the decision. Nothing was changed; try again." };
  }
}

/** S4-2: asks the personas about the current version. */
export async function askPersonas(campaignId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await startPersonaReview(member, campaignId, sendEvent);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    throw err;
  }
  revalidateCampaign(campaignId);
  return { done: "The Persona agent is reviewing the brief." };
}

/** S4-4: makes a test plan for the current version. */
export async function makeTestPlan(campaignId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await startTestPlan(member, campaignId, sendEvent);
  } catch (err) {
    const k = known(err);
    if (k) return k;
    throw err;
  }
  revalidateCampaign(campaignId);
  return { done: "Writing the test plan." };
}

