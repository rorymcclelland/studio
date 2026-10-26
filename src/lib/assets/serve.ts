import { etagMatches } from "@/lib/http/etag";
import { readAsset } from "./store";

// S5-1: what /assets/[id] answers. Kept out of the route file so tests can
// call it with a user id and the request's If-None-Match; the route only adds
// the session.

/**
 * An asset's bytes for the signed-in user, or a plain 404 (signed out, another
 * workspace's, or not an id: all look the same). The bytes never change, but a
 * browser keeps them only until it revalidates (`private, no-cache`), so a
 * shared device doesn't hold a workspace's pictures after sign-out (review
 * finding 8). A matching ETag gets a 304, and only after the access check.
 */
export async function assetResponse(userId: string | null, id: string, ifNoneMatch: string | null = null): Promise<Response> {
  const asset = userId ? await readAsset(userId, id) : null;
  if (!asset) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  }
  const etag = `"${asset.sha256}"`;
  const headers = {
    "cache-control": "private, no-cache",
    etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (etagMatches(ifNoneMatch, etag)) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(asset.bytes), {
    status: 200,
    headers: { ...headers, "content-type": asset.mime, "content-length": String(asset.bytes.length) },
  });
}
