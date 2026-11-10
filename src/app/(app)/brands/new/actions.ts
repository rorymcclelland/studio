"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { BrandInputError, createBrand } from "@/lib/brands/repo";
import { parseNewBrand } from "@/lib/brands/schema";

const REFUSED = "Some fields need changing. Nothing was saved.";

export type NewBrandState = { error: string; fieldErrors: Record<string, string> } | null;

/**
 * D-1: starts a person's own brand in their workspace (rule 7), neither
 * fictional nor simulated, then opens its kit editor. Nothing is saved unless
 * every field is valid.
 */
export async function createNewBrand(draft: { name: string; slug: string; category: string; description: string }): Promise<NewBrandState> {
  const member = await requireMember();
  const parsed = parseNewBrand(draft);
  if (!parsed.ok) return { error: REFUSED, fieldErrors: parsed.fieldErrors };
  let id: string;
  try {
    id = await createBrand(member, parsed.data);
  } catch (err) {
    if (err instanceof BrandInputError) return { error: REFUSED, fieldErrors: err.fieldErrors };
    console.error("[createNewBrand] couldn't create the brand", err);
    return { error: "Couldn't create the brand. Nothing was saved; try again.", fieldErrors: {} };
  }
  revalidatePath("/brands");
  revalidatePath("/campaigns");
  redirect(`/brands/${id}/edit`);
}
