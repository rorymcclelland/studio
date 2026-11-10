"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { generateSimulatedData, SimulatedDataError } from "@/lib/demo/simulated";

export type SimulatedDataState = { error: string; fieldErrors: Record<string, string> } | null;

/**
 * D-3: makes simulated products, customers and orders for a brand with none,
 * from a short profile, then opens its Products and data tab. No AI (rule 5);
 * the data is labelled as simulated everywhere (rule 1).
 */
export async function generateData(brandId: string, profile: unknown): Promise<SimulatedDataState> {
  const member = await requireMember();
  const started = Date.now();
  try {
    const done = await generateSimulatedData(member, brandId, profile);
    console.log(`[generateData] ${done.customers} customers and ${done.orders} orders in ${Date.now() - started} ms`);
  } catch (err) {
    if (err instanceof SimulatedDataError) {
      const fields = Object.keys(err.fieldErrors).length > 0;
      return { error: fields ? err.message : `${err.message} Nothing was saved.`, fieldErrors: err.fieldErrors };
    }
    console.error("[generateData] couldn't generate the data", { brandId }, err);
    return { error: "Couldn't generate the data. Nothing was saved; try again.", fieldErrors: {} };
  }
  revalidatePath(`/brands/${brandId}`);
  revalidatePath("/brands");
  redirect(`/brands/${brandId}?tab=products`);
}
