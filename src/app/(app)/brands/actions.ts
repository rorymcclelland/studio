"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/session";
import { BrandInputError, getBrand, updateBrand } from "@/lib/brands/repo";
import type { BrandInput } from "@/lib/brands/schema";
import { DemoAlreadyLoadedError, loadDemoBrands } from "@/lib/demo/load";
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
