import type { LayoutId } from "./layouts";

// C7-1: the sizes each ad channel needs, as data. An ad (one row in
// ad_variants) is drawn in every size of its channel on request
// (/ads/<id>/<size>.png); nothing is stored per size. Paid social uses the four
// social canvases; display uses the three IAB banners Rory chose (Q2). Each
// size lists the layouts it can draw: the social sizes draw the ad's own layout
// (Full bleed, Split or Card) and fall back to another only if that one can't
// hold the words; the banners have one compact layout of their own (headline,
// button, logo and legal lines, no body).

/** The layouts a size can draw: the three ad layouts, and the banners' compact one. */
export type DrawLayoutId = LayoutId | "banner";

export type SizeChannel = "paid social" | "display";

export type SizeSpec = {
  /** In the address: /ads/<id>/<id>.png. Width × height in pixels. */
  id: SizeId;
  width: number;
  height: number;
  channel: SizeChannel;
  /** Shown to people ("4:5 portrait", "Leaderboard"). */
  name: string;
  /** "4:5" for social sizes; the IAB name's size for banners. */
  ratio: string;
  /** Used in refusals: "the legal lines don't fit a 728 × 90 leaderboard at a readable size". */
  phrase: string;
  /** In the order tried. */
  layouts: readonly DrawLayoutId[];
};

export const SIZE_IDS = ["1080x1080", "1080x1350", "1080x1920", "1200x628", "300x250", "300x600", "728x90"] as const;
export type SizeId = (typeof SIZE_IDS)[number];

/** The square every ad was drawn in before sizes; /ads/<id> and /ads/<id>.png are this size. */
export const SQUARE: SizeId = "1080x1080";

const SOCIAL_LAYOUTS: readonly LayoutId[] = ["full-bleed", "split", "card"];

export const SIZES: Record<SizeId, SizeSpec> = {
  "1080x1080": { id: "1080x1080", width: 1080, height: 1080, channel: "paid social", name: "1:1 square", ratio: "1:1", phrase: "a 1:1 (1080 × 1080) square", layouts: SOCIAL_LAYOUTS },
  "1080x1350": { id: "1080x1350", width: 1080, height: 1350, channel: "paid social", name: "4:5 portrait", ratio: "4:5", phrase: "a 4:5 (1080 × 1350) portrait", layouts: SOCIAL_LAYOUTS },
  "1080x1920": { id: "1080x1920", width: 1080, height: 1920, channel: "paid social", name: "9:16 story", ratio: "9:16", phrase: "a 9:16 (1080 × 1920) story", layouts: SOCIAL_LAYOUTS },
  "1200x628": { id: "1200x628", width: 1200, height: 628, channel: "paid social", name: "1.91:1 landscape", ratio: "1.91:1", phrase: "a 1.91:1 (1200 × 628) landscape", layouts: SOCIAL_LAYOUTS },
  "300x250": { id: "300x250", width: 300, height: 250, channel: "display", name: "Medium rectangle", ratio: "300 × 250", phrase: "a 300 × 250 medium rectangle", layouts: ["banner"] },
  "300x600": { id: "300x600", width: 300, height: 600, channel: "display", name: "Half page", ratio: "300 × 600", phrase: "a 300 × 600 half page", layouts: ["banner"] },
  "728x90": { id: "728x90", width: 728, height: 90, channel: "display", name: "Leaderboard", ratio: "728 × 90", phrase: "a 728 × 90 leaderboard", layouts: ["banner"] },
};

export function isSizeId(id: string): id is SizeId {
  return (SIZE_IDS as readonly string[]).includes(id);
}

/** The sizes of a channel, in display order; none for a channel that has no ads. */
export function sizesFor(channel: string): SizeSpec[] {
  return SIZE_IDS.map((id) => SIZES[id]).filter((s) => s.channel === channel);
}

/** The layouts to try for an ad in a size: its own layout first when the size draws it, then the size's others. */
export function layoutsToTry(size: SizeSpec, own: LayoutId): DrawLayoutId[] {
  return size.layouts.includes(own) ? [own, ...size.layouts.filter((l) => l !== own)] : [...size.layouts];
}

/**
 * A picture enlarged more than this is noted in the Sizes view ("upscaled from
 * a 1K picture"). A few per cent is invisible: every 1K picture is drawn at
 * 1080 in the square (1.05 times), which is how every ad looked before sizes.
 */
export const UPSCALE_NOTE_ABOVE = 1.1;
