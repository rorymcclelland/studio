import { adKeys, NOT_SIGNED_OFF_PRETEST, NO_PANEL, panelFor, personaAverage, type Panel, type StoredPanel } from "@/lib/creative/pretest";
import { drawableVariant, drawVariant, type AdWords } from "@/lib/creative/variants";
import { asUser } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import { AgentOutputError, runModelStep, type StepContext } from "./model-step";
import { panelAverage, pretestAgent, pretestStart, SYNTHETIC_PANEL, type PretestInput } from "./pretest";
import { setRun, type StepTools } from "./workflow";

// C8-4: Pre-test picked ads. Read the picked ads and the panel (system step),
// then one Pretest model step per ad: the ad drawn as its square PNG, the
// personas of the latest persona review for the signed-off version, and the
// code checks (scores only, quotes from the ad's words) with one repair. Each
// ad's scores are saved with the ad's key, so a later change to the ad makes
// them out of date. Nothing is published, replaced, ranked or spent beyond the
// AI cost (rule 3): the person's click, with the cost shown on it, started the
// run, and the daily cap applies through generate() (rule 5).

type Job = {
  variantId: string;
  number: number;
  adKey: string;
  channel: "paid social" | "display";
  audience: string;
  words: AdWords;
  legalLines: string[];
};

type Prepared =
  | {
      ok: true;
      campaignId: string;
      version: number;
      brandName: string;
      voice: string;
      panel: Panel;
      jobs: Job[];
      skipped: { variantId: string; reason: string }[];
    }
  | { ok: false; message: string };

type Scored =
  | { ok: true; variantId: string; number: number; headline: string; average: number; simulated: boolean; repaired: boolean }
  | { ok: false; variantId: string; number: number; headline: string; cap: boolean; reason: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shown = (s: string) => s.split("­").join("");

async function systemStep(ctx: StepContext, ok: boolean, input: unknown, output: unknown, error: string | null, started: number) {
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, 1, 'Read the picked ads and the panel', 'system', ${ok ? "succeeded" : "failed"},
            ${tx.json((input ?? {}) as never)}, ${output === null ? null : tx.json(output as never)}, ${error}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
}

async function prepare(ctx: StepContext): Promise<{ result: Prepared; raw: unknown }> {
  return asUser(ctx.userId, async (tx) => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const parsed = pretestStart.safeParse(run?.input);
    if (!parsed.success) return { result: { ok: false, message: "The run's input is not a pre-test request." }, raw: run?.input ?? {} };
    const start = parsed.data;
    const fail = (message: string) => ({ result: { ok: false as const, message }, raw: start });
    const [c] = await tx`
      select c.status, c.approved_version, b.name, b.tone_words, b.voice_notes
      from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${start.campaignId}`;
    if (!c) return fail("The campaign no longer exists, or isn't in this workspace.");
    if (c.status !== "approved" || !c.approved_version) return fail(NOT_SIGNED_OFF_PRETEST);
    const version = c.approved_version as number;
    const panel = await panelFor(tx, start.campaignId, version);
    if (!panel) return fail(NO_PANEL);

    const rows = await tx`
      select v.id, v.brief_version, v.picked_at, v.discarded_at, a.discarded_at as image_discarded, s.discarded_at as words_discarded,
        s.channel, s.set, s.legal_lines, s.segment_title
      from public.ad_variants v
      join public.assets a on a.id = v.image_asset_id
      join public.copy_sets s on s.id = v.copy_set_id
      where v.id = any(${start.variantIds}::uuid[]) and v.campaign_id = ${start.campaignId}`;
    const keys = await adKeys(tx, rows.map((r) => r.id as string));
    const jobs: Job[] = [];
    const skipped: { variantId: string; reason: string }[] = [];
    for (const [i, id] of start.variantIds.entries()) {
      const r = rows.find((x) => x.id === id);
      const why = !r
        ? "that ad is no longer in this campaign"
        : r.discarded_at || r.image_discarded || r.words_discarded
          ? "that ad was discarded, or its picture or words were replaced"
          : r.brief_version !== version
            ? `that ad is for version ${r.brief_version}; the signed-off brief is version ${version}`
            : !r.picked_at
              ? "that ad is no longer picked"
              : null;
      if (why || !r) {
        skipped.push({ variantId: id, reason: why ?? "unknown ad" });
        continue;
      }
      const set = r.set as AdWords;
      jobs.push({
        variantId: id,
        number: i + 1,
        adKey: keys.get(id)!,
        channel: r.channel as Job["channel"],
        audience: r.segment_title as string,
        words: { headline: set.headline, body: set.body, cta: set.cta },
        legalLines: (r.legal_lines as string[]) ?? [],
      });
    }
    if (jobs.length === 0) return fail(`Nothing to pre-test: ${[...new Set(skipped.map((s) => s.reason))].join("; ") || "no ads were chosen"}.`);
    return {
      result: {
        ok: true,
        campaignId: start.campaignId,
        version,
        brandName: c.name as string,
        voice: [(c.tone_words as string[]).join(", "), c.voice_notes as string].filter(Boolean).join(". ").slice(0, 2500),
        panel,
        jobs,
        skipped,
      },
      raw: start,
    };
  });
}

async function scoreOne(ctx: StepContext, p: Extract<Prepared, { ok: true }>, job: Job, seq: number): Promise<Scored> {
  const headline = shown(job.words.headline);
  const base = { variantId: job.variantId, number: job.number, headline };
  // The ad as it is now: if it changed since the click (a layout switch), it is scored as it is, under its new key.
  const drawable = await drawableVariant(ctx.userId, job.variantId);
  if (!drawable) return { ...base, ok: false, cap: false, reason: "the ad was discarded, or its picture or words were replaced, before it was scored" };
  const drawn = await drawVariant(ctx.userId, drawable);
  if ("refused" in drawn) return { ...base, ok: false, cap: false, reason: `the ad couldn't be drawn (${drawn.refused})` };
  const input: PretestInput = {
    brandName: p.brandName,
    voice: p.voice,
    channel: job.channel,
    audience: job.audience,
    words: job.words,
    legalLines: job.legalLines,
    personas: p.panel.personas,
    adNumber: job.number,
    image: { data: new Uint8Array(drawn.png.buffer, drawn.png.byteOffset, drawn.png.byteLength), mediaType: "image/png" },
  };
  try {
    const { output, stepId } = await runModelStep(ctx, pretestAgent, input, seq, `Panel scores "${headline}"`.slice(0, 200));
    const names = new Map(p.panel.personas.map((x) => [x.key, x]));
    const panel: StoredPanel = {
      label: SYNTHETIC_PANEL,
      personas: output.personas.map((x) => ({
        key: x.key,
        name: names.get(x.key)?.name ?? x.key,
        segment: names.get(x.key)?.segment ?? "",
        average: personaAverage(x.scores),
        scores: x.scores,
      })),
    };
    const average = panelAverage(output);
    const saved = await asUser(ctx.userId, async (tx) => {
      const [stepRow] = await tx`select provider, attempts from public.agent_steps where id = ${stepId}`;
      const [v] = await tx`select image_asset_id, copy_set_id from public.ad_variants where id = ${job.variantId}`;
      const simulated = stepRow?.provider === "mock";
      await tx`
        insert into public.pretest_scores (workspace_id, campaign_id, variant_id, image_asset_id, copy_set_id, ad_key, persona_run_id,
                                           run_id, step_id, panel, average, simulated, created_by)
        values (${ctx.workspaceId}, ${p.campaignId}, ${job.variantId}, ${v.image_asset_id}, ${v.copy_set_id}, ${drawable.etag}, ${p.panel.personaRunId},
                ${ctx.runId}, ${stepId}, ${tx.json(panel as never)}, ${average}, ${simulated}, ${ctx.userId})
        on conflict (run_id, variant_id) do nothing`;
      return { simulated, repaired: Number(stepRow?.attempts ?? 1) > 1 };
    });
    return { ...base, ok: true, average, ...saved };
  } catch (err) {
    const cap = err instanceof CapExceededError;
    const message = err instanceof Error ? err.message : String(err);
    const reason = cap
      ? "the daily AI cap was reached"
      : err instanceof AgentOutputError
        ? `the panel's reply still broke a rule after one repair (${message.replace(/^The agent's reply (failed its checks|did not match the expected format): /, "")})`
        : `the model call failed (${message})`;
    return { ...base, ok: false, cap, reason };
  }
}

export async function executePretestRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("read", async (): Promise<Prepared> => {
    const started = Date.now();
    const { result, raw } = await prepare(ctx);
    await systemStep(
      ctx,
      result.ok,
      raw,
      result.ok
        ? { version: result.version, personas: result.panel.personas.map((x) => x.name), ads: result.jobs.map((j) => j.variantId), skipped: result.skipped }
        : null,
      result.ok ? null : result.message,
      started,
    );
    return result;
  });
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }

  const results: Scored[] = [];
  let capped = false;
  for (const [i, job] of prepared.jobs.entries()) {
    if (capped) {
      results.push({ ok: false, variantId: job.variantId, number: job.number, headline: shown(job.words.headline), cap: true, reason: "not started: the daily AI cap was reached" });
      continue;
    }
    const r = await step.run(`pretest-${job.variantId}`, () => scoreOne(ctx, prepared, job, 2 + i));
    results.push(r);
    if (!r.ok && r.cap) capped = true;
  }

  return step.run("finish", async () => {
    const made = results.filter((r): r is Extract<Scored, { ok: true }> => r.ok);
    const failed = results.filter((r): r is Extract<Scored, { ok: false }> => !r.ok);
    const simulated = made.some((m) => m.simulated);
    const what = made.length
      ? `${SYNTHETIC_PANEL}: ${plural(prepared.panel.personas.length, "persona")} scored ${plural(made.length, "picked ad")}${simulated ? " (simulated scores from the mock model)" : ""}`
      : "No ads were scored";
    const notes = [...failed.map((f) => `"${f.headline}": ${f.reason}.`), ...prepared.skipped.map((s) => `One ad was left out: ${s.reason}.`)];
    const output = {
      summary: `${what}.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      label: SYNTHETIC_PANEL,
      scored: made.map((m) => ({ variantId: m.variantId, headline: m.headline, average: m.average, simulated: m.simulated, repaired: m.repaired })),
      notScored: [...failed.map((f) => ({ variantId: f.variantId, reason: f.reason })), ...prepared.skipped],
      campaignId: prepared.campaignId,
      briefVersion: prepared.version,
      href: `/campaigns/${prepared.campaignId}#creative`,
      hrefLabel: "See the panel's scores",
    };
    if (capped) {
      await setRun(ctx, "stopped_cap", { output, error: `Daily AI cap reached. ${what}. The scores made are kept.` });
      return "stopped_cap";
    }
    if (made.length === 0) {
      await setRun(ctx, "failed", { output, error: `No ads were scored. ${notes.join(" ")}`.trim() });
      return "failed";
    }
    await setRun(ctx, "completed", { output });
    return "completed";
  });
}
