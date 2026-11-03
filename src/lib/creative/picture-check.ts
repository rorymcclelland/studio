import { z } from "zod";
import { createWorkflowRun, takeRunLock, type Member, type SendEvent } from "@/lib/agents/runs";
import { asUser, type Tx } from "@/lib/db/scoped";
import { pictureCheckEstimate, type Estimate } from "./costs";

// C8-2: Check pictures, for a campaign's pictures that have no picture-check
// result yet (made before Sprint 8, or whose check errored or hit the cap).
// The click is the person's choice, with the cost on the button first (rule 3);
// each check goes through runModelStep and generate(), so it is traced (rule 4)
// and capped (rule 5). It writes results only: no picture is discarded or
// replaced (a person does that with New picture), and a picture with a result
// is never checked again, so running it twice checks nothing and costs nothing.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PICTURE_CHECK_KEY = "pictureCheck";
export const PICTURE_CHECK_VERSION = 1;
/** The most pictures one run checks (a campaign has four a Make creative, plus any New pictures). */
export const PICTURE_CHECK_MAX = 50;

export const pictureCheckStart = z.object({ campaignId: z.uuid(), assetIds: z.array(z.uuid()).min(1).max(PICTURE_CHECK_MAX) });

export class PictureCheckError extends Error {}

export const ALL_CHECKED = "Every picture in the campaign's ads has been checked by AI.";
export const NOT_SIGNED_OFF_CHECK = "Sign off the brief first: Check pictures looks at the pictures of a signed-off brief's ads.";
export const NO_PICTURES = "No ads yet, so there are no pictures to check.";
export const CHECK_BUSY = "Check pictures is already running for this campaign. It takes a few seconds a picture.";

/**
 * The pictures still to check, oldest first: each picture used by a current ad
 * of the signed-off version, not discarded, whose meta has no result (no
 * vision record, or one that says the check didn't run).
 */
export async function picturesToCheck(tx: Tx, campaignId: string, version: number): Promise<{ todo: { id: string; picture: number }[]; total: number }> {
  const rows = await tx`
    select a.id, coalesce((a.meta ->> 'picture')::int, 1) as picture, a.meta -> 'vision' ->> 'status' as status
    from public.assets a
    where a.campaign_id = ${campaignId} and a.kind = 'image' and a.discarded_at is null
      and exists (select 1 from public.ad_variants v where v.image_asset_id = a.id and v.brief_version = ${version} and v.discarded_at is null)
    order by a.created_at, a.id`;
  const todo = rows.filter((r) => r.status !== "checked").slice(0, PICTURE_CHECK_MAX).map((r) => ({ id: r.id as string, picture: Number(r.picture) }));
  return { todo, total: rows.length };
}

export type PictureCheckPlan = { brandId: string; brandName: string; assetIds: string[]; total: number; estimate: Estimate; refusal: string | null };

export async function pictureCheckPlan(tx: Tx, campaignId: string): Promise<PictureCheckPlan> {
  const [c] = await tx`
    select c.brand_id, c.status, c.approved_version, b.name from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
  if (!c) throw new PictureCheckError("That campaign isn't in your workspace.");
  const base = { brandId: c.brand_id as string, brandName: c.name as string };
  if (c.status !== "approved" || !c.approved_version) return { ...base, assetIds: [], total: 0, estimate: pictureCheckEstimate(0), refusal: NOT_SIGNED_OFF_CHECK };
  const { todo, total } = await picturesToCheck(tx, campaignId, c.approved_version as number);
  const refusal = total === 0 ? NO_PICTURES : todo.length === 0 ? ALL_CHECKED : null;
  return { ...base, assetIds: todo.map((t) => t.id), total, estimate: pictureCheckEstimate(refusal ? 0 : todo.length), refusal };
}

/** The Check pictures button: the pictures it would check, its cost, a run in progress, or why not. */
export type PictureCheckBar = { todo: number; total: number; estimate: string; reason: string | null; runningRunId: string | null };

export async function pictureCheckBar(tx: Tx, campaignId: string): Promise<PictureCheckBar> {
  const plan = await pictureCheckPlan(tx, campaignId);
  const [running] = await tx`
    select id from public.agent_runs
    where agent = ${PICTURE_CHECK_KEY} and status in ('queued', 'running') and input ->> 'campaignId' = ${campaignId}
    order by created_at desc limit 1`;
  return {
    todo: plan.refusal ? 0 : plan.assetIds.length,
    total: plan.total,
    estimate: plan.estimate.label,
    reason: plan.refusal,
    runningRunId: (running?.id as string | undefined) ?? null,
  };
}

/**
 * Starts Check pictures: one run for the campaign's pictures without a result.
 * Refused with the reason (PictureCheckError) for a draft, with no ads, when
 * every picture has a result, or while a check runs for the campaign.
 */
export async function startPictureCheck(member: Member, campaignId: string, send: SendEvent): Promise<string> {
  if (!UUID.test(campaignId)) throw new PictureCheckError("That campaign isn't in your workspace.");
  const plan = await asUser(member.userId, (tx) => pictureCheckPlan(tx, campaignId));
  if (plan.refusal) throw new PictureCheckError(plan.refusal);
  const n = plan.assetIds.length;
  return createWorkflowRun(member, PICTURE_CHECK_KEY, PICTURE_CHECK_VERSION, { campaignId, assetIds: plan.assetIds }, send, {
    brandId: plan.brandId,
    label: `${plan.brandName}: check ${n} ${n === 1 ? "picture" : "pictures"}`,
    // Review fix 4: the busy check and the run's insert in one transaction, under the campaign's lock, so two clicks start one run.
    guard: async (tx) => {
      await takeRunLock(tx, `${PICTURE_CHECK_KEY}:${campaignId}`);
      const [b] = await tx`
        select count(*)::int as n from public.agent_runs
        where agent = ${PICTURE_CHECK_KEY} and status in ('queued', 'running') and input ->> 'campaignId' = ${campaignId}`;
      if (b.n > 0) throw new PictureCheckError(CHECK_BUSY);
    },
  });
}
