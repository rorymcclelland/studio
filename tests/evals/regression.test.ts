// F-16a #2: the replies that broke production, saved as fixtures
// (tests/evals/fixtures), against the graders of the eval cases that guard
// them. Each case's grader fails the bad reply and passes the fix; where the
// fix was in code (a check, a schema, the repair), the bad reply goes through
// that code and is shown handled, and the check as it was before the fix is
// shown to refuse it, so the fixture is known to be the one that broke.
//
// The fixtures are reconstructions: the production replies are in
// production's agent_steps and were never copied into the repository. Each
// fixture says what is quoted from the production notes and commits, and what
// was written around it (rule 1). Two of the three "brief" failures in Sprint
// 9's refinement were the Market agent's (docs/refinement/sprint-4.md), so
// their fixtures are under market. P9-4 has not reached production, so its
// fixtures are the bad replies its agreed cases name.
//
// Sprint 10 adds BUG-4 and BUG-11, from F-16a's own real-model run (6 and 7
// Nov): the brief's loose quantities, and the brand's name reaching the
// image-prompt model. Their fixtures are reconstructed around what the reports
// quote, the same way.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_MODELS } from "@/config/agents";
import { briefAgent } from "@/lib/agents/brief";
import { brandNameIn, checkImagery, forImageModel, imageryAgent, imageryOutput, type ImageryInput, type ImageryOutput } from "@/lib/agents/imagery";
import { checkMarket, marketAgent, marketOutput, undeclaredNames, type MarketInput, type MarketOutput } from "@/lib/agents/market";
import { AgentOutputError, extractJson, repairPrompt, runModelStep } from "@/lib/agents/model-step";
import { createWorkflowRun, getRun, type Member } from "@/lib/agents/runs";
import type { EvidenceItem, KitLists } from "@/lib/brief/checks";
import { evidenceProblems, figuresIn, figureSupported, quantityInWords } from "@/lib/brief/checks";
import type { StoredBrief } from "@/lib/brief/schema";
import { colourWords } from "@/lib/creative/colour-words";
import { closeSql } from "@/lib/db/client";
import { mockBehaviour } from "@/lib/models/mock";
import { resultFrom } from "@/lib/performance/ask-rules";
import { pageReader } from "@/lib/web/page-text";
import { createMember, truncateAll } from "../helpers/db";
import { DEMO_VIEWS, demoRows } from "../helpers/monitor";
import briefEval, { quantityAttempts } from "./brief.eval";
import imageryEval, { BRAND_NAME_INPUT, linesNamingTheBrand, REGRESSION_INPUT, regressionProblems } from "./imagery.eval";
import marketEval from "./market.eval";
import answerEval, { ANSWER_CASES } from "./monitorAnswer.eval";
import { EVAL_CAMPAIGN, gradePlan, type PlanExpectation } from "./monitorPlan.eval";

const DIR = join(process.cwd(), "tests/evals/fixtures");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixture = (p: string): any => JSON.parse(readFileSync(join(DIR, p), "utf8"));
const said = (r: { text: string }) => ({ ...r, inputTokens: 100, outputTokens: 100 });

let m: Member;
beforeAll(async () => {
  await truncateAll();
  m = await createMember();
});
beforeEach(() => mockBehaviour.reset());
afterAll(closeSql);

async function step<I, O>(agent: Parameters<typeof runModelStep<I, O>>[1], input: I, label: string) {
  const runId = await createWorkflowRun(m, agent.key, agent.version, { regression: true }, async () => {}, { label });
  const ctx = { runId, workspaceId: m.workspaceId, userId: m.userId };
  try {
    const r = await runModelStep(ctx, agent, input, 1, label);
    const s = (await getRun(m.userId, runId))!.steps.find((x) => x.id === r.stepId)!;
    return { ok: true as const, output: r.output, leftOut: r.leftOut, attempts: s.attempt_log.map((a) => a.problems) };
  } catch (err) {
    const s = (await getRun(m.userId, runId))!.steps[0];
    return { ok: false as const, error: err, message: err instanceof Error ? err.message : String(err), attempts: s.attempt_log.map((a) => a.problems) };
  }
}

describe("F-16a the regression fixtures", () => {
  it("each says which case it is, where the failure is recorded, and how much of it is reconstructed", () => {
    const files = readdirSync(DIR, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".json") && !f.endsWith("quillmoor-input.json"));
    expect(files.sort()).toEqual([
      "brief/brand-name-figure.json",
      "brief/loose-quantities.json",
      "imagery/aspect-wording.json",
      "imagery/brand-name.json",
      "imagery/cut-off-reply.json",
      "imagery/ruled-out-face.json",
      "market/long-note.json",
      "market/possessive-names.json",
      "monitorAnswer/figure-and-forecast.json",
      "monitorPlan/refusal-and-injection.json",
    ]);
    for (const f of files) {
      const x = fixture(f);
      expect(x.case, f).toMatch(/\w{5}/);
      // Rule 1: a fixture is either reconstructed from the record, with what was written around it, or quoted from the refinement.
      expect(["reconstructed", "from the refinement"], f).toContain(x.provenance);
      expect(x.provenanceNote.length, f).toBeGreaterThan(80);
      expect(x.source, f).toMatch(/docs\/refinement\/sprint-\d+\.md/);
      if (x.provenance === "reconstructed") {
        expect(x.provenanceNote, f).toContain("never copied into the repository");
        expect(x.source, f).toMatch(/commits? [0-9a-f]{7}/);
      }
    }
  });

  it("the Imagery input's palette words are the demo palette's, as code makes them", () => {
    for (const c of [...REGRESSION_INPUT.palette, ...BRAND_NAME_INPUT.palette]) expect(colourWords(c.hex), c.name).toBe(c.words);
  });

  it("the regression eval cases are in the eval files, and the prompt-only ones draw no pictures", () => {
    expect(briefEval.cases.map((c) => c.name)).toContain("Regression, 26 Oct: the brand name beside a figure");
    expect(briefEval.cases.map((c) => c.name)).toContain("Regression, 6-7 Nov: loose quantities (Quillmoor sign-ups)");
    expect(marketEval.cases.map((c) => c.name)).toContain("Quillmoor (personal finance app, UK), as the 26 Oct production runs");
    const reg = imageryEval.cases.filter((c) => c.input.regression);
    expect(reg.map((c) => c.input.regression)).toEqual(["cut-off", "face", "aspect", "brand-name"]);
    for (const c of reg) expect(c.extraPence, c.name).toBe(0);
  });
});

describe("F-16a brief: the brand name read as a figure (26 Oct)", () => {
  const f = fixture("brief/brand-name-figure.json");
  const ctx = { objective: f.objective as string, context: f.context as EvidenceItem[], kit: f.kit as KitLists, noExclamations: true };
  const input = { brand: "quillmoor" as const, objective: f.objective as string };

  it("the figure check before 66e6794 refused the production reply's figure: it took Quillmoor as the unit", () => {
    // The pattern and unit rule as they were before the fix (66e6794's parent).
    const BEFORE = /(£\s?)?(\d[\d,]*(?:\.\d+)?)(\s?(?:%|per\s?cent\b))?(?:\s+([a-z]+))?/gi;
    const STOP = new Set(["of", "in", "and", "or", "to", "the", "a", "an", "on", "at", "for", "by", "with", "from", "as", "is", "are", "was", "were", "have", "has", "than"]);
    const before = (t: string) => [...t.matchAll(BEFORE)].map((x) => ({ value: x[2].replace(/,/g, ""), unit: x[1] ? "£" : x[3] ? "%" : x[4] && !STOP.has(x[4].toLowerCase()) ? x[4].toLowerCase() : "" }));
    const figure = before(f.reply.insights[0].text).find((x) => x.value === "2000")!;
    expect(figure.unit).toBe("quillmoor");
    expect(figureSupported(figure, before(f.context[1].text))).toBe(false);
    expect(f.reply.insights[0].text).toContain("533 of 2,000 Quillmoor Money customers");
  });

  it("the brief eval's grader passes the production reply now, and fails the same reply with a figure the segment doesn't hold", async () => {
    const good = await briefEval.grade(input, f.reply as StoredBrief, ctx);
    expect(good, good.notes).toMatchObject({ pass: true });
    expect(figuresIn("2,000 Quillmoor Money customers")[0]).toEqual({ value: "2000", unit: "customer" });
    const bad = structuredClone(f.reply) as StoredBrief;
    bad.insights[0].text = f.stillRefused.insight;
    const refused = await briefEval.grade(input, bad, ctx);
    expect(refused.pass).toBe(false);
    expect(refused.notes).toContain("insight 1 says 612");
  });
});

describe("F-16a market: the long note (26 Oct, first run)", () => {
  const f = fixture("market/long-note.json");
  const input = f.input as MarketInput;
  const sources = (f.pages as { url: string; title: string }[]).map((p) => ({ url: p.url, title: p.title, citedText: [] as string[] }));
  const pageText = new Map((f.pages as { url: string; text: string }[]).map((p) => [p.url, p.text]));
  const realRead = pageReader.read;
  beforeEach(() => {
    pageReader.read = async (url) => pageText.get(url) ?? null;
  });
  afterAll(() => {
    pageReader.read = realRead;
  });

  it("the note past the old 500-character limit is taken by today's schema and passes the market eval's grader", async () => {
    const long = f.reply.notes[0].text as string;
    expect(long.length).toBeGreaterThan(500);
    expect(long.length).toBeLessThanOrEqual(700);
    // The schema before a33b51b (62d3236): notes of at most 500 characters.
    expect(z.string().trim().min(20).max(500).safeParse(long).success).toBe(false);
    expect(marketOutput.safeParse(f.reply).success).toBe(true);
    expect(await checkMarket(input, f.reply as MarketOutput, { sources, readPage: async (u) => pageText.get(u) ?? null })).toEqual([]);
    const g = await marketEval.grade({ brand: "quillmoor" }, f.reply as MarketOutput, { sources, brandName: input.brandName, banned: input.bannedTerms });
    expect(g, g.notes).toMatchObject({ pass: true });
  });

  it("the repair that wrote a search instead of JSON fails; today's repair is shown the pages, told no tools are left, and given the whole reply", async () => {
    expect(extractJson(f.repairReply)).toBeUndefined();
    const tooLong = structuredClone(f.reply);
    tooLong.notes[0].text = "x".repeat(f.tooLongNote.length);
    expect(marketOutput.safeParse(tooLong).success).toBe(false);
    const repair = repairPrompt("P", "notes.0.text: Too big", JSON.stringify(tooLong), sources);
    expect(repair).toContain("Searching is finished and no tools are available");
    for (const s of sources) expect(repair).toContain(s.url);
    expect(repair).toContain(JSON.stringify(tooLong).slice(-40));

    // Through the model step: the production pair (a note too long, then a search) fails as it did,
    // and a repair in JSON is kept.
    mockBehaviour.searchPages = sources.map((s) => ({ url: s.url, title: s.title, citedText: "" }));
    mockBehaviour.next(said({ text: JSON.stringify(tooLong) }));
    mockBehaviour.next(said({ text: f.repairReply }));
    const broke = await step(marketAgent, input, "Research the market");
    expect(broke.ok).toBe(false);
    expect(broke.ok ? "" : broke.message).toMatch(/did not match the expected format: The reply was not valid JSON/);
    expect(mockBehaviour.lastPlainPrompt).toContain("Searching is finished and no tools are available");

    mockBehaviour.searchPages = sources.map((s) => ({ url: s.url, title: s.title, citedText: "" }));
    mockBehaviour.next(said({ text: JSON.stringify(tooLong) }));
    mockBehaviour.next(said({ text: JSON.stringify(f.reply) }));
    const fixed = await step(marketAgent, input, "Research the market");
    expect(fixed.ok, fixed.ok ? "" : fixed.message).toBe(true);
    expect(fixed.attempts[0].join(" ")).toMatch(/700 characters|Too big/);
  });
});

describe("F-16a market: the possessive names (26 Oct, second and third runs)", () => {
  const f = fixture("market/possessive-names.json");
  const input = f.input as MarketInput;
  const sources = (f.pages as { url: string; title: string }[]).map((p) => ({ url: p.url, title: p.title, citedText: [] as string[] }));

  it("the name check before ce2ceef flagged the possessive names in the reply, as it did in production", () => {
    // undeclaredNames as it was before the fix (ce2ceef's parent), with its list of common words.
    const COMMON = new Set(
      (
        "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday " +
        "spring summer autumn winter christmas easter boxing day new year year's eve black friday cyber monday bank holiday valentine's halloween bonfire night " +
        "uk u.k gb britain british great england english scotland scottish wales welsh ireland irish northern london europe european eu " +
        "north south east west midlands yorkshire humber highlands lake district peak dales cornwall devon cumbria snowdonia " +
        "vat gdp ons ai app apps i a an the this that these those it its our we they"
      ).split(" "),
    );
    const before = (text: string, declared: string[], i: MarketInput) => {
      const own = new Set([i.brandName, i.category, ...i.products, ...i.places].join(" ").toLowerCase().match(/[a-z0-9']+/g) ?? []);
      const declaredWords = new Set(declared.join(" ").toLowerCase().match(/[a-z0-9'.&-]+/g) ?? []);
      const out = new Set<string>();
      const capital = (w: string) => /^[A-Z][A-Za-z0-9'.&-]*[A-Za-z0-9]$|^[A-Z]{2,}$/.test(w);
      for (const sentence of text.split(/(?<=[.!?:;])\s+|\n+/)) {
        const words = sentence.split(/\s+/).filter(Boolean).map((raw) => raw.replace(/^[("'‘“]+|[)"'’”.,!?;:]+$/g, ""));
        let k = 0;
        while (k < words.length) {
          if (!capital(words[k])) {
            k++;
            continue;
          }
          let j = k;
          while (j + 1 < words.length && capital(words[j + 1])) j++;
          const run = words.slice(k, j + 1);
          const candidate = k === 0 && run.length === 1 ? [] : run;
          const unexplained = candidate.filter((w) => !COMMON.has(w.toLowerCase()) && !own.has(w.toLowerCase()));
          const covered = candidate.some((w) => declaredWords.has(w.toLowerCase()));
          if (unexplained.length > 0 && !covered) out.add(candidate.join(" "));
          k = j + 1;
        }
      }
      return [...out];
    };
    const notes = f.reply.notes as { title: string; text: string; names: string[] }[];
    const flagged = notes.map((n) => before(`${n.title}. ${n.text}`, n.names, input));
    // Every note was refused: YouGov's (declared as YouGov), UK's, UK-focused, AER and More UK among the flags.
    for (const [i, x] of flagged.entries()) expect(x.length, notes[i].text).toBeGreaterThan(0);
    const all = flagged.flat();
    for (const w of ["YouGov's UK", "UK's", "UK-focused", "AER", "More UK"]) expect(all, w).toContain(w);
    // Today's check passes the same reply.
    for (const n of notes) expect(undeclaredNames(`${n.title}. ${n.text}`, n.names, input), n.text).toEqual([]);
  });

  it("the words the name check flagged in production (YouGov's, UK's, UK-focused, AER, More UK) are no longer names", () => {
    const all = (f.reply.notes as { text: string }[]).map((n) => n.text).join(" ");
    for (const w of ["YouGov's", "UK's", "UK-focused", "AER", "More UK"]) expect(all, w).toContain(w);
    for (const n of f.reply.notes as { title: string; text: string; names: string[] }[]) expect(undeclaredNames(`${n.title}. ${n.text}`, n.names, input), n.text).toEqual([]);
  });

  it("the market eval's grader passes the reply, and still fails a company named without being declared", async () => {
    expect(marketOutput.safeParse(f.reply).success).toBe(true);
    expect(await checkMarket(input, f.reply as MarketOutput, { sources, readPage: async () => null })).toEqual([]);
    const ok = await marketEval.grade({ brand: "quillmoor" }, f.reply as MarketOutput, { sources, brandName: input.brandName, banned: input.bannedTerms });
    expect(ok, ok.notes).toMatchObject({ pass: true });
    const bad = structuredClone(f.reply);
    bad.notes[2].text = f.stillRefused.text;
    bad.notes[2].names = [];
    const refused = await marketEval.grade({ brand: "quillmoor" }, bad as MarketOutput, { sources, brandName: input.brandName, banned: input.bannedTerms });
    expect(refused.pass).toBe(false);
    expect(refused.notes).toContain(`names "${f.stillRefused.expectName}" without declaring it`);
  });
});

/** The Imagery eval's grade for a prompt-only regression case (`sent`: the prompt's data lines, when the test has them). */
function gradeImagery(kind: "cut-off" | "face" | "aspect" | "brand-name", r: Awaited<ReturnType<typeof step<unknown, ImageryOutput>>>, sent?: string) {
  const output = r.ok
    ? { prompts: r.output.prompts, status: "completed", kept: r.output.prompts.length, simulated: false, error: null, promptsOnly: true, attempts: r.attempts, leftOut: r.leftOut }
    : { prompts: [], status: "failed", kept: 0, simulated: false, error: r.message, promptsOnly: true, attempts: r.attempts, leftOut: [] };
  const input = kind === "brand-name" ? BRAND_NAME_INPUT : REGRESSION_INPUT;
  return imageryEval.grade({ brand: kind === "brand-name" ? "fernhollow" : "quillmoor", objective: "", regression: kind }, output, { input, sent });
}

describe("F-16a imagery: the cut-off reply (27 Oct, first Make creative)", () => {
  const f = fixture("imagery/cut-off-reply.json");

  it("a reply cut off mid-JSON on both attempts fails the step and the eval's grader, as in production", async () => {
    expect(extractJson(f.reply)).toBeUndefined();
    mockBehaviour.next(said({ text: f.reply }));
    mockBehaviour.next(said({ text: f.reply }));
    const r = await step(imageryAgent, REGRESSION_INPUT, "Write the image prompts");
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error).toBeInstanceOf(AgentOutputError);
    expect(r.ok ? "" : r.message).toMatch(/The reply was not valid JSON/);
    const g = await gradeImagery("cut-off", r);
    expect(g.pass).toBe(false);
    expect(g.notes).toMatch(/the run ended failed/);
  });

  it("the regression case also fails when only the first reply was cut off, even though the repair saved the run", async () => {
    mockBehaviour.next(said({ text: f.reply }));
    mockBehaviour.next(said({ text: JSON.stringify(f.fixedReply) }));
    const r = await step(imageryAgent, REGRESSION_INPUT, "Write the image prompts");
    expect(r.ok).toBe(true);
    const g = await gradeImagery("cut-off", r);
    expect(g.pass).toBe(false);
    expect(g.notes).toMatch(/cut off/);
  });

  it("the fix: four complete prompts under 600 characters pass, and the reply limit is now well above 1,500 tokens", async () => {
    expect(AGENT_MODELS.imagery.maxOutputTokens).toBeGreaterThan(f.replyLimitBefore * 2);
    for (const p of f.fixedReply.prompts) expect(p.prompt.length).toBeLessThan(600);
    expect(imageryAgent.instructions).toContain("Keep each prompt under 600 characters");
    mockBehaviour.next(said({ text: JSON.stringify(f.fixedReply) }));
    const r = await step(imageryAgent, REGRESSION_INPUT, "Write the image prompts");
    const g = await gradeImagery("cut-off", r);
    expect(g, g.notes).toMatchObject({ pass: true });
  });
});

describe("F-16a imagery: the ruled-out face (27 Oct, second Make creative)", () => {
  const f = fixture("imagery/ruled-out-face.json");

  it("the face check before b3a6b79 refused the prompt that ruled the face out", () => {
    const BEFORE = /\b(faces?|facial|portraits?|headshots?|selfies?)\b/i;
    expect(f.reply.prompts[0].prompt).toContain(f.faceWords);
    expect(BEFORE.exec(f.reply.prompts[0].prompt)?.[0]).toBe("face");
  });

  it("now the reply passes the step first time and the eval's grader, and a face that is shown is still refused", async () => {
    expect(checkImagery(REGRESSION_INPUT, imageryOutput.parse(f.reply))).toEqual([]);
    mockBehaviour.next(said({ text: JSON.stringify(f.reply) }));
    const r = await step(imageryAgent, REGRESSION_INPUT, "Write the image prompts");
    expect(r.ok && r.attempts).toEqual([[]]);
    expect(await gradeImagery("face", r)).toMatchObject({ pass: true });

    const bad = structuredClone(f.reply);
    bad.prompts[0].prompt = f.stillRefused.prompt;
    mockBehaviour.next(said({ text: JSON.stringify(bad) }));
    mockBehaviour.next(said({ text: JSON.stringify(bad) }));
    const refused = await step(imageryAgent, REGRESSION_INPUT, "Write the image prompts");
    // The other three are kept after the repair, and the case fails over the one left out.
    expect(refused.ok && refused.leftOut[0]).toMatch(/shows a face or a close-up of a person \("face"\)/);
    const g = await gradeImagery("face", refused);
    expect(g.pass).toBe(false);
    expect(g.notes).toMatch(/left out after the repair|write exactly 4 prompts/);
  });
});

describe("F-16a imagery: the aspect wording (27 Oct, second Make creative)", () => {
  const f = fixture("imagery/aspect-wording.json");

  it("the schema before b3a6b79 refused \"1:1 square\"; now code sets the shape and the reply passes first time", async () => {
    expect(f.reply.prompts.every((p: { aspect: string }) => p.aspect === "1:1 square")).toBe(true);
    expect(z.literal("1:1").safeParse("1:1 square").success).toBe(false);
    expect(imageryOutput.parse(f.reply).prompts.every((p) => p.aspect === "1:1")).toBe(true);
    mockBehaviour.next(said({ text: JSON.stringify(f.reply) }));
    const r = await step(imageryAgent, REGRESSION_INPUT, "Write the image prompts");
    expect(r.ok && r.attempts).toEqual([[]]);
    expect(await gradeImagery("aspect", r)).toMatchObject({ pass: true });
  });

  it("the regression case fails any attempt refused over the aspect field, as the production first attempt was", () => {
    expect(regressionProblems("aspect", [["prompts.0.aspect: Invalid input: expected \"1:1\""], []], [])).toHaveLength(1);
    expect(regressionProblems("aspect", [[]], [])).toEqual([]);
  });
});

describe("F-16a monitor (P9-4 cases 5 to 7, not yet in production)", () => {
  it("the answer eval's grader fails an answer with a figure not in the result or a forecast, and passes one from the result", async () => {
    const f = fixture("monitorAnswer/figure-and-forecast.json");
    const c = ANSWER_CASES.find((x) => x.question === f.question)!;
    const result = resultFrom(c.plan, demoRows(14), DEMO_VIEWS, 14);
    const fill = (s: string) => s.replace("{top}", String(result.rows[0].adNumber)).replace("{figure}", result.rows[0].shown.cpa!);
    for (const b of f.bad as { why: string; answer: string }[]) {
      const g = await answerEval.grade(c, { answer: fill(b.answer) }, { result });
      expect(g.pass, b.why).toBe(false);
    }
    const ok = await answerEval.grade(c, { answer: fill(f.good) }, { result });
    expect(ok, ok.notes).toMatchObject({ pass: true });
  });

  it("the plan eval's grader fails a query planned for an unanswerable question, an SQL field and a made-up ad, and passes the right plans", () => {
    const f = fixture("monitorPlan/refusal-and-injection.json");
    for (const c of f.cases as { question: string; expect: string; bad: never; good: never }[]) {
      const expectation: PlanExpectation = c.expect === "unanswerable" ? { answerable: false } : { answerable: "either" };
      const input = { ...EVAL_CAMPAIGN, question: c.question };
      expect(gradePlan(input, c.bad, expectation).pass, `bad: ${c.question}`).toBe(false);
      const ok = gradePlan(input, c.good, expectation);
      expect(ok.pass, `good: ${c.question}: ${ok.notes}`).toBe(true);
    }
  });
});

describe("BUG-4 brief: loose quantities, refused on both attempts (6-7 Nov real-model run)", () => {
  const f = fixture("brief/loose-quantities.json");
  const ctx = { objective: f.objective as string, context: f.context as EvidenceItem[], kit: f.kit as KitLists, noExclamations: true };
  const input = { brand: "quillmoor" as const, objective: f.objective as string, regression: "loose-quantities" as const };
  const failures = f.failures as { report: string; case: string; where: string; quoted: string; sentence: string; instead: string }[];

  it("the check refuses every phrase the reports quote, in the sentence written around it, and passes each rewrite", () => {
    expect(failures).toHaveLength(8);
    for (const x of failures) {
      expect(x.sentence.toLowerCase(), x.report).toContain(x.quoted.trim().toLowerCase());
      expect(quantityInWords(x.sentence)?.trim().toLowerCase(), x.sentence).toBe(x.quoted.trim().toLowerCase());
      expect(quantityInWords(x.instead), x.instead).toBeNull();
    }
  });

  it("the Brief agent's prompt before the fix named none of them; now it names each one and the way round it", () => {
    // The evidence rule as it was before BUG-4 (f22e0d5).
    const BEFORE = 'never write quantities in words ("half of", "one in four").';
    for (const x of failures) expect(BEFORE.toLowerCase(), x.quoted).not.toContain(x.quoted.trim().toLowerCase());
    const now = briefAgent.instructions.toLowerCase();
    for (const x of failures) expect(now, x.quoted).toContain(`"${x.quoted.trim().toLowerCase()}"`);
    expect(briefAgent.instructions).toContain("name the group without saying how much of it there is");
  });

  it("the brief eval's grader fails the reconstructed reply and passes it rewritten; the message says how to rewrite it", async () => {
    const bad = await briefEval.grade(input, f.reply as StoredBrief, { ...ctx, attempts: [[]] });
    expect(bad.pass).toBe(false);
    expect(bad.notes).toContain('the story says "Many people"');
    expect(bad.notes).toContain("name the group without saying how much of it there is");
    const fixed = structuredClone(f.reply) as StoredBrief;
    fixed.story = fixed.story.replace(failures[1].sentence, failures[1].instead);
    expect(evidenceProblems(fixed, ctx.context, ctx.kit, { objective: ctx.objective })).toEqual([]);
    const ok = await briefEval.grade(input, fixed, { ...ctx, attempts: [[]] });
    expect(ok, ok.notes).toMatchObject({ pass: true });
  });

  it("the regression case fails a run whose first attempt was sent back for a quantity, even when the repair passed", async () => {
    const fixed = structuredClone(f.reply) as StoredBrief;
    fixed.story = fixed.story.replace(failures[1].sentence, failures[1].instead);
    const sentBack = [[`the story says "Many people"; quantities in words can't be checked, so use only figures from the context`], []];
    expect(quantityAttempts(sentBack)).toHaveLength(1);
    const g = await briefEval.grade(input, fixed, { ...ctx, attempts: sentBack });
    expect(g.pass).toBe(false);
    expect(g.notes).toMatch(/an attempt was sent back for a quantity in words/);
    // The other brief cases don't hold a repaired quantity against the run.
    expect((await briefEval.grade({ ...input, regression: undefined }, fixed, { ...ctx, attempts: sentBack })).pass).toBe(true);
  });
});

describe("BUG-11 imagery: the brand's name reached the image-prompt model (7 Nov real-model run)", () => {
  const f = fixture("imagery/brand-name.json");
  const raw = f.input as ImageryInput;
  // The workflow's clean-up as it was before BUG-11 (f22e0d5): the whole name only, swapped for "the brand".
  const before = (t: string) => t.replace(new RegExp(raw.brandName, "gi"), "the brand");
  const promptOf = (input: ImageryInput) => imageryAgent.buildPrompt(input).split("\n").slice(1).join("\n");

  it("the clean-up before the fix left the short and possessive forms in the brief, and the eval's grader fails that prompt", () => {
    const old: ImageryInput = { ...raw, brief: { title: before(raw.brief.title), story: before(raw.brief.story), audiences: raw.brief.audiences.map(before), channels: raw.brief.channels.map(before) } };
    const sentBefore = ["Brief: " + JSON.stringify(old.brief)].join("\n");
    for (const form of f.leakedForms as string[]) expect(sentBefore, form).toContain(form);
    expect(sentBefore).not.toContain(raw.brandName);
    expect(linesNamingTheBrand(sentBefore)).toEqual(["Brief"]);
  });

  it("now no line the model is sent names the brand, whoever builds the input; the possessive keeps its sense", () => {
    const sent = promptOf(raw);
    expect(sent).not.toMatch(/fernhollow/i);
    expect(linesNamingTheBrand(sent)).toEqual([]);
    expect(sent).toContain("the company's winter range");
    // forImageModel is what the workflow sends, and buildPrompt applies it again: the same prompt either way.
    expect(promptOf(forImageModel(raw))).toBe(sent);
    // Only brandName itself, kept for the checks and never put in the prompt, still holds the name.
    expect(JSON.stringify({ ...forImageModel(raw), brandName: "" })).not.toMatch(/fernhollow/i);
  });

  it("the prompt checks refuse the brand's name in every form; the check before the fix let lower case and capitals through", () => {
    const first = raw.brandName.split(" ")[0];
    const BEFORE = (t: string) => new RegExp(`\\b${first}\\b`).test(t);
    const stillRefused = f.stillRefused.prompts as string[];
    expect(BEFORE(stillRefused[0])).toBe(false);
    expect(BEFORE(stillRefused[1])).toBe(false);
    for (const prompt of stillRefused) {
      const out = { prompts: [{ idea: "A ridge walk", prompt, aspect: "1:1" as const }, ...imageryOutput.parse(f.fixedReply).prompts.slice(1)] };
      expect(checkImagery(raw, out).join("; "), prompt).toMatch(/prompt 1 names the brand/);
    }
    expect(brandNameIn("Fernhollow's winter layers", raw.brandName)).toBe("Fernhollow's");
    expect(checkImagery(raw, imageryOutput.parse(f.fixedReply))).toEqual([]);
  });

  it("the eval's regression case passes the fixed reply through the step, and fails a reply that names the brand", async () => {
    mockBehaviour.next(said({ text: JSON.stringify(f.fixedReply) }));
    const r = await step(imageryAgent, raw, "Write the image prompts");
    expect(r.ok && r.attempts).toEqual([[]]);
    expect(mockBehaviour.lastPlainPrompt).not.toMatch(/fernhollow/i);
    expect(await gradeImagery("brand-name", r, promptOf(raw))).toMatchObject({ pass: true });

    const bad = structuredClone(f.fixedReply);
    bad.prompts[0].prompt = f.stillRefused.prompts[0];
    mockBehaviour.next(said({ text: JSON.stringify(bad) }));
    mockBehaviour.next(said({ text: JSON.stringify(f.fixedReply) }));
    const named = await step(imageryAgent, raw, "Write the image prompts");
    const g = await gradeImagery("brand-name", named, promptOf(raw));
    expect(g.pass).toBe(false);
    expect(g.notes).toMatch(/a prompt named the brand, which the model was not given/);
    // And the grader fails a prompt that reached the model with the name in it.
    expect((await gradeImagery("brand-name", r, `Brief: ${JSON.stringify(raw.brief)}`)).notes).toMatch(/the brief reached the model with the brand's name in it/);
  });
});
