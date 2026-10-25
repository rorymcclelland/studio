// S2-4 test cases 1 to 4 and 7: the deterministic demo-data generator.
import { describe, expect, it } from "vitest";
import { DEMO_BRIEFS } from "@/lib/demo/briefs";
import { generateDemoBrand } from "@/lib/demo/generate";
import { parseBrandInput } from "@/lib/brands/schema";
import { sanitizeLogoSvg } from "@/lib/brands/svg";

const REF = new Date("2026-10-25T00:00:00Z");

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
      const data = generateDemoBrand(brief, { seed: 42, refDate: REF });

      it("S2-4 #1: the same seed gives identical data", () => {
        expect(generateDemoBrand(brief, { seed: 42, refDate: REF })).toEqual(data);
        expect(generateDemoBrand(brief, { seed: 43, refDate: REF })).not.toEqual(data);
      });

      it("S2-4 #2: expected counts, and orders in each of the last 24 months", () => {
        expect(data.products.length).toBeGreaterThanOrEqual(15);
        expect(data.products.length).toBeLessThanOrEqual(25);
        expect(data.customers.length).toBe(brief.customers);
        const ratio = data.orders.length / brief.targetOrders;
        expect(ratio).toBeGreaterThan(0.95);
        expect(ratio).toBeLessThan(1.05);
        const months = new Set(data.orders.map((o) => o.orderedAt.slice(0, 7)));
        expect(months.size).toBe(24);
        for (const o of data.orders) {
          expect(new Date(o.orderedAt) < REF).toBe(true);
          expect(o.lines.length).toBeGreaterThan(0);
        }
      });

      it("S2-4 #3: a lapsed segment of 15% to 35% of customers", () => {
        const lastOrder = new Map<number, string>();
        for (const o of data.orders) {
          const prev = lastOrder.get(o.customer);
          if (!prev || o.orderedAt > prev) lastOrder.set(o.customer, o.orderedAt);
        }
        const cutoff = new Date(REF);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
        const lapsed = [...lastOrder.values()].filter((d) => new Date(d) < cutoff).length;
        const share = lapsed / data.customers.length;
        expect(share).toBeGreaterThanOrEqual(0.15);
        expect(share).toBeLessThanOrEqual(0.35);
      });

      it("S2-4 #4: the busiest calendar month matches the brief's peak", () => {
        const byMonth = new Array(12).fill(0);
        for (const o of data.orders) byMonth[new Date(o.orderedAt).getUTCMonth()]++;
        const peak = byMonth.indexOf(Math.max(...byMonth)) + 1;
        expect(brief.peakMonths).toContain(peak);
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
