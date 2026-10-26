import { discardIn, insertImage, toWebp } from "@/lib/assets/store";
import { realNamesFor, withoutNames } from "@/lib/brief/gather";
import { storedBrief } from "@/lib/brief/schema";
import { paletteWords } from "@/lib/creative/colour-words";
import { NOT_SIGNED_OFF } from "@/lib/creative/imagery";
import { asUser } from "@/lib/db/scoped";
import { CapExceededError, generateImage } from "@/lib/models/generate";
import { IMAGE_COUNT, imageCheckAgent, imageryAgent, imageryStart, isFinanceCategory, type ImageryInput, type ImageryOutput } from "./imagery";
import { runModelStep, type StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

// S5-1: read the signed-off brief (system step), write four prompts (model
// step with the prompt checks), then for each prompt, in parallel: draw the
// picture (an image call), check it for text (a vision call), and on a "yes"
// redraw once; a second "yes" drops it. Pictures are saved as assets as they
// are drawn, so a run stopped by the cap keeps what it already has.

type Prompt = ImageryOutput["prompts"][number];

type Prepared =
  | { ok: true; campaignId: string; version: number; brandId: string; paletteHex: string[]; input: ImageryInput }
  | { ok: false; message: string };

/** What drawing one picture needs to know (S5-4's New picture draws one outside a full Imagery run). */
export type DrawTarget = { campaignId: string; version: number; brandId: string; paletteHex: string[] };

/** Where a draw or check goes in the trail, when it isn't part of a full Imagery run. */
export type TrailSlot = { seq: number; name: string };

type Written = { ok: true; output: ImageryOutput } | { ok: false; reason: "cap" | "error"; message: string };

export type Drawn = { ok: true; assetId: string } | { ok: false; reason: "cap" | "error"; message: string };
export type Checked = { ok: true; hasText: boolean; reason: string } | { ok: false; reason: "cap" | "error"; message: string };

export type PictureOutcome =
  | { picture: number; outcome: "kept"; assetId: string; attempts: number; idea: string }
  | { picture: number; outcome: "dropped"; reasons: string[]; idea: string }
  | { picture: number; outcome: "stopped_cap" | "failed"; message: string; idea: string };

// Trail order: 1 read, 2 prompts, then four slots per picture (draw, check, redraw, check again), then save.
const seqFor = (picture: number, attempt: number, kind: "draw" | "check") => 3 + (picture - 1) * 4 + (attempt - 1) * 2 + (kind === "check" ? 1 : 0);
const SAVE_SEQ = 3 + IMAGE_COUNT * 4;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const reasonOf = (err: unknown): "cap" | "error" => (err instanceof CapExceededError ? "cap" : "error");

function scrub(text: string, brandName: string, realNames: string[]): string {
  const name = brandName.trim();
  const own = name ? text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the brand") : text;
  return withoutNames(own, realNames);
}

async function readBrief(ctx: StepContext): Promise<Prepared> {
  const started = Date.now();
  const res = await asUser(ctx.userId, async (tx): Promise<{ result: Prepared; raw: unknown; summary: unknown }> => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const start = imageryStart.safeParse(run?.input);
    if (!start.success) return { result: { ok: false, message: "The run's input is not a picture request." }, raw: run?.input ?? {}, summary: null };
    const [c] = await tx`
      select c.id, c.brand_id, c.status, c.approved_version, b.name, b.category, b.tone_words, b.do_rules, b.dont_rules, b.palette, v.brief
      from public.campaigns c join public.brands b on b.id = c.brand_id
      left join public.brief_versions v on v.campaign_id = c.id and v.version = ${start.data.version}
      where c.id = ${start.data.campaignId}`;
    const fail = (message: string) => ({ result: { ok: false as const, message }, raw: start.data, summary: null });
    if (!c) return fail("The campaign no longer exists, or isn't in this workspace.");
    if (c.status !== "approved" || !c.approved_version) return fail(NOT_SIGNED_OFF);
    if (c.approved_version !== start.data.version) {
      return fail(`Version ${start.data.version} isn't the signed-off brief (version ${c.approved_version} is), so no pictures were made from it.`);
    }
    if (!c.brief) return fail("The signed-off brief version is missing.");
    const palette = ((c.palette ?? []) as { name: string; hex: string }[]).filter((p) => /^#[0-9a-f]{6}$/i.test(p.hex));
    if (palette.length === 0) return fail("The brand has no palette, so the pictures can't be on-brand. Add its colours on the brand page first.");
    const brief = storedBrief.parse(c.brief);
    const realNames = await realNamesFor(tx, c.brand_id);
    const segIds = brief.audiences.map((a) => a.segmentRef).filter((r) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r));
    const segs = segIds.length ? await tx`select id, title from public.context_items where id = any(${segIds}::uuid[])` : [];
    const segTitle = new Map(segs.map((s) => [s.id as string, s.title as string]));
    const places = await tx`select distinct region from public.customers where brand_id = ${c.brand_id} and region <> '' limit 30`;
    const clean = (t: string) => scrub(t, c.name, realNames);
    const input: ImageryInput = {
      brief: {
        title: clean(brief.title),
        story: clean(brief.story),
        audiences: brief.audiences.map((a) => clean(`${segTitle.get(a.segmentRef) ?? "An audience"}: ${a.why}`).slice(0, 400)),
        channels: brief.channels.map((ch) => clean(`${ch.channel}: ${ch.role}`).slice(0, 250)),
      },
      palette: paletteWords(palette),
      toneWords: c.tone_words as string[],
      doRules: c.do_rules as string[],
      dontRules: c.dont_rules as string[],
      finance: isFinanceCategory(c.category as string),
      brandName: c.name as string,
      realNames,
      places: places.map((p) => p.region as string),
    };
    return {
      result: { ok: true, campaignId: c.id, version: start.data.version, brandId: c.brand_id, paletteHex: palette.map((p) => p.hex), input },
      raw: start.data,
      summary: { version: start.data.version, palette: input.palette.map((p) => `${p.name}: ${p.words}`), finance: input.finance },
    };
  });
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, 1, 'Read the signed-off brief', 'system', ${res.result.ok ? "succeeded" : "failed"},
            ${tx.json(res.raw as never)}, ${res.summary === null ? null : tx.json(res.summary as never)},
            ${res.result.ok ? null : res.result.message}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
  return res.result;
}

/** One image call, recorded as its own costed step; the picture is stored as a WebP asset at once. */
export async function drawOne(
  ctx: StepContext,
  prepared: DrawTarget,
  p: Pick<Prompt, "prompt" | "idea" | "aspect">,
  picture: number,
  attempt: number,
  at?: TrailSlot & { seed?: number; meta?: Record<string, unknown> },
): Promise<Drawn> {
  const seq = at?.seq ?? seqFor(picture, attempt, "draw");
  const name = at?.name ?? (attempt === 1 ? `Draw picture ${picture}` : `Redraw picture ${picture}`);
  const [s] = await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input)
    values (${ctx.runId}, ${ctx.workspaceId}, ${seq}, ${name}, 'model', 'running',
            ${tx.json({ prompt: p.prompt, idea: p.idea, aspect: p.aspect, attempt } as never)})
    on conflict (run_id, seq) do update set status = 'running', attempts = 0, input_tokens = 0, cost_pence = 0, error = null, started_at = now()
    returning id`);
  const stepId = s.id as string;
  const started = Date.now();
  const finish = (status: "succeeded" | "failed" | "skipped", f: { provider?: string; model?: string; inputTokens?: number; output?: unknown; error?: string | null }) =>
    asUser(ctx.userId, (tx) => tx`
      update public.agent_steps set status = ${status}, provider = ${f.provider ?? null}, model = ${f.model ?? null},
        attempts = ${status === "skipped" ? 0 : 1}, input_tokens = ${f.inputTokens ?? 0}, output = ${f.output === undefined ? null : tx.json(f.output as never)},
        cost_pence = (select coalesce(sum(l.cost_pence), 0) from public.usage_ledger l where l.step_id = ${stepId}),
        duration_ms = ${Date.now() - started}, error = ${f.error ?? null}, finished_at = now()
      where id = ${stepId}`);
  try {
    const img = await generateImage({
      agent: "imagery",
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      stepId,
      prompt: p.prompt,
      aspect: p.aspect,
      seed: at?.seed ?? picture * 10 + attempt,
      palette: prepared.paletteHex,
    });
    const webp = await toWebp(img.bytes);
    const assetId = await asUser(ctx.userId, (tx) =>
      insertImage(tx, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        brandId: prepared.brandId,
        campaignId: prepared.campaignId,
        runId: ctx.runId,
        webp,
        simulated: img.simulated,
        createdByKind: "agent",
        meta: { picture, attempt, idea: p.idea, prompt: p.prompt, briefVersion: prepared.version, provider: img.provider, model: img.model, size: img.size, ...at?.meta },
      }),
    );
    await finish("succeeded", {
      provider: img.provider,
      model: img.model,
      inputTokens: img.inputTokens,
      output: { assetId, images: 1, width: webp.width, height: webp.height, bytes: webp.data.length, simulated: img.simulated },
    });
    return { ok: true, assetId };
  } catch (err) {
    const reason = reasonOf(err);
    await finish(reason === "cap" ? "skipped" : "failed", { error: errorText(err) });
    return { ok: false, reason, message: errorText(err) };
  }
}

/** The vision check on one stored picture; a picture with text, or one that couldn't be checked, is discarded. */
export async function checkOne(ctx: StepContext, assetId: string, picture: number, attempt: number, at?: TrailSlot): Promise<Checked> {
  const [a] = await asUser(ctx.userId, (tx) => tx`select bytes, mime from public.assets where id = ${assetId}`);
  try {
    const { output } = await runModelStep(
      ctx,
      imageCheckAgent,
      { picture, attempt, image: { data: new Uint8Array(a.bytes as Buffer), mediaType: a.mime as "image/webp" } },
      at?.seq ?? seqFor(picture, attempt, "check"),
      at?.name ?? (attempt === 1 ? `Check picture ${picture} for text` : `Check picture ${picture} again`),
    );
    if (output.hasText) await asUser(ctx.userId, (tx) => discardIn(tx, assetId));
    return { ok: true, hasText: output.hasText, reason: output.reason };
  } catch (err) {
    // Rule 8: a picture nobody has checked for text is not kept.
    await asUser(ctx.userId, (tx) => discardIn(tx, assetId));
    return { ok: false, reason: reasonOf(err), message: errorText(err) };
  }
}

async function makePicture(ctx: StepContext, step: StepTools, prepared: Extract<Prepared, { ok: true }>, p: Prompt, picture: number): Promise<PictureOutcome> {
  const reasons: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const drawn = await step.run(`draw-${picture}-${attempt}`, () => drawOne(ctx, prepared, p, picture, attempt));
    if (!drawn.ok) return { picture, outcome: drawn.reason === "cap" ? "stopped_cap" : "failed", message: drawn.message, idea: p.idea };
    const checked = await step.run(`check-${picture}-${attempt}`, () => checkOne(ctx, drawn.assetId, picture, attempt));
    if (!checked.ok) {
      return {
        picture,
        outcome: checked.reason === "cap" ? "stopped_cap" : "failed",
        message: `Picture ${picture} was drawn but couldn't be checked for text, so it was discarded: ${checked.message}`,
        idea: p.idea,
      };
    }
    if (!checked.hasText) return { picture, outcome: "kept", assetId: drawn.assetId, attempts: attempt, idea: p.idea };
    reasons.push(checked.reason);
  }
  return { picture, outcome: "dropped", reasons, idea: p.idea };
}

export async function executeImageryRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("read-brief", () => readBrief(ctx));
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }

  const written = await step.run("write-prompts", async (): Promise<Written> => {
    try {
      return { ok: true, output: (await runModelStep(ctx, imageryAgent, prepared.input, 2, "Write the image prompts")).output };
    } catch (err) {
      return { ok: false, reason: reasonOf(err), message: errorText(err) };
    }
  });
  if (!written.ok) {
    const status = written.reason === "cap" ? "stopped_cap" : "failed";
    await step.run("stop", () => setRun(ctx, status, { error: written.message }));
    return status;
  }

  // Four pictures at once (F-21's reservations keep the cap whole when they start together).
  const outcomes = await Promise.all(written.output.prompts.map((p, i) => makePicture(ctx, step, prepared, p, i + 1)));

  return step.run("save", async () => {
    const started = Date.now();
    const kept = outcomes.filter((o): o is Extract<PictureOutcome, { outcome: "kept" }> => o.outcome === "kept");
    const dropped = outcomes.filter((o): o is Extract<PictureOutcome, { outcome: "dropped" }> => o.outcome === "dropped");
    const stopped = outcomes.filter((o): o is Extract<PictureOutcome, { outcome: "stopped_cap" | "failed" }> => o.outcome === "stopped_cap" || o.outcome === "failed");
    const capped = stopped.some((o) => o.outcome === "stopped_cap");
    const [{ simulated }] = await asUser(ctx.userId, (tx) => tx`
      select coalesce(bool_or(simulated), false) as simulated from public.assets where id = any(${kept.map((k) => k.assetId)}::uuid[])`);
    const record = {
      kept: kept.map((k) => ({ picture: k.picture, assetId: k.assetId, attempts: k.attempts, idea: k.idea })),
      dropped: dropped.map((d) => ({ picture: d.picture, idea: d.idea, reasons: d.reasons })),
      notMade: stopped.map((s) => ({ picture: s.picture, idea: s.idea, outcome: s.outcome, message: s.message })),
    };
    await asUser(ctx.userId, (tx) => tx`
      insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, duration_ms, finished_at)
      values (${ctx.runId}, ${ctx.workspaceId}, ${SAVE_SEQ}, 'Save the pictures', 'system', 'succeeded',
              ${tx.json({ pictures: outcomes.length } as never)}, ${tx.json(record as never)}, ${Date.now() - started}, now())
      on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, finished_at = now()`);

    const droppedNote = dropped.length
      ? ` ${dropped.length === 1 ? `Picture ${dropped[0].picture} was` : `Pictures ${dropped.map((d) => d.picture).join(", ")} were`} dropped: the check found text twice.`
      : "";
    const output = {
      summary: `${kept.length} of ${outcomes.length} pictures kept from version ${prepared.version} of the brief.${droppedNote}${simulated ? " Simulated images (mock model)." : ""}`,
      assets: kept.map((k) => k.assetId),
      ...record,
      simulated,
      campaignId: prepared.campaignId,
      briefVersion: prepared.version,
      href: `/campaigns/${prepared.campaignId}#creative`,
      hrefLabel: "See the campaign",
    };
    if (capped) {
      await setRun(ctx, "stopped_cap", {
        output,
        error: `Daily AI cap reached before every picture was made: ${kept.length} of ${outcomes.length} kept. ${stopped.find((s) => s.outcome === "stopped_cap")!.message}`,
      });
      return "stopped_cap";
    }
    if (kept.length === 0) {
      const why = stopped.length ? stopped.map((s) => `picture ${s.picture}: ${s.message}`).join("; ") : "every picture still had text after a redraw";
      await setRun(ctx, "failed", { output, error: `No picture was kept (${why}).` });
      return "failed";
    }
    await setRun(ctx, "completed", { output });
    return "completed";
  });
}
