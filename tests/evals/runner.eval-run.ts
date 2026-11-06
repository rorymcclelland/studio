// The eval driver: loaded only by vitest.eval.config.ts via `npm run eval`.
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_MODELS, type AgentKey } from "@/config/agents";
import { PRICES } from "@/config/prices";
import { listBrands } from "@/lib/brands/repo";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { exitCode, reportMarkdown, runEvalModule, type EvalResult } from "@/lib/evals/runner";
import type { EvalEnv, EvalModule } from "@/lib/evals/types";
import { createMember } from "../helpers/db";

const wanted = (process.env.EVAL_AGENTS ?? "").split(",").filter((a) => /^[a-z][a-zA-Z0-9]*$/.test(a));
const mode = process.env.EVAL_MODE === "real" ? "real" : "mock";
// Imported by name (scripts/eval.mjs has checked the files exist), so a new eval file is always picked up.
const loaded: EvalModule[] = await Promise.all(
  wanted.map(async (a) => ((await import(/* @vite-ignore */ `./${a}.eval.ts`)) as { default: EvalModule }).default),
);
// --part=k/n (checked by scripts/eval.mjs): every nth case, starting at the kth, so an
// agent that costs more than one run's cap can be split across runs (F-16a).
const partMatch = /^(\d+)\/(\d+)$/.exec(process.env.EVAL_PART ?? "");
const part = partMatch ? { k: Number(partMatch[1]), n: Number(partMatch[2]) } : null;
const modules: EvalModule[] = part ? loaded.map((m) => ({ ...m, cases: m.cases.filter((_, i) => i % part.n === part.k - 1) })) : loaded;
const partLabel = part ? ` (part ${part.k} of ${part.n})` : "";

/** A generous estimate: 8,000 tokens in and the full output allowance, twice (one repair) per case, plus any pictures. */
function estimatePence(mod: EvalModule): number {
  const cfg = AGENT_MODELS[mod.agent as AgentKey];
  const price = cfg && PRICES[`${cfg.provider}:${cfg.model}`];
  const extra = mod.cases.reduce((s, c) => s + (c.extraPence ?? mod.extraPencePerCase ?? 0), 0);
  if (!price) return extra;
  const usd = (2 * (8000 * price.inputPerMTok + cfg.maxOutputTokens * price.outputPerMTok)) / 1e6;
  return usd * 100 * Number(process.env.USD_TO_GBP ?? 0.79) * mod.cases.length + extra;
}

describe("agent evals", () => {
  let env: EvalEnv;
  const results: EvalResult[] = [];

  beforeAll(async () => {
    const member = await createMember();
    // Today's earlier eval spend (scripts/eval.mjs carries it over), so the daily cap covers every eval run today.
    const carried = Number(process.env.EVAL_CARRIED_PENCE ?? 0);
    if (carried > 0) {
      await asUser(member.userId, (tx) => tx`
        insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
        values (${member.workspaceId}, 'eval-carried', 'carried', 'earlier eval runs today', 0, 0, ${carried})`);
    }
    await loadDemoBrands(member, { refDate: new Date("2026-10-01T09:00:00Z") });
    const brands = Object.fromEntries((await listBrands(member.userId)).map((b) => [b.slug, b.id]));
    env = { member, brands };
  });
  afterAll(closeSql);

  it("runs the requested agents' cases and writes a report", async () => {
    expect(modules.map((m) => m.agent), "each eval file names its own agent").toEqual(wanted);
    expect(modules.length, "at least one agent to evaluate").toBeGreaterThan(0);
    if (mode === "real") {
      const total = modules.reduce((s, m) => s + estimatePence(m), 0);
      console.log(`\nReal-model evals for ${modules.map((m) => m.agent).join(", ")}: up to about ${total.toFixed(1)}p.`);
      if (part) console.log(`  Only part ${part.k} of ${part.n} of each agent's cases.`);
      // F-16a: each agent's share, so a run can be split to stay inside the cap.
      for (const m of modules) console.log(`  Estimate for ${m.agent}: ${m.cases.length} cases, up to about ${estimatePence(m).toFixed(1)}p.`);
      if (!process.env.EVAL_CONFIRMED) {
        console.log("Nothing was run. Add --yes to run them.\n");
        expect.fail("Real-model evals need --yes.");
      }
    }
    for (const mod of modules) {
      const model = AGENT_MODELS[mod.agent as AgentKey];
      const r = await runEvalModule(mod, env, mode, model ? `${model.provider} · ${model.model}` : "unknown");
      results.push(r);
      const when = new Date();
      const dir = mode === "mock" ? "evals/reports/mock" : "evals/reports";
      mkdirSync(dir, { recursive: true });
      const path = `${dir}/${mod.agent}-${when.toISOString().slice(0, 10)}${part ? `-part-${part.k}-of-${part.n}` : ""}.md`;
      const report = reportMarkdown(r, when);
      // A part's report says so, so it is never read as the agent's whole set of cases.
      writeFileSync(path, part ? report.replace("\n\n", `\n\nPart ${part.k} of ${part.n} of this agent's cases (every ${part.n === 2 ? "second" : `${part.n}th`} case, from case ${part.k}).\n\n`) : report);
      const passed = r.results.filter((x) => x.outcome === "pass").length;
      console.log(`\n${mod.agent}${partLabel}: ${passed} of ${r.results.length} passed (report: ${path})`);
      for (const x of r.results.filter((y) => y.outcome !== "pass")) console.log(`  ${x.outcome}: ${x.name}: ${x.notes}`);
    }
    expect(exitCode(results), "every case should pass").toBe(0);
  });
});
