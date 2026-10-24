// Sample data for the design-direction prototypes only. Fernhollow Outfitters
// is a fictional brand (rule 2) and every figure here is invented to show
// the layout; each prototype labels it as sample data (rule 1).

export type CheckStatus = "pass" | "review" | "fail";
export type Aspect = "1:1" | "4:5" | "9:16" | "1.91:1";
export type Scene = "ridge" | "lake" | "forest" | "snow";

export type Variant = {
  id: string;
  name: string;
  aspect: Aspect;
  language: "EN" | "ZH" | "ES";
  headline: string;
  cta: string;
  scene: Scene;
  palette: [string, string, string, string];
  checks: { brand: CheckStatus; legal: CheckStatus; accessibility: CheckStatus };
  note?: string;
  pretest: number; // synthetic-audience score out of 10
};

export const brand = { name: "Fernhollow Outfitters", short: "Fernhollow" };

export const campaign = {
  name: "Winter range: win back lapsed customers",
  objective: "Bring back customers who haven't bought in 18 months, with the new winter range.",
  launched: "14 Oct",
  day: 10,
  days: 28,
  healthyShare: 78,
  spend: 4820,
  budget: 9000,
  liveVariants: 24,
};

export type SquadState = { key: "strategy" | "creative" | "performance"; name: string; state: string; detail: string; progress: number };

export const squads: SquadState[] = [
  { key: "strategy", name: "Strategy", state: "Done", detail: "Brief approved 12 Oct · 3 audiences · 4 test cells", progress: 1 },
  { key: "creative", name: "Creative", state: "2 waiting for you", detail: "60 variants made · 48 passed checks · 2 replacements ready", progress: 0.8 },
  { key: "performance", name: "Performance", state: "Watching", detail: "24 live variants · 3 fatiguing · next check 14:00", progress: 0.36 },
];

export type Approval = { id: string; title: string; why: string; agent: string };

export const approvals: Approval[] = [
  {
    id: "a1",
    title: "Swap “Ridge at dawn” (4:5) for “Ridge at dusk”",
    why: "Click-through has fallen 31% over five days; the forecast crosses your threshold on Thursday.",
    agent: "Fatigue and swap agent",
  },
  {
    id: "a2",
    title: "Move £400 from Lake (1:1) to Forest walk (9:16)",
    why: "Forest walk converts at twice the rate on the lapsed-customer audience.",
    agent: "Budget agent",
  },
];

export const activity = [
  { time: "11:42", agent: "Monitor agent", text: "Flagged “Ridge at dawn” for fatigue (CTR 1.9% → 1.3%)." },
  { time: "11:44", agent: "Creative squad", text: "Made two replacement variants and checked them against the brand kit." },
  { time: "10:15", agent: "Diagnostics agent", text: "Lake (1:1) dips at weekends: the audience skews to weekday commuters." },
  { time: "09:00", agent: "Monitor agent", text: "Daily check: 21 of 24 variants above threshold." },
];

/** Daily healthy-spend share, day 1 to 10 (sample). */
export const healthTrend = [64, 69, 72, 75, 81, 84, 83, 80, 79, 78];

export const variants: Variant[] = [
  {
    id: "v1", name: "Ridge at dawn", aspect: "4:5", language: "EN", headline: "The long way round, kept warm", cta: "Shop winter",
    scene: "ridge", palette: ["#F3C9A4", "#C9786A", "#5D4B6E", "#2B2944"],
    checks: { brand: "pass", legal: "pass", accessibility: "pass" }, pretest: 7.4,
  },
  {
    id: "v2", name: "Ridge at dusk", aspect: "4:5", language: "EN", headline: "Further, without the cold", cta: "Shop winter",
    scene: "ridge", palette: ["#E9A27D", "#8C5A7A", "#3E3A63", "#1F2340"],
    checks: { brand: "pass", legal: "pass", accessibility: "pass" }, pretest: 8.1, note: "Replacement for Ridge at dawn",
  },
  {
    id: "v3", name: "Lake", aspect: "1:1", language: "EN", headline: "Still water. Warm hands.", cta: "See the range",
    scene: "lake", palette: ["#CFE3E8", "#8DB7C2", "#3F7383", "#1D3B47"],
    checks: { brand: "pass", legal: "review", accessibility: "pass" }, pretest: 6.8,
    note: "Legal: “warmest we've made” needs the test reference in small print",
  },
  {
    id: "v4", name: "Forest walk", aspect: "9:16", language: "EN", headline: "Back on the trail", cta: "Shop winter",
    scene: "forest", palette: ["#DCE5C7", "#93A877", "#4B6440", "#22331F"],
    checks: { brand: "pass", legal: "pass", accessibility: "pass" }, pretest: 8.4,
  },
  {
    id: "v5", name: "First snow", aspect: "1.91:1", language: "EN", headline: "First snow is our favourite season", cta: "Explore",
    scene: "snow", palette: ["#F2F4F7", "#C8D2DE", "#7E8EA6", "#38445A"],
    checks: { brand: "review", legal: "pass", accessibility: "fail" }, pretest: 5.9,
    note: "Accessibility: headline contrast 2.6:1 on the snow field (needs 4.5:1)",
  },
  {
    id: "v6", name: "Lake (Mandarin)", aspect: "1:1", language: "ZH", headline: "静水，暖手。", cta: "查看系列",
    scene: "lake", palette: ["#CFE3E8", "#8DB7C2", "#3F7383", "#1D3B47"],
    checks: { brand: "pass", legal: "review", accessibility: "pass" }, pretest: 6.6,
  },
  {
    id: "v7", name: "Forest walk (Spanish)", aspect: "9:16", language: "ES", headline: "De vuelta al sendero", cta: "Comprar",
    scene: "forest", palette: ["#DCE5C7", "#93A877", "#4B6440", "#22331F"],
    checks: { brand: "pass", legal: "pass", accessibility: "pass" }, pretest: 8.0,
  },
  {
    id: "v8", name: "Summit glow", aspect: "1.91:1", language: "EN", headline: "Made for the top, and the walk home", cta: "Shop winter",
    scene: "ridge", palette: ["#F7D9B9", "#E59A6B", "#A2524D", "#4A2A3A"],
    checks: { brand: "fail", legal: "pass", accessibility: "pass" }, pretest: 7.0,
    note: "Brand: logo inside the safe zone margin (12px, needs 24px)",
  },
];

export function overall(v: Variant): CheckStatus {
  const s = Object.values(v.checks);
  if (s.includes("fail")) return "fail";
  if (s.includes("review")) return "review";
  return "pass";
}
