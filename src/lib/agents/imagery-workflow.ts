import { discardIn, insertImage, toWebp } from "@/lib/assets/store";
import { realNamesFor, withoutNames } from "@/lib/brief/gather";
import { storedBrief } from "@/lib/brief/schema";
import { paletteWords } from "@/lib/creative/colour-words";
import { NOT_SIGNED_OFF } from "@/lib/creative/imagery";
import { asUser } from "@/lib/db/scoped";
import { CapExceededError, generateImage } from "@/lib/models/generate";
import { dontKey } from "@/lib/compliance/rules";
import { fitVision, META_MARGIN_BYTES, META_MAX_BYTES, VISION_MAX_BYTES, type VisionRecord } from "@/lib/compliance/vision";
import { IMAGE_COUNT, imageCheckAgent, imageryAgent, imageryStart, isFinanceCategory, MAX_DONT_RULES, type ImageryInput, type ImageryOutput } from "./imagery";
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

type Written = { ok: true; output: ImageryOutput; leftOut: string[] } | { ok: false; reason: "cap" | "error"; message: string };

export type Drawn = { ok: true; assetId: string } | { ok: false; reason: "cap" | "error"; message: string };
export type Checked =
  | {
      ok: true;
      hasText: boolean;
      reason: string;
      /** A close-up face in a finance brand's picture (F-24); always false for other brands. */
      closeUpFace: boolean;
      /** Why the picture is refused: text, or (finance brands) a close-up face; null when it may be kept. */
      refused: "text" | "face" | null;
    }
  | { ok: false; reason: "cap" | "error"; message: string };

export type PictureOutcome =
  | { picture: number; outcome: "kept"; assetId: string; attempts: number; idea: string }
  | { picture: number; outcome: "dropped"; reasons: string[]; kinds: ("text" | "face")[]; idea: string }
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

/** C8-2 (F-24): what a close-up face in a finance brand's picture is called in the trail and the run summary. */
export const FACE_REFUSAL = "a close-up face (a finance brand's pictures show people only from behind, at a distance or as hands)";

/**
 * Stores a picture check's result with the picture (assets.meta.vision), within
 * the meta column's limit: the rest of meta (measured in SQL as jsonb text) and
 * the record (measured as jsonb prints it) leave META_MARGIN_BYTES spare.
 */
async function saveVision(ctx: StepContext, assetId: string, metaBytes: number, record: VisionRecord): Promise<void> {
  const fitted = fitVision(record, Math.min(VISION_MAX_BYTES, META_MAX_BYTES - META_MARGIN_BYTES - metaBytes));
  await asUser(ctx.userId, (tx) => tx`select public.set_asset_vision(${assetId}, ${tx.json(fitted as never)})`);
}

/** Says on the check's step that its paid-for result couldn't be kept with the picture (review fix 6). Never throws. */
async function noteNotSaved(ctx: StepContext, seq: number, why: string): Promise<void> {
  const error = `The check's result couldn't be saved with the picture, so its ads show the picture check as not run (${why}).`.slice(0, 1000);
  await asUser(ctx.userId, (tx) => tx`update public.agent_steps set error = ${error} where run_id = ${ctx.runId} and seq = ${seq}`).catch(() => undefined);
}

/**
 * The vision check on one stored picture (C8-2: text, a face and the kit's
 * don't rules, in one call through runModelStep), with its result stored on
 * the picture. A picture is refused for text, or (F-24) for a close-up face
 * when the brand is a finance brand; a face for any other brand is not a
 * finding. With `discard` (the default, for a picture just drawn) a refused
 * picture, or one that couldn't be checked, is discarded (rule 8). Check
 * pictures passes `discard: false`: a picture already in ads is never
 * replaced without a person (rule 3), so its result becomes a finding instead.
 */
export async function checkOne(ctx: StepContext, assetId: string, picture: number, attempt: number, at?: TrailSlot, opts: { discard?: boolean } = {}): Promise<Checked> {
  const discard = opts.discard ?? true;
  // A read that fails (the database, say) throws and the step is retried, which is free: nothing is paid before
  // the check. A picture that isn't there can't be checked, so it is a failed check, not a retry (review nit).
  const [a] = await asUser(ctx.userId, (tx) => tx`
    select a.bytes, a.mime, octet_length((a.meta - 'vision')::text) as meta_bytes, b.category, b.dont_rules
    from public.assets a join public.brands b on b.id = a.brand_id where a.id = ${assetId}`);
  if (!a?.bytes) return { ok: false, reason: "error", message: `The picture to check is missing (asset ${assetId}).` };
  const image = { data: new Uint8Array(a.bytes as Buffer), mediaType: a.mime as "image/webp" };
  const finance = isFinanceCategory((a.category as string) ?? "");
  const rules = [...new Set(((a.dont_rules as string[] | null) ?? []).map((r) => r.trim()).filter(Boolean))].slice(0, MAX_DONT_RULES).map((r) => r.slice(0, 300));
  const seq = at?.seq ?? seqFor(picture, attempt, "check");
  const metaBytes = Number(a.meta_bytes ?? 0);
  const trail = async () => {
    const [s] = await asUser(ctx.userId, (tx) => tx`select id, provider, model from public.agent_steps where run_id = ${ctx.runId} and seq = ${seq}`);
    return { stepId: (s?.id as string | undefined) ?? null, provider: (s?.provider as string | null) ?? null, model: (s?.model as string | null) ?? null };
  };
  try {
    const { output } = await runModelStep(
      ctx,
      imageCheckAgent,
      { picture: Math.min(Math.max(1, picture), 99), attempt, image, dontRules: rules },
      seq,
      at?.name ?? (attempt === 1 ? `Check picture ${picture} for text` : `Check picture ${picture} again`),
    );
    const closeUp = output.face.closeUp;
    const refused = output.hasText ? "text" : finance && closeUp ? "face" : null;
    // Review fix 6: the check is paid for and its answer stands. A failure to save it is recorded on the step, not
    // thrown, so the step isn't retried (a second paid call) and the answer isn't mistaken for a check that failed.
    const notSaved = await saveVision(ctx, assetId, metaBytes, {
      status: "checked",
      checkedAt: new Date().toISOString(),
      runId: ctx.runId,
      ...(await trail()),
      hasText: output.hasText,
      reason: output.reason,
      face: { present: output.face.present || closeUp, closeUp },
      rules: output.dontRules.map((r) => ({ key: dontKey(rules[r.rule - 1]), breaks: r.breaks, reason: r.reason })),
    }).then(
      () => null,
      (err: unknown) => errorText(err),
    );
    if (notSaved) await noteNotSaved(ctx, seq, notSaved);
    if (refused && discard) await asUser(ctx.userId, (tx) => discardIn(tx, assetId));
    return { ok: true, hasText: output.hasText, reason: output.reason, closeUpFace: finance && closeUp, refused };
  } catch (err) {
    const reason = reasonOf(err);
    // Kept with the picture, so its compliance says the check didn't run, and why (never Pass).
    await saveVision(ctx, assetId, metaBytes, { status: reason, checkedAt: new Date().toISOString(), runId: ctx.runId, ...(await trail()), message: errorText(err).slice(0, 400) }).catch(() => undefined);
    // Rule 8: a picture nobody has checked for text is not kept.
    if (discard) await asUser(ctx.userId, (tx) => discardIn(tx, assetId));
    return { ok: false, reason, message: errorText(err) };
  }
}

async function makePicture(ctx: StepContext, step: StepTools, prepared: Extract<Prepared, { ok: true }>, p: Prompt, picture: number): Promise<PictureOutcome> {
  const reasons: string[] = [];
  const kinds: ("text" | "face")[] = [];
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
    if (!checked.refused) return { picture, outcome: "kept", assetId: drawn.assetId, attempts: attempt, idea: p.idea };
    // F-24: a close-up face in a finance brand's picture is treated like text: redrawn once, then dropped.
    reasons.push(checked.refused === "face" ? `The check found ${FACE_REFUSAL}.` : checked.reason);
    kinds.push(checked.refused);
  }
  return { picture, outcome: "dropped", reasons, kinds, idea: p.idea };
}

/** What the check found twice in each dropped picture, said once per kind: "Picture 2 was dropped: the check found text twice." */
function droppedText(dropped: { picture: number; kinds: ("text" | "face")[] }[]): string {
  const why = (k: ("text" | "face")[]) =>
    k.every((x) => x === "face") ? `the check found ${FACE_REFUSAL} twice` : k.every((x) => x === "text") ? "the check found text twice" : "the check found text once and a close-up face once";
  const groups = new Map<string, number[]>();
  for (const d of dropped) groups.set(why(d.kinds), [...(groups.get(why(d.kinds)) ?? []), d.picture]);
  return [...groups.entries()].map(([w, ps]) => ` ${ps.length === 1 ? `Picture ${ps[0]} was` : `Pictures ${ps.join(", ")} were`} dropped: ${w}.`).join("");
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
      const r = await runModelStep(ctx, imageryAgent, prepared.input, 2, "Write the image prompts");
      return { ok: true, output: r.output, leftOut: r.leftOut };
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
      dropped: dropped.map((d) => ({ picture: d.picture, idea: d.idea, reasons: d.reasons, found: d.kinds })),
      notMade: stopped.map((s) => ({ picture: s.picture, idea: s.idea, outcome: s.outcome, message: s.message })),
    };
    await asUser(ctx.userId, (tx) => tx`
      insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, duration_ms, finished_at)
      values (${ctx.runId}, ${ctx.workspaceId}, ${SAVE_SEQ}, 'Save the pictures', 'system', 'succeeded',
              ${tx.json({ pictures: outcomes.length } as never)}, ${tx.json(record as never)}, ${Date.now() - started}, now())
      on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, finished_at = now()`);

    const droppedNote = droppedText(dropped);
    const leftOutNote = written.leftOut.length
      ? ` ${written.leftOut.length} ${written.leftOut.length === 1 ? "prompt" : "prompts"} failed the checks twice and ${written.leftOut.length === 1 ? "was" : "were"} left out (see the trail).`
      : "";
    const output = {
      summary: `${kept.length} of ${outcomes.length} pictures kept from version ${prepared.version} of the brief.${leftOutNote}${droppedNote}${simulated ? " Simulated images (mock model)." : ""}`,
      assets: kept.map((k) => k.assetId),
      leftOut: written.leftOut,
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
      // The same refusal for every picture (a quota, say) is said once.
      const messages = [...new Set(stopped.map((s) => s.message))];
      const why = !stopped.length
        ? dropped.every((d) => d.kinds.every((k) => k === "text"))
          ? "every picture still had text after a redraw"
          : "every picture still had text or a close-up face after a redraw"
        : messages.length === 1
          ? messages[0]
          : stopped.map((s) => `picture ${s.picture}: ${s.message}`).join("; ");
      await setRun(ctx, "failed", { output, error: messages.length === 1 && stopped.length ? `No picture was kept. ${why}` : `No picture was kept (${why}).` });
      return "failed";
    }
    await setRun(ctx, "completed", { output });
    return "completed";
  });
}
