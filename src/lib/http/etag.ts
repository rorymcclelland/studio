/**
 * Whether a request's If-None-Match matches an ETag: any listed tag, weak or
 * strong (a GET compares weakly), or "*". Shared by /ads and /assets.
 */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const v = t.trim().replace(/^W\//, "");
    return v === etag || v === "*";
  });
}
