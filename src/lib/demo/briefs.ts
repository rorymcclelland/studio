import type { BrandKit } from "@/lib/brands/schema";
import { FERNHOLLOW_LOGO, QUILLMOOR_LOGO } from "./logos";

// Briefs for the two fictional demo brands (S2-4, Q1). Every name here is
// invented (rule 2). The numbers shape simulated data only (rule 1).

export type ProductBrief = { name: string; category: string; pricePence: number; description: string; weight: number };

export type DemoBrief = {
  kit: BrandKit & { logoSvg: string };
  products: ProductBrief[];
  customers: number;
  /** Expected number of orders over 24 months; the generator lands within 5%. */
  targetOrders: number;
  /** Relative demand by calendar month, January first. */
  monthWeights: number[];
  /** Calendar months (1-12) that should be the busiest. */
  peakMonths: number[];
  /** Chance a still-active customer orders in a given month, before seasonality. */
  monthlyOrderRate: number;
  /** Mean months a customer stays active after their first order. */
  meanLifetimeMonths: number;
  linesPerOrder: { counts: number[]; weights: number[] };
  channels: { names: ("web" | "app" | "store" | "marketplace")[]; weights: number[] };
  regions: { names: string[]; weights: number[] };
  ageBands: { names: string[]; weights: number[] };
  consentRate: number;
  refPrefix: string;
};

const UK_REGIONS = {
  names: ["London", "South East", "South West", "East of England", "West Midlands", "East Midlands",
    "North West", "North East", "Yorkshire and the Humber", "Scotland", "Wales", "Northern Ireland"],
};

export const FERNHOLLOW: DemoBrief = {
  kit: {
    name: "Fernhollow Outfitters",
    slug: "fernhollow",
    description: "Outdoor clothing and kit for people who walk far in British weather, made to be mended rather than replaced.",
    category: "Outdoor apparel",
    toneWords: ["warm", "plain-spoken", "unhurried", "practical"],
    voiceNotes: "Write like a friend who has done the walk. Short sentences. Name real kinds of landscape (ridges, bogs, coast paths), never extreme sport. No exclamation marks.",
    doRules: [
      "Lead with where the kit takes you, then what it is made of",
      "Mention repair and long life where it is true",
      "Use British spelling and the metric system",
    ],
    dontRules: [
      "Promise safety or survival in any conditions",
      "Use fear (storms, danger) to sell",
      "Mock people who are new to the outdoors",
    ],
    palette: [
      { name: "Moss", hex: "#3F5B3A" },
      { name: "Bracken", hex: "#B5653A" },
      { name: "Fog", hex: "#E8EBE4" },
      { name: "Peat", hex: "#2B2A26" },
      { name: "Loch", hex: "#4F7A8C" },
    ],
    fontPrimary: "Georgia",
    fontSecondary: "Helvetica",
    legalLines: ["Prices include VAT.", "Free returns within 30 days on unworn items."],
    bannedTerms: ["indestructible", "waterproof forever", "guaranteed to keep you safe", "lifetime of adventure"],
    evidenceClaims: ["warmest", "lightest", "most sustainable", "fully recycled"],
    ownNames: [],
    logoSvg: FERNHOLLOW_LOGO,
  },
  products: [
    { name: "Ridgeline waterproof jacket", category: "Jackets", pricePence: 18900, description: "Three-layer shell for long wet days on high ground.", weight: 9 },
    { name: "Coastpath softshell", category: "Jackets", pricePence: 11900, description: "Windproof stretch jacket for breezy coastal walks.", weight: 5 },
    { name: "Bothy insulated jacket", category: "Jackets", pricePence: 15900, description: "Recycled-fill jacket for cold stops and bothy evenings.", weight: 7 },
    { name: "Heather fleece", category: "Fleeces", pricePence: 6500, description: "Midweight fleece in recycled polyester.", weight: 10 },
    { name: "Gorse half-zip fleece", category: "Fleeces", pricePence: 5500, description: "Light grid fleece for warm-up layers.", weight: 6 },
    { name: "Merino base layer top", category: "Base layers", pricePence: 5900, description: "Fine merino against the skin, for warmth without smell.", weight: 8 },
    { name: "Merino base layer leggings", category: "Base layers", pricePence: 5200, description: "Merino leggings for winter walks and camp.", weight: 4 },
    { name: "Tor walking trousers", category: "Trousers", pricePence: 7900, description: "Stretch walking trousers with a water-repellent finish.", weight: 8 },
    { name: "Bog-trotter overtrousers", category: "Trousers", pricePence: 8900, description: "Full-zip waterproof overtrousers.", weight: 4 },
    { name: "Scree leather walking boots", category: "Footwear", pricePence: 16500, description: "Resoleable leather boots with a waterproof lining.", weight: 6 },
    { name: "Drover trail shoes", category: "Footwear", pricePence: 10500, description: "Grippy shoes for paths and dry hills.", weight: 5 },
    { name: "Hill walking socks (2 pairs)", category: "Accessories", pricePence: 1800, description: "Cushioned wool-blend socks.", weight: 14 },
    { name: "Wool beanie", category: "Accessories", pricePence: 2200, description: "Ribbed lambswool hat.", weight: 7 },
    { name: "Fingerless wool mitts", category: "Accessories", pricePence: 1900, description: "Mitts for map reading on cold days.", weight: 4 },
    { name: "Cairn 28-litre daypack", category: "Packs", pricePence: 8500, description: "Daypack with a rain cover and hip belt.", weight: 5 },
    { name: "Drystore roll-top bag", category: "Packs", pricePence: 2500, description: "Roll-top bag to keep spare layers dry.", weight: 5 },
    { name: "Repair kit and patches", category: "Care", pricePence: 1200, description: "Patches, thread and a guide to fixing your kit.", weight: 6 },
    { name: "Wash-in reproofer", category: "Care", pricePence: 1100, description: "Restores water repellency to shells.", weight: 5 },
    { name: "Summit gaiters", category: "Accessories", pricePence: 3900, description: "Gaiters for wet heather and deep mud.", weight: 3 },
    { name: "Packable sun hat", category: "Accessories", pricePence: 2400, description: "Light hat for summer ridges.", weight: 3 },
  ],
  customers: 2000,
  targetOrders: 5150,
  monthWeights: [0.8, 0.7, 1.0, 1.1, 0.9, 0.8, 0.8, 0.8, 1.0, 1.5, 1.8, 1.6],
  peakMonths: [10, 11, 12],
  monthlyOrderRate: 0.25,
  meanLifetimeMonths: 11,
  linesPerOrder: { counts: [1, 2, 3, 4], weights: [55, 28, 12, 5] },
  channels: { names: ["web", "app", "store", "marketplace"], weights: [58, 18, 16, 8] },
  regions: { ...UK_REGIONS, weights: [10, 13, 11, 8, 6, 6, 11, 5, 9, 12, 6, 3] },
  ageBands: { names: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"], weights: [7, 18, 22, 22, 19, 12] },
  consentRate: 0.62,
  refPrefix: "F",
};

export const QUILLMOOR: DemoBrief = {
  kit: {
    name: "Quillmoor Money",
    slug: "quillmoor",
    description: "A budgeting and savings app that helps people see where their money goes and put a little aside without thinking about it.",
    category: "Personal finance app",
    toneWords: ["clear", "calm", "encouraging", "honest"],
    voiceNotes: "Explain money in plain words, as a patient friend would. Show the number, then what it means. Never make people feel bad about their spending.",
    doRules: [
      "State fees and rates in full wherever a product is promoted",
      "Use real-looking but clearly illustrative examples, labelled as examples",
      "Keep the benefit and the risk in the same place",
    ],
    dontRules: [
      "Suggest savings or interest are guaranteed when rates are variable",
      "Use urgency or fear (\"don't miss out\", \"before it's too late\")",
      "Shame people about debt or spending",
    ],
    palette: [
      { name: "Ink", hex: "#14213D" },
      { name: "Quill blue", hex: "#1F4E79" },
      { name: "Gold leaf", hex: "#F2C14E" },
      { name: "Paper", hex: "#F7F5F0" },
      { name: "Sage", hex: "#6B9080" },
    ],
    fontPrimary: "Helvetica",
    fontSecondary: "Georgia",
    legalLines: [
      "Savings rates are variable and can change.",
      "Fees apply to Plus and Premium plans; see the price list in the app.",
      "Quillmoor Money is a fictional company created for demonstration.",
    ],
    bannedTerms: ["guaranteed returns", "risk-free", "free money", "get rich", "best rates on the market", "never pay fees"],
    evidenceClaims: ["cheapest", "fastest", "most secure", "highest rate", "award-winning"],
    ownNames: [],
    logoSvg: QUILLMOOR_LOGO,
  },
  products: [
    { name: "Plus plan (monthly)", category: "Plans", pricePence: 300, description: "Spending insights, extra pots and custom categories.", weight: 16 },
    { name: "Premium plan (monthly)", category: "Plans", pricePence: 700, description: "Everything in Plus with travel cover and cashback.", weight: 7 },
    { name: "Plus plan (annual)", category: "Plans", pricePence: 3000, description: "Plus, paid yearly.", weight: 5 },
    { name: "Premium plan (annual)", category: "Plans", pricePence: 7000, description: "Premium, paid yearly.", weight: 3 },
    { name: "Joint pot", category: "Add-ons", pricePence: 200, description: "A shared pot for household bills.", weight: 6 },
    { name: "Bill splitter", category: "Add-ons", pricePence: 150, description: "Split shared bills and send friendly reminders.", weight: 5 },
    { name: "Round-up booster", category: "Add-ons", pricePence: 100, description: "Multiplies round-ups into savings pots.", weight: 7 },
    { name: "Credit score tracker", category: "Add-ons", pricePence: 250, description: "Monthly credit report with plain-English notes.", weight: 6 },
    { name: "Subscription finder", category: "Add-ons", pricePence: 150, description: "Spots repeating payments you may have forgotten.", weight: 6 },
    { name: "Travel money card", category: "Cards", pricePence: 500, description: "Card for spending abroad, with fees shown before you pay.", weight: 4 },
    { name: "Metal card", category: "Cards", pricePence: 4500, description: "A heavier card for Premium members.", weight: 1 },
    { name: "Replacement card", category: "Cards", pricePence: 500, description: "A new card if yours is lost or damaged.", weight: 2 },
    { name: "Budget coaching session", category: "Services", pricePence: 2500, description: "Thirty minutes with a money coach.", weight: 2 },
    { name: "Tax-year savings review", category: "Services", pricePence: 1500, description: "A guided review of the year's saving.", weight: 2 },
    { name: "Gadget cover", category: "Cover", pricePence: 600, description: "Monthly cover for phones and laptops.", weight: 3 },
    { name: "Kids pocket-money account", category: "Add-ons", pricePence: 300, description: "A supervised account for children.", weight: 3 },
  ],
  customers: 2000,
  targetOrders: 5970,
  monthWeights: [2.6, 1.4, 1.0, 1.1, 0.9, 0.8, 0.8, 0.8, 1.0, 1.0, 1.0, 0.9],
  peakMonths: [1],
  monthlyOrderRate: 0.42,
  meanLifetimeMonths: 6.5,
  linesPerOrder: { counts: [1, 2], weights: [85, 15] },
  channels: { names: ["app", "web"], weights: [86, 14] },
  regions: { ...UK_REGIONS, weights: [19, 14, 8, 9, 8, 7, 11, 4, 8, 7, 3, 2] },
  ageBands: { names: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"], weights: [22, 33, 21, 13, 7, 4] },
  consentRate: 0.48,
  refPrefix: "Q",
};

export const DEMO_BRIEFS = [FERNHOLLOW, QUILLMOOR];
