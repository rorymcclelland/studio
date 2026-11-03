import { sendEvent } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth/session";
import { uploadResponse } from "@/lib/uploads/upload-response";

// C8-3: POST /brands/<id>/check/upload, the Check an ad page's upload, with
// its own 4 MB limit (src/lib/uploads/upload-response.ts). A route handler, so
// every server action keeps its 1100 KB limit (next.config.ts).

export async function POST(request: Request, ctx: RouteContext<"/brands/[id]/check/upload">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  return uploadResponse(user?.id ?? null, id, request, sendEvent);
}
