// U10-8 (answer B1) The campaigns list's filters and address, as the runs
// list's: a brand and a status, paged 20 at a time by a cursor. Pure, so the
// page, the query and the tests agree. The status keys are the states the list
// shows (campaignStatusLabel), so a filter matches exactly what a row says.
import { filterNote, firstParam, listHref, uuidOrNull, type SearchParams } from "@/lib/agents/run-list";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatusFacts } from "./status";

export const CAMPAIGNS_PAGE_SIZE = 20;

export const CAMPAIGN_FILTER_KEYS = ["brand", "status"] as const;
export type CampaignFilterKey = (typeof CAMPAIGN_FILTER_KEYS)[number];

export type CampaignStatusKey = "writing" | "draft" | "waiting" | "signedOff" | "launchWaiting" | "live" | "ended";

/** The status filter's choices, in the order a campaign moves through them, in the list's words. */
export const CAMPAIGN_STATUS_FILTERS: readonly { id: CampaignStatusKey; label: string }[] = [
  { id: "writing", label: CAMPAIGN_STATUS_LABELS.writing },
  { id: "draft", label: CAMPAIGN_STATUS_LABELS.draft },
  { id: "waiting", label: CAMPAIGN_STATUS_LABELS.waiting },
  { id: "signedOff", label: CAMPAIGN_STATUS_LABELS.signedOff },
  { id: "launchWaiting", label: CAMPAIGN_STATUS_LABELS.launchWaiting },
  { id: "live", label: "Live" },
  { id: "ended", label: CAMPAIGN_STATUS_LABELS.ended },
];

const STATUS_KEYS: readonly string[] = CAMPAIGN_STATUS_FILTERS.map((s) => s.id);

/**
 * The state a campaign's row shows, with campaignStatusLabel's precedence: a live launch, a launch waiting, an
 * ended launch, then the brief's own state; an unknown status is a draft.
 */
export function campaignStatusKey(facts: CampaignStatusFacts): CampaignStatusKey {
  if (facts.launches.some((l) => l.status === "live")) return "live";
  if (facts.launches.some((l) => l.status === "awaiting_approval")) return "launchWaiting";
  if (facts.launches.some((l) => l.status === "ended")) return "ended";
  if (facts.status === "drafting" || facts.currentVersion === 0) return "writing";
  if (facts.status === "awaiting_signoff") return "waiting";
  if (facts.status === "approved") return "signedOff";
  return "draft";
}

export type CampaignFilters = { brand: string | null; status: CampaignStatusKey | null };

/** The campaigns list's filters and cursor from its address. Never throws. */
export function parseCampaignFilters(params: SearchParams): { filters: CampaignFilters; before: string | null; ignored: CampaignFilterKey[] } {
  const filters: CampaignFilters = { brand: null, status: null };
  const ignored: CampaignFilterKey[] = [];
  const brand = firstParam(params, "brand");
  if (brand !== null) {
    filters.brand = uuidOrNull(brand);
    if (filters.brand === null) ignored.push("brand");
  }
  const status = firstParam(params, "status");
  if (status !== null) {
    if (STATUS_KEYS.includes(status)) filters.status = status as CampaignStatusKey;
    else ignored.push("status");
  }
  return { filters, before: campaignCursorOrNull(firstParam(params, "before")), ignored };
}

/**
 * The campaigns list's cursor: the last row's position, `<updated_at in microseconds since 1970>_<campaign id>`.
 * A campaign's updated_at moves whenever it changes, so the cursor carries the position it was shown at rather
 * than looking it up again (which could repeat page 1 or skip campaigns that changed in between).
 */
export type CampaignCursor = { micros: string; id: string };

const CURSOR = /^(\d{1,18})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function campaignCursor(c: CampaignCursor): string {
  return `${c.micros}_${c.id}`;
}

/** A well-formed cursor in lower case, or null (a bare id, or anything else, gives the first page). */
export function campaignCursorOrNull(value: string | null): string | null {
  return value !== null && CURSOR.test(value) ? value.toLowerCase() : null;
}

export function parseCampaignCursor(value: string | null): CampaignCursor | null {
  const m = value === null ? null : CURSOR.exec(value);
  return m ? { micros: m[1], id: m[2].toLowerCase() } : null;
}

/** The campaigns list's address for these filters, and the page after `before`. */
export function campaignsHref(filters: Partial<CampaignFilters>, before?: string | null): string {
  return listHref("/campaigns", [
    ["brand", filters.brand],
    ["status", filters.status],
    ["before", before],
  ]);
}

/** The plain note for filters Studio didn't recognise, in the runs list's words. */
export function campaignFilterNote(ignored: readonly string[]): string | null {
  return filterNote(ignored);
}
