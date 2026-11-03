import sharp from "sharp";
import { realNamesFor } from "@/lib/brief/gather";
import {
  dontKeys,
  maskNames,
  outcomeLine,
  uploadFindings,
  uploadOutcome,
  type UploadKit,
} from "@/lib/compliance/upload-rules";
import { ENGLISH, LANG_NAMES, brandLanguagesIn } from "@/lib/creative/languages";
import type { PaletteColour } from "@/lib/creative/render/colour";
import { asUser } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import { measureContrast } from "@/lib/uploads/contrast";
import { isFinanceCategory } from "./imagery";
import { AgentOutputError, runModelStep, type StepContext } from "./model-step";
import { readAdAgent, readAdStart, type ReadAdInput } from "./read-ad";
import { setRun, type StepTools } from "./workflow";

// C8-3: Check an ad. Read the upload's details and the brand's kit as it is
// now (a system step), then one Read ad model step: Haiku with vision reads
// the words and estimates their boxes and the logo's, and says whether there
// is a face (finance brands) and whether any don't rule may be broken. Code
// then checks the words, the density and the contrast from the pixels
// (upload-rules.ts), and the findings are kept in uploaded_ad_checks with the
// words read (any real company's name replaced, so it is said only in its
// finding). Nothing is changed, published or spent beyond the AI cost shown
// on the click that started it (rule 3); the daily cap applies through
// generate() (rule 5). The upload is never redrawn (rule 8).

/** The model sees the ad at most this many pixels on its longest side (Claude scales larger pictures down anyway). */
export const MODEL_MAX_SIDE = 1568;

type Prepared =
  | {
      ok: true;
      brandId: string;
      assetId: string;
      lang: string;
      brandName: string;
      size: { width: number; height: number };
      kit: UploadKit;
    }
  | { ok: false; message: string };

type Checked =
  | { ok: true; checkId: string; outcome: string; line: string; simulated: boolean; lines: number }
  | { ok: false; cap: boolean; reason: string };

async function systemStep(ctx: StepContext, ok: boolean, input: unknown, output: unknown, error: string | null, started: number) {
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, 1, 'Read the upload and the kit', 'system', ${ok ? "succeeded" : "failed"},
            ${tx.json((input ?? {}) as never)}, ${output === null ? null : tx.json(output as never)}, ${error}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
}

async function prepare(ctx: StepContext): Promise<{ result: Prepared; raw: unknown }> {
  return asUser(ctx.userId, async (tx) => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const parsed = readAdStart.safeParse(run?.input);
    if (!parsed.success) return { result: { ok: false, message: "The run's input is not a check of an uploaded ad." }, raw: run?.input ?? {} };
    const start = parsed.data;
    const fail = (message: string) => ({ result: { ok: false as const, message }, raw: start });
    const [b] = await tx`
      select name, category, palette, legal_lines, banned_terms, dont_rules, logo_svg, logo_asset_id
      from public.brands where id = ${start.brandId}`;
    if (!b) return fail("The brand no longer exists, or isn't in this workspace.");
    const [a] = await tx`
      select width, height from public.assets
      where id = ${start.assetId} and brand_id = ${start.brandId} and kind = 'upload' and discarded_at is null`;
    if (!a) return fail("The uploaded ad no longer exists, or isn't this brand's.");
    const isEnglish = start.lang === ENGLISH;
    const language = isEnglish ? null : (await brandLanguagesIn(tx, start.brandId)).find((l) => l.lang === start.lang);
    if (!isEnglish && !language) return fail("That language is no longer one of the brand's languages.");
    const englishLegal = (b.legal_lines as string[]) ?? [];
    const englishBanned = (b.banned_terms as string[]) ?? [];
    return {
      result: {
        ok: true,
        brandId: start.brandId,
        assetId: start.assetId,
        lang: start.lang,
        brandName: b.name as string,
        size: { width: a.width as number, height: a.height as number },
        kit: {
          langName: (LANG_NAMES as Record<string, string>)[start.lang] ?? start.lang,
          isEnglish,
          legalLines: isEnglish ? englishLegal : language!.legalLines.length ? language!.legalLines : null,
          englishLegal,
          bannedTerms: isEnglish ? englishBanned : [...language!.bannedTerms, ...englishBanned],
          dontRules: (b.dont_rules as string[]) ?? [],
          realNames: await realNamesFor(tx, start.brandId),
          palette: ((b.palette as PaletteColour[]) ?? []).filter((p) => p && typeof p.hex === "string"),
          hasLogo: !!(b.logo_svg || b.logo_asset_id),
          finance: isFinanceCategory((b.category as string) ?? ""),
          channel: start.channel,
        },
      },
      raw: start,
    };
  });
}

/** The ad as the model sees it: no larger than MODEL_MAX_SIDE, as a JPEG (small to send; the boxes are fractions, so size doesn't change them). */
async function modelCopy(bytes: Buffer): Promise<Uint8Array> {
  const out = await sharp(bytes)
    .resize({ width: MODEL_MAX_SIDE, height: MODEL_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#FFFFFF" })
    .jpeg({ quality: 88 })
    .toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

async function readAndCheck(ctx: StepContext, p: Extract<Prepared, { ok: true }>): Promise<Checked> {
  const [asset] = await asUser(ctx.userId, (tx) => tx`select bytes from public.assets where id = ${p.assetId} and kind = 'upload'`);
  if (!asset) return { ok: false, cap: false, reason: "the uploaded ad was removed before it was read" };
  const bytes = asset.bytes as Buffer;
  const keys = dontKeys(p.kit.dontRules);
  const input: ReadAdInput = {
    brandName: p.brandName,
    finance: p.kit.finance,
    dontRules: keys.map((k) => ({ key: k.key, rule: k.rule })),
    langName: p.kit.langName,
    channel: p.kit.channel as ReadAdInput["channel"],
    size: p.size,
    image: { data: await modelCopy(bytes), mediaType: "image/jpeg" },
  };
  try {
    const { output, stepId } = await runModelStep(ctx, readAdAgent, input, 2, "Read the uploaded ad");
    const measured = await measureContrast(bytes, output.words.map((w) => w.box));
    const findings = uploadFindings(output, measured, p.kit, p.size);
    const outcome = uploadOutcome(findings);
    // The words as shown with the check: each real company's name is said once, in its finding.
    const words = output.words.map((w) => ({ text: maskNames(w.text, p.kit.realNames), part: w.part }));
    return asUser(ctx.userId, async (tx) => {
      const [stepRow] = await tx`select provider from public.agent_steps where id = ${stepId}`;
      const simulated = stepRow?.provider === "mock";
      // Append-only (no update grant): a retried step keeps the row it already saved.
      const [made] = await tx`
        insert into public.uploaded_ad_checks (workspace_id, brand_id, asset_id, channel, lang, run_id, step_id, words, findings, outcome, simulated, created_by)
        values (${ctx.workspaceId}, ${p.brandId}, ${p.assetId}, ${p.kit.channel}, ${p.lang}, ${ctx.runId}, ${stepId},
                ${tx.json(words as never)}, ${tx.json(findings as never)}, ${outcome}, ${simulated}, ${ctx.userId})
        on conflict (run_id) do nothing
        returning id`;
      const row = made ?? (await tx`select id from public.uploaded_ad_checks where run_id = ${ctx.runId}`)[0];
      return { ok: true as const, checkId: row.id as string, outcome, line: outcomeLine(findings), simulated, lines: words.length };
    });
  } catch (err) {
    const cap = err instanceof CapExceededError;
    const message = err instanceof Error ? err.message : String(err);
    const reason = cap
      ? "the daily AI cap was reached"
      : err instanceof AgentOutputError
        ? `the AI's reading still broke a rule after one repair (${message.replace(/^The agent's reply (failed its checks|did not match the expected format): /, "")})`
        : `the model call failed (${message})`;
    return { ok: false, cap, reason };
  }
}

export async function executeReadAdRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("read", async (): Promise<Prepared> => {
    const started = Date.now();
    const { result, raw } = await prepare(ctx);
    await systemStep(
      ctx,
      result.ok,
      raw,
      result.ok
        ? {
            size: result.size,
            language: result.kit.langName,
            channel: result.kit.channel,
            legalLines: result.kit.legalLines?.length ?? 0,
            bannedTerms: result.kit.bannedTerms.length,
            dontRules: result.kit.dontRules.length,
            realNames: result.kit.realNames.length,
            finance: result.kit.finance,
          }
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

  const checked = await step.run("read-ad", () => readAndCheck(ctx, prepared));

  return step.run("finish", async () => {
    const href = `/brands/${prepared.brandId}/check/${prepared.assetId}`;
    if (!checked.ok) {
      const error = `The uploaded ad wasn't checked: ${checked.reason}.`;
      await setRun(ctx, checked.cap ? "stopped_cap" : "failed", { output: { summary: error, href, hrefLabel: "See the upload" }, error });
      return checked.cap ? "stopped_cap" : "failed";
    }
    const output = {
      summary: `Checked an uploaded ad against the kit: ${checked.line}${checked.simulated ? " (simulated reading from the mock model)" : ""}`,
      checkId: checked.checkId,
      outcome: checked.outcome,
      href,
      hrefLabel: "See the check",
    };
    await setRun(ctx, "completed", { output });
    return "completed";
  });
}
