import type { SendEvent } from "@/lib/agents/runs";
import { asUser } from "@/lib/db/scoped";
import { UPLOAD_MAX_BYTES } from "./file";
import { NOT_YOURS, UploadError, uploadAd } from "./repo";

// C8-3: what POST /brands/<id>/check/upload answers (the Check an ad page's
// upload). Kept out of the route file so tests can call it; the route only
// adds the session. A route handler, not a server action, so the 4 MB upload
// has its own limit without raising every server action's (next.config.ts
// keeps 1100 KB for the logo). The body is read up to the limit and no
// further. Only a signed-in member's same-origin request is taken (a server
// action checks the origin itself; a route handler must). The click that
// sends it shows the cost of the check that follows (rule 3). Refusals are
// JSON with the reason; nothing is stored.

/**
 * The file, plus the multipart framing and the two small fields: 4 MB and 64
 * KB, under the 4.5 MB production's host takes in a request (Rory, decision
 * 0025), so Studio's own refusal is the one a person sees.
 */
export const BODY_LIMIT = UPLOAD_MAX_BYTES + 64 * 1024;
const TOO_LARGE = "The file is too large (4 MB at most). Nothing was stored.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const refuse = (status: number, error: string) => reply(status, { ok: false, error });

/** The request came from a page of this site (the Origin header names this host). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const expected = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return host === expected.split(",")[0].trim();
}

/** The body, or null once it passes the limit (the rest is never read). */
async function readBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The upload's answer for a signed-in user (or null), the brand in the address, and the request. */
export async function uploadResponse(userId: string | null, brandId: string, request: Request, send: SendEvent): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, "This upload didn't come from Studio's Check an ad page, so it was refused.");
  if (!userId) return refuse(401, "Sign in again to upload an ad. Nothing was stored.");
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) return refuse(400, "Send the ad as a file from the Check an ad page.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) return refuse(413, TOO_LARGE);
  const body = await readBody(request);
  if (!body) return refuse(413, TOO_LARGE);

  let form: FormData;
  try {
    form = await new Response(body as BodyInit, { headers: { "content-type": type } }).formData();
  } catch {
    return refuse(400, "The upload couldn't be read. Choose the file again and try once more.");
  }
  const file = form.get("ad");
  if (!(file instanceof File) || file.size === 0) return refuse(400, "Choose a PNG or JPEG file first.");
  if (file.size > UPLOAD_MAX_BYTES) return refuse(413, TOO_LARGE);

  // The workspace is the brand's, read through asUser as uploadAd's own check reads it (review nit 12): a brand
  // the person can't see is the same answer as no brand, and nothing is made for them.
  const workspaceId = UUID.test(brandId)
    ? await asUser(userId, async (tx) => {
        const [b] = await tx`select workspace_id from public.brands where id = ${brandId}`;
        return (b?.workspace_id as string | undefined) ?? null;
      })
    : null;
  if (!workspaceId) return refuse(404, NOT_YOURS);
  try {
    const r = await uploadAd(
      { userId, workspaceId },
      brandId,
      { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      { channel: String(form.get("channel") ?? ""), lang: String(form.get("lang") ?? "") },
      send,
    );
    return reply(200, {
      ok: true,
      href: `/brands/${brandId}/check/${r.assetId}`,
      done: r.error ?? "Uploaded. The Read ad agent is reading the ad; the check takes a few seconds.",
      started: r.runId !== null,
    });
  } catch (err) {
    if (err instanceof UploadError) return refuse(err.message === NOT_YOURS ? 404 : 422, err.message === NOT_YOURS ? err.message : `${err.message} Nothing was stored.`);
    console.error("[check/upload]", { brandId }, err);
    return refuse(500, "Couldn't upload the ad. Nothing was stored; try again.");
  }
}
