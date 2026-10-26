import { createRun, type Member, type SendEvent } from "@/lib/agents/runs";
import { CampaignError } from "@/lib/brief/repo";
import { asUser } from "@/lib/db/scoped";

// S5-1: starting the Imagery agent. Creative starts only from a signed-off
// brief (S4-1: sign-off is the gate before creative), and reads the version
// that was signed off, never a later draft.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NOT_SIGNED_OFF =
  "Sign off the brief to make creative: pictures are drawn only from a signed-off brief, so a person has agreed what the ads say first.";

export async function startImagery(member: Member, campaignId: string, send: SendEvent): Promise<string> {
  if (!UUID.test(campaignId)) throw new CampaignError("That campaign isn't in your workspace.");
  const [c] = await asUser(member.userId, (tx) => tx`
    select c.brand_id, c.status, c.approved_version, b.name
    from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`);
  if (!c) throw new CampaignError("That campaign isn't in your workspace.");
  if (c.status !== "approved" || !c.approved_version) throw new CampaignError(NOT_SIGNED_OFF);
  const version = c.approved_version as number;
  return createRun(member, "imagery", { campaignId, version }, send, { brandId: c.brand_id, label: `${c.name}: pictures (v${version})` });
}
