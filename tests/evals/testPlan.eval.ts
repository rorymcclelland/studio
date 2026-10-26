// Evals for the test plan (S4-4). Graded in code only.
import { checkTestPlan, type TestPlanOutput } from "@/lib/agents/testplan";
import { getRun } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import { createCampaign, getCampaign } from "@/lib/brief/repo";
import type { EvalEnv, EvalModule } from "@/lib/evals/types";
import { startTestPlan } from "@/lib/strategy/reviews";

type In = { brand: "fernhollow" | "quillmoor"; objective: string };
const inline = { run: async <T,>(_i: string, fn: () => Promise<T>) => fn(), waitForEvent: async () => null };
const go = async (env: EvalEnv, runId: string) => {
  await executeRun((await getRun(env.member.userId, runId))!.agent, { runId, workspaceId: env.member.workspaceId, userId: env.member.userId }, inline);
  return (await getRun(env.member.userId, runId))!;
};

const mod: EvalModule<In, TestPlanOutput, { input: Parameters<typeof checkTestPlan>[0] }> = {
  agent: "testPlan",
  cases: [
    { name: "Fernhollow win-back", input: { brand: "fernhollow", objective: "Launch the winter range to lapsed customers" } },
    { name: "Quillmoor win-back", input: { brand: "quillmoor", objective: "Bring lapsed customers back to the Plus plan in January" } },
    { name: "Quillmoor sign-ups", input: { brand: "quillmoor", objective: "Grow Plus sign-ups among customers aged 25 to 34" } },
  ],
  async execute(env, input) {
    const id = await createCampaign(env.member, env.brands[input.brand], input.objective, async () => {});
    const brief = await go(env, (await getCampaign(env.member.userId, id))!.run!.id);
    if (brief.status !== "completed") throw new Error(`Brief: ${brief.error}`);
    const r = await go(env, await startTestPlan(env.member, id, async () => {}));
    if (r.status !== "completed") throw new Error(r.error ?? r.status);
    const step = r.steps.find((s) => s.seq === 2)!;
    const prompt = (step.input as { prompt: string }).prompt;
    const read = (label: string) => JSON.parse(prompt.split("\n").find((l) => l.startsWith(`${label}: `))!.slice(label.length + 2));
    return {
      runId: r.id,
      output: step.output as TestPlanOutput,
      context: { input: { brandName: "", title: "", summary: "", kpi: read("KPI"), insights: read("Insights"), audiences: read("Audiences"), channels: read("Channels") } },
    };
  },
  grade(_input, output, ctx) {
    const problems = checkTestPlan(ctx.input, output);
    if (new Set(output.hypotheses.map((h) => h.insightRef)).size < Math.min(2, ctx.input.insights.length)) problems.push("every hypothesis tests the same insight");
    return { pass: problems.length === 0, notes: problems.join("; ") || `${output.hypotheses.length} hypotheses, each linked to an insight and audience, no figures.` };
  },
};

export default mod;
