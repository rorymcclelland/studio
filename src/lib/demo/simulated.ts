import "server-only";
import { asUser } from "@/lib/db/scoped";
import { syncBrandContext } from "@/lib/context/sync";
import { parseBrandInput } from "@/lib/brands/schema";
import { insertBrandData, type Member } from "./load";
import { parseDataProfile, simulateProfile } from "./profile";

// Sprint 10b, D-3: simulated customers, orders and products for a person's own
// brand, from a short profile. One transaction, through asUser() in the
// reader's workspace (rule 7). No model calls (rule 5). The brand becomes
// is_simulated, so its data is labelled as simulated everywhere (rule 1).

export class SimulatedDataError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOT_IN_WORKSPACE = "That brand isn't in your workspace.";
export const HAS_CUSTOMERS = "This brand already has customers, so no simulated data can be added.";

export async function generateSimulatedData(
  member: Member,
  brandId: string,
  raw: unknown,
  opts: { now?: Date } = {},
): Promise<{ products: number; customers: number; orders: number; asOf: string }> {
  const parsed = parseDataProfile(raw);
  if (!parsed.ok) throw new SimulatedDataError("Some fields need changing. Nothing was saved.", parsed.fieldErrors);
  if (!UUID.test(brandId)) throw new SimulatedDataError(NOT_IN_WORKSPACE);
  const profile = parsed.data;

  return asUser(member.userId, async (tx) => {
    // One generation at a time per brand: a second press waits, then finds the customers.
    await tx`select pg_advisory_xact_lock(hashtextextended(${brandId}::text, 8))`;
    const [brand] = await tx`select * from public.brands where id = ${brandId} and workspace_id = ${member.workspaceId} for update`;
    if (!brand) throw new SimulatedDataError(NOT_IN_WORKSPACE);
    const [{ n }] = await tx`select count(*)::int as n from public.customers where brand_id = ${brandId}`;
    if (n > 0) throw new SimulatedDataError(HAS_CUSTOMERS);

    const kit = parseBrandInput({
      name: brand.name, slug: brand.slug, description: brand.description, category: brand.category,
      toneWords: brand.tone_words, voiceNotes: brand.voice_notes, doRules: brand.do_rules, dontRules: brand.dont_rules,
      palette: brand.palette, fontPrimary: brand.font_primary, fontSecondary: brand.font_secondary,
      legalLines: brand.legal_lines, bannedTerms: brand.banned_terms, evidenceClaims: brand.evidence_claims, ownNames: brand.own_names,
    });
    if (!kit.ok) throw new Error(`The brand's kit is invalid: ${JSON.stringify(kit.fieldErrors)}`);

    const { data, refDate } = simulateProfile(profile, kit.data, { brandId, now: opts.now ?? new Date() });
    await insertBrandData(tx, member.workspaceId, brandId, data);
    await tx`update public.brands set is_simulated = true, data_as_of = ${refDate} where id = ${brandId}`;
    await syncBrandContext(tx, brandId);
    return { products: data.products.length, customers: data.customers.length, orders: data.orders.length, asOf: refDate.toISOString() };
  });
}
