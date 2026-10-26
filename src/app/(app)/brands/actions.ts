"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { BrandInputError, getBrand, updateBrand } from "@/lib/brands/repo";
import type { BrandInput } from "@/lib/brands/schema";
import { DemoAlreadyLoadedError, loadDemoBrands } from "@/lib/demo/load";
import { createRun, StartRunError } from "@/lib/agents/runs";
import { removeContextItem } from "@/lib/context/store";
import { RecentlyRefreshedError, startMarketRun } from "@/lib/strategy/market";
import { sendEvent } from "@/inngest/client";
import type { FormState } from "../actions";

/** S2-4: adds the two simulated demo brands, or says why it didn't. */
export async function addDemoBrands(): Promise<FormState> {
  const member = await requireMember();
  let names: string[];
  const started = Date.now();
  try {
    names = await loadDemoBrands(member);
    console.log(`[addDemoBrands] loaded ${names.length} brands in ${Date.now() - started} ms`);
  } catch (err) {
    if (err instanceof DemoAlreadyLoadedError) return { error: `${err.message} Nothing was added.` };
    console.error("[addDemoBrands] couldn't load the demo brands", err);
    return { error: "Couldn't add the demo brands. Nothing was added; try again." };
  }
  revalidatePath("/brands");
  return { done: `Added ${names.join(" and ")}. Their customers and orders are simulated.` };
}

/** The editable parts of a kit: everything except the logo, which can't be changed here yet. */
export type BrandDraft = Omit<BrandInput, "logoSvg">;

export type SaveState =
  | { ok: true; done: string }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

/** S2-3: saves a brand kit. Nothing is saved unless every field is valid. */
export async function saveBrand(brandId: string, draft: BrandDraft): Promise<SaveState> {
  const member = await requireMember();
  const current = await getBrand(member.userId, brandId);
  if (!current) {
    return { ok: false, error: "This brand isn't in your workspace any more, so nothing was saved.", fieldErrors: {} };
  }
  try {
    // The logo is kept as it is: it is not part of the editor (upload arrives with imagery).
    const saved = await updateBrand(member, brandId, { ...draft, logoSvg: current.logoSvg });
    if (!saved) {
      return { ok: false, error: "This brand isn't in your workspace any more, so nothing was saved.", fieldErrors: {} };
    }
  } catch (err) {
    if (err instanceof BrandInputError) {
      return { ok: false, error: "Some fields need changing. Nothing was saved.", fieldErrors: err.fieldErrors };
    }
    console.error("[saveBrand] couldn't save the brand kit", { brandId }, err);
    return { ok: false, error: "Couldn't save the brand kit. Nothing was changed; try again.", fieldErrors: {} };
  }
  revalidatePath(`/brands/${brandId}`);
  revalidatePath("/brands");
  return { ok: true, done: `Brand kit saved for ${draft.name.trim()}.` };
}

/** S3-1: starts the Audience agent for a brand; the brand page then follows the run. */
export async function startAudienceRun(brandId: string): Promise<FormState & { runId?: string }> {
  const member = await requireMember();
  const brand = await getBrand(member.userId, brandId);
  if (!brand) return { error: "That brand isn't in your workspace." };
  try {
    const runId = await createRun(member, "audience", { brandId }, sendEvent, { brandId, label: `${brand.name}: find audiences` });
    revalidatePath(`/brands/${brandId}`);
    return { done: "The Audience agent is counting and naming segments. This takes a few seconds.", runId };
  } catch (err) {
    if (err instanceof StartRunError) return { error: err.message };
    console.error("[startAudienceRun] couldn't start the run", err);
    return { error: "Couldn't start the Audience agent. Nothing was started; try again." };
  }
}

/** Removes a segment the Audience agent added (system segments can't be removed). */
export async function removeSegment(brandId: string, itemId: string): Promise<FormState> {
  const member = await requireMember();
  const removed = await removeContextItem(member.userId, itemId);
  revalidatePath(`/brands/${brandId}`);
  return removed ? { done: "Segment removed. Running the Audience agent again would bring it back." } : { error: "That segment can't be removed." };
}

/** S4-3: refreshes the brand's market notes. Within a day of the last refresh it asks for confirmation (costs money). */
export async function refreshMarketNotes(brandId: string, confirm = false): Promise<FormState & { runId?: string; needsConfirm?: boolean }> {
  const member = await requireMember();
  try {
    const runId = await startMarketRun(member, brandId, sendEvent, { confirm });
    revalidatePath(`/brands/${brandId}`);
    return { done: "The Market agent is searching the web. This takes about a minute.", runId };
  } catch (err) {
    if (err instanceof RecentlyRefreshedError) return { error: err.message, needsConfirm: true };
    if (err instanceof StartRunError) return { error: err.message };
    console.error("[refreshMarketNotes]", err);
    return { error: "Couldn't start the Market agent. Nothing was started; try again." };
  }
}

