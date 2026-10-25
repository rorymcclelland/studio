import { asUser } from "@/lib/db/scoped";

// Customer summary for the brand overview (S2-3). Figures come straight from
// the brand's customers and orders; screens label them simulated when the
// brand is (rule 1).

export type CustomerSummary = {
  customers: number;
  orders: number;
  repeatRate: number; // share of customers with two or more orders
  lapsed: number; // customers with no order in the last 12 months
  byRegion: { label: string; count: number }[];
  byAgeBand: { label: string; count: number }[];
  ordersByMonth: { month: string; count: number }[]; // "2026-03", last 24 months, oldest first
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getCustomerSummary(userId: string, brandId: string): Promise<CustomerSummary | null> {
  if (!UUID.test(brandId)) return null;
  return asUser(userId, async (tx) => {
    const [brand] = await tx`select id from public.brands where id = ${brandId}`;
    if (!brand) return null;
    const [base] = await tx`
      with per as (select customer_id, count(*) as n, max(ordered_at) as last_at from public.orders where brand_id = ${brandId} group by customer_id)
      select
        (select count(*)::int from public.customers where brand_id = ${brandId}) as customers,
        (select count(*)::int from public.orders where brand_id = ${brandId}) as orders,
        (select count(*)::int from per where n >= 2) as repeaters,
        (select count(*)::int from per where last_at < now() - interval '12 months') as lapsed`;
    const byRegion = await tx`select region as label, count(*)::int as count from public.customers where brand_id = ${brandId} group by region order by count desc, region`;
    const byAgeBand = await tx`select age_band as label, count(*)::int as count from public.customers where brand_id = ${brandId} group by age_band order by age_band`;
    const ordersByMonth = await tx`
      with months as (
        select to_char(date_trunc('month', now() at time zone 'UTC') - make_interval(months => g), 'YYYY-MM') as month
        from generate_series(23, 0, -1) g)
      select m.month, coalesce(count(o.id), 0)::int as count
      from months m left join public.orders o
        on o.brand_id = ${brandId} and to_char(o.ordered_at at time zone 'UTC', 'YYYY-MM') = m.month
      group by m.month order by m.month`;
    return {
      customers: base.customers,
      orders: base.orders,
      repeatRate: base.customers ? base.repeaters / base.customers : 0,
      lapsed: base.lapsed,
      byRegion: byRegion.map((r) => ({ label: r.label, count: r.count })),
      byAgeBand: byAgeBand.map((r) => ({ label: r.label, count: r.count })),
      ordersByMonth: ordersByMonth.map((r) => ({ month: r.month, count: r.count })),
    };
  });
}
