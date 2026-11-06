"use server";

// P9-1 on the campaign page: Ask to launch, and End the launch; P9-2's
// simulated clock: Next day, Next week and Run to the end. Each returns a
// brief action's state, so the page's forms show the error and its problems.
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { advance, ClockError, clockLabel, type ClockStep } from "@/lib/performance/clock";
import { endLaunch, LaunchError, requestLaunch, type LaunchRequest } from "@/lib/performance/launch";
import type { BriefActionState } from "../actions";

/** A launch refusal as the form shows it; null for anything unexpected. Not exported: every export here is a server action. */
function launchErrorState(err: unknown): BriefActionState | null {
  if (!(err instanceof LaunchError)) return null;
  return err.problems ? { error: err.message, problems: err.problems } : { error: err.message };
}

/** Asks for a launch with the panel's settings; it waits for approval in the inbox (rule 3). */
export async function askToLaunch(campaignId: string, request: LaunchRequest): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await requestLaunch(member, campaignId, request);
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/approvals");
    return { done: "Launch asked for. It waits for approval in the inbox; nothing real is spent." };
  } catch (err) {
    const k = launchErrorState(err);
    if (k) return k;
    console.error("[askToLaunch]", err);
    return { error: "Couldn't ask to launch. Nothing was saved; try again." };
  }
}

/** Ends a live launch early, after the panel's confirm step. */
export async function endTheLaunch(campaignId: string, launchId: string): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    await endLaunch(member, launchId);
    revalidatePath(`/campaigns/${campaignId}`);
    return { done: "The launch has ended." };
  } catch (err) {
    const k = launchErrorState(err);
    if (k) return k;
    console.error("[endTheLaunch]", err);
    return { error: "Couldn't end the launch. It is still live; try again." };
  }
}

/**
 * Moves a live launch's simulated clock on from the day the page showed, by a
 * day, a week or to the end. A second click on the same day writes nothing:
 * the page just shows where the clock is now.
 */
export async function advanceClock(campaignId: string, launchId: string, by: ClockStep, fromDay: number): Promise<BriefActionState> {
  const member = await requireMember();
  try {
    const r = await advance(member, launchId, by, fromDay, { campaignId });
    revalidatePath(`/campaigns/${campaignId}`);
    return { done: r.written > 0 ? `${clockLabel(r.simDay, r.days)}.` : `The clock had already moved on: ${clockLabel(r.simDay, r.days).toLowerCase()}.` };
  } catch (err) {
    if (err instanceof ClockError) return { error: err.message };
    console.error("[advanceClock]", err);
    return { error: "Couldn't move the simulation on. Nothing was written; try again." };
  }
}
