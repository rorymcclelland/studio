// U10-3: the Creative stage's gallery filter and the card's state, pure (no
// server imports), so CI checks every combination
// (tests/lib/gallery-filter.test.ts). Which filter an address asks for
// (?show= and ?audience=; anything unknown reads as All), which ads each
// filter shows and its count, an ad's state on its card, the line an ad in a
// launch shows, which tools its card offers, and the sentences the server
// refuses with. An ad in a live launch, or in one waiting for approval, is
// locked: nothing that changes what it shows (rule 3).

export const GALLERY_SHOWS = ["all", "picked", "decide", "launched"] as const;
export type GalleryShow = (typeof GALLERY_SHOWS)[number];

export const SHOW_LABELS: Record<GalleryShow, string> = {
  all: "All",
  picked: "Picked",
  decide: "Needs a decision",
  launched: "Launched",
};

type Param = string | string[] | null | undefined;
const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : (value ?? undefined));

/** The filter an address asks for: an exact value, or the first of a repeated parameter; anything else is All. */
export function parseShow(value: Param): GalleryShow {
  const v = first(value);
  return (GALLERY_SHOWS as readonly string[]).includes(v ?? "") ? (v as GalleryShow) : "all";
}

/** The audience an address asks for: one of the campaign's own segment refs, else null (every audience). */
export function parseAudience(value: Param, refs: readonly string[]): string | null {
  const v = first(value);
  return v !== undefined && refs.includes(v) ? v : null;
}

/** The launch that holds an ad: live, waiting for approval, or none (ended and refused launches hold nothing). */
export type LaunchHold = "live" | "awaiting_approval" | null;

/** What the filter and the card need to know about one ad. */
export type AdFacts = { id: string; picked: boolean; toDecide: boolean; launch: LaunchHold; segmentRef: string | null };

type FactsSource = {
  id: string;
  picked: boolean;
  briefVersion: number;
  launch: { launchId: string; status: "live" | "awaiting_approval" } | null;
  words: { audience: { segmentRef: string | null } };
};

/**
 * Each ad's facts. An ad needs a decision as U10-2's overview counts it:
 * picked, made for the signed-off version, and its compliance pill to review.
 */
export function factsFor(variants: readonly FactsSource[], version: number | null, pills: Record<string, { tone: string } | undefined>): AdFacts[] {
  return variants.map((v) => ({
    id: v.id,
    picked: v.picked,
    toDecide: version !== null && v.picked && v.briefVersion === version && pills[v.id]?.tone === "review",
    launch: v.launch?.status ?? null,
    segmentRef: v.words.audience.segmentRef,
  }));
}

/** Whether a filter shows an ad. Launched is the live launch only: a waiting launch isn't running. */
export function matchesShow(ad: AdFacts, show: GalleryShow): boolean {
  switch (show) {
    case "picked":
      return ad.picked;
    case "decide":
      return ad.toDecide;
    case "launched":
      return ad.launch === "live";
    default:
      return true;
  }
}

/** How many ads each filter shows. */
export function showCounts(ads: readonly AdFacts[]): Record<GalleryShow, number> {
  return Object.fromEntries(GALLERY_SHOWS.map((s) => [s, ads.filter((a) => matchesShow(a, s)).length])) as Record<GalleryShow, number>;
}

/** The ads a filter shows, for one audience or every one (null), in the gallery's order. */
export function filterAds<T extends AdFacts>(ads: readonly T[], show: GalleryShow, audience: string | null): T[] {
  return ads.filter((a) => (audience === null || a.segmentRef === audience) && matchesShow(a, show));
}

/** The one line a filter with no ads shows instead of an empty gallery. */
export function emptyLine(show: GalleryShow): string {
  switch (show) {
    case "picked":
      return "No ad is picked yet.";
    case "decide":
      return "No picked ad needs a compliance decision.";
    case "launched":
      return "No ad is in a live launch (simulated).";
    default:
      return "No ads yet.";
  }
}

/** The gallery's address for a filter: no ?show= for All, then the audience. */
export function galleryHref(campaignId: string, { show, audience }: { show: GalleryShow; audience: string | null }): string {
  const params: string[] = [];
  if (show !== "all") params.push(`show=${encodeURIComponent(show)}`);
  if (audience !== null) params.push(`audience=${encodeURIComponent(audience)}`);
  return `/campaigns/${campaignId}/creative${params.length ? `?${params.join("&")}` : ""}`;
}

export type AdState = "discarded" | "launched" | "decide" | "picked";

export const AD_STATE_LABELS: Record<AdState, string> = {
  discarded: "Discarded",
  launched: "Launched",
  decide: "Needs a decision",
  picked: "Picked",
};

/** The one state a card shows, the most pressing first; null for a plain ad. A waiting launch's ad shows what it otherwise is. */
export function adState(ad: AdFacts & { discarded?: boolean }): AdState | null {
  if (ad.discarded) return "discarded";
  if (ad.launch === "live") return "launched";
  if (ad.toDecide) return "decide";
  if (ad.picked) return "picked";
  return null;
}

export const LOCK_LINES: Record<"live" | "awaiting_approval", string> = {
  live: "Running in the launch (simulated)",
  awaiting_approval: "In a launch waiting for approval (simulated)",
};

/** The line on the card of an ad in a launch; null for one in none. */
export function lockLine(launch: LaunchHold): string | null {
  return launch ? LOCK_LINES[launch] : null;
}

/** The server's refusal for an ad in a live launch (case 2's sentence). */
export const RUNNING_IN_LAUNCH = "That ad is running in a launch (simulated), so it can't change until the launch ends.";
/** The server's refusal for an ad in a launch waiting for approval. */
export const WAITING_FOR_LAUNCH = "That ad is in a launch waiting for approval (simulated), so it can't change until the launch is decided.";
/** New or edited words for an ad whose words another ad in a live launch shows. */
export const WORDS_RUNNING_IN_LAUNCH = "Those words are on an ad running in a launch (simulated), so they can't change until the launch ends.";
/** The same, for a launch waiting for approval. */
export const WORDS_WAITING_FOR_LAUNCH = "Those words are on an ad in a launch waiting for approval (simulated), so they can't change until the launch is decided.";

/** The sentence the server refuses a change with, for the ad's own launch, or for another ad on the same words (`shared`). */
export function lockRefusal(status: "live" | "awaiting_approval", shared = false): string {
  if (shared) return status === "live" ? WORDS_RUNNING_IN_LAUNCH : WORDS_WAITING_FOR_LAUNCH;
  return status === "live" ? RUNNING_IN_LAUNCH : WAITING_FOR_LAUNCH;
}

export type AdTool = "layout" | "redraw" | "pick" | "discard" | "new-picture" | "new-words" | "edit-words" | "translate" | "sizes" | "compliance" | "about";

/** The tools that change what an ad shows, so an ad in a live or waiting launch has none of them. */
export const LOCKED_TOOLS: readonly AdTool[] = ["layout", "redraw", "discard", "new-picture", "new-words", "edit-words"];

/** Where each tool lives on the card: its face, or the Edit or More menu. */
export const TOOL_MENU: Record<AdTool, "face" | "edit" | "more"> = {
  pick: "face",
  layout: "edit",
  redraw: "edit",
  "new-picture": "edit",
  "new-words": "edit",
  "edit-words": "edit",
  translate: "more",
  sizes: "more",
  compliance: "more",
  discard: "more",
  about: "more",
};

/**
 * The tools a card offers, in the card's order: none that would change an ad
 * in a live or waiting launch; Redraw only for an ad made with an older kit
 * (F-26); Translate only where the card has always shown it (a picked ad with
 * translations to write).
 */
export function adTools({ picked, launch, olderKit, translate }: { picked: boolean; launch: LaunchHold; olderKit: boolean; translate: boolean }): AdTool[] {
  const all: AdTool[] = ["pick", "layout", "redraw", "new-picture", "new-words", "edit-words", "translate", "sizes", "compliance", "discard", "about"];
  return all.filter((t) => {
    if (launch && LOCKED_TOOLS.includes(t)) return false;
    if (t === "redraw") return olderKit;
    if (t === "translate") return picked && translate;
    return true;
  });
}

// ---------------------------------------------------------------- the gallery's order and length (U10-3, Rory's choice b)

/** How many ads an audience group shows before "Show all N ads", under All. A filter shows every ad it matches. */
export const GROUP_PREVIEW = 6;

/** What the gallery's order needs to know about an ad: its facts, when it was made, and the run that made it. */
export type OrderFacts = AdFacts & { createdAt: Date; runId: string | null };

const TIER: Record<AdState, number> = { launched: 0, decide: 1, picked: 2, discarded: 3 };

/**
 * The order the gallery shows an audience's ads in: launched, then needing a
 * decision, then picked, then the rest; newest first within each. Ads one run
 * made together (Make creative's batch) count as one age and keep the order
 * they were given in, so a batch reads Ad 1, Ad 2, ... and not backwards; an ad
 * made later (a new picture, new or edited words, a redraw) comes before them.
 */
export function galleryOrder<T extends OrderFacts>(ads: readonly T[]): T[] {
  const age = new Map<string, number>();
  for (const a of ads) {
    const key = a.runId ?? a.id;
    age.set(key, Math.max(age.get(key) ?? -Infinity, a.createdAt.getTime()));
  }
  const tier = (a: T) => {
    const s = adState(a);
    return s === null ? 4 : TIER[s];
  };
  return ads
    .map((a, i) => ({ a, i }))
    .sort((x, y) => tier(x.a) - tier(y.a) || age.get(y.a.runId ?? y.a.id)! - age.get(x.a.runId ?? x.a.id)! || x.i - y.i)
    .map((x) => x.a);
}

/** How many of a group's ads show before "Show all": every one under a filter, else GROUP_PREVIEW. */
export function previewCount(show: GalleryShow, total: number): number {
  return show === "all" ? Math.min(total, GROUP_PREVIEW) : total;
}

/** "Show all 12 ads" */
export const showAllLabel = (total: number) => `Show all ${total} ads`;

// ---------------------------------------------------------------- the checks on the picked ads (U10-3, Rory's choice a)

/** What the one line above the folded checks on the picked ads is made from: counts the page already has. */
export type PickedChecksFacts = {
  picked: number;
  /** Picked ads whose compliance waits for a person (the Needs a decision count). */
  toDecide: number;
  /** Picked ads with current pre-test scores, and whether any of those scores came from the mock model. */
  pretested: { count: number; simulated: boolean };
  /** Picked ads with at least one translation, and whether any came from the mock model. */
  translated: { count: number; simulated: boolean };
  /** Pictures with no picture-check result yet. */
  picturesUnchecked: number;
  /** The launch pack: null while it is worked out (or when there is none to work out). */
  packReady: boolean | null;
};

/**
 * The folded checks' one-line state: "Checks on the 4 picked ads: 1 needs a
 * decision, 4 pre-tested (simulated scores), launch pack ready". Simulated
 * figures say so (rule 1).
 */
export function pickedChecksLine(f: PickedChecksFacts): { title: string; state: string } {
  if (f.picked === 0) return { title: "Checks on the picked ads", state: "no ad is picked yet" };
  const parts: string[] = [];
  parts.push(f.toDecide === 0 ? "none needs a decision" : `${f.toDecide} ${f.toDecide === 1 ? "needs" : "need"} a decision`);
  if (f.pretested.count > 0) parts.push(`${f.pretested.count} pre-tested${f.pretested.simulated ? " (simulated scores)" : ""}`);
  if (f.translated.count > 0) parts.push(`${f.translated.count} translated${f.translated.simulated ? " (simulated)" : ""}`);
  if (f.picturesUnchecked > 0) parts.push(`${f.picturesUnchecked} ${f.picturesUnchecked === 1 ? "picture" : "pictures"} not checked yet`);
  if (f.packReady !== null) parts.push(f.packReady ? "launch pack ready" : "no launch pack yet");
  return { title: `Checks on the ${f.picked} picked ${f.picked === 1 ? "ad" : "ads"}`, state: parts.join(", ") };
}
