import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { adResponse } from "@/lib/creative/ad-serve";

// S5-3: a finished ad, drawn in code from its picture, words, logo and legal
// lines (rule 8), read through asUser() (rule 7). /ads/<id> and /ads/<id>.png
// both work. Another workspace's variant, a malformed id, a signed-out request
// and a variant whose picture or words were discarded all get the same 404.
// Per-user data, so never prerendered or shared-cached: the session read and
// the request headers make this request-time work under Cache Components.
export async function GET(request: NextRequest, ctx: RouteContext<"/ads/[variantId]">) {
  const { variantId } = await ctx.params;
  const user = await getCurrentUser();
  return adResponse(user?.id ?? null, variantId, request.headers.get("if-none-match"));
}
