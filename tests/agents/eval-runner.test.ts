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
      env: { ...process.env, MODEL_PROVIDER_OVERRIDE: "" },
      timeout: 120_000,
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/Real-model evals for tagline: up to about [\d.]+p\./);
    expect(r.stdout).toContain("Nothing was run. Add --yes");
  }, 120_000);
});
