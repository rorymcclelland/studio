// Evals for the Market agent (S4-3). Graded in code only; with a real model the links are also checked by hand.
import { AGENT_MODELS } from "@/config/agents";
import { checkMarket, MAX_SEARCHES, type MarketOutput } from "@/lib/agents/market";
import { getRun } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import type { EvalModule } from "@/lib/evals/types";
import { costPence, searchCostPence } from "@/lib/models/cost";
import type { WebSource } from "@/lib/models/generate";
import { startMarketRun } from "@/lib/strategy/market";

type In = { brand: "fernhollow" | "quillmoor" };

const mod: EvalModule<In, MarketOutput, { sources: WebSource[]; brandName: string; banned: string[] }> = {
  agent: "market",
  // F-16a: the searches, as generate() estimates them before the call (30,000 tokens of pages a
  // search, and the search price); the runner's own estimate counts 8,000 tokens in, which a
  // market run passes many times over (production, 26 Oct: 14p to 30p a run).
  extraPencePerCase:
    costPence(AGENT_MODELS.market.provider, AGENT_MODELS.market.model, MAX_SEARCHES * 30000, 0) + searchCostPence(AGENT_MODELS.market.provider, MAX_SEARCHES),
  cases: [
    { name: "Fernhollow (outdoor apparel, UK)", input: { brand: "fernhollow" } },
    // F-16a: the long note and the possessive names (listed under the brief in Sprint 9's refinement) were this
    // agent's, on its three Quillmoor runs on 26 Oct, so this case is their real-model regression case: its run
    // must finish (a note past the limit is repaired from the pages found) and every note pass the name check.
    // A second identical case would cost as much again for nothing new. Fixtures and sources:
    // tests/evals/fixtures/market (checked in tests/evals/regression.test.ts).
    { name: "Quillmoor (personal finance app, UK), as the 26 Oct production runs", input: { brand: "quillmoor" } },
  ],
  async execute(env, input) {
    const runId = await startMarketRun(env.member, env.brands[input.brand], async () => {}, { confirm: true });
    await executeRun("market", { runId, workspaceId: env.member.workspaceId, userId: env.member.userId }, { run: async (_i, fn) => fn(), waitForEvent: async () => null });
    const run = (await getRun(env.member.userId, runId))!;
    if (run.status !== "completed") throw new Error(run.error ?? run.status);
    const step = run.steps.find((s) => s.seq === 2)!;
    const prompt = (step.input as { prompt: string }).prompt;
    const read = (label: string) => JSON.parse(prompt.split("\n").find((l) => l.startsWith(`${label}: `))!.slice(label.length + 2));
    const urls = (run.output as { sources: string[] }).sources;
    return { runId, output: step.output as MarketOutput, context: { sources: urls.map((url) => ({ url, title: null, citedText: [] })), brandName: read("Brand (fictional)"), banned: read("Banned terms") } };
  },
  async grade(_input, output, ctx) {
    // Source membership and declared names (figures were checked against the cited pages in the run itself).
    const problems = (await checkMarket({ brandName: ctx.brandName, category: "", description: "", products: [], bannedTerms: ctx.banned, places: [], month: "" }, output, { sources: ctx.sources, readPage: async () => null }))
      .filter((p) => !/says .*(can't be checked|cited pages do not contain)/.test(p));
    const kinds = new Set(output.notes.map((n) => n.kind));
    if (kinds.size < 2) problems.push("every note is the same kind");
    return { pass: problems.length === 0, notes: problems.join("; ") || `${output.notes.length} notes of ${kinds.size} kinds, every source returned by the search.` };
  },
};

export default mod;
