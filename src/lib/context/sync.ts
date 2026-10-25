import type { Tx } from "@/lib/db/scoped";

// Keeps a brand's system-maintained context items in step with its kit,
// products and customer data (S2-5). Items are upserted by source_ref, so
// re-syncing updates them in place; items whose source has gone are removed.
// Agent- and person-written items are never touched.

type Item = { kind: string; title: string; body: string; source: string; sourceRef: string; tags?: string[] };

const pct = (n: number, d: number) => (d === 0 ? "0%" : `${((100 * n) / d).toFixed(1)}%`);
const num = (n: number) => n.toLocaleString("en-GB");
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function syncBrandContext(tx: Tx, brandId: string): Promise<void> {
  const [brand] = await tx`select * from public.brands where id = ${brandId}`;
  if (!brand) return;
  const simulated = brand.is_simulated ? " Simulated data." : "";
  // Windows count back from when the data was made (review finding 5).
  const asOf: Date = brand.data_as_of ? new Date(brand.data_as_of) : new Date();
  const asOfNote = brand.data_as_of ? ` As of ${asOf.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.` : "";
  const items: Item[] = [];

  // Kit: voice, rules, legal.
  const tone = (brand.tone_words as string[]).join(", ");
  if (tone || brand.voice_notes) {
    items.push({ kind: "brand_voice", title: `${brand.name} tone of voice`, body: [tone && `Tone: ${tone}.`, brand.voice_notes].filter(Boolean).join(" "), source: "Brand kit", sourceRef: "voice" });
  }
  (brand.do_rules as string[]).forEach((r, i) => items.push({ kind: "brand_rule", title: `Do: ${r.slice(0, 190)}`, body: r, source: "Brand kit", sourceRef: `rule:do:${i}`, tags: ["do"] }));
  (brand.dont_rules as string[]).forEach((r, i) => items.push({ kind: "brand_rule", title: `Don't: ${r.slice(0, 186)}`, body: r, source: "Brand kit", sourceRef: `rule:dont:${i}`, tags: ["dont"] }));
  (brand.legal_lines as string[]).forEach((l, i) => items.push({ kind: "legal", title: "Required legal line", body: l, source: "Brand kit", sourceRef: `legal:line:${i}` }));
  if ((brand.banned_terms as string[]).length) {
    items.push({ kind: "legal", title: "Banned terms", body: `Never use: ${(brand.banned_terms as string[]).join("; ")}.`, source: "Brand kit", sourceRef: "legal:banned" });
  }
  if ((brand.evidence_claims as string[]).length) {
    items.push({ kind: "legal", title: "Claims that need evidence", body: `Only use with evidence: ${(brand.evidence_claims as string[]).join("; ")}.`, source: "Brand kit", sourceRef: "legal:evidence" });
  }

  // Products.
  const products = await tx`select id, name, category, price_pence, description, active from public.products where brand_id = ${brandId} order by name`;
  for (const p of products) {
    const price = `£${(p.price_pence / 100).toFixed(2)}`;
    items.push({ kind: "product", title: p.name, body: `${p.category}. ${price}. ${p.description}${p.active ? "" : " No longer sold."}`.trim(), source: "Products", sourceRef: `product:${p.id}`, tags: [p.category] });
  }

  // Customer summaries, computed from orders.
  const [base] = await tx`
    with last as (select customer_id, max(ordered_at) as last_at, count(*) as n from public.orders where brand_id = ${brandId} group by customer_id)
    select
      (select count(*)::int from public.customers where brand_id = ${brandId}) as customers,
      (select count(*)::int from public.customers where brand_id = ${brandId} and marketing_consent) as consenting,
      (select count(*)::int from last where last_at < ${asOf} - interval '12 months') as lapsed,
      (select count(*)::int from last where n >= 2) as repeaters,
      (select count(*)::int from public.orders where brand_id = ${brandId}
         and ordered_at >= date_trunc('month', ${asOf}::timestamptz - interval '1 millisecond') - interval '23 months') as orders`;
  if (base.customers > 0) {
    items.push({ kind: "insight", title: `${brand.name} customer base`, body: `${num(base.customers)} customers and ${num(base.orders)} orders in the 24 months to the data date; ${pct(base.consenting, base.customers)} have agreed to marketing.${asOfNote}${simulated}`, source: "Customer summary", sourceRef: "insight:base" });
    items.push({ kind: "segment", title: "Lapsed customers (no order in 12 months)", body: `${num(base.lapsed)} of ${num(base.customers)} customers (${pct(base.lapsed, base.customers)}) have not ordered in the 12 months to the data date.${asOfNote}${simulated}`, source: "Customer summary", sourceRef: "segment:lapsed", tags: ["lapsed", "win-back"] });
    items.push({ kind: "segment", title: "Repeat customers (two or more orders)", body: `${num(base.repeaters)} customers (${pct(base.repeaters, base.customers)}) have ordered more than once.${simulated}`, source: "Customer summary", sourceRef: "segment:repeat", tags: ["loyal"] });

    const regions = await tx`select region, count(*)::int as n from public.customers where brand_id = ${brandId} group by region order by n desc, region limit 3`;
    items.push({ kind: "insight", title: "Where customers live", body: `Largest regions: ${regions.map((r) => `${r.region} (${pct(r.n, base.customers)})`).join(", ")}.${simulated}`, source: "Customer summary", sourceRef: "insight:regions" });

    const ages = await tx`select age_band, count(*)::int as n from public.customers where brand_id = ${brandId} group by age_band order by age_band`;
    items.push({ kind: "insight", title: "Customer ages", body: `By age band: ${ages.map((r) => `${r.age_band} ${pct(r.n, base.customers)}`).join(", ")}.${simulated}`, source: "Customer summary", sourceRef: "insight:ages" });

    const months = await tx`select extract(month from ordered_at)::int as m, count(*)::int as n from public.orders where brand_id = ${brandId} group by 1 order by n desc limit 3`;
    items.push({ kind: "insight", title: "Seasonality", body: `Busiest months for orders: ${months.map((r) => MONTH[r.m - 1]).join(", ")}.${simulated}`, source: "Customer summary", sourceRef: "insight:seasonality", tags: ["seasonality"] });

    const best = await tx`
      select p.id, p.name, sum(l.quantity)::int as units from public.order_lines l join public.products p on p.id = l.product_id
      where p.brand_id = ${brandId} group by p.id, p.name order by units desc, p.name limit 3`;
    if (best.length) {
      items.push({ kind: "insight", title: "Best-sellers", body: `Most units sold: ${best.map((r) => `${r.name} (${num(r.units)})`).join(", ")}.${simulated}`, source: "Customer summary", sourceRef: "insight:best-sellers" });
    }
  }

  // Upsert, then remove system items whose source no longer exists. Text is
  // capped to the column limits, so a valid kit can always be saved (finding 3).
  const refs = items.map((i) => i.sourceRef);
  for (const raw of items) {
    const i = { ...raw, title: raw.title.slice(0, 200), body: raw.body.length > 4000 ? `${raw.body.slice(0, 3997)}...` : raw.body };
    await tx`
      insert into public.context_items (workspace_id, brand_id, kind, title, body, source, source_ref, tags, created_by_kind)
      values (${brand.workspace_id}, ${brandId}, ${i.kind}, ${i.title}, ${i.body}, ${i.source}, ${i.sourceRef}, ${i.tags ?? []}, 'system')
      on conflict (brand_id, source_ref) do update set
        kind = excluded.kind, title = excluded.title, body = excluded.body, source = excluded.source, tags = excluded.tags
      where (public.context_items.title, public.context_items.body, public.context_items.tags)
        is distinct from (excluded.title, excluded.body, excluded.tags)`;
  }
  await tx`delete from public.context_items where brand_id = ${brandId} and created_by_kind = 'system' and not (source_ref = any(${refs}))`;

  // Best-sellers mention the products they name.
  await tx`
    insert into public.context_edges (workspace_id, from_item, to_item, relation)
    select ${brand.workspace_id}, b.id, p.id, 'mentions'
    from public.context_items b
    join public.context_items p on p.brand_id = b.brand_id and p.kind = 'product' and position(p.title in b.body) > 0
    where b.brand_id = ${brandId} and b.source_ref = 'insight:best-sellers'
    on conflict do nothing`;
}
