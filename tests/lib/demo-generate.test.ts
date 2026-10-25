// S2-4 test cases 1 to 4 and 7: the deterministic demo-data generator.
import { describe, expect, it } from "vitest";
import { DEMO_BRIEFS } from "@/lib/demo/briefs";
import { generateDemoBrand } from "@/lib/demo/generate";
import { parseBrandInput } from "@/lib/brands/schema";
import { sanitizeLogoSvg } from "@/lib/brands/svg";
import { DEMO_SEED } from "@/lib/demo/load";

const REF = new Date("2026-10-25T00:00:00Z");
// The app loads with DEMO_SEED on whatever day the button is pressed, so the
// criteria are checked for that seed on every week of a year (review finding 1).
const LOAD_DATES = Array.from({ length: 53 }, (_, w) => new Date(Date.UTC(2026, 9, 25 + 7 * w)));

function lapsedShare(data: ReturnType<typeof generateDemoBrand>, ref: Date) {
  const lastOrder = new Map<number, string>();
  for (const o of data.orders) {
    const prev = lastOrder.get(o.customer);
    if (!prev || o.orderedAt > prev) lastOrder.set(o.customer, o.orderedAt);
  }
  const cutoff = new Date(ref);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  return [...lastOrder.values()].filter((d) => new Date(d) < cutoff).length / data.customers.length;
}

function peakMonth(data: ReturnType<typeof generateDemoBrand>) {
  const byMonth = new Array(12).fill(0);
  for (const o of data.orders) byMonth[new Date(o.orderedAt).getUTCMonth()]++;
  return byMonth.indexOf(Math.max(...byMonth)) + 1;
}

// Real brands in the two categories (and a few general ones). None may appear.
const DENY = [
  "patagonia", "north face", "arc'teryx", "arcteryx", "berghaus", "montane", "columbia", "rab",
  "mountain warehouse", "jack wolfskin", "fjallraven", "regatta", "craghoppers", "salomon",
  "monzo", "revolut", "starling", "barclays", "hsbc", "lloyds", "natwest", "nationwide", "santander",
  "wise", "klarna", "paypal", "chip", "plum", "moneybox", "nutmeg", "tally", "chase", "visa", "mastercard",
  "amazon", "google", "apple", "nike", "adidas",
];

describe("demo data generator", () => {
  for (const brief of DEMO_BRIEFS) {
    describe(brief.kit.name, () => {
      const data = generateDemoBrand(brief, { seed: DEMO_SEED, refDate: REF });
      const sweep = LOAD_DATES.map((ref) => ({ ref, data: generateDemoBrand(brief, { seed: DEMO_SEED, refDate: ref }) }));

      it("S2-4 #1: the same seed gives identical data", () => {
        expect(generateDemoBrand(brief, { seed: DEMO_SEED, refDate: REF })).toEqual(data);
        expect(generateDemoBrand(brief, { seed: DEMO_SEED + 1, refDate: REF })).not.toEqual(data);
      });

      it("S2-4 #2: expected counts, and orders in each of the last 24 months, on every load date", () => {
        expect(data.products.length).toBeGreaterThanOrEqual(15);
        expect(data.products.length).toBeLessThanOrEqual(25);
        expect(data.customers.length).toBe(brief.customers);
        for (const { ref, data: d } of sweep) {
          const when = ref.toISOString().slice(0, 10);
          const ratio = d.orders.length / brief.targetOrders;
          expect(ratio, when).toBeGreaterThan(0.95);
          expect(ratio, when).toBeLessThan(1.05);
          expect(new Set(d.orders.map((o) => o.orderedAt.slice(0, 7))).size, when).toBe(24);
          expect(d.orders.every((o) => new Date(o.orderedAt) < ref && o.lines.length > 0), when).toBe(true);
        }
      });

      it("S2-4 #3: a lapsed segment of 15% to 35% of customers, on every load date", () => {
        for (const { ref, data: d } of sweep) {
          const share = lapsedShare(d, ref);
          expect(share, ref.toISOString().slice(0, 10)).toBeGreaterThanOrEqual(0.15);
          expect(share, ref.toISOString().slice(0, 10)).toBeLessThanOrEqual(0.35);
        }
      });

      it("S2-4 #4: the busiest calendar month matches the brief's peak, on every load date", () => {
        for (const { ref, data: d } of sweep) expect(brief.peakMonths, ref.toISOString().slice(0, 10)).toContain(peakMonth(d));
      });

      it("S2-4 #7: no real company, product or trademark names; the kit is valid", () => {
        const text = JSON.stringify({ kit: data.kit, products: data.products }).toLowerCase();
        for (const name of DENY) expect(text, name).not.toMatch(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")}\\b`));
        expect(parseBrandInput(data.kit).ok).toBe(true);
        expect(() => sanitizeLogoSvg(data.kit.logoSvg!)).not.toThrow();
        expect(data.customers.every((c) => /^[A-Z]-\d{5}$/.test(c.externalRef))).toBe(true);
      });
    });
  }
});
