import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { adSizeResponse } from "@/lib/creative/ad-serve";

// C7-1: an ad in one size of its channel (/ads/<id>/<size>.png, e.g.
// /ads/<id>/1080x1920.png), drawn in code on request (rule 8) through the same
// access check as /ads/<id> (rule 7). An unknown size, a size from the other
// channel, another workspace's ad and a signed-out request all get the same
// 404; a size the words or legal lines don't fit is a 422 with the reason.
// Per-user, request-time work: never prerendered or shared-cached.
export async function GET(request: NextRequest, ctx: RouteContext<"/ads/[variantId]/[size]">) {
  const { variantId, size } = await ctx.params;
  const user = await getCurrentUser();
  // C7-2: ?lang=fr-FR (or de-DE, es-ES) draws the ad in that language, when it has a current translation.
  return adSizeResponse(user?.id ?? null, variantId, size, request.headers.get("if-none-match"), request.nextUrl.searchParams.get("lang"));
}
