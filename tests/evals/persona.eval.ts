// Evals for the Persona agent (S4-2). Graded in code only.
import { checkPersonas, type PersonaOutput } from "@/lib/agents/persona";
import { createRun, getRun } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import { createCampaign, getCampaign } from "@/lib/brief/repo";
import type { EvalEnv, EvalModule } from "@/lib/evals/types";
import { getReviews, startPersonaReview } from "@/lib/strategy/reviews";
import { REAL_BRANDS } from "./real-brands";

type In = { brand: "fernhollow" | "quillmoor"; objective: string };
const inline = { run: async <T,>(_i: string, fn: () => Promise<T>) => fn(), waitForEvent: async () => null };
const go = async (env: EvalEnv, runId: string) => {
  await executeRun((await getRun(env.member.userId, runId))!.agent, { runId, workspaceId: env.member.workspaceId, userId: env.member.userId }, inline);
  return (await getRun(env.member.userId, runId))!;
};
const audiences = new Set<string>();

const mod: EvalModule<In, PersonaOutput, { input: Parameters<typeof checkPersonas>[0] }> = {
  agent: "persona",
  cases: [
    { name: "Fernhollow win-back brief", input: { brand: "fernhollow", objective: "Launch the winter range to lapsed customers" } },
    { name: "Fernhollow product launch", input: { brand: "fernhollow", objective: "Launch the Bothy insulated jacket for the first cold weekends of autumn" } },
    { name: "Quillmoor win-back brief", input: { brand: "quillmoor", objective: "Bring lapsed customers back to the Plus plan in January" } },
    { name: "Quillmoor sign-ups", input: { brand: "quillmoor", objective: "Grow Plus sign-ups among customers aged 25 to 34" } },
  ],
  async execute(env, input) {
    const brandId = env.brands[input.brand];
    if (!audiences.has(brandId)) {
      await go(env, await createRun(env.member, "audience", { brandId }, async () => {}, { brandId }));
      audiences.add(brandId);
    }
    const id = await createCampaign(env.member, brandId, input.objective, async () => {});
    const brief = await go(env, (await getCampaign(env.member.userId, id))!.run!.id);
    if (brief.status !== "completed") throw new Error(`Brief: ${brief.error}`);
    const r = await go(env, await startPersonaReview(env.member, id, async () => {}));
    if (r.status !== "completed") throw new Error(r.error ?? r.status);
    const step = r.steps.find((s) => s.seq === 2)!;
    const prompt = (step.input as { prompt: string }).prompt;
    const read = (label: string) => JSON.parse(prompt.split("\n").find((l) => l.startsWith(`${label}: `))!.slice(label.length + 2));
    void (await getReviews(env.member.userId, id));
    return { runId: r.id, output: step.output as PersonaOutput, context: { input: { brandName: "", voice: "", brief: read("Brief"), segments: read("Segments") } } };
  },
  grade(_input, output, ctx) {
    const problems = checkPersonas(ctx.input, output);
    const totals = output.personas.map((p) => Object.values(p.scores).join(","));
    if (output.personas.length > 1 && new Set(totals).size === 1) problems.push("every persona gave the same scores");
    for (const p of output.personas) if (REAL_BRANDS.test(`${p.about} ${p.wants} ${p.objection.text} ${p.winOver.text}`)) problems.push(`${p.name} names a real brand`);
    return { pass: problems.length === 0, notes: problems.join("; ") || `${output.personas.length} personas, quotes found, scores vary.` };
  },
};

export default mod;
