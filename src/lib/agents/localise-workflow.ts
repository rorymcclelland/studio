import { fitInSizes, type SizeFit } from "@/lib/creative/ad-sizes";
import { loadCopyContext, NOT_SIGNED_OFF } from "@/lib/creative/copy-context";
import { brandLanguagesIn, langList, languageRefusal, LANG_NAMES, type Lang } from "@/lib/creative/languages";
import type { LayoutId } from "@/lib/creative/render/layouts";
import type { RenderInput } from "@/lib/creative/render/render";
import { SIZES, type SizeId } from "@/lib/creative/render/sizes";
import { kitHash, LAYOUT_NAMES, type AdWords, type KitSnapshot } from "@/lib/creative/variants";
import { asUser, type Tx } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import type { AgentDefinition } from "./contract";
import { checkTranslation, localiseAgent, localiseStart, type LocaliseChannel, type LocaliseInput, type LocaliseOutput } from "./localise";
import { AgentOutputError, runModelStep, type StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

// C7-2: Translate. Read the English sets and the brand's languages (system
// step), then one Localise model step per set and language: the code checks
// (limits, the language's banned terms, names, testimonials) and the fit in
// every size of the channel, for every current ad on the set, with one repair
// naming the field and size. A size still too small for the words is left out
// with the reason (the Sizes view refuses it, as for English); a language that
// still breaks a rule is left out for that set. Each translation is saved as a
// new copy set (lang, translated_from), with the language's legal lines from
// the kit. Nothing is published, replaced or spent beyond the AI cost (rule
// 3): the person's click, with the cost shown on it, started the run, and the
// English ads are unchanged.

/** An ad on a set, as the fit check needs it: its layout and kit (fonts, palette, logo). */
type Target = { layout: LayoutId; kit: KitSnapshot };

type SetToTranslate = {
  channel: LocaliseChannel;
  english: AdWords;
  segmentRef: string | null;
  segmentTitle: string;
  targets: Target[];
  ads: number;
};

type Job = { setId: string; lang: Lang };

type Prepared =
  | {
      ok: true;
      campaignId: string;
      version: number;
      brandName: string;
      base: Omit<LocaliseInput, "lang" | "channel" | "english" | "bannedTerms" | "legalLines">;
      englishBanned: string[];
      languages: Partial<Record<Lang, { legalLines: string[]; bannedTerms: string[] }>>;
      sets: Record<string, SetToTranslate>;
      jobs: Job[];
      skipped: { setId: string | null; lang: Lang | null; reason: string }[];
    }
  | { ok: false; message: string };

export type LeftOutSize = { size: SizeId; name: string; reason: string };

type Translated =
  | { ok: true; setId: string; lang: Lang; newSetId: string; headline: string; simulated: boolean; leftOut: LeftOutSize[]; repaired: boolean }
  | { ok: false; setId: string; lang: Lang; cap: boolean; reason: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const visible = (s: string) => s.split("­").join("");

async function systemStep(ctx: StepContext, seq: number, name: string, ok: boolean, input: unknown, output: unknown, error: string | null, started: number) {
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, ${seq}, ${name}, 'system', ${ok ? "succeeded" : "failed"},
            ${tx.json((input ?? {}) as never)}, ${output === null ? null : tx.json(output as never)}, ${error}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
}

async function prepare(ctx: StepContext): Promise<{ result: Prepared; raw: unknown }> {
  return asUser(ctx.userId, async (tx) => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const parsed = localiseStart.safeParse(run?.input);
    if (!parsed.success) return { result: { ok: false, message: "The run's input is not a translation request." }, raw: run?.input ?? {} };
    const start = parsed.data;
    const raw = start;
    const fail = (message: string) => ({ result: { ok: false as const, message }, raw });
    const [c] = await tx`select status, approved_version from public.campaigns where id = ${start.campaignId}`;
    if (!c) return fail("The campaign no longer exists, or isn't in this workspace.");
    if (c.status !== "approved" || !c.approved_version) return fail(NOT_SIGNED_OFF);
    const context = await loadCopyContext(tx, start.campaignId);
    if (!context) return fail("The signed-off brief version no longer exists.");
    const languages = await brandLanguagesIn(tx, context.brandId);

    const skipped: Extract<Prepared, { ok: true }>["skipped"] = [];
    const langs: Lang[] = [];
    for (const lang of start.langs) {
      const refusal = languageRefusal(context.kit.legalLines, languages.find((l) => l.lang === lang), lang);
      if (refusal) skipped.push({ setId: null, lang, reason: refusal });
      else langs.push(lang);
    }

    const rows = await tx`
      select s.id, s.channel, s.set, s.segment_ref, s.segment_title, s.lang, s.brief_version, s.discarded_at
      from public.copy_sets s where s.id = any(${start.setIds}::uuid[]) and s.campaign_id = ${start.campaignId}`;
    const sets: Record<string, SetToTranslate> = {};
    for (const id of start.setIds) {
      const r = rows.find((x) => x.id === id);
      const why = !r
        ? "those words are no longer in this campaign"
        : r.discarded_at
          ? "those words were replaced or discarded"
          : r.brief_version !== context.version
            ? `those words are for version ${r.brief_version}; the signed-off brief is version ${context.version}`
            : r.lang !== "en-GB"
              ? "those words are a translation already"
              : !["paid social", "display"].includes(r.channel as string)
                ? `${r.channel} words aren't translated yet`
                : null;
      if (why || !r) {
        skipped.push({ setId: id, lang: null, reason: why ?? "unknown set" });
        continue;
      }
      const ads = await tx`select layout, kit from public.ad_variants where copy_set_id = ${id} and discarded_at is null order by created_at`;
      if (ads.length === 0) {
        skipped.push({ setId: id, lang: null, reason: "no current ad uses those words" });
        continue;
      }
      const seen = new Map<string, Target>();
      for (const a of ads) seen.set(`${a.layout}:${kitHash(a.kit as KitSnapshot)}`, { layout: a.layout as LayoutId, kit: a.kit as KitSnapshot });
      const set = r.set as AdWords;
      sets[id] = {
        channel: r.channel as LocaliseChannel,
        english: { headline: set.headline, body: set.body, cta: set.cta },
        segmentRef: (r.segment_ref as string | null) ?? null,
        segmentTitle: r.segment_title as string,
        targets: [...seen.values()],
        ads: ads.length,
      };
    }

    const existing = await tx`
      select translated_from, lang from public.copy_sets
      where translated_from = any(${Object.keys(sets)}::uuid[]) and discarded_at is null`;
    const done = new Set(existing.map((e) => `${e.translated_from}:${e.lang}`));
    const jobs: Job[] = [];
    for (const setId of Object.keys(sets)) {
      for (const lang of langs) {
        if (done.has(`${setId}:${lang}`)) skipped.push({ setId, lang, reason: `already translated into ${LANG_NAMES[lang]}` });
        else jobs.push({ setId, lang });
      }
    }
    if (jobs.length === 0) {
      const reasons = [...new Set(skipped.map((s) => s.reason))].join("; ");
      return fail(`Nothing to translate: ${reasons || "no words were chosen"}.`);
    }
    return {
      result: {
        ok: true,
        campaignId: start.campaignId,
        version: context.version,
        brandName: context.brandName,
        base: {
          brandName: context.brandName,
          voice: context.voice,
          doRules: context.doRules,
          dontRules: context.kit.dontRules,
          evidenceClaims: context.kit.evidenceClaims,
          realNames: context.kit.realNames,
          products: context.products,
          places: context.places,
        },
        englishBanned: context.kit.bannedTerms,
        languages: Object.fromEntries(languages.filter((l) => langs.includes(l.lang)).map((l) => [l.lang, { legalLines: l.legalLines, bannedTerms: l.bannedTerms }])),
        sets,
        jobs,
        skipped,
      },
      raw,
    };
  });
}

/** Fit checks for one set: the English words' fit is the baseline, so only sizes the English ad fills can send a translation back. */
type FitCheck = (copy: AdWords) => Promise<{ problems: string[]; leftOut: LeftOutSize[]; fitsSomewhere: boolean }>;

const REPAIRABLE = new Set(["headline", "body", "cta", "copy", "glyphs"]);

function fieldPhrase(langName: string, part: string): string {
  switch (part) {
    case "headline":
      return `the ${langName} headline is too long`;
    case "body":
      return `the ${langName} body is too long`;
    case "cta":
      return `the ${langName} call to action is too long for the button`;
    case "glyphs":
      return `the ${langName} words use characters the fonts can't draw`;
    default:
      return `the ${langName} headline and body together are too long`;
  }
}

async function fitChecker(tx: Tx, set: SetToTranslate, legalLines: string[], englishLegal: string[], lang: Lang): Promise<FitCheck> {
  const langName = LANG_NAMES[lang];
  const logos = new Map<string, Buffer | null>();
  const bases: { target: Target; base: Omit<RenderInput, "image" | "layout" | "size"> }[] = [];
  for (const target of set.targets) {
    const logo = target.kit.logo;
    let png: Buffer | null = null;
    if (logo && "assetId" in logo) {
      if (!logos.has(logo.assetId)) {
        const [l] = await tx`select bytes from public.assets where id = ${logo.assetId}`;
        logos.set(logo.assetId, l ? (l.bytes as Buffer) : null);
      }
      png = logos.get(logo.assetId) ?? null;
    }
    bases.push({
      target,
      base: {
        copy: set.english,
        legalLines,
        logo: logo && "svg" in logo ? { svg: logo.svg } : png ? { png } : null,
        palette: target.kit.palette,
        fontPrimary: target.kit.fontPrimary,
        fontSecondary: target.kit.fontSecondary,
        brandName: target.kit.brandName,
      },
    });
  }
  // The English ad's sizes, with its own legal lines: a size it can't fill is left out in every language, as it is in English.
  const englishFits = await Promise.all(bases.map((b) => fitInSizes({ ...b.base, legalLines: englishLegal }, b.target.layout, set.channel)));
  return async (copy) => {
    const problems = new Set<string>();
    const leftOut = new Map<SizeId, LeftOutSize>();
    let fitsSomewhere = false;
    for (const [i, b] of bases.entries()) {
      const fits: SizeFit[] = await fitInSizes({ ...b.base, copy }, b.target.layout, set.channel);
      for (const f of fits) {
        if (f.ok) {
          fitsSomewhere = true;
          continue;
        }
        const size = SIZES[f.size];
        leftOut.set(f.size, { size: f.size, name: size.name, reason: f.refused });
        const englishFit = englishFits[i].find((e) => e.size === f.size)?.ok === true;
        if (englishFit && REPAIRABLE.has(f.part)) {
          const layout = set.targets.length > 1 ? ` (${LAYOUT_NAMES[b.target.layout]} layout)` : "";
          problems.add(`${fieldPhrase(langName, f.part)} for ${size.phrase}${layout}: shorten it`);
        }
      }
    }
    return { problems: [...problems], leftOut: [...leftOut.values()], fitsSomewhere };
  };
}

/** The Localise agent with this set's fit check added: one repair for both, then the sizes that still don't fit are left out (salvage). */
function withFit(fit: FitCheck): AgentDefinition<LocaliseInput, LocaliseOutput> {
  return {
    ...localiseAgent,
    check: async (input, output) => [...checkTranslation(input, output), ...(await fit(output.copy)).problems],
    salvage: async (input, output) => {
      if (checkTranslation(input, output).length > 0) return null;
      const f = await fit(output.copy);
      if (!f.fitsSomewhere) return null;
      return { output, leftOut: f.problems.map((p) => p.replace(/: shorten it$/, "")) };
    },
  };
}

async function translateOne(ctx: StepContext, p: Extract<Prepared, { ok: true }>, job: Job, seq: number): Promise<Translated> {
  const set = p.sets[job.setId];
  const language = p.languages[job.lang]!;
  const input: LocaliseInput = {
    ...p.base,
    lang: job.lang,
    channel: set.channel,
    english: set.english,
    bannedTerms: [...new Set([...language.bannedTerms, ...p.englishBanned])],
    legalLines: language.legalLines,
  };
  const englishLegal = await asUser(ctx.userId, async (tx) => {
    const [s] = await tx`select legal_lines from public.copy_sets where id = ${job.setId}`;
    return (s?.legal_lines as string[]) ?? [];
  });
  const fit = await asUser(ctx.userId, (tx) => fitChecker(tx, set, language.legalLines, englishLegal, job.lang));
  const langName = LANG_NAMES[job.lang];
  try {
    const { output, stepId } = await runModelStep(ctx, withFit(fit), input, seq, `Translate "${set.english.headline}" into ${langName}`.slice(0, 200));
    const finalFit = await fit(output.copy);
    const saved = await asUser(ctx.userId, async (tx) => {
      const [stepRow] = await tx`select provider, attempts from public.agent_steps where id = ${stepId}`;
      const simulated = stepRow?.provider === "mock";
      // A retried step finds the translation it already saved (one current translation per set and language).
      const [row] = await tx`
        insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_ref, segment_title, set, legal_lines,
                                      source, created_by, created_at, lang, translated_from, simulated)
        values (${ctx.workspaceId}, ${p.campaignId}, ${p.version}, ${ctx.runId}, ${set.channel}, ${set.segmentRef}, ${set.segmentTitle},
                ${tx.json(output.copy as never)}, ${language.legalLines}, 'agent', ${ctx.userId}, clock_timestamp(), ${job.lang}, ${job.setId}, ${simulated})
        on conflict (translated_from, lang) where translated_from is not null and discarded_at is null do nothing
        returning id`;
      const id = row
        ? (row.id as string)
        : ((await tx`select id from public.copy_sets where translated_from = ${job.setId} and lang = ${job.lang} and discarded_at is null`)[0].id as string);
      return { id, simulated, repaired: Number(stepRow?.attempts ?? 1) > 1 };
    });
    return { ok: true, setId: job.setId, lang: job.lang, newSetId: saved.id, headline: visible(output.copy.headline), simulated: saved.simulated, leftOut: finalFit.leftOut, repaired: saved.repaired };
  } catch (err) {
    const cap = err instanceof CapExceededError;
    const message = err instanceof Error ? err.message : String(err);
    const reason = cap
      ? "the daily AI cap was reached"
      : err instanceof AgentOutputError
        ? `the ${langName} words still broke a rule after one repair (${message.replace(/^The agent's reply (failed its checks|did not match the expected format): /, "")})`
        : `the model call failed (${message})`;
    return { ok: false, setId: job.setId, lang: job.lang, cap, reason };
  }
}

export async function executeLocaliseRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("read", async (): Promise<Prepared> => {
    const started = Date.now();
    const { result, raw } = await prepare(ctx);
    await systemStep(
      ctx,
      1,
      "Read the words and the brand's languages",
      result.ok,
      raw,
      result.ok ? { version: result.version, jobs: result.jobs, skipped: result.skipped, languages: Object.keys(result.languages) } : null,
      result.ok ? null : result.message,
      started,
    );
    return result;
  });
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }

  const results: Translated[] = [];
  let capped = false;
  for (const [i, job] of prepared.jobs.entries()) {
    if (capped) {
      results.push({ ok: false, setId: job.setId, lang: job.lang, cap: true, reason: "not started: the daily AI cap was reached" });
      continue;
    }
    const r = await step.run(`translate-${job.setId}-${job.lang}`, () => translateOne(ctx, prepared, job, 2 + i));
    results.push(r);
    if (!r.ok && r.cap) capped = true;
  }

  return step.run("finish", async () => {
    const made = results.filter((r): r is Extract<Translated, { ok: true }> => r.ok);
    const failed = results.filter((r): r is Extract<Translated, { ok: false }> => !r.ok);
    const setCount = new Set(prepared.jobs.map((j) => j.setId)).size;
    const langs = [...new Set(made.map((m) => m.lang))];
    const ads = [...new Set(made.map((m) => m.setId))].reduce((n, id) => n + prepared.sets[id].ads, 0);
    const sizesLeft = made.flatMap((m) => m.leftOut.map((l) => `${LANG_NAMES[m.lang]} at ${l.name} (${l.reason})`));
    const notes = [
      ...failed.map((f) => `${LANG_NAMES[f.lang]} for "${prepared.sets[f.setId].english.headline}": ${f.reason}.`),
      ...prepared.skipped.filter((s) => s.lang && !s.setId).map((s) => s.reason),
    ];
    const what = made.length
      ? `${plural(made.length, "translation")} (${langList(langs)}) of ${plural(setCount, "set")} of words, shown on ${plural(ads, "ad")} as machine translations`
      : "No translations";
    const output = {
      summary: `${what}.${sizesLeft.length ? ` Left out: ${sizesLeft.join("; ")}.` : ""}${notes.length ? ` ${notes.join(" ")}` : ""}`.trim(),
      translations: made.map((m) => ({ setId: m.setId, lang: m.lang, newSetId: m.newSetId, headline: m.headline, simulated: m.simulated, repaired: m.repaired, leftOut: m.leftOut })),
      notTranslated: [
        ...failed.map((f) => ({ setId: f.setId, lang: f.lang, reason: f.reason })),
        ...prepared.skipped.map((s) => ({ setId: s.setId, lang: s.lang, reason: s.reason })),
      ],
      campaignId: prepared.campaignId,
      briefVersion: prepared.version,
      href: `/campaigns/${prepared.campaignId}/creative`,
      hrefLabel: "See the ads",
    };
    if (capped) {
      await setRun(ctx, "stopped_cap", { output, error: `Daily AI cap reached: ${what.toLowerCase()}. What was translated is kept.` });
      return "stopped_cap";
    }
    if (made.length === 0) {
      await setRun(ctx, "failed", { output, error: `Nothing was translated. ${notes.join(" ")}`.trim() });
      return "failed";
    }
    await setRun(ctx, "completed", { output });
    return "completed";
  });
}
