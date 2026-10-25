import { asUser } from "@/lib/db/scoped";

// A brand's catalogue, read-only, for the brand overview (S2-3). Products are
// created by the demo generator; adding them by hand is a later item.

export type Product = {
  id: string;
  name: string;
  category: string;
  pricePence: number;
  description: string;
  active: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One brand's products, by category then name. Empty for another workspace's brand. */
export async function listProducts(userId: string, brandId: string): Promise<Product[]> {
  if (!UUID.test(brandId)) return [];
  const rows = await asUser(userId, (tx) => tx`
    select id, name, category, price_pence, description, active from public.products
    where brand_id = ${brandId} order by category, name`);
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    category: r.category as string,
    pricePence: Number(r.price_pence),
    description: (r.description as string | null) ?? "",
    active: r.active as boolean,
  }));
}
