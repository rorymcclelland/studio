import { getCurrentUser } from "@/lib/auth/session";
import { packResponse } from "@/lib/creative/pack";

// C7-3: the launch pack (/campaigns/<id>/pack.zip). Every picked ad of the
// signed-off brief, in every size and language that passed its checks, with
// manifest.json, manifest.csv and README.txt, streamed as it is drawn
// (decision 0020): a buffered function response is capped at 4.5 MB on
// Vercel; a streamed one isn't. No session, a malformed id and another
// workspace's campaign are the same 404 (rule 7); no sign-off or nothing
// picked is a 409 with the reason. A download publishes nothing and spends
// nothing, so it needs no approval (rule 3, Q6). Per-user, request-time work.

// Drawing takes about half a second a file; a large pack can take minutes.
export const maxDuration = 300;

export async function GET(_request: Request, ctx: RouteContext<"/campaigns/[id]/pack.zip">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  return packResponse(user?.id ?? null, id);
}
