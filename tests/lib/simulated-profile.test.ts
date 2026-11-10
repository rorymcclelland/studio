// Sprint 10b, D-3 Simulated data for a new brand: the pure parts. A short
// profile (1 to 10 products with how popular each is, 500 to 20,000 customers,
// UK or Japan's regions, the busiest months) and the kit become a DemoBrief;
// generateDemoBrand() (unchanged, pure and deterministic) makes the customers
// and orders, with a seed from the brand id and the day. No model calls (rule
// 5); the data is simulated and labelled so (rule 1). The interface is in the
// header of tests/e2e/new-brand.spec.ts; saving it is tests/flows/simulated-data.test.ts.
import { describe, expect, it } from "vitest";
import { parseBrandInput, type BrandKit } from "@/lib/brands/schema";
import { generateDemoBrand } from "@/lib/demo/generate";
import {
  parseDataProfile,
  penceFromPounds,
  PROFILE_LIMITS,
  profileToBrief,
  REGION_SETS,
  simulatedDataDay,
  simulatedDataSeed,
  simulateProfile,
} from "@/lib/demo/profile";
import { BRIGHTWATER, BRIGHTWATER_PROFILE, HOSTILE_PRODUCT_NAME, JAPAN_REGIONS, TIDEWELL_PROFILE, UK_REGIONS } from "../fixtures/new-brand";

const BRAND_ID = "6f1c2d3e-4a5b-4c6d-8e7f-001122334455";
const OTHER_BRAND_ID = "6f1c2d3e-4a5b-4c6d-8e7f-001122334466";
const NOW = new Date("2026-11-10T09:40:00Z");

function kitOf(name: string, slug: string): BrandKit {
  const r = parseBrandInput({ name, slug, category: BRIGHTWATER.category });
  if (!r.ok) throw new Error(JSON.stringify(r.fieldErrors));
  return r.data;
}
const KIT = kitOf(BRIGHTWATER.name, BRIGHTWATER.slug);

const peakMonth = (orders: { orderedAt: string }[]) => {
  const byMonth = new Array(12).fill(0);
  for (const o of orders) byMonth[new Date(o.orderedAt).getUTCMonth()]++;
  return byMonth.indexOf(Math.max(...byMonth)) + 1;
};

describe("D-3 the simulated-data profile", () => {
  it("D-3 the region sets: the 12 UK regions, and Japan's 8 regions in order", () => {
    expect(REGION_SETS.japan).toEqual([...JAPAN_REGIONS]);
    expect(REGION_SETS.japan).toEqual(["Hokkaido", "Tohoku", "Kanto", "Chubu", "Kansai", "Chugoku", "Shikoku", "Kyushu-Okinawa"]);
    expect(REGION_SETS.uk).toEqual([...UK_REGIONS]);
    expect(PROFILE_LIMITS).toEqual({ minProducts: 1, maxProducts: 10, minCustomers: 500, maxCustomers: 20_000, defaultCustomers: 5_000, maxPricePence: 1_000_000, maxBusiestMonths: 3 });
  });

  it("D-3 #1 the brief follows the profile: customers, regions, busiest months and popularity; the data lands within 5% of its promised orders", () => {
    const parsed = parseDataProfile(BRIGHTWATER_PROFILE);
    expect(parsed).toEqual({ ok: true, data: BRIGHTWATER_PROFILE });
    const brief = profileToBrief(BRIGHTWATER_PROFILE, KIT);
    expect(brief.customers).toBe(2000);
    expect(brief.regions.names).toEqual([...UK_REGIONS]);
    expect(brief.peakMonths).toEqual([1, 9]);
    expect(brief.products.map((p) => [p.name, p.category, p.pricePence])).toEqual(BRIGHTWATER_PROFILE.products.map((p) => [p.name, p.category, p.pricePence]));
    const [high, medium, low] = brief.products.map((p) => p.weight);
    expect(high).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(low);
    expect(brief.targetOrders).toBeGreaterThan(brief.customers);

    const { data, refDate } = simulateProfile(BRIGHTWATER_PROFILE, KIT, { brandId: BRAND_ID, now: NOW });
    expect(refDate.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(data.customers).toHaveLength(2000);
    expect(data.products).toHaveLength(3);
    const ratio = data.orders.length / brief.targetOrders;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
    expect(BRIGHTWATER_PROFILE.busiestMonths).toContain(peakMonth(data.orders));
    expect(data.orders.every((o) => new Date(o.orderedAt) < refDate && o.lines.length > 0)).toBe(true);
    expect(new Set(data.customers.map((c) => c.region)).size).toBeGreaterThan(1);
    for (const c of data.customers) expect(UK_REGIONS as readonly string[]).toContain(c.region);
    // The popular product sells most, the unpopular least.
    const units = [0, 0, 0];
    for (const o of data.orders) for (const l of o.lines) units[l.product] += l.quantity;
    expect(units[0]).toBeGreaterThan(units[1]);
    expect(units[1]).toBeGreaterThan(units[2]);
  });

  it("D-3 #1 Japan's regions: every customer is in one of the 8, and every region has customers", () => {
    const { data, brief } = simulateProfile(TIDEWELL_PROFILE, kitOf("Tidewell Moments", "tidewell-moments"), { brandId: BRAND_ID, now: NOW });
    expect(brief.regions.names).toEqual([...JAPAN_REGIONS]);
    expect(new Set(data.customers.map((c) => c.region))).toEqual(new Set(JAPAN_REGIONS));
    expect(data.orders.length / brief.targetOrders).toBeGreaterThan(0.95);
    expect(data.orders.length / brief.targetOrders).toBeLessThan(1.05);
    expect(peakMonth(data.orders)).toBe(12);
  });

  it("D-3 #2 the same profile, brand and day give the same data; another day or brand gives other data", () => {
    const later = new Date("2026-11-10T22:15:00Z");
    expect(simulatedDataDay(later).toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(simulatedDataSeed(BRAND_ID, NOW)).toBe(simulatedDataSeed(BRAND_ID, later));
    expect(Number.isInteger(simulatedDataSeed(BRAND_ID, NOW))).toBe(true);
    const a = simulateProfile(BRIGHTWATER_PROFILE, KIT, { brandId: BRAND_ID, now: NOW });
    const b = simulateProfile(BRIGHTWATER_PROFILE, KIT, { brandId: BRAND_ID, now: later });
    expect(b.seed).toBe(a.seed);
    expect(b.data).toEqual(a.data);
    // As generateDemoBrand gives it for that seed and day.
    expect(generateDemoBrand(a.brief, { seed: a.seed, refDate: a.refDate })).toEqual(a.data);
    const nextDay = simulateProfile(BRIGHTWATER_PROFILE, KIT, { brandId: BRAND_ID, now: new Date("2026-11-11T09:40:00Z") });
    expect(nextDay.seed).not.toBe(a.seed);
    expect(nextDay.data).not.toEqual(a.data);
    const otherBrand = simulateProfile(BRIGHTWATER_PROFILE, KIT, { brandId: OTHER_BRAND_ID, now: NOW });
    expect(otherBrand.seed).not.toBe(a.seed);
    expect(otherBrand.data.customers).not.toEqual(a.data.customers);
  });

  it("D-3 #4 refused with field errors: no products, 11 products, a price of 0 or over £10,000, and a customer count outside 500 to 20,000", () => {
    const p = BRIGHTWATER_PROFILE;
    const one = p.products[0];
    expect(parseDataProfile({ ...p, products: [] })).toEqual({ ok: false, fieldErrors: { products: "Add at least one product." } });
    expect(parseDataProfile({ ...p, products: Array.from({ length: 11 }, (_, i) => ({ ...one, name: `Recipe box ${i + 1}` })) })).toEqual({
      ok: false,
      fieldErrors: { products: "No more than 10 products." },
    });
    expect(parseDataProfile({ ...p, products: Array.from({ length: 10 }, (_, i) => ({ ...one, name: `Recipe box ${i + 1}` })) })).toMatchObject({ ok: true });
    expect(parseDataProfile({ ...p, products: [{ ...one, pricePence: 0 }] })).toEqual({ ok: false, fieldErrors: { "products.0.pricePence": "Give a price above £0." } });
    expect(parseDataProfile({ ...p, products: [{ ...one, pricePence: 1_000_001 }] })).toEqual({ ok: false, fieldErrors: { "products.0.pricePence": "Keep the price to £10,000 or less." } });
    expect(parseDataProfile({ ...p, products: [{ ...one, pricePence: 1_000_000 }] })).toMatchObject({ ok: true });
    expect(parseDataProfile({ ...p, products: [{ ...one, pricePence: 1 }] })).toMatchObject({ ok: true });
    for (const customers of [499, 20_001, 0, 1500.5]) {
      expect(parseDataProfile({ ...p, customers }), String(customers)).toEqual({ ok: false, fieldErrors: { customers: "Choose between 500 and 20,000 customers." } });
    }
    for (const customers of [500, 20_000]) expect(parseDataProfile({ ...p, customers }), String(customers)).toMatchObject({ ok: true });
  });

  it("D-3 #4 the other fields' words: a product's name and popularity, the region set and the busiest months", () => {
    const p = BRIGHTWATER_PROFILE;
    const one = p.products[0];
    expect(parseDataProfile({ ...p, products: [{ ...one, name: "  " }] })).toEqual({ ok: false, fieldErrors: { "products.0.name": "Name the product." } });
    expect(parseDataProfile({ ...p, products: [{ ...one, name: "p".repeat(81) }] })).toEqual({ ok: false, fieldErrors: { "products.0.name": "Product name must be 80 characters or fewer." } });
    expect(parseDataProfile({ ...p, products: [{ ...one, popularity: "very high" }] })).toEqual({ ok: false, fieldErrors: { "products.0.popularity": "Choose low, medium or high." } });
    expect(parseDataProfile({ ...p, regionSet: "france" })).toEqual({ ok: false, fieldErrors: { regionSet: "Choose UK regions or Japan's regions." } });
    for (const busiestMonths of [[], [1, 2, 3, 4], [0], [13], [3, 3]]) {
      expect(parseDataProfile({ ...p, busiestMonths }), JSON.stringify(busiestMonths)).toEqual({ ok: false, fieldErrors: { busiestMonths: "Choose one to three busiest months." } });
    }
    // Errors on several fields come together, keyed by field.
    const many = parseDataProfile({ ...p, products: [{ ...one, pricePence: 0 }, { ...one, name: "" }], customers: 10 });
    expect(many).toEqual({ ok: false, fieldErrors: { "products.0.pricePence": "Give a price above £0.", "products.1.name": "Name the product.", customers: "Choose between 500 and 20,000 customers." } });
  });

  it("D-3 #4 prices are read from pounds as a person types them", () => {
    expect(penceFromPounds("12.50")).toBe(1250);
    expect(penceFromPounds("£12.50")).toBe(1250);
    expect(penceFromPounds(" 12.5 ")).toBe(1250);
    expect(penceFromPounds("12")).toBe(1200);
    expect(penceFromPounds("1,200")).toBe(120000);
    expect(penceFromPounds("10000.01")).toBe(1_000_001);
    expect(penceFromPounds("0")).toBe(0);
    for (const bad of ["", "abc", "12.505", "-3", "12,50", "1e3"]) expect(penceFromPounds(bad), bad).toBeNull();
  });

  it("D-3 #5 a product name with markup or SQL is kept as text", () => {
    const r = parseDataProfile({ ...BRIGHTWATER_PROFILE, products: [{ ...BRIGHTWATER_PROFILE.products[0], name: HOSTILE_PRODUCT_NAME }] });
    expect(r).toMatchObject({ ok: true, data: { products: [{ name: HOSTILE_PRODUCT_NAME }] } });
  });
});
