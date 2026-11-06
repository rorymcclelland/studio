// P9-1: the launch's settings, their limits and their wording. Pure code with
// no database, so the campaign page's form can use the same rules as the
// server (src/lib/performance/launch.ts re-exports all of it).
import type { KPI_METRICS } from "@/lib/brief/schema";

export type KpiMetric = (typeof KPI_METRICS)[number];

export const KPI_MEASURES = ["ctr", "conversion_rate", "cpa", "roas"] as const;
export type KpiMeasure = (typeof KPI_MEASURES)[number];

export const MEASURE_NAMES: Record<KpiMeasure, string> = {
  ctr: "Click-through rate",
  conversion_rate: "Conversion rate",
  cpa: "Cost per acquisition (simulated £)",
  roas: "Return on ad spend",
};

/** When an ad is healthy against the threshold: a cost is healthy low, everything else high. */
export const HEALTHY_WHEN: Record<KpiMeasure, "at or above" | "at or below"> = {
  ctr: "at or above",
  conversion_rate: "at or above",
  cpa: "at or below",
  roas: "at or above",
};

/** Rule 1: the suggested values are Studio's own, never presented as industry figures. */
export const SIMULATED_DEFAULT = "Studio's own simulated default, not a benchmark";

/** Studio's own simulated defaults: rates in per cent, cost per acquisition in simulated pounds, return on ad spend as a ratio. */
export const DEFAULT_VALUES: Record<KpiMeasure, number> = { ctr: 1, conversion_rate: 2, cpa: 20, roas: 3 };

const MEASURE_FOR: Record<KpiMetric, KpiMeasure> = {
  "click-through rate": "ctr",
  reach: "ctr",
  conversions: "cpa",
  "sign-ups": "cpa",
  "reactivation rate": "cpa",
  "cost per acquisition": "cpa",
  "return on ad spend": "roas",
  revenue: "roas",
};

export const isKpiMeasure = (m: unknown): m is KpiMeasure => typeof m === "string" && (KPI_MEASURES as readonly string[]).includes(m);

/** The refinement's table: the default measure from the brief's KPI, with Studio's simulated default value. */
export function defaultThreshold(briefKpi: KpiMetric | null): { measure: KpiMeasure; value: number; healthyWhen: "at or above" | "at or below"; label: string } {
  const measure: KpiMeasure = (briefKpi && MEASURE_FOR[briefKpi]) || "conversion_rate";
  return { measure, value: DEFAULT_VALUES[measure], healthyWhen: HEALTHY_WHEN[measure], label: SIMULATED_DEFAULT };
}

export const LAUNCH_LIMITS = {
  budgetPence: { min: 500, max: 50_000, default: 5_000 },
  days: { min: 7, max: 60, default: 30 },
  startsOn: { min: "2026-01-01", max: "2027-12-31" },
} as const;

export type LaunchSettings = { dailyBudgetPence: number; days: number; startsOn: string; kpiMeasure: string; kpiValue: number };
export type LaunchRequest = LaunchSettings & { variantIds: string[] };

const londonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** A day in London as YYYY-MM-DD. */
export function londonDate(now: Date = new Date()): string {
  return londonDay.format(now);
}

/** £50 a day for 30 days from today (in London), with the threshold the brief's KPI suggests. */
export function launchDefaults(briefKpi: KpiMetric | null, now: Date = new Date()): LaunchSettings {
  const t = defaultThreshold(briefKpi);
  return { dailyBudgetPence: LAUNCH_LIMITS.budgetPence.default, days: LAUNCH_LIMITS.days.default, startsOn: londonDate(now), kpiMeasure: t.measure, kpiValue: t.value };
}

export const LAUNCH_REASONS = {
  budget: "The daily budget must be between £5 and £500 (simulated).",
  days: "A launch runs for 7 to 60 days.",
  startsOn: "The start date must be between 1 January 2026 and 31 December 2027.",
  measure: "Pick one of the four measures: click-through rate, conversion rate, cost per acquisition or return on ad spend.",
  threshold: "The threshold must be a number above 0.",
  percent: "A rate can't be more than 100%.",
} as const;

const PERCENT: ReadonlySet<string> = new Set<KpiMeasure>(["ctr", "conversion_rate"]);

/** A real calendar date written YYYY-MM-DD. */
function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const wholeBetween = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** Every problem with the settings, in the form's order (empty when they are valid). */
export function validateLaunchInput(settings: LaunchSettings): string[] {
  const s = (settings ?? {}) as Partial<Record<keyof LaunchSettings, unknown>>;
  const out: string[] = [];
  const L = LAUNCH_LIMITS;
  if (!wholeBetween(s.dailyBudgetPence, L.budgetPence.min, L.budgetPence.max)) out.push(LAUNCH_REASONS.budget);
  if (!wholeBetween(s.days, L.days.min, L.days.max)) out.push(LAUNCH_REASONS.days);
  if (!isRealDate(s.startsOn) || s.startsOn < L.startsOn.min || s.startsOn > L.startsOn.max) out.push(LAUNCH_REASONS.startsOn);
  const measureOk = isKpiMeasure(s.kpiMeasure);
  if (!measureOk) out.push(LAUNCH_REASONS.measure);
  const value = s.kpiValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) out.push(LAUNCH_REASONS.threshold);
  else if (measureOk && PERCENT.has(s.kpiMeasure as string) && value > 100) out.push(LAUNCH_REASONS.percent);
  return out;
}

export const NOT_SIGNED_OFF_LAUNCH = "A campaign can launch only once its brief is signed off.";
export const NO_ELIGIBLE_ADS = "No picked ads pass compliance yet";
export const LAUNCH_NOT_VALID = "The launch wasn't asked for. Fix the problems below.";
export const LAUNCH_CAMPAIGN_NOT_FOUND = "That campaign isn't in your workspace.";
export const LAUNCH_AD_NOT_FOUND = "That ad isn't in this campaign.";
export const LAUNCH_ADS_CHANGED = "The ads that can launch changed since the page was opened. Reload to see them.";
export const LAUNCH_ALREADY_ASKED = "This campaign already has a launch waiting for approval.";
export const LAUNCH_ALREADY_LIVE = "This campaign already has a live launch.";
export const LAUNCH_REQUEST_NOT_OPEN = "This launch request is no longer open.";
export const REFUSAL_NEEDS_REASON = "Say why, so the launch can be fixed.";
export const LAUNCH_NOT_LIVE = "There's no live launch to end.";
/** Approving re-checks the campaign: its brief must still be signed off, and the ads that can launch unchanged. */
export const LAUNCH_BRIEF_NOT_SIGNED_OFF = "The brief is no longer signed off, so this launch can't be approved. Refuse it, and ask again once the brief is signed off.";
export const LAUNCH_ADS_CHANGED_SINCE_ASKED = "The ads that can launch changed since this launch was asked for. Refuse it, then ask again from the campaign.";

export const LAUNCH_DAYS_TO_DECIDE = 14;
export const LAUNCH_EXPIRED = `The request expired after ${LAUNCH_DAYS_TO_DECIDE} days without a decision.`;
export const LAUNCH_QUESTION = "Launch this campaign's ads in a simulation?";
export const NO_REAL_MONEY = "Simulated: no real money is spent and nothing is published.";

/** Simulated money for people: whole pounds without pence ("£50"), otherwise "£12.34". */
export function formatPounds(pence: number): string {
  return pence % 100 === 0 ? `£${(pence / 100).toLocaleString("en-GB")}` : `£${(pence / 100).toFixed(2)}`;
}

/** A threshold for people: "1.5%", "£20" (simulated pounds), or "3" for a return on ad spend. */
export function formatThreshold(measure: string, value: number): string {
  if (measure === "cpa") return formatPounds(Math.round(value * 100));
  const n = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return PERCENT.has(measure) ? `${n}%` : n;
}

/** "Cost per acquisition (simulated £) at or below £20". */
export function thresholdPhrase(measure: string, value: number): string {
  if (!isKpiMeasure(measure)) return formatThreshold(measure, value);
  const unit = measure === "roas" ? " (simulated revenue for each £1 spent)" : "";
  return `${MEASURE_NAMES[measure]} ${HEALTHY_WHEN[measure]} ${formatThreshold(measure, value)}${unit}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "4 ads, £50 a day for 30 days from 6 November 2026 (simulated)". */
export function launchSummary(ads: number, dailyBudgetPence: number, days: number, startsOnDay: string): string {
  return `${plural(ads, "ad")}, ${formatPounds(dailyBudgetPence)} a day for ${plural(days, "day")} from ${startsOnDay} (simulated)`;
}
