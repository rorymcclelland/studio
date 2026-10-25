import { asUser } from "@/lib/db/scoped";

// The one way agents and screens read the Business Context store (S2-5).

export type ContextKind = "brand_voice" | "brand_rule" | "legal" | "product" | "segment" | "insight" | "result";

export type ContextHit = {
  id: string;
  brandId: string;
  kind: ContextKind;
  title: string;
  body: string;
  source: string;
  rank: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<ContextKind>(["brand_voice", "brand_rule", "legal", "product", "segment", "insight", "result"]);

/**
 * Ranked full-text search over the user's workspace. websearch_to_tsquery
 * accepts any text without syntax errors, so hostile or odd input just
 * returns fewer results (S2-5 #5).
 */
export async function searchContext(
  userId: string,
  opts: { query: string; brandId?: string; kinds?: ContextKind[]; limit?: number },
): Promise<ContextHit[]> {
  const query = opts.query.trim().slice(0, 200);
  if (!query) return [];
  if (opts.brandId && !UUID.test(opts.brandId)) return [];
  const kinds = (opts.kinds ?? []).filter((k) => KINDS.has(k));
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await asUser(userId, (tx) => tx`
    select id, brand_id, kind, title, body, source, ts_rank(search, q) as rank
    from public.context_items, websearch_to_tsquery('english', ${query}) q
    where search @@ q
      ${opts.brandId ? tx`and brand_id = ${opts.brandId}` : tx``}
      ${kinds.length ? tx`and kind = any(${kinds})` : tx``}
    order by rank desc, updated_at desc
    limit ${limit}`);
  return rows.map((r) => ({
    id: r.id, brandId: r.brand_id, kind: r.kind, title: r.title, body: r.body, source: r.source, rank: Number(r.rank),
  }));
}

/** Every item for one brand, grouped by kind, for the brand overview. */
export async function listContext(userId: string, brandId: string): Promise<ContextHit[]> {
  if (!UUID.test(brandId)) return [];
  const rows = await asUser(userId, (tx) => tx`
    select id, brand_id, kind, title, body, source, 0 as rank from public.context_items
    where brand_id = ${brandId} order by kind, title`);
  return rows.map((r) => ({ id: r.id, brandId: r.brand_id, kind: r.kind, title: r.title, body: r.body, source: r.source, rank: 0 }));
}
