// P9-2: the simulator's numbers. Every rate, range, speed and multiplier here
// is Studio's own assumption, chosen so a simulated month looks like a month a
// marketer might read; none is an industry benchmark (rule 1). The bank
// holiday dates are facts, from gov.uk, and Black Friday and Cyber Monday are
// the retail calendar's dates. Nothing here is imported but types, so the
// simulator stays pure (src/lib/performance/simulate.ts).

export type Range = readonly [min: number, max: number];

/** Multipliers on the day's cost per thousand impressions and on its conversion rate: 1 is no change. */
export type EventEffect = { cost: number; conversion: number };

export type ChannelRates = {
  /** Click-through rate before any fatigue, as a fraction of impressions. */
  ctr: Range;
  /** Conversions per click, as a fraction. */
  conversionRate: Range;
  /** Cost per thousand impressions, in pence. */
  cpmPence: Range;
  /** The people one ad can reach, which sets how quickly its frequency grows. */
  audience: Range;
};

export type SimulationConfig = {
  /** Says what these numbers are wherever they are shown. */
  label: string;
  channels: Record<"paid social" | "display", ChannelRates>;
  /** An order's value when the brand has no active products, in pence. */
  orderValuePence: Range;
  /**
   * How an ad tires: its click-through rate is base × (floor + (1 − floor) / (1 + speed × frequency)),
   * where frequency is its impressions so far over its audience. A fast ad tires noticeably within a
   * month; a slow one barely. The floor is the share of the click-through rate an ad keeps however
   * often people see it, and fastShare the chance that an ad tires fast (one ad in a launch of two or more always does).
   */
  fatigue: { fast: Range; slow: Range; floor: number; fastShare: number };
  weekend: EventEffect;
  bankHolidays: {
    region: "England and Wales";
    source: "https://www.gov.uk/bank-holidays";
    effect: EventEffect;
    days: { date: string; name: string }[];
  };
  retail: { date: string; name: "Black Friday" | "Cyber Monday"; effect: EventEffect }[];
  /** The day-to-day amplitude of the noise: each day's rates move by up to this fraction either way. */
  noise: number;
};

const BLACK_FRIDAY: EventEffect = { cost: 1.45, conversion: 1.6 };
const CYBER_MONDAY: EventEffect = { cost: 1.3, conversion: 1.4 };

export const SIMULATION: SimulationConfig = {
  label: "Studio's own assumptions for the simulation, not industry benchmarks",
  channels: {
    "paid social": { ctr: [0.008, 0.016], conversionRate: [0.02, 0.045], cpmPence: [400, 800], audience: [15_000, 40_000] },
    display: { ctr: [0.002, 0.005], conversionRate: [0.01, 0.03], cpmPence: [150, 400], audience: [40_000, 120_000] },
  },
  orderValuePence: [3_000, 9_000],
  fatigue: { fast: [2.2, 3.5], slow: [0.002, 0.012], floor: 0.2, fastShare: 0.25 },
  // Cheaper auctions and a little more buying at the weekend.
  weekend: { cost: 0.9, conversion: 1.1 },
  bankHolidays: {
    region: "England and Wales",
    source: "https://www.gov.uk/bank-holidays",
    // People are out: cheaper impressions, fewer of them buy.
    effect: { cost: 0.85, conversion: 0.85 },
    // 2026 and 2027, in date order, as gov.uk lists them.
    days: [
      { date: "2026-01-01", name: "New Year’s Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-05-04", name: "Early May bank holiday" },
      { date: "2026-05-25", name: "Spring bank holiday" },
      { date: "2026-08-31", name: "Summer bank holiday" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-28", name: "Boxing Day (substitute day)" },
      { date: "2027-01-01", name: "New Year’s Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-05-03", name: "Early May bank holiday" },
      { date: "2027-05-31", name: "Spring bank holiday" },
      { date: "2027-08-30", name: "Summer bank holiday" },
      { date: "2027-12-27", name: "Christmas Day (substitute day)" },
      { date: "2027-12-28", name: "Boxing Day (substitute day)" },
    ],
  },
  // Busy auctions push the cost up, and more people buy.
  retail: [
    { date: "2026-11-27", name: "Black Friday", effect: BLACK_FRIDAY },
    { date: "2026-11-30", name: "Cyber Monday", effect: CYBER_MONDAY },
    { date: "2027-11-26", name: "Black Friday", effect: BLACK_FRIDAY },
    { date: "2027-11-29", name: "Cyber Monday", effect: CYBER_MONDAY },
  ],
  noise: 0.12,
};
