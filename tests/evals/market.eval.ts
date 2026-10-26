// Evals for the Market agent (S4-3). Graded in code only; with a real model the links are also checked by hand.
import { checkMarket, type MarketOutput } from "@/lib/agents/market";
import { getRun } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import type { EvalModule } from "@/lib/evals/types";
import type { WebSource } from "@/lib/models/generate";
import { startMarketRun } from "@/lib/strategy/market";

type In = { brand: "fernhollow" | "quillmoor" };

const mod: EvalModule<In, MarketOutput, { sources: WebSource[]; brandName: string; banned: string[] }> = {
  agent: "market",
  cases: [
    { name: "Fernhollow (outdoor apparel, UK)", input: { brand: "fernhollow" } },
    { name: "Quillmoor (personal finance app, UK)", input: { brand: "quillmoor" } },
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
  grade(_input, output, ctx) {
    // Source membership and declared names (figures were checked against the cited passages in the run itself).
    const problems = checkMarket({ brandName: ctx.brandName, category: "", description: "", products: [], bannedTerms: ctx.banned, month: "" }, output, { sources: ctx.sources })
      .filter((p) => !/cited passages contain/.test(p));
    const kinds = new Set(output.notes.map((n) => n.kind));
    if (kinds.size < 2) problems.push("every note is the same kind");
    return { pass: problems.length === 0, notes: problems.join("; ") || `${output.notes.length} notes of ${kinds.size} kinds, every source returned by the search.` };
  },
};

export default mod;
