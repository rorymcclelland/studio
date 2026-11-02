import { randomUUID } from "node:crypto";
import { asUser } from "@/lib/db/scoped";
import { syncBrandContext } from "@/lib/context/sync";
import { parseBrandInput } from "@/lib/brands/schema";
import { sanitizeLogoSvg } from "@/lib/brands/svg";
import { DEMO_BRIEFS } from "./briefs";
import { generateDemoBrand } from "./generate";
import { insertDemoLanguages } from "@/lib/creative/languages";

export class DemoAlreadyLoadedError extends Error {}

export type Member = { userId: string; workspaceId: string };

export const DEMO_SEED = 2026;
const CHUNK = 2000;

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Adds the two simulated demo brands to the member's workspace, with their
 * catalogue, customers and orders, in one transaction: all or nothing
 * (S2-4 #5). Refuses if either demo brand is already there. No model calls.
 */
export async function loadDemoBrands(member: Member, opts: { refDate?: Date } = {}): Promise<string[]> {
  const refDate = opts.refDate ?? new Date();
  const datasets = DEMO_BRIEFS.map((b) => generateDemoBrand(b, { seed: DEMO_SEED, refDate }));

  try {
    return await load(member, datasets, refDate);
  } catch (err) {
    // Two presses at once: the second waits on the lock, then finds the brands
    // (or, if it raced past the check, hits the unique short name). Either way
    // the right answer is "already loaded" (review finding 7).
    if ((err as { code?: string }).code === "23505") {
      throw new DemoAlreadyLoadedError("The demo brands are already in this workspace.");
    }
    throw err;
  }
}

async function load(member: Member, datasets: ReturnType<typeof generateDemoBrand>[], refDate: Date): Promise<string[]> {
  return asUser(member.userId, async (tx) => {
    // One load at a time per workspace.
    await tx`select pg_advisory_xact_lock(hashtextextended(${member.workspaceId}::text, 7))`;
    const slugs = datasets.map((d) => d.kit.slug);
    const existing = await tx`
      select name from public.brands
      where workspace_id = ${member.workspaceId} and slug = any(${slugs})
      order by name`;
    if (existing.length) {
      throw new DemoAlreadyLoadedError(
        `The demo brands are already in this workspace (${existing.map((e) => e.name).join(" and ")}).`,
      );
    }

    const names: string[] = [];
    for (const d of datasets) {
      const parsed = parseBrandInput(d.kit);
      if (!parsed.ok) throw new Error(`Demo brief for ${d.kit.name} is invalid: ${JSON.stringify(parsed.fieldErrors)}`);
      const k = parsed.data;
      const brandId = randomUUID();
      const ws = member.workspaceId;
      await tx`insert into public.brands ${tx({
        id: brandId, workspace_id: ws, created_by: member.userId, is_simulated: true,
        data_as_of: refDate,
        name: k.name, slug: k.slug, description: k.description, category: k.category,
        tone_words: k.toneWords, voice_notes: k.voiceNotes, do_rules: k.doRules, dont_rules: k.dontRules,
        font_primary: k.fontPrimary, font_secondary: k.fontSecondary, logo_svg: sanitizeLogoSvg(d.kit.logoSvg),
        legal_lines: k.legalLines, banned_terms: k.bannedTerms, evidence_claims: k.evidenceClaims,
      })}`;
      await tx`update public.brands set palette = ${tx.json(k.palette)} where id = ${brandId}`;

      const productIds = d.products.map(() => randomUUID());
      await tx`insert into public.products ${tx(d.products.map((p, i) => ({
        id: productIds[i], workspace_id: ws, brand_id: brandId, name: p.name, category: p.category,
        price_pence: p.pricePence, description: p.description,
      })))}`;

      const customerIds = d.customers.map(() => randomUUID());
      for (const part of chunks(d.customers.map((c, i) => ({
        id: customerIds[i], workspace_id: ws, brand_id: brandId, external_ref: c.externalRef, region: c.region,
        age_band: c.ageBand, first_order_on: c.firstOrderOn, marketing_consent: c.marketingConsent,
      })))) await tx`insert into public.customers ${tx(part)}`;

      const orderIds = d.orders.map(() => randomUUID());
      for (const part of chunks(d.orders.map((o, i) => ({
        id: orderIds[i], workspace_id: ws, brand_id: brandId, customer_id: customerIds[o.customer],
        ordered_at: o.orderedAt, channel: o.channel,
      })))) await tx`insert into public.orders ${tx(part)}`;

      const lines = d.orders.flatMap((o, i) => o.lines.map((l) => ({
        workspace_id: ws, order_id: orderIds[i], product_id: productIds[l.product], quantity: l.quantity, price_pence: l.pricePence,
      })));
      for (const part of chunks(lines)) await tx`insert into public.order_lines ${tx(part)}`;

      await syncBrandContext(tx, brandId);
      // C7-2 (Q4): French, German and Spanish, with legal lines and banned terms written by Claude for the demo, marked so.
      await insertDemoLanguages(tx, member, brandId, k.slug);
      names.push(k.name);
    }
    return names;
  });
}
