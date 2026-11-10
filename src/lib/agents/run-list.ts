// U10-8 The runs list's filters, address and labels. Pure (it imports only
// @/lib/format), so the page, the query and the tests agree on what an address
// means: missing or empty is no filter; a value Studio doesn't recognise is not
// applied and is named in a plain note; `before` is a cursor (the id of the last
// run shown), and a malformed one quietly shows the first page.
import { formatCost, formatPence } from "@/lib/format";

export const RUNS_PAGE_SIZE = 50;

export const RUN_FILTER_KEYS = ["campaign", "agent", "status"] as const;
export type RunFilterKey = (typeof RUN_FILTER_KEYS)[number];

export const RUN_STATUSES = ["queued", "running", "awaiting_approval", "completed", "failed", "rejected", "expired", "stopped_cap"] as const;

export type RunFilters = { campaign: string | null; agent: string | null; status: string | null };
export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A parameter's first value, or null when it is missing or empty. Never reads the prototype. */
export function firstParam(params: SearchParams, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(params, key)) return null;
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value !== "" ? value : null;
}

/** A UUID in lower case, or null. */
export function uuidOrNull(value: string | null): string | null {
  return value !== null && UUID.test(value) ? value.toLowerCase() : null;
}

/** One of `allowed`, exactly, or null. */
function oneOf(value: string, allowed: readonly string[]): string | null {
  return allowed.includes(value) ? value : null;
}

/** The runs list's filters and cursor from its address; `agents` is every agent and workflow key. Never throws. */
export function parseRunFilters(params: SearchParams, agents: readonly string[]): { filters: RunFilters; before: string | null; ignored: RunFilterKey[] } {
  const filters: RunFilters = { campaign: null, agent: null, status: null };
  const ignored: RunFilterKey[] = [];
  const read: Record<RunFilterKey, (v: string) => string | null> = {
    campaign: (v) => uuidOrNull(v),
    agent: (v) => oneOf(v, agents),
    status: (v) => oneOf(v, RUN_STATUSES),
  };
  for (const key of RUN_FILTER_KEYS) {
    const raw = firstParam(params, key);
    if (raw === null) continue;
    const value = read[key](raw);
    if (value === null) ignored.push(key);
    else filters[key] = value;
  }
  return { filters, before: uuidOrNull(firstParam(params, "before")), ignored };
}

/** A list's address: the path, then the set values in the order given, encoded. */
export function listHref(path: string, values: [string, string | null | undefined][]): string {
  const q = new URLSearchParams();
  for (const [key, value] of values) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** The runs list's address for these filters, and the page after `before`. */
export function runsHref(filters: Partial<RunFilters>, before?: string | null): string {
  return listHref("/runs", [
    ["campaign", filters.campaign],
    ["agent", filters.agent],
    ["status", filters.status],
    ["before", before],
  ]);
}

/** "a", "a and b", "a, b and c". */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The plain note for filters Studio didn't recognise, or null when there are none. */
export function filterNote(ignored: readonly string[]): string | null {
  if (ignored.length === 0) return null;
  return `${ignored.length === 1 ? "Filter" : "Filters"} not recognised, so not applied: ${listWords(ignored)}.`;
}

type Costed = { cost_pence: string | number; simulated_pence: string | number };

/** Wholly simulated, by formatCost's rule (sums from the database can differ in the last places). */
const whollySimulated = (r: Costed) => Number(r.simulated_pence) >= Number(r.cost_pence) - 0.0001;

/**
 * The cost column's heading: "Cost (simulated)" when some run shown has a cost and every run with a cost is wholly
 * simulated, so the label is said once; otherwise "Cost", and each row keeps its own words (rule 1).
 */
export function costHeading(runs: readonly Costed[]): "Cost (simulated)" | "Cost" {
  const costed = runs.filter((r) => Number(r.cost_pence) > 0);
  return costed.length > 0 && costed.every(whollySimulated) ? "Cost (simulated)" : "Cost";
}

/** A run's cost under that heading: the amount alone under "Cost (simulated)", else formatCost's words. */
export function runCostText(run: Costed, heading: string): string {
  return heading === "Cost (simulated)" ? formatPence(run.cost_pence) : formatCost(run.cost_pence, run.simulated_pence);
}

/** A run's trail steps in seq order, numbered 1 to n with nothing left out; the input is unchanged. */
export function numberTrailSteps<T extends { seq: number }>(steps: readonly T[]): (T & { number: number })[] {
  return [...steps].sort((a, b) => a.seq - b.seq).map((s, i) => ({ ...s, number: i + 1 }));
}
