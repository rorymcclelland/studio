import { z } from "zod";
import { NOT_SIGNED_OFF } from "@/lib/creative/imagery";
import { composeVariants, firstLayoutThatRenders, insertVariant, loadParts, refusalText, type ComposeResult, type KitSnapshot } from "@/lib/creative/variants";
import type { LayoutId } from "@/lib/creative/render/layouts";
import { asUser, type Tx } from "@/lib/db/scoped";
import { copyAgent } from "./copy";
import { executeCopyRun } from "./copy-workflow";
import { imageryAgent } from "./imagery";
import { checkOne, drawOne, executeImageryRun, FACE_REFUSAL } from "./imagery-workflow";
import type { StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

// S5-4: Make creative, and New picture. Neither is a model agent of its own:
// Make creative runs the Imagery and Copy agents' workflows as child runs (each
// with its own trail and cost, both at once), then composes the ads in code.
// New picture draws one picture through the Imagery agent's code path (one
// image call and its check for text) and makes a new variant with it.
// Nothing here spends ad money or publishes (rule 3). A person asked for every
// replacement: the click on New picture is that choice.

export const CREATIVE_KEY = "creative";
export const CREATIVE_VERSION = 1;
export const CREATIVE_NAME = "Make creative";

export const creativeStart = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("make"), campaignId: z.uuid(), version: z.number().int().min(1) }),
  z.object({ mode: z.literal("picture"), campaignId: z.uuid(), variantId: z.uuid() }),
]);
export type CreativeStart = z.infer<typeof creativeStart>;

/** The child runs' outcomes, as the parent's trail and output record them. */
export type ChildOutcome = { runId: string; status: string; error: string | null } | null;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Step tools whose step ids are prefixed, so a child workflow's steps can't collide with the parent's (Inngest memoises by id). */
function within(step: StepTools, prefix: string): StepTools {
  return {
    run: (id, fn) => step.run(`${prefix}:${id}`, fn),
    waitForEvent: (id, opts) => step.waitForEvent(`${prefix}:${id}`, opts),
  };
}

async function systemStep(ctx: StepContext, seq: number, name: string, ok: boolean, input: unknown, output: unknown, error: string | null, started: number) {
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, ${seq}, ${name}, 'system', ${ok ? "succeeded" : "failed"},
            ${tx.json((input ?? {}) as never)}, ${output === null ? null : tx.json(output as never)}, ${error}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
}

/** The message for a second Make creative while one is active. */
export const MAKE_BUSY = "Creative is already being made for this brief. It takes about two minutes.";

/**
 * Why Make creative can't start for this campaign now, or null. Shared by the
 * start function, the gallery and the workflow. The workflow passes its own
 * run (`ownRunId`): then only an older active run refuses it, so of two runs
 * started together the first goes ahead rather than both stopping (review
 * finding 5; the database's agent_runs_one_active_make index means a second
 * active one can't normally be recorded at all).
 */
export async function makeCreativeRefusal(tx: Tx, campaignId: string, ownRunId: string | null = null): Promise<string | null> {
  const [c] = await tx`
    select c.status, c.approved_version, b.palette, v.brief
    from public.campaigns c join public.brands b on b.id = c.brand_id
    left join public.brief_versions v on v.campaign_id = c.id and v.version = c.approved_version
    where c.id = ${campaignId}`;
  if (!c) return "That campaign isn't in your workspace.";
  if (c.status !== "approved" || !c.approved_version) return NOT_SIGNED_OFF;
  const channels = ((c.brief?.channels ?? []) as { channel: string }[]).map((x) => x.channel);
  if (!channels.some((x) => x === "paid social" || x === "display")) {
    return "The brief has no paid-social or display channel, so there are no ads to compose. Write its copy with the Copy agent instead.";
  }
  const palette = ((c.palette ?? []) as { hex: string }[]).filter((p) => /^#[0-9a-f]{6}$/i.test(p.hex));
  if (palette.length === 0) return "The brand has no palette, so the pictures can't be on-brand. Add its colours on the brand page first.";
  const [busy] = await tx`
    select count(*)::int as n from public.agent_runs r
    where r.agent = 'creative' and r.status in ('queued', 'running', 'awaiting_approval') and r.input ->> 'mode' = 'make'
      and r.input ->> 'campaignId' = ${campaignId}
      and ${ownRunId
        ? tx`r.id <> ${ownRunId}::uuid and (r.created_at, r.id) < (select o.created_at, o.id from public.agent_runs o where o.id = ${ownRunId}::uuid)`
        : tx`true`}`;
  if (busy.n > 0) return MAKE_BUSY;
  const [current] = await tx`
    select count(*)::int as n from public.ad_variants
    where campaign_id = ${campaignId} and brief_version = ${c.approved_version} and discarded_at is null`;
  if (current.n > 0) {
    return "This signed-off brief already has ads. Use New picture or New words on an ad, or discard the ads first.";
  }
  return null;
}

type MakePrepared =
  | { ok: true; campaignId: string; version: number; imageryRunId: string; copyRunId: string | null; reusedSets: number }
  | { ok: false; message: string };

/** Records (once) the child runs Make creative runs: always Imagery; Copy only when the version has no current copy yet (S5-2's rule). */
async function prepareMake(ctx: StepContext): Promise<MakePrepared> {
  const started = Date.now();
  const res = await asUser(ctx.userId, async (tx): Promise<{ result: MakePrepared; raw: unknown }> => {
    const [run] = await tx`select input, brand_id from public.agent_runs where id = ${ctx.runId}`;
    const start = creativeStart.safeParse(run?.input);
    if (!start.success || start.data.mode !== "make") return { result: { ok: false, message: "The run's input is not a Make creative request." }, raw: run?.input ?? {} };
    const { campaignId, version } = start.data;
    const fail = (message: string) => ({ result: { ok: false as const, message }, raw: start.data });
    const refusal = await makeCreativeRefusal(tx, campaignId, ctx.runId);
    if (refusal) return fail(refusal);
    const [c] = await tx`select c.approved_version, c.brand_id, b.name from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
    if (c.approved_version !== version) return fail(`Version ${version} isn't the signed-off brief (version ${c.approved_version} is), so no creative was made from it.`);

    // A retried step finds the children it already recorded.
    const children = await tx`select id, agent from public.agent_runs where input ->> 'parentRunId' = ${ctx.runId}`;
    const existing = (agent: string) => children.find((r) => r.agent === agent)?.id as string | undefined;
    const [sets] = await tx`
      select count(*)::int as n from public.copy_sets
      where campaign_id = ${campaignId} and brief_version = ${version} and discarded_at is null and lang = 'en-GB'`;
    const child = async (agent: string, agentVersion: number, input: Record<string, unknown>, label: string) => {
      const [r] = await tx`
        insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by, label, brand_id)
        values (${ctx.workspaceId}, ${agent}, ${agentVersion}, ${tx.json({ ...input, parentRunId: ctx.runId } as never)}, ${ctx.userId},
                ${label.slice(0, 200)}, ${c.brand_id})
        returning id`;
      return r.id as string;
    };
    const imageryRunId = existing("imagery") ?? (await child("imagery", imageryAgent.version, { campaignId, version }, `${c.name}: pictures (v${version})`));
    let copyRunId = existing("copy") ?? null;
    if (!copyRunId && sets.n === 0) copyRunId = await child("copy", copyAgent.version, { mode: "all", campaignId }, `${c.name}: copy (v${version})`);
    return { result: { ok: true, campaignId, version, imageryRunId, copyRunId, reusedSets: copyRunId ? 0 : sets.n }, raw: start.data };
  });
  await systemStep(
    ctx,
    1,
    "Read the signed-off brief",
    res.result.ok,
    res.raw,
    res.result.ok ? { version: res.result.version, imageryRunId: res.result.imageryRunId, copyRunId: res.result.copyRunId, reusedSets: res.result.reusedSets } : null,
    res.result.ok ? null : res.result.message,
    started,
  );
  return res.result;
}

async function outcomeOf(ctx: StepContext, runId: string | null): Promise<ChildOutcome> {
  if (!runId) return null;
  const [r] = await asUser(ctx.userId, (tx) => tx`select status, error, output from public.agent_runs where id = ${runId}`);
  return r ? { runId, status: r.status as string, error: (r.error as string | null) ?? null } : { runId, status: "failed", error: "The run is missing." };
}

const childLine = (what: string, o: ChildOutcome) =>
  !o ? "" : o.status === "completed" ? "" : o.status === "stopped_cap" ? `${what}: stopped at the daily AI cap. ` : `${what}: ${o.error ?? o.status}. `;

async function executeMake(ctx: StepContext, step: StepTools): Promise<string> {
  const prepared = await step.run("prepare", () => prepareMake(ctx));
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }
  const child = (runId: string) => ({ runId, workspaceId: ctx.workspaceId, userId: ctx.userId });

  // Pictures and words at once: they don't depend on each other. Each child
  // sets its own status, and keeps what it made if it stops.
  const started = Date.now();
  await Promise.all([
    executeImageryRun(child(prepared.imageryRunId), within(step, "imagery")),
    prepared.copyRunId ? executeCopyRun(child(prepared.copyRunId), within(step, "copy")) : Promise.resolve("reused"),
  ]);

  const children = await step.run("children", async () => {
    const imagery = await outcomeOf(ctx, prepared.imageryRunId);
    const copy = await outcomeOf(ctx, prepared.copyRunId);
    const [img] = await asUser(ctx.userId, (tx) => tx`select output from public.agent_runs where id = ${prepared.imageryRunId}`);
    const pictures = ((img?.output as { assets?: string[] } | null)?.assets ?? []) as string[];
    await systemStep(ctx, 2, "Make the pictures (Imagery agent)", imagery?.status === "completed", { runId: prepared.imageryRunId }, { ...imagery, pictures: pictures.length }, imagery?.status === "completed" ? null : imagery?.error ?? null, started);
    await systemStep(
      ctx,
      3,
      prepared.copyRunId ? "Write the copy (Copy agent)" : "Use the brief's copy",
      !copy || copy.status === "completed",
      { runId: prepared.copyRunId },
      copy ?? { reused: prepared.reusedSets, note: `The brief version already had ${prepared.reusedSets} copy set${prepared.reusedSets === 1 ? "" : "s"}, so no new copy was written.` },
      copy && copy.status !== "completed" ? copy.error : null,
      started,
    );
    return { imagery, copy, pictures };
  });

  return step.run("compose", async () => {
    const t = Date.now();
    const { imagery, copy, pictures } = children;
    let composed: ComposeResult | null = null;
    let composeError: string | null = null;
    const copyUsable = !copy || copy.status === "completed";
    if (pictures.length > 0 && copyUsable) {
      try {
        composed = await composeVariants(ctx, prepared.campaignId, { runId: ctx.runId, imageIds: pictures });
      } catch (err) {
        composeError = errorText(err);
      }
    }
    const made = composed ? composed.made.length + composed.existing : 0;
    const notes = composed?.notes ?? [];
    const refusedNote = composed?.refused.length
      ? ` ${composed.refused.length} picture and words pair${composed.refused.length === 1 ? "" : "s"} couldn't be drawn in any layout (${[...new Set(composed.refused.map((r) => r.reason))].join("; ")}).`
      : "";
    await systemStep(
      ctx,
      4,
      "Compose the ads",
      made > 0,
      { pictures: pictures.length },
      composed ? { made: composed.made, refused: composed.refused, existing: composed.existing, notes, audiences: composed.audiences } : null,
      made > 0 ? null : composeError ?? (composed ? `No ad could be composed.${refusedNote} ${notes.join(" ")}`.trim() : "Nothing to compose: the pictures or the words weren't made."),
      t,
    );

    const capped = imagery?.status === "stopped_cap" || copy?.status === "stopped_cap";
    const audienceCount = composed?.audiences.length ?? 0;
    const what = `${made} ad${made === 1 ? "" : "s"} from ${pictures.length} picture${pictures.length === 1 ? "" : "s"} and ${composed?.sets ?? 0} set${composed?.sets === 1 ? "" : "s"} of words${audienceCount > 1 ? `, for ${audienceCount} audiences` : ""}`;
    const output = {
      summary: `${what}.${refusedNote}${notes.length ? ` ${notes.join(" ")}` : ""}`.trim(),
      variants: made,
      pictures: pictures.length,
      sets: composed?.sets ?? 0,
      notes,
      refused: composed?.refused ?? [],
      audiences: composed?.audiences ?? [],
      children: { imagery, copy },
      campaignId: prepared.campaignId,
      briefVersion: prepared.version,
      href: `/campaigns/${prepared.campaignId}#creative`,
      hrefLabel: "See the ads",
    };
    const problems = `${childLine("Pictures", imagery)}${childLine("Copy", copy)}`.trim();
    if (capped) {
      await setRun(ctx, "stopped_cap", {
        output,
        error: `Daily AI cap reached: ${what}. What was made is kept. ${problems}`.trim(),
      });
      return "stopped_cap";
    }
    if (made === 0) {
      const kept = pictures.length ? ` The ${pictures.length} picture${pictures.length === 1 ? " is" : "s are"} kept.` : "";
      await setRun(ctx, "failed", { output, error: `No ads were made. ${problems || composeError || ""}${refusedNote}${kept}`.replace(/\s+/g, " ").trim() });
      return "failed";
    }
    await setRun(ctx, "completed", { output });
    return "completed";
  });
}

// New picture ------------------------------------------------------------------

type PicturePrepared =
  | {
      ok: true;
      variantId: string;
      campaignId: string;
      version: number;
      brandId: string;
      paletteHex: string[];
      oldImageId: string;
      copySetId: string;
      layout: LayoutId;
      kit: KitSnapshot;
      prompt: string;
      idea: string;
      picture: number;
    }
  | { ok: false; message: string };

async function preparePicture(ctx: StepContext): Promise<PicturePrepared> {
  const started = Date.now();
  const res = await asUser(ctx.userId, async (tx): Promise<{ result: PicturePrepared; raw: unknown }> => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const start = creativeStart.safeParse(run?.input);
    if (!start.success || start.data.mode !== "picture") return { result: { ok: false, message: "The run's input is not a New picture request." }, raw: run?.input ?? {} };
    const fail = (message: string) => ({ result: { ok: false as const, message }, raw: start.data });
    const [v] = await tx`
      select v.*, a.meta, a.discarded_at as image_discarded, s.discarded_at as words_discarded, c.status, c.approved_version, c.brand_id, b.palette
      from public.ad_variants v
      join public.assets a on a.id = v.image_asset_id
      join public.copy_sets s on s.id = v.copy_set_id
      join public.campaigns c on c.id = v.campaign_id
      join public.brands b on b.id = c.brand_id
      where v.id = ${start.data.variantId} and v.campaign_id = ${start.data.campaignId}`;
    if (!v) return fail("That ad isn't in your workspace.");
    if (v.discarded_at) return fail("That ad was discarded, so its picture wasn't redrawn.");
    if (v.image_discarded || v.words_discarded) return fail("That ad's picture or words were replaced, so there is nothing to redraw.");
    if (v.status !== "approved" || v.approved_version !== v.brief_version) return fail(NOT_SIGNED_OFF);
    const meta = (v.meta ?? {}) as { prompt?: string; idea?: string; picture?: number };
    if (!meta.prompt) return fail("That picture has no stored prompt, so it can't be redrawn.");
    const paletteHex = ((v.palette ?? []) as { hex: string }[]).map((p) => p.hex).filter((h) => /^#[0-9a-f]{6}$/i.test(h));
    return {
      result: {
        ok: true,
        variantId: v.id,
        campaignId: v.campaign_id,
        version: v.brief_version,
        brandId: v.brand_id,
        paletteHex,
        oldImageId: v.image_asset_id,
        copySetId: v.copy_set_id,
        layout: v.layout,
        kit: v.kit,
        prompt: meta.prompt,
        idea: meta.idea ?? "A new picture",
        picture: typeof meta.picture === "number" ? meta.picture : 1,
      },
      raw: start.data,
    };
  });
  const r = res.result;
  await systemStep(ctx, 1, "Read the ad", r.ok, res.raw, r.ok ? { variantId: r.variantId, image: r.oldImageId, idea: r.idea } : null, r.ok ? null : r.message, started);
  return r;
}

/** A seed that differs per run, so the mock (and models that take a seed) draw something new. */
const seedFor = (runId: string) => parseInt(runId.replace(/-/g, "").slice(0, 7), 16);

async function executePicture(ctx: StepContext, step: StepTools): Promise<string> {
  const p = await step.run("read-variant", () => preparePicture(ctx));
  if (!p.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: p.message }));
    return "failed";
  }
  const target = { campaignId: p.campaignId, version: p.version, brandId: p.brandId, paletteHex: p.paletteHex };
  const drawn = await step.run("draw", () =>
    drawOne(ctx, target, { prompt: p.prompt, idea: p.idea, aspect: "1:1" }, p.picture, 1, {
      seq: 2,
      name: "Draw a new picture",
      seed: seedFor(ctx.runId),
      meta: { replaces: p.oldImageId, variantId: p.variantId },
    }),
  );
  if (!drawn.ok) {
    const status = drawn.reason === "cap" ? "stopped_cap" : "failed";
    await step.run("stop", () => setRun(ctx, status, { error: `${drawn.message} The ad keeps its picture.` }));
    return status;
  }
  const checked = await step.run("check", () => checkOne(ctx, drawn.assetId, p.picture, 1, { seq: 3, name: "Check the new picture for text" }));
  if (!checked.ok || checked.refused) {
    const status = !checked.ok && checked.reason === "cap" ? "stopped_cap" : "failed";
    // F-24 (C8-2): a close-up face in a finance brand's picture is refused like text.
    const why = !checked.ok
      ? `it couldn't be checked for text (${checked.message})`
      : checked.refused === "face"
        ? `the check found ${FACE_REFUSAL}`
        : `the check found text in it (${checked.reason})`;
    await step.run("stop", () => setRun(ctx, status, { error: `The new picture was discarded because ${why}. The ad keeps its picture; try New picture again.` }));
    return status;
  }

  return step.run("save", async () => {
    const t = Date.now();
    const parts = await asUser(ctx.userId, (tx) => loadParts(tx, drawn.assetId, p.copySetId, p.kit));
    const rendered = parts ? await firstLayoutThatRenders(parts, p.layout) : null;
    const outcome = await asUser(ctx.userId, async (tx) => {
      const [old] = await tx`select discarded_at, picked_at from public.ad_variants where id = ${p.variantId} for update`;
      if (!old || old.discarded_at) return { ok: false as const, message: "The ad was discarded while the picture was drawn, so no new ad was made. The new picture is kept." };
      if (!rendered?.ok) return { ok: false as const, message: `The new picture couldn't be composed: ${rendered ? refusalText(rendered.tried) : "its parts could not be read"}.` };
      const id = await insertVariant(tx, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        campaignId: p.campaignId,
        briefVersion: p.version,
        imageAssetId: drawn.assetId,
        copySetId: p.copySetId,
        layout: rendered.layout,
        checks: rendered.checks,
        kit: p.kit,
        origin: "new picture",
        runId: ctx.runId,
        basedOn: p.variantId,
        pickedAt: old.picked_at as Date | null,
      });
      await tx`update public.ad_variants set discarded_at = now() where id = ${p.variantId}`;
      // The old picture is discarded once no current ad uses it (ads that share it keep it).
      const [using] = await tx`select count(*)::int as n from public.ad_variants where image_asset_id = ${p.oldImageId} and discarded_at is null`;
      if (using.n === 0) await tx`update public.assets set discarded_at = now() where id = ${p.oldImageId} and discarded_at is null`;
      return { ok: true as const, id: id as string, layout: rendered.layout, oldImageDiscarded: using.n === 0 };
    });
    await systemStep(ctx, 4, "Save the new ad", outcome.ok, { variantId: p.variantId, image: drawn.assetId }, outcome.ok ? outcome : null, outcome.ok ? null : outcome.message, t);
    const href = `/campaigns/${p.campaignId}#creative`;
    if (!outcome.ok) {
      await setRun(ctx, "failed", { output: { variantId: p.variantId, imageAssetId: drawn.assetId, href, hrefLabel: "See the ads" }, error: outcome.message });
      return "failed";
    }
    await setRun(ctx, "completed", {
      output: {
        summary: `A new picture for one ad. The old ad is discarded${outcome.oldImageDiscarded ? ", and its picture too" : "; its picture stays in the ads that share it"}.`,
        variantId: outcome.id,
        replaces: p.variantId,
        imageAssetId: drawn.assetId,
        oldImageAssetId: p.oldImageId,
        layout: outcome.layout,
        campaignId: p.campaignId,
        href,
        hrefLabel: "See the ads",
      },
    });
    return "completed";
  });
}

/** The `creative` workflow: Make creative for a signed-off version, or a new picture for one ad. */
export async function executeCreativeRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));
  const mode = await step.run("mode", async () => {
    const [run] = await asUser(ctx.userId, (tx) => tx`select input from public.agent_runs where id = ${ctx.runId}`);
    return (run?.input as { mode?: string } | undefined)?.mode ?? null;
  });
  if (mode === "picture") return executePicture(ctx, step);
  return executeMake(ctx, step);
}
