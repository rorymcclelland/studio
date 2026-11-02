import type { Tx } from "@/lib/db/scoped";
import { fitInSizes } from "./ad-sizes";
import { kitHash, RENDER_VERSION, SIZES_VERSION, type AdChannel, type KitSnapshot, type LayoutId } from "./variants";

// Whether a set of words fits each size of its channel, worked out without
// drawing (fitInSizes). Fitting is pure in the words, legal lines, layout, kit
// and renderer, and copy sets never change, so each set, layout and kit is
// fitted once per instance (the campaign page refreshes while runs go). The
// launch pack's plan (C7-3) and the gallery's translated thumbnails (review
// fix 8) share it.

export type FitResult = Awaited<ReturnType<typeof fitInSizes>>;
export type FitBase = Parameters<typeof fitInSizes>[0];

const FIT_MAX = 600;
declare global {
  var __csPackFitCache: Map<string, FitResult> | undefined;
}
const fitCache: Map<string, FitResult> = (globalThis.__csPackFitCache ??= new Map());

export async function fitsFor(setId: string, base: FitBase, layout: LayoutId, channel: AdChannel, kit: KitSnapshot): Promise<FitResult> {
  const key = [RENDER_VERSION, SIZES_VERSION, setId, layout, channel, kitHash(kit)].join("|");
  const hit = fitCache.get(key);
  if (hit) return hit;
  const fits = await fitInSizes(base, layout, channel);
  fitCache.set(key, fits);
  while (fitCache.size > FIT_MAX) fitCache.delete(fitCache.keys().next().value as string);
  return fits;
}

/** Forgets the fits (tests). */
export function clearFitCache() {
  fitCache.clear();
}

/** A frozen kit's logo as the renderer takes it: the SVG, or an uploaded PNG's bytes (read once per asset through `logos`). */
export async function logoFor(tx: Tx, kit: KitSnapshot, logos: Map<string, Buffer | null>): Promise<FitBase["logo"]> {
  if (!kit.logo) return null;
  if ("svg" in kit.logo) return { svg: kit.logo.svg };
  const id = kit.logo.assetId;
  if (!logos.has(id)) {
    const [l] = await tx`select bytes from public.assets where id = ${id}`;
    logos.set(id, l ? (l.bytes as Buffer) : null);
  }
  const png = logos.get(id) ?? null;
  return png ? { png } : null;
}

/** The words, legal lines and kit as fitInSizes takes them. */
export function fitBase(words: { headline: string; body: string; cta: string }, legalLines: string[], logo: FitBase["logo"], kit: KitSnapshot): FitBase {
  return {
    copy: { headline: words.headline, body: words.body, cta: words.cta },
    legalLines,
    logo,
    palette: kit.palette,
    fontPrimary: kit.fontPrimary,
    fontSecondary: kit.fontSecondary,
    brandName: kit.brandName,
  };
}
