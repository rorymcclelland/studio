import { etagMatches } from "@/lib/http/etag";
import { drawableVariant, drawVariant } from "./variants";

// S5-3: what /ads/[variantId] answers. Kept out of the route file so tests can
// call it with a user id; the route only adds the session and the request's
// If-None-Match.
//
// The PNG is drawn on request from the variant's parts, through asUser()
// (rule 7). Its ETag is made from the parts' hashes and the layout, so a
// browser revalidates (`private, no-cache`) and gets a 304 without a drawing
// while nothing changed; switching the layout changes the ETag. A small
// in-process cache keeps recent drawings, so a gallery reload doesn't redraw
// twelve ads.

const NOT_FOUND = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

const CACHE_MAX = 48;
declare global {
  var __csAdCache: Map<string, Buffer> | undefined;
}
const cache: Map<string, Buffer> = (globalThis.__csAdCache ??= new Map());

function remember(etag: string, png: Buffer) {
  cache.delete(etag);
  cache.set(etag, png);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Forgets cached drawings (tests). */
export function clearAdCache() {
  cache.clear();
}

/** The id from the path: a variant id, with or without a ".png" suffix. */
export function variantIdFromPath(segment: string): string {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    return "";
  }
  return s.toLowerCase().endsWith(".png") ? s.slice(0, -4) : s;
}

/** A drawn ad for the signed-in user, or a plain 404 (signed out, another workspace's, malformed, or its picture or words discarded). */
export async function adResponse(userId: string | null, segment: string, ifNoneMatch: string | null = null): Promise<Response> {
  const variant = userId ? await drawableVariant(userId, variantIdFromPath(segment)) : null;
  if (!variant || !userId) return NOT_FOUND();
  const headers = {
    "cache-control": "private, no-cache",
    etag: variant.etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (etagMatches(ifNoneMatch, variant.etag)) return new Response(null, { status: 304, headers });

  let png = cache.get(variant.etag);
  if (!png) {
    const drawn = await drawVariant(userId, variant);
    if ("refused" in drawn) {
      // The checks passed when the variant was made, so this is unexpected (a font file missing, say).
      console.error("[ads] a stored variant could not be drawn", { variantId: variant.id, reason: drawn.refused });
      return new Response(`This ad can't be drawn: ${drawn.refused}`, {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
      });
    }
    png = drawn.png;
    remember(variant.etag, png);
  }
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { ...headers, "content-type": "image/png", "content-length": String(png.length) },
  });
}
