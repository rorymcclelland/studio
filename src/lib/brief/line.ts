import { createRun, takeRunLock, type Member, type SendEvent } from "@/lib/agents/runs";
import { taglineCampaign } from "@/lib/agents/tagline";
import { asUser } from "@/lib/db/scoped";
import { CampaignError, StaleBriefError } from "./repo";
import { storedBrief } from "./schema";

// D-4 (Sprint 10b), Suggest lines: the Tagline agent suggests three campaign
// lines from a brief version's title and story, its audiences' names and the
// kit's voice. The run goes through generate() and the cap (rule 5) and has its
// trail (rule 4); it saves nothing to the brief. A person picks a line on the
// Brief stage, which is a brief edit: a new version, signed off with the brief
// (rule 3). Everything is read through asUser() (rule 7).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_YOURS = "That campaign isn't in your workspace.";
const RUNNING = ["queued", "running"];

/** At most this many characters of the kit's voice (the agent's input allows 2,100). */
const VOICE_MAX = 2100;

/**
 * Starts Suggest lines for a campaign's current brief version (`baseVersion`): a "tagline" run with the
 * campaign's context as data. One at a time per campaign, so a double click starts one paid run.
 */
export async function startSuggestLines(member: Member, campaignId: string, baseVersion: number, send: SendEvent): Promise<string> {
  if (!UUID.test(campaignId)) throw new CampaignError(NOT_YOURS);
  const prepared = await asUser(member.userId, async (tx) => {
    const [c] = await tx`
      select c.id, c.current_version, b.id as brand_id, b.name, b.own_names, b.tone_words, b.voice_notes
      from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
    if (!c) throw new CampaignError(NOT_YOURS);
    if (c.current_version !== baseVersion) throw new StaleBriefError();
    const [v] = await tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${baseVersion}`;
    if (!v) throw new CampaignError("There is no brief to suggest lines for yet.");
    const brief = storedBrief.parse(v.brief);
    const refs = brief.audiences.map((a) => a.segmentRef);
    const items = refs.length
      ? await tx`select id::text as id, title from public.context_items where brand_id = ${c.brand_id} and id::text = any(${refs})`
      : [];
    const titles = new Map(items.map((i) => [i.id as string, i.title as string]));
    const tone = (c.tone_words as string[]).join(", ");
    const voice = [tone ? `Tone: ${tone}.` : "", (c.voice_notes as string) ?? ""].filter(Boolean).join(" ").slice(0, VOICE_MAX);
    const campaign = taglineCampaign.parse({
      campaignId: c.id,
      version: baseVersion,
      title: brief.title,
      story: brief.story,
      audiences: refs.map((r) => titles.get(r)).filter((t): t is string => !!t).map((t) => t.slice(0, 120)),
      voice,
      // Review fix B1: the brand's own names, which the agent's check lets a line carry.
      ...((c.own_names as string[] | null)?.length ? { ownNames: c.own_names as string[] } : {}),
    });
    return { brandId: c.brand_id as string, brandName: c.name as string, campaign };
  });
  return createRun(member, "tagline", { brandName: prepared.brandName, campaign: prepared.campaign }, send, {
    brandId: prepared.brandId,
    label: `${prepared.brandName}: suggest lines`,
    guard: async (tx) => {
      await takeRunLock(tx, `suggest-lines:${campaignId}`);
      const [busy] = await tx`
        select 1 from public.agent_runs
        where agent = 'tagline' and input #>> '{campaign,campaignId}' = ${campaignId} and status = any(${RUNNING}::public.run_status[])`;
      if (busy) throw new CampaignError("The Tagline agent is already suggesting lines for this campaign.");
    },
  });
}

/** A Suggest lines run for a brief version: its state, and its lines once done. */
export type LineSuggestionsRun = { runId: string; version: number; status: string; taglines: string[] | null; error: string | null };

/** The latest Suggest lines run for a campaign in the last 7 days, or null. */
export async function latestLineSuggestions(userId: string, campaignId: string): Promise<LineSuggestionsRun | null> {
  if (!UUID.test(campaignId)) return null;
  const [r] = await asUser(userId, (tx) => tx`
    select id, status, input, output, error from public.agent_runs
    where agent = 'tagline' and input #>> '{campaign,campaignId}' = ${campaignId} and created_at > now() - interval '7 days'
    order by created_at desc, id desc limit 1`);
  if (!r) return null;
  const taglines = Array.isArray(r.output?.taglines) ? (r.output.taglines as unknown[]).filter((t): t is string => typeof t === "string") : null;
  return {
    runId: r.id as string,
    version: Number(r.input?.campaign?.version),
    status: r.status as string,
    taglines: taglines && taglines.length ? taglines : null,
    error: (r.error as string | null) ?? null,
  };
}
