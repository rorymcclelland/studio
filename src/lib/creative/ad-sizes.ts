import { asUser } from "@/lib/db/scoped";
import type { RenderChecks } from "./render/render";
import { renderAd } from "./render/render";
import { isSizeId, layoutsToTry, sizesFor, SIZES, SQUARE, UPSCALE_NOTE_ABOVE, type DrawLayoutId, type SizeId, type SizeSpec } from "./render/sizes";
import { adEtag, drawableVariant, loadParts, renderInputFor, type DrawableVariant, type VariantParts } from "./variants";

// C7-1: an ad in every size of its channel, drawn on request from its one
// ad_variants row (nothing is stored per size). The square is the ad as it has
// always been drawn (its own layout, the same ETag as /ads/<id>.png); the
// other sizes try the ad's layout first, then the size's others, and record
// which one drew it. A size that can't hold the words or the legal lines at
// its smallest readable step is refused with the renderer's plain reason, and
// the other sizes are unaffected. Drawings, their checks and refusals are
// cached in-process by ETag, so the Sizes view and the thumbnails it shows
// draw each size once.

export type SizeDrawing =
  | { ok: true; png: Buffer; checks: RenderChecks<DrawLayoutId>; layout: DrawLayoutId }
  | { ok: false; refused: string };

const CACHE_MAX_ENTRIES = 160;
const CACHE_MAX_BYTES = 96 * 1024 * 1024;
type Cached = SizeDrawing;
declare global {
  var __csAdSizeCache: { map: Map<string, Cached>; bytes: number } | undefined;
}
const cache = (globalThis.__csAdSizeCache ??= { map: new Map(), bytes: 0 });
const sizeOf = (c: Cached) => (c.ok ? c.png.length : 256);

function remember(key: string, value: Cached) {
  const old = cache.map.get(key);
  if (old) {
    cache.bytes -= sizeOf(old);
    cache.map.delete(key);
  }
  cache.map.set(key, value);
  cache.bytes += sizeOf(value);
  while (cache.map.size > CACHE_MAX_ENTRIES || cache.bytes > CACHE_MAX_BYTES) {
    const first = cache.map.keys().next().value as string;
    cache.bytes -= sizeOf(cache.map.get(first)!);
    cache.map.delete(first);
  }
}

/** Forgets cached size drawings (tests). */
export function clearSizeCache() {
  cache.map.clear();
  cache.bytes = 0;
}

/** The size from the path ("728x90.png" or "728x90"), or null for anything else. */
export function sizeFromPath(segment: string): SizeId | null {
  let s: string;
  try {
    s = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const id = s.toLowerCase().endsWith(".png") ? s.slice(0, -4) : s;
  return isSizeId(id) ? id : null;
}

/** The ETag of an ad in a size: the square keeps the ad's own (it is the same drawing); other sizes add the size. */
export function sizeEtag(v: DrawableVariant, size: SizeId): string {
  return size === SQUARE ? v.etag : adEtag({ ...v.etagParts, size });
}

/** The variant, if the user may see it and the size belongs to its channel; null otherwise (all answered 404 alike). */
export async function sizedVariant(userId: string | null, variantId: string, size: SizeId | null): Promise<DrawableVariant | null> {
  if (!userId || !size) return null;
  const v = await drawableVariant(userId, variantId);
  if (!v || SIZES[size].channel !== v.channel) return null;
  return v;
}

async function draw(parts: VariantParts, v: DrawableVariant, size: SizeSpec): Promise<SizeDrawing> {
  // The square draws only the ad's layout, as /ads/<id>.png always has; other sizes may fall back.
  const layouts: DrawLayoutId[] = size.id === SQUARE ? [v.layout] : layoutsToTry(size, v.layout);
  const reasons: string[] = [];
  for (const layout of layouts) {
    const r = await renderAd({ ...renderInputFor(parts, v.layout), layout, size: size.id });
    if (!("refused" in r)) return { ok: true, png: r.png, checks: r.checks, layout };
    reasons.push(r.refused);
  }
  // One reason when the size has one layout (the banners); otherwise each layout's, in the order tried.
  return { ok: false, refused: [...new Set(reasons)].join("; ") };
}

/** Draws (or recalls) an ad in one size. */
export async function drawInSize(userId: string, v: DrawableVariant, size: SizeId, parts?: VariantParts | null): Promise<SizeDrawing> {
  const key = sizeEtag(v, size);
  const hit = cache.map.get(key);
  if (hit) return hit;
  const p = parts ?? (await asUser(userId, (tx) => loadParts(tx, v.imageAssetId, v.copySetId, v.kit)));
  if (!p) return { ok: false, refused: "the picture or the words could not be read" };
  const drawn = await draw(p, v, SIZES[size]);
  remember(key, drawn);
  return drawn;
}

export type SizeView = {
  size: SizeId;
  name: string;
  ratio: string;
  width: number;
  height: number;
  /** The drawn ad in this size (PNG). */
  src: string;
} & (
  | {
      ok: true;
      layout: DrawLayoutId;
      layoutName: string;
      /** The ad's own layout couldn't hold the words in this size, so another drew it. */
      fellBack: boolean;
      badges: { key: "contrast" | "fit" | "legal" | "logo" | "simulated" | "upscaled"; label: string; tone: "good" | "warn" | "info"; detail: string }[];
    }
  | { ok: false; reason: string }
);

const LAYOUT_LABEL: Record<DrawLayoutId, string> = { "full-bleed": "Full bleed", split: "Split", card: "Card", banner: "Banner" };

function badgesFor(checks: RenderChecks<DrawLayoutId>, size: SizeSpec): Extract<SizeView, { ok: true }>["badges"] {
  const ratio = Math.min(checks.contrast.headline, checks.contrast.cta);
  const badges: Extract<SizeView, { ok: true }>["badges"] = [
    { key: "contrast", label: `Contrast ${ratio.toFixed(1)}:1`, tone: "good", detail: `Text ${checks.contrast.headline.toFixed(1)}:1 on its panel, button ${checks.contrast.cta.toFixed(1)}:1 (AA).` },
    { key: "fit", label: `Fits ${size.name}`, tone: "good", detail: `Headline at ${checks.fit.headline.size} px${checks.fit.body.lines.length ? `, body at ${checks.fit.body.size} px` : ""}${checks.fit.legal.lines.length ? `, legal lines at ${checks.fit.legal.size} px` : ""}.` },
    checks.legalLinePresent
      ? { key: "legal", label: "Legal lines", tone: "good", detail: `Every legal line is drawn (${checks.fit.legal.lines.length} ${checks.fit.legal.lines.length === 1 ? "line" : "lines"}).` }
      : { key: "legal", label: "No legal line", tone: "warn", detail: checks.legalNote ?? "No legal line in the kit." },
  ];
  if (checks.logo === "none") badges.push({ key: "logo", label: "No logo", tone: "warn", detail: "The brand has no logo yet. Upload one on the brand page." });
  if (checks.simulatedLabel) badges.push({ key: "simulated", label: "Simulated image", tone: "info", detail: "Drawn by the mock image model, not a real one." });
  const pic = checks.picture;
  if (pic && pic.upscale > UPSCALE_NOTE_ABOVE) {
    const oneK = Math.max(pic.source.width, pic.source.height) <= 1024;
    badges.push({
      key: "upscaled",
      label: oneK ? "Upscaled from a 1K picture" : "Upscaled picture",
      tone: "warn",
      detail: `The picture is ${pic.source.width} × ${pic.source.height} and is enlarged ${pic.upscale.toFixed(2)} times to fill ${pic.box.width} × ${pic.box.height}, so it may look soft. Pictures drawn from Sprint 7 are 2K.`,
    });
  }
  return badges;
}

/**
 * Every size of an ad's channel, drawn (or recalled) with its badges or its
 * refusal: what the Sizes view shows. Null when the user can't see the ad.
 */
export async function adSizes(
  userId: string,
  variantId: string,
): Promise<{ variantId: string; campaignId: string; channel: string; headline: string; sizes: SizeView[] } | null> {
  const v = await drawableVariant(userId, variantId);
  if (!v) return null;
  const [row] = await asUser(userId, (tx) => tx`
    select v.campaign_id, s.set ->> 'headline' as headline
    from public.ad_variants v join public.copy_sets s on s.id = v.copy_set_id where v.id = ${v.id}`);
  if (!row) return null;
  const sizes = sizesFor(v.channel);
  let parts: VariantParts | null | undefined;
  const views: SizeView[] = [];
  for (const size of sizes) {
    const key = sizeEtag(v, size.id);
    if (!cache.map.has(key) && parts === undefined) parts = await asUser(userId, (tx) => loadParts(tx, v.imageAssetId, v.copySetId, v.kit));
    const d = await drawInSize(userId, v, size.id, parts ?? null);
    const base = { size: size.id, name: size.name, ratio: size.ratio, width: size.width, height: size.height, src: `/ads/${v.id}/${size.id}.png` };
    views.push(
      d.ok
        ? { ...base, ok: true, layout: d.layout, layoutName: LAYOUT_LABEL[d.layout], fellBack: d.layout !== v.layout && d.layout !== "banner", badges: badgesFor(d.checks, size) }
        : { ...base, ok: false, reason: sentence(d.refused) },
    );
  }
  return { variantId: v.id, campaignId: row.campaign_id as string, channel: v.channel, headline: (row.headline as string) ?? "", sizes: views };
}

/** "the legal lines don't fit ..." as a sentence for people. */
export function sentence(reason: string): string {
  const s = reason.trim();
  return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}` : s;
}
