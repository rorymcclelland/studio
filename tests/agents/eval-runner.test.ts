// F-5 test cases 1 to 5: the evals runner.
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun } from "@/lib/agents/runs";
import { closeSql } from "@/lib/db/client";
import { exitCode, reportMarkdown, runEvalModule } from "@/lib/evals/runner";
import type { EvalEnv, EvalModule } from "@/lib/evals/types";
import { CapExceededError } from "@/lib/models/generate";
import { createMember, truncateAll } from "../helpers/db";

let env: EvalEnv;

function fakeModule(behaviour: (n: number) => "pass" | "fail" | "grader-throws" | "cap"): EvalModule<number, { n: number }, null> {
  return {
    agent: "tagline",
    cases: [0, 1, 2, 3].map((n) => ({ name: `case ${n}`, input: n })),
    async execute(e, n) {
      if (behaviour(n) === "cap") throw new CapExceededError(100, 100, 1);
      const runId = await createRun(e.member, "tagline", { brandName: `Case ${n}` }, async () => {});
      return { runId, output: { n }, context: null };
    },
    grade(n) {
      const b = behaviour(n);
      if (b === "grader-throws") throw new Error("boom");
      return { pass: b === "pass", notes: b === "pass" ? "fine" : "not fine" };
    },
  };
}

describe("F-5 evals runner", () => {
  beforeAll(async () => {
    await truncateAll();
    env = { member: await createMember(), brands: {} };
  });
  afterAll(closeSql);

  it("#1 runs the cases and writes a report with the right pass count", async () => {
    const r = await runEvalModule(fakeModule((n) => (n === 2 ? "fail" : "pass")), env, "mock", "mock · mock-model");
    expect(r.results.map((x) => x.outcome)).toEqual(["pass", "pass", "fail", "pass"]);
    const md = reportMarkdown(r, new Date("2026-10-26T09:00:00Z"));
    expect(md).toContain("**3 of 4 passed**");
    expect(md).toContain("(mock model)");
    expect(md).toContain("| case 2 | fail | not fine |");
    expect(exitCode([r])).toBe(1);
  });

  it("#2 a grader that throws marks that case as an error and the rest still run", async () => {
    const r = await runEvalModule(fakeModule((n) => (n === 1 ? "grader-throws" : "pass")), env, "mock", "m");
    expect(r.results.map((x) => x.outcome)).toEqual(["pass", "error", "pass", "pass"]);
    expect(r.results[1].notes).toContain("boom");
  });

  it("#3 reaching the cap stops the run; the remaining cases are 'not run' and the exit code is non-zero", async () => {
    const r = await runEvalModule(fakeModule((n) => (n >= 1 ? "cap" : "pass")), env, "real", "m");
    expect(r.results.map((x) => x.outcome)).toEqual(["pass", "not run", "not run", "not run"]);
    expect(r.stoppedByCap).toBe(true);
    expect(reportMarkdown(r, new Date())).toContain("Stopped early");
    expect(exitCode([r])).toBe(1);
    expect(exitCode([{ ...r, stoppedByCap: false, results: [r.results[0]] }])).toBe(0);
  });

  it("#4 an unknown agent exits with the list of agents that have eval files", () => {
    const r = spawnSync("node", ["scripts/eval.mjs", "nonesuch", "--mock"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("No eval file for: nonesuch");
    expect(r.stderr).toMatch(/Agents with evals: .*tagline/);
  });

  it("#5 a real-model run prints its estimate and runs nothing without --yes", () => {
    const r = spawnSync("node", ["scripts/eval.mjs", "tagline"], {
      encoding: "utf8",
      env: { ...process.env, MODEL_PROVIDER_OVERRIDE: "", ANTHROPIC_API_KEY: "test-placeholder-not-used" },
      timeout: 120_000,
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/Real-model evals for tagline: up to about [\d.]+p\./);
    expect(r.stdout).toContain("Nothing was run. Add --yes");
  }, 120_000);

  it("F-16a the estimate needs no key, and --real estimates every agent with each agent's share", () => {
    const env: Record<string, string | undefined> = { ...process.env, MODEL_PROVIDER_OVERRIDE: "" };
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;
    const r = spawnSync("node", ["scripts/eval.mjs", "--real"], { encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 120_000 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toContain("need a provider key");
    expect(r.stdout).toMatch(/Real-model evals for audience, brief, .*testPlan: up to about [\d.]+p\./);
    expect(r.stdout).toMatch(/Estimate for monitorPlan: 16 cases, up to about [\d.]+p\./);
    expect(r.stdout).toContain("Nothing was run. Add --yes");
  }, 120_000);

  it("F-16a --max-pence needs a number", () => {
    const r = spawnSync("node", ["scripts/eval.mjs", "tagline", "--yes", "--max-pence=lots"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--max-pence needs a number of pence");
  });

  it("#5 a real-model run without a provider key refuses to start", () => {
    const env: Record<string, string | undefined> = { ...process.env, MODEL_PROVIDER_OVERRIDE: "" };
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;
    const r = spawnSync("node", ["scripts/eval.mjs", "tagline", "--yes"], { encoding: "utf8", env: env as NodeJS.ProcessEnv });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("need a provider key");
  });
});

describe("F-13 long replies in the attempt log", () => {
  it("cuts a raw reply over 8,000 characters and says so", async () => {
    const { mockBehaviour } = await import("@/lib/models/mock");
    const { runModelStep } = await import("@/lib/agents/model-step");
    const { taglineAgent } = await import("@/lib/agents/tagline");
    const { getRun } = await import("@/lib/agents/runs");
    const runId = await createRun(env.member, "tagline", { brandName: "Long" }, async () => {});
    mockBehaviour.reset();
    mockBehaviour.next({ text: "x".repeat(9000), inputTokens: 1, outputTokens: 1 });
    mockBehaviour.next({ text: JSON.stringify({ taglines: ["One line", "Two line", "Three line"] }), inputTokens: 1, outputTokens: 1 });
    await runModelStep({ runId, workspaceId: env.member.workspaceId, userId: env.member.userId }, taglineAgent, { brandName: "Long" }, 1, "Propose");
    const step = (await getRun(env.member.userId, runId))!.steps[0];
    expect(step.attempt_log[0]).toMatchObject({ attempt: 1, truncated: true });
    expect(step.attempt_log[0].raw).toHaveLength(8000);
    expect(step.attempt_log[0].problems[0]).toContain("not valid JSON");
  });
});
