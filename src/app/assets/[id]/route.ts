import type { NextRequest } from "next/server";
import { assetResponse } from "@/lib/assets/serve";
import { getCurrentUser } from "@/lib/auth/session";

// S5-1: a stored picture, read through asUser() (rule 7). Another workspace's
// asset, a malformed id and a signed-out request all get the same 404. A
// matching If-None-Match gets a 304 after the access check (review finding 8).
export async function GET(request: NextRequest, ctx: RouteContext<"/assets/[id]">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  return assetResponse(user?.id ?? null, id, request.headers.get("if-none-match"));
}
