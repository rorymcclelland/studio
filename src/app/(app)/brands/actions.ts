"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { BrandInputError, getBrand, updateBrand } from "@/lib/brands/repo";
import type { BrandInput } from "@/lib/brands/schema";
import { DemoAlreadyLoadedError, loadDemoBrands } from "@/lib/demo/load";
import { createRun, StartRunError } from "@/lib/agents/runs";
import { removeContextItem } from "@/lib/context/store";
import { RecentlyRefreshedError, startMarketRun } from "@/lib/strategy/market";
import { LogoError, PNG_MAX_BYTES, removeBrandLogo, uploadBrandLogo } from "@/lib/brands/logo-upload";
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
    // The logo is kept as it is (SVG or PNG): it changes only through an upload (F-10, uploadBrandLogo).
    const saved = await updateBrand(member, brandId, draft);
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


export type LogoState =
  | { ok: true; done: string; logo: { kind: "svg"; svg: string } | { kind: "png"; src: string; width: number; height: number } | null }
  | { ok: false; error: string };

/** F-10: uploads a brand's logo (SVG up to 200 KB, PNG up to 1 MB). A refusal gives the reason, and nothing is stored. */
export async function uploadLogo(brandId: string, form: FormData): Promise<LogoState> {
  const member = await requireMember();
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an SVG or PNG file first." };
  if (file.size > PNG_MAX_BYTES) return { ok: false, error: "The file is too large: an SVG can be 200 KB and a PNG 1 MB at most." };
  try {
    const logo = await uploadBrandLogo(member, brandId, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidatePath(`/brands/${brandId}`);
    revalidatePath(`/brands/${brandId}/edit`);
    revalidatePath("/brands");
    return {
      ok: true,
      done: logo.kind === "svg" ? "Logo uploaded. New ads will use it." : `Logo uploaded (${logo.width} × ${logo.height} PNG). New ads will use it.`,
      logo: logo.kind === "svg" ? logo : { kind: "png", src: logo.src, width: logo.width, height: logo.height },
    };
  } catch (err) {
    if (err instanceof LogoError) return { ok: false, error: `${err.message} Nothing was changed.` };
    console.error("[uploadLogo]", { brandId }, err);
    return { ok: false, error: "Couldn't upload the logo. Nothing was changed; try again." };
  }
}

/** F-10: removes a brand's logo. Ads already made keep the logo they were drawn with. */
export async function removeLogo(brandId: string): Promise<LogoState> {
  const member = await requireMember();
  const removed = await removeBrandLogo(member, brandId);
  if (!removed) return { ok: false, error: "This brand isn't in your workspace any more, so nothing was changed." };
  revalidatePath(`/brands/${brandId}`);
  revalidatePath(`/brands/${brandId}/edit`);
  revalidatePath("/brands");
  return { ok: true, done: "Logo removed. Ads already made keep the logo they were drawn with.", logo: null };
}
