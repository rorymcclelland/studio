// F-16a #1: the real-model run's own check (scripts/eval-check.mjs, run by
// scripts/eval.mjs after a run with --yes): every agent has a report with its
// model, cases, pass rate and cost, and the total is at most the limit.
import { describe, expect, it } from "vitest";
import { readReport, realRunProblems, summaryMarkdown } from "../../scripts/eval-check.mjs";
import { reportMarkdown, type EvalResult } from "@/lib/evals/runner";

const when = new Date("2026-11-06T10:00:00Z");
const result = (agent: string, mode: "real" | "mock", costs: number[], fail = 0): EvalResult => ({
  agent,
  mode,
  model: "anthropic · claude-haiku-5-5",
  stoppedByCap: false,
  results: costs.map((c, i) => ({ name: `case ${i}`, outcome: i < fail ? "fail" : "pass", notes: "n", costPence: c, inputTokens: 1, outputTokens: 1, ms: 1 })),
});
const report = (r: EvalResult) => ({ file: `evals/reports/${r.agent}-2026-11-06.md`, text: reportMarkdown(r, when) });

describe("F-16a #1 the real-model run's own check", () => {
  it("reads the model, cases, pass rate and cost from a report the runner writes", () => {
    expect(readReport(report(result("brief", "real", [3.2, 4.1], 1)).text)).toEqual({
      agent: "brief",
      model: "anthropic · claude-haiku-5-5",
      passed: 1,
      cases: 2,
      costPence: 7.3,
    });
    expect(readReport(report(result("tagline", "real", [0])).text)?.costPence).toBe(0);
    expect(readReport("# Something else")).toBeNull();
  });

  it("passes a run with a real report for every agent and a total within the limit, failed cases or not", () => {
    const reports = [report(result("brief", "real", [3, 4], 1)), report(result("monitorPlan", "real", [0.1, 0.1]))];
    expect(realRunProblems({ agents: ["brief", "monitorPlan"], reports, costPence: 7.2, maxPence: 100 })).toEqual([]);
    expect(realRunProblems({ agents: ["brief"], reports: reports.slice(0, 1), costPence: 100, maxPence: 100 })).toEqual([]);
  });

  it("fails a total over the limit, a missing or unreadable cost, a missing report, a mock report and an empty one", () => {
    const reports = [report(result("brief", "real", [3]))];
    expect(realRunProblems({ agents: ["brief"], reports, costPence: 100.01, maxPence: 100 })).toEqual(["the run cost 100.01p, over the 100p limit"]);
    expect(realRunProblems({ agents: ["brief"], reports, costPence: Number.NaN, maxPence: 100 })).toEqual(["the run's real cost could not be read from the usage ledger"]);
    expect(realRunProblems({ agents: ["brief", "imagery"], reports, costPence: 3, maxPence: 100 })).toEqual(["no report for imagery"]);
    expect(realRunProblems({ agents: ["brief"], reports: [report(result("brief", "mock", [0]))], costPence: 0, maxPence: 100 })).toEqual(["brief's report is from the mock model"]);
    expect(realRunProblems({ agents: ["brief"], reports: [report(result("brief", "real", []))], costPence: 0, maxPence: 100 })).toEqual(["brief's report has no cases"]);
    expect(realRunProblems({ agents: [], reports: [{ file: "evals/reports/x.md", text: "notes" }], costPence: 0, maxPence: 100 })).toEqual(["evals/reports/x.md is not an eval report"]);
  });

  it("summarises the run for the job summary: each agent's model, pass rate and cost, and the total against the limit", () => {
    const reports = [report(result("brief", "real", [3, 4], 1))];
    const md = summaryMarkdown({ reports, costPence: 7, maxPence: 100, problems: [] });
    expect(md).toContain("| brief | anthropic · claude-haiku-5-5 | 1 of 2 | 7.00p |");
    expect(md).toContain("Total real cost from the usage ledger: **7.00p** (limit 100p).");
    expect(summaryMarkdown({ reports, costPence: 120, maxPence: 100, problems: ["the run cost 120.00p, over the 100p limit"] })).toContain("- the run cost 120.00p, over the 100p limit");
  });
});
