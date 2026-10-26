import type { Tx } from "@/lib/db/scoped";
import type { EvidenceItem, KitLists } from "./checks";

// S3-2: what the Brief agent may use. Gathered in code, tagged C1..Cn for the
// prompt; the model cites tags and code maps them back to item ids.

export const MAX_CONTEXT_ITEMS = 40;
const MAX_PRODUCTS = 10;
const BODY_CHARS = 600;

export type GatheredItem = EvidenceItem & { id: string };

export type Gathered = {
  brand: { id: string; name: string; voice: string; doRules: string[]; isSimulated: boolean };
  kit: KitLists;
  items: GatheredItem[];
};

// If a big kit would overflow the limit, rules are the last to be dropped after results.
// Market notes (results) come straight after segments (S4-3).
const KIND_ORDER = ["brand_voice", "segment", "result", "insight", "legal", "brand_rule", "product"];

/** Words from the objective, safe to OR together in a full-text query. */
export function objectiveWords(objective: string): string[] {
  return [...new Set(objective.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((w) => w.length > 2).slice(0, 20);
}

export async function gatherContext(tx: Tx, brandId: string, objective: string): Promise<Gathered | null> {
  const [b] = await tx`select * from public.brands where id = ${brandId}`;
  if (!b) return null;

  const fixed = await tx`
    select id, kind, title, body from public.context_items
    where brand_id = ${brandId} and kind <> 'product'
    order by array_position(${KIND_ORDER}::text[], kind), (created_by_kind = 'system') desc, title`;

  const words = objectiveWords(objective);
  const products = await tx`
    select id, kind, title, body,
      ${words.length ? tx`ts_rank(search, websearch_to_tsquery('english', ${words.join(" or ")}))` : tx`0`} as rank
    from public.context_items
    where brand_id = ${brandId} and kind = 'product'
    order by rank desc, title
    limit ${MAX_PRODUCTS}`;

  // Products keep their places; the kit, segments and insights fill the rest.
  const rows = [...fixed.slice(0, MAX_CONTEXT_ITEMS - products.length), ...products];
  const items: GatheredItem[] = rows.map((r, i) => ({
    ref: `C${i + 1}`,
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    text: (r.body as string).length > BODY_CHARS ? `${(r.body as string).slice(0, BODY_CHARS - 3)}...` : (r.body as string),
  }));

  return {
    brand: {
      id: b.id,
      name: b.name,
      voice: [(b.tone_words as string[]).join(", "), b.voice_notes as string].filter(Boolean).join(". ").slice(0, 2500),
      doRules: b.do_rules as string[],
      isSimulated: b.is_simulated as boolean,
    },
    kit: {
      realNames: await realNamesFor(tx, brandId),
      legalLines: b.legal_lines as string[],
      bannedTerms: b.banned_terms as string[],
      dontRules: b.dont_rules as string[],
      evidenceClaims: b.evidence_claims as string[],
    },
    items,
  };
}

/** The brand's whole context as evidence items keyed by id, for checking stored briefs and hand edits. */
export async function contextById(tx: Tx, brandId: string): Promise<EvidenceItem[]> {
  const rows = await tx`select id, kind, title, body from public.context_items where brand_id = ${brandId}`;
  return rows.map((r) => ({ ref: r.id as string, kind: r.kind as string, title: r.title as string, text: r.body as string }));
}

/** The real companies the brand's market notes name (S4-3, rule 2). */
export async function realNamesFor(tx: Tx, brandId: string): Promise<string[]> {
  const rows = await tx`
    select distinct jsonb_array_elements_text(coalesce(meta -> 'names', '[]'::jsonb)) as name
    from public.context_items where brand_id = ${brandId} and kind = 'result'`;
  return rows.map((r) => r.name as string).filter((n) => n.trim().length >= 2);
}

