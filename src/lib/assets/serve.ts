import { readAsset } from "./store";

// S5-1: what /assets/[id] answers. Kept out of the route file so tests can
// call it with a user id; the route only adds the session.

/** An asset's bytes for the signed-in user, or a plain 404 (signed out, another workspace's, or not an id: all look the same). */
export async function assetResponse(userId: string | null, id: string): Promise<Response> {
  const asset = userId ? await readAsset(userId, id) : null;
  if (!asset) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  }
  return new Response(new Uint8Array(asset.bytes), {
    status: 200,
    headers: {
      "content-type": asset.mime,
      "content-length": String(asset.bytes.length),
      // Assets are append-only (their bytes never change), so a browser may keep one for good; never a shared cache.
      "cache-control": "private, max-age=31536000, immutable",
      etag: `"${asset.sha256}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
