import type { DemoBrief } from "./briefs";
import { makeRng, seedFrom } from "./rng";

// Pure, deterministic generator of simulated first-party data (S2-4). Same
// brief, seed and reference date, same output. No model calls (rule 5).

export type DemoCustomer = {
  externalRef: string;
  region: string;
  ageBand: string;
  firstOrderOn: string;
  marketingConsent: boolean;
};

export type DemoOrder = {
  customer: number; // index into customers
  orderedAt: string; // ISO timestamp
  channel: "web" | "app" | "store" | "marketplace";
  lines: { product: number; quantity: number; pricePence: number }[];
};

export type DemoData = {
  kit: DemoBrief["kit"];
  products: DemoBrief["products"];
  customers: DemoCustomer[];
  orders: DemoOrder[];
};

const MONTHS = 24;

function monthStart(ref: Date, monthsBack: number): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - monthsBack, 1));
}

export function generateDemoBrand(brief: DemoBrief, opts: { seed: number; refDate: Date }): DemoData {
  const rng = makeRng(seedFrom(brief.kit.slug, opts.seed));
  // Month 0 is 24 months ago; month 23 is the month containing the instant just
  // before refDate, so it always has some length, even when refDate is the
  // first of a month at midnight.
  const lastInstant = new Date(opts.refDate.getTime() - 1);
  const starts = Array.from({ length: MONTHS }, (_, i) => monthStart(lastInstant, MONTHS - 1 - i));
  const season = starts.map((d) => brief.monthWeights[d.getUTCMonth()]);
  // Gentle growth: newer months win slightly more new customers.
  const acquisition = season.map((w, i) => w * (0.75 + (0.5 * i) / (MONTHS - 1)));

  const pickDate = (month: number): Date => {
    const start = starts[month];
    const end = month === MONTHS - 1 ? opts.refDate : starts[month + 1];
    const span = end.getTime() - start.getTime();
    return new Date(start.getTime() + Math.floor(rng.next() * Math.max(span - 1, 1)));
  };

  const productWeights = brief.products.map((p) => p.weight);
  const productIdx = brief.products.map((_, i) => i);
  const customers: DemoCustomer[] = [];
  const orders: DemoOrder[] = [];

  const makeOrder = (customer: number, at: Date): DemoOrder => {
    const n = rng.weighted(brief.linesPerOrder.counts, brief.linesPerOrder.weights);
    const chosen = new Set<number>();
    while (chosen.size < Math.min(n, brief.products.length)) chosen.add(rng.weighted(productIdx, productWeights));
    return {
      customer,
      orderedAt: at.toISOString(),
      channel: rng.weighted(brief.channels.names, brief.channels.weights),
      lines: [...chosen].sort((a, b) => a - b).map((p) => ({
        product: p,
        quantity: rng.next() < 0.88 ? 1 : 2,
        pricePence: brief.products[p].pricePence,
      })),
    };
  };

  const monthIdx = starts.map((_, i) => i);
  for (let c = 0; c < brief.customers; c++) {
    const first = rng.weighted(monthIdx, acquisition);
    const firstAt = pickDate(first);
    // Exponential lifetime in whole months.
    const lifetime = Math.max(0, Math.round(-brief.meanLifetimeMonths * Math.log(1 - rng.next())));
    customers.push({
      externalRef: `${brief.refPrefix}-${String(c + 1).padStart(5, "0")}`,
      region: rng.weighted(brief.regions.names, brief.regions.weights),
      ageBand: rng.weighted(brief.ageBands.names, brief.ageBands.weights),
      firstOrderOn: firstAt.toISOString().slice(0, 10),
      marketingConsent: rng.next() < brief.consentRate,
    });
    orders.push(makeOrder(c, firstAt));
    const lastActive = Math.min(MONTHS - 1, first + lifetime);
    for (let m = first + 1; m <= lastActive; m++) {
      if (rng.next() < brief.monthlyOrderRate * season[m]) orders.push(makeOrder(c, pickDate(m)));
    }
  }

  orders.sort((a, b) => (a.orderedAt < b.orderedAt ? -1 : a.orderedAt > b.orderedAt ? 1 : a.customer - b.customer));
  return { kit: brief.kit, products: brief.products, customers, orders };
}
