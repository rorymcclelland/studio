import { asUser } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import type { EvalEnv, EvalModule } from "./types";

export type CaseResult = {
  name: string;
  outcome: "pass" | "fail" | "error" | "not run";
  notes: string;
  costPence: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
};

export type EvalResult = { agent: string; mode: "mock" | "real"; model: string; results: CaseResult[]; stoppedByCap: boolean };

async function usage(env: EvalEnv, runId: string) {
  const [u] = await asUser(env.member.userId, (tx) => tx`
    select coalesce(sum(cost_pence), 0)::float as cost, coalesce(sum(input_tokens), 0)::int as i,
           coalesce(sum(output_tokens), 0)::int as o
    from public.usage_ledger where run_id = ${runId}`);
  return { costPence: u.cost as number, inputTokens: u.i as number, outputTokens: u.o as number };
}

/**
 * Runs every case of one agent's evals. A case that throws, or whose grader
 * throws, is an error and the rest still run; reaching the daily cap stops
 * the run and marks the remaining cases "not run" (F-5 #2, #3).
 */
export async function runEvalModule<I, O, C>(mod: EvalModule<I, O, C>, env: EvalEnv, mode: "mock" | "real", model: string): Promise<EvalResult> {
  const results: CaseResult[] = [];
  let stoppedByCap = false;
  for (const c of mod.cases) {
    if (stoppedByCap) {
      results.push({ name: c.name, outcome: "not run", notes: "Daily AI cap reached.", costPence: 0, inputTokens: 0, outputTokens: 0, ms: 0 });
      continue;
    }
    const started = Date.now();
    let runId: string | null = null;
    try {
      const done = await mod.execute(env, c.input);
      runId = done.runId;
      let grade;
      try {
        grade = mod.grade(c.input, done.output, done.context);
      } catch (err) {
        grade = { pass: false, notes: `The grader failed: ${err instanceof Error ? err.message : String(err)}`, error: true };
      }
      results.push({
        name: c.name,
        outcome: "error" in grade ? "error" : grade.pass ? "pass" : "fail",
        notes: grade.notes,
        ...(await usage(env, runId)),
        ms: Date.now() - started,
      });
    } catch (err) {
      const cap = err instanceof CapExceededError || (err instanceof Error && /Daily AI cap reached/.test(err.message));
      if (cap) stoppedByCap = true;
      results.push({
        name: c.name,
        outcome: cap ? "not run" : "error",
        notes: err instanceof Error ? err.message : String(err),
        ...(runId ? await usage(env, runId) : { costPence: 0, inputTokens: 0, outputTokens: 0 }),
        ms: Date.now() - started,
      });
    }
  }
  return { agent: mod.agent, mode, model, results, stoppedByCap };
}

const pence = (p: number) => (p === 0 ? "0p" : p < 0.01 ? "under 0.01p" : `${p.toFixed(2)}p`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 300);

export function reportMarkdown(r: EvalResult, when: Date): string {
  const passed = r.results.filter((x) => x.outcome === "pass").length;
  const cost = r.results.reduce((s, x) => s + x.costPence, 0);
  const lines = [
    `# Evals: ${r.agent} (${r.mode === "mock" ? "mock model" : r.model})`,
    "",
    `Run ${when.toISOString().slice(0, 16).replace("T", " ")} UTC against the demo brands (simulated data). ` +
      `**${passed} of ${r.results.length} passed**; cost ${pence(cost)}.` +
      (r.stoppedByCap ? " Stopped early: the daily AI cap was reached." : ""),
    "",
    "| Case | Result | Notes | Tokens in / out | Cost | Time |",
    "| --- | --- | --- | --- | --- | --- |",
    ...r.results.map(
      (x) => `| ${cell(x.name)} | ${x.outcome} | ${cell(x.notes)} | ${x.inputTokens} / ${x.outputTokens} | ${pence(x.costPence)} | ${(x.ms / 1000).toFixed(1)} s |`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function exitCode(results: EvalResult[]): number {
  return results.some((r) => r.stoppedByCap || r.results.some((x) => x.outcome !== "pass")) ? 1 : 0;
}
