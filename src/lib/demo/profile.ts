import { z } from "zod";
import type { BrandKit } from "@/lib/brands/schema";
import type { DemoBrief } from "./briefs";
import { generateDemoBrand, type DemoData } from "./generate";
import { seedFrom } from "./rng";

// Sprint 10b, D-3: a short profile of a person's own brand (products, how many
// customers, where they live, the busiest months) becomes a DemoBrief, and
// generateDemoBrand() makes simulated customers and orders from it. Pure: no
// database and no model (rule 5). The data is simulated and labelled so (rule 1).

export const REGION_SETS = {
  uk: [
    "London",
    "South East",
    "South West",
    "East of England",
    "West Midlands",
    "East Midlands",
    "North West",
    "North East",
    "Yorkshire and the Humber",
    "Scotland",
    "Wales",
    "Northern Ireland",
  ],
  japan: ["Hokkaido", "Tohoku", "Kanto", "Chubu", "Kansai", "Chugoku", "Shikoku", "Kyushu-Okinawa"],
} as const satisfies Record<string, readonly string[]>;

/** Rough shares of people by region, so the simulated customers spread like a population. */
const REGION_WEIGHTS: Record<keyof typeof REGION_SETS, number[]> = {
  uk: [13, 14, 9, 10, 9, 7, 11, 4, 8, 8, 5, 3],
  japan: [4, 7, 35, 17, 18, 6, 3, 11],
};

export const PROFILE_LIMITS = {
  minProducts: 1,
  maxProducts: 10,
  minCustomers: 500,
  maxCustomers: 20_000,
  defaultCustomers: 5_000,
  maxPricePence: 1_000_000,
  maxBusiestMonths: 3,
} as const;

export const POPULARITY = ["low", "medium", "high"] as const;
export type Popularity = (typeof POPULARITY)[number];

export type ProfileProduct = { name: string; category: string; pricePence: number; popularity: Popularity };
export type DataProfile = { products: ProfileProduct[]; customers: number; regionSet: "uk" | "japan"; busiestMonths: number[] };

const productSchema = z.object({
  name: z.string().trim().min(1, "Name the product.").max(80, "Product name must be 80 characters or fewer."),
  category: z.string().trim().max(60, "Category must be 60 characters or fewer.").default(""),
  pricePence: z
    .number("Give a price above £0.")
    .int("Give a price above £0.")
    .min(1, "Give a price above £0.")
    .max(PROFILE_LIMITS.maxPricePence, "Keep the price to £10,000 or less."),
  popularity: z.enum(POPULARITY, "Choose low, medium or high."),
});

const CUSTOMERS = "Choose between 500 and 20,000 customers.";
const MONTHS = "Choose one to three busiest months.";

const profileSchema = z.object({
  products: z
    .array(productSchema, "Add at least one product.")
    .min(PROFILE_LIMITS.minProducts, "Add at least one product.")
    .max(PROFILE_LIMITS.maxProducts, "No more than 10 products."),
  customers: z.number(CUSTOMERS).int(CUSTOMERS).min(PROFILE_LIMITS.minCustomers, CUSTOMERS).max(PROFILE_LIMITS.maxCustomers, CUSTOMERS),
  regionSet: z.enum(["uk", "japan"], "Choose UK regions or Japan's regions."),
  busiestMonths: z
    .array(z.number(MONTHS).int(MONTHS).min(1, MONTHS).max(12, MONTHS), MONTHS)
    .min(1, MONTHS)
    .max(PROFILE_LIMITS.maxBusiestMonths, MONTHS)
    .refine((ms) => new Set(ms).size === ms.length, MONTHS),
});

/** Checks a profile; errors are keyed by field path, such as "products.0.pricePence". The busiest months' errors are one message. */
export function parseDataProfile(raw: unknown): { ok: true; data: DataProfile } | { ok: false; fieldErrors: Record<string, string> } {
  const r = profileSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    // A month's own error belongs to the months as a whole.
    const path = issue.path[0] === "busiestMonths" ? ["busiestMonths"] : issue.path;
    fieldErrors[path.join(".") || "form"] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

/** A price typed in pounds ("12.50", "£12.50", "1,200") as whole pence; null when it isn't a price. */
export function penceFromPounds(text: string): number | null {
  const m = /^£?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const pounds = Number(m[1].replace(/,/g, ""));
  const pence = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  const total = pounds * 100 + pence;
  return Number.isSafeInteger(total) ? total : null;
}

/** The start of now's UTC day: the simulated data's reference date (brands.data_as_of). */
export function simulatedDataDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A seed from the brand and the day: the same brand on the same day gets the same data. */
export function simulatedDataSeed(brandId: string, day: Date): number {
  return seedFrom(`${brandId.toLowerCase()}|${simulatedDataDay(day).toISOString().slice(0, 10)}`, 2026);
}

const POPULARITY_WEIGHT: Record<Popularity, number> = { low: 1, medium: 3, high: 7 };
const BUSY_WEIGHT = 2.2;
const MONTHLY_ORDER_RATE = 0.22;
const MEAN_LIFETIME_MONTHS = 9;
const GENERATED_MONTHS = 24;

/**
 * The orders generateDemoBrand() is expected to make for this brief: one first
 * order per customer, then each month a still-active customer orders with
 * monthlyOrderRate times the month's weight. Averaged over the twelve months the
 * data can end in, so the promise doesn't depend on the day it is made.
 */
function expectedOrders(b: Pick<DemoBrief, "customers" | "monthWeights" | "monthlyOrderRate" | "meanLifetimeMonths">): number {
  const n = GENERATED_MONTHS;
  let total = 0;
  for (let endMonth = 0; endMonth < 12; endMonth++) {
    // Month i's calendar month, when the last of the n months is endMonth.
    const season = Array.from({ length: n }, (_, i) => b.monthWeights[(((endMonth - (n - 1 - i)) % 12) + 12) % 12]);
    const acquisition = season.map((w, i) => w * (0.75 + (0.5 * i) / (n - 1)));
    const sum = acquisition.reduce((s, w) => s + w, 0);
    let perCustomer = 0;
    for (let f = 0; f < n; f++) {
      let repeats = 0;
      for (let m = f + 1; m < n; m++) {
        // The lifetime is round(an exponential draw): at least k months with chance exp(-(k - 0.5) / mean).
        const active = Math.exp(-(m - f - 0.5) / b.meanLifetimeMonths);
        repeats += active * Math.min(1, b.monthlyOrderRate * season[m]);
      }
      perCustomer += (acquisition[f] / sum) * (1 + repeats);
    }
    total += perCustomer;
  }
  return Math.round((total / 12) * b.customers);
}

/** The DemoBrief for a profile and the brand's kit. */
export function profileToBrief(profile: DataProfile, kit: BrandKit): DemoBrief {
  const busy = new Set(profile.busiestMonths);
  const monthWeights = Array.from({ length: 12 }, (_, i) => (busy.has(i + 1) ? BUSY_WEIGHT : 1));
  const shape = { customers: profile.customers, monthWeights, monthlyOrderRate: MONTHLY_ORDER_RATE, meanLifetimeMonths: MEAN_LIFETIME_MONTHS };
  const regions = REGION_SETS[profile.regionSet];
  return {
    kit: { ...kit, logoSvg: kit.logoSvg ?? "" },
    products: profile.products.map((p) => ({ name: p.name, category: p.category, pricePence: p.pricePence, description: "", weight: POPULARITY_WEIGHT[p.popularity] })),
    ...shape,
    targetOrders: expectedOrders(shape),
    peakMonths: [...profile.busiestMonths],
    linesPerOrder: { counts: [1, 2, 3], weights: [70, 22, 8] },
    channels: { names: ["web", "app", "store", "marketplace"], weights: [50, 30, 12, 8] },
    regions: { names: [...regions], weights: REGION_WEIGHTS[profile.regionSet] },
    ageBands: { names: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"], weights: [12, 22, 21, 18, 15, 12] },
    consentRate: 0.55,
    refPrefix: "S",
  };
}

/** The brief and the simulated data for a brand's profile on now's UTC day. */
export function simulateProfile(
  profile: DataProfile,
  kit: BrandKit,
  at: { brandId: string; now: Date },
): { brief: DemoBrief; data: DemoData; refDate: Date; seed: number } {
  const brief = profileToBrief(profile, kit);
  const refDate = simulatedDataDay(at.now);
  const seed = simulatedDataSeed(at.brandId, refDate);
  return { brief, data: generateDemoBrand(brief, { seed, refDate }), refDate, seed };
}
