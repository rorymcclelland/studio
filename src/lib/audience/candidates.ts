import type { Tx } from "@/lib/db/scoped";

// S3-1: candidate segments, counted in code. The Audience agent only names and
// describes them; every size, share and trait shown comes from here (rule 1).

export const MIN_SEGMENT_SIZE = 50;

export type Share = { name: string; share: number };

export type Candidate = {
  key: string;
  /** Plain definition, for people and for the model. */
  definition: string;
  size: number;
  /** Share of all customers, 0 to 1. */
  share: number;
  traits: {
    regions: Share[];
    ageBands: Share[];
    categories: Share[];
    /** Median order value in pence, over the segment's orders. */
    medianOrderPence: number | null;
    consentShare: number;
  };
};

export type CandidateSet = {
  brandId: string;
  asOf: string;
  customers: number;
  candidates: Candidate[];
  /** Candidates under MIN_SEGMENT_SIZE customers: "too small to target". */
  tooSmall: { key: string; definition: string; size: number }[];
};

type Row = {
  id: string;
  region: string;
  age_band: string;
  consent: boolean;
  first_at: Date | null;
  last_at: Date | null;
  n: number;
  spend: number;
  top_category: string | null;
  order_totals: number[];
};

const DAY = 86_400_000;

function monthsBefore(d: Date, months: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() - months);
  return x;
}

function topShares(rows: Row[], pick: (r: Row) => string, n: number): Share[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = pick(r);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, c]) => ({ name, share: rows.length ? c / rows.length : 0 }));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Computes the candidate segments for one brand, measured from its data date. */
export async function computeCandidates(tx: Tx, brandId: string): Promise<CandidateSet | null> {
  const [brand] = await tx`select id, data_as_of from public.brands where id = ${brandId}`;
  if (!brand) return null;
  const asOf: Date = brand.data_as_of ? new Date(brand.data_as_of) : new Date();

  // Right after a demo load the tables have no statistics yet, and the planner
  // can pick nested loops over thousands of orders (minutes, not milliseconds).
  // Hash joins are right for this whole-brand scan either way.
  await tx`set local enable_nestloop = off`;
  const rows = (await tx`
    -- Materialised so each CTE is computed once, whatever the planner's statistics say
    -- (freshly loaded tables have none, and a nested-loop plan took minutes).
    with totals as materialized (
      select o.id, o.customer_id, o.ordered_at, coalesce(sum(l.quantity * l.price_pence), 0)::int as total
      from public.orders o left join public.order_lines l on l.order_id = o.id
      where o.brand_id = ${brandId} and o.ordered_at <= ${asOf}
      group by o.id
    ), cat as materialized (
      select o.customer_id, p.category, sum(l.quantity)::int as units
      from public.orders o join public.order_lines l on l.order_id = o.id join public.products p on p.id = l.product_id
      where o.brand_id = ${brandId} and o.ordered_at <= ${asOf}
      group by o.customer_id, p.category
    ), topcat as materialized (
      select distinct on (customer_id) customer_id, category from cat order by customer_id, units desc, category
    )
    select c.id, c.region, c.age_band, c.marketing_consent as consent,
      min(t.ordered_at) as first_at, max(t.ordered_at) as last_at, count(t.id)::int as n,
      coalesce(sum(t.total), 0)::int as spend, tc.category as top_category,
      coalesce(array_agg(t.total) filter (where t.id is not null), '{}') as order_totals
    from public.customers c
    left join totals t on t.customer_id = c.id
    left join topcat tc on tc.customer_id = c.id
    where c.brand_id = ${brandId}
    group by c.id, tc.category`) as unknown as Row[];

  const customers = rows.length;
  const buyers = rows.filter((r) => r.n > 0);
  const t12 = monthsBefore(asOf, 12).getTime();
  const t6 = monthsBefore(asOf, 6).getTime();
  const t90 = asOf.getTime() - 90 * DAY;

  // Top fifth by spend among customers with orders.
  const bySpend = [...buyers].sort((a, b) => b.spend - a.spend || a.id.localeCompare(b.id));
  const topFifth = new Set(bySpend.slice(0, Math.ceil(bySpend.length / 5)).map((r) => r.id));

  const defs: { key: string; definition: string; test: (r: Row) => boolean }[] = [
    { key: "lapsed", definition: "Customers whose last order was 12 months or more before the data date.", test: (r) => !!r.last_at && r.last_at.getTime() < t12 },
    { key: "at-risk", definition: "Customers whose last order was between 6 and 12 months before the data date.", test: (r) => !!r.last_at && r.last_at.getTime() >= t12 && r.last_at.getTime() < t6 },
    { key: "new", definition: "Customers whose first order was in the 90 days to the data date.", test: (r) => !!r.first_at && r.first_at.getTime() >= t90 },
    { key: "high-value", definition: "Customers with two or more orders who are in the top fifth by total spend.", test: (r) => r.n >= 2 && topFifth.has(r.id) },
  ];

  // One segment per top-three category by units sold.
  const [catRows] = [
    await tx`
      select p.category, sum(l.quantity)::int as units
      from public.order_lines l join public.products p on p.id = l.product_id join public.orders o on o.id = l.order_id
      where p.brand_id = ${brandId} and o.ordered_at <= ${asOf}
      group by p.category order by units desc, p.category limit 3`,
  ];
  for (const c of catRows) {
    const category = c.category as string;
    defs.push({
      key: `category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      definition: `Customers whose most-bought category is ${category}.`,
      test: (r) => r.top_category === category,
    });
  }
  defs.push(
    { key: "consenting", definition: "Customers who have opted in to marketing.", test: (r) => r.consent },
    { key: "not-consenting", definition: "Customers who have not opted in to marketing; reachable only through paid media.", test: (r) => !r.consent },
  );

  const candidates: Candidate[] = [];
  const tooSmall: CandidateSet["tooSmall"] = [];
  for (const d of defs) {
    const members = rows.filter(d.test);
    if (members.length < MIN_SEGMENT_SIZE) {
      tooSmall.push({ key: d.key, definition: d.definition, size: members.length });
      continue;
    }
    candidates.push({
      key: d.key,
      definition: d.definition,
      size: members.length,
      share: customers ? members.length / customers : 0,
      traits: {
        regions: topShares(members, (r) => r.region, 3),
        ageBands: topShares(members, (r) => r.age_band, 2),
        categories: topShares(members.filter((r) => r.top_category), (r) => r.top_category ?? "", 3),
        medianOrderPence: median(members.flatMap((r) => r.order_totals.map(Number))),
        consentShare: members.filter((r) => r.consent).length / members.length,
      },
    });
  }
  return { brandId, asOf: asOf.toISOString(), customers, candidates, tooSmall };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/** The facts line saved with each segment: always from code, never from the model. */
export function candidateFacts(c: Candidate, customers: number): string {
  const t = c.traits;
  const parts = [
    `${c.size.toLocaleString("en-GB")} of ${customers.toLocaleString("en-GB")} customers (${pct(c.share)}).`,
    c.definition,
    t.regions.length ? `Top regions: ${t.regions.map((r) => `${r.name} ${pct(r.share)}`).join(", ")}.` : "",
    t.ageBands.length ? `Main age bands: ${t.ageBands.map((r) => `${r.name} ${pct(r.share)}`).join(", ")}.` : "",
    t.categories.length ? `Most-bought categories: ${t.categories.map((r) => `${r.name} ${pct(r.share)}`).join(", ")}.` : "",
    t.medianOrderPence !== null ? `Median order £${(t.medianOrderPence / 100).toFixed(2)}.` : "",
    `${pct(t.consentShare)} have agreed to marketing.`,
  ];
  return parts.filter(Boolean).join(" ");
}
