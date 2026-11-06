// F-16a #1: the real-model run's own check, used by scripts/eval.mjs after a
// confirmed real run (and tested in tests/lib/eval-check.test.ts). A run
// passes this check when every agent it ran has a report (model, cases, pass
// rate and cost) and its total real cost, from the eval database's usage
// ledger, is at most the limit (100p in .github/workflows/evals.yml).

/** The parts of a report this check needs (src/lib/evals/runner.ts, reportMarkdown), or null if it isn't one. */
export function readReport(text) {
  const title = /^# Evals: (\w+) \((.+)\)$/m.exec(text);
  const tally = /\*\*(\d+) of (\d+) passed\*\*; cost (0p|under 0\.01p|[\d.]+p)\./.exec(text);
  if (!title || !tally) return null;
  const cost = tally[3] === "0p" ? 0 : tally[3] === "under 0.01p" ? 0.01 : Number(tally[3].slice(0, -1));
  return { agent: title[1], model: title[2], passed: Number(tally[1]), cases: Number(tally[2]), costPence: cost };
}

/**
 * The problems with a real run: an agent with no report, a report from the
 * mock model or with no cases, or a total over the limit.
 * @param {{ agents: string[], reports: { file: string, text: string }[], costPence: number, maxPence: number }} run
 */
export function realRunProblems({ agents, reports, costPence, maxPence }) {
  const problems = [];
  const read = reports.map((r) => ({ file: r.file, report: readReport(r.text) }));
  for (const r of read) if (!r.report) problems.push(`${r.file} is not an eval report`);
  for (const agent of agents) {
    const mine = read.filter((r) => r.report?.agent === agent).map((r) => r.report);
    if (mine.length === 0) problems.push(`no report for ${agent}`);
    for (const r of mine) {
      if (r.model === "mock model" || /\bmock\b/.test(r.model)) problems.push(`${agent}'s report is from the mock model`);
      if (r.cases === 0) problems.push(`${agent}'s report has no cases`);
    }
  }
  if (!Number.isFinite(costPence)) problems.push("the run's real cost could not be read from the usage ledger");
  else if (costPence > maxPence) problems.push(`the run cost ${costPence.toFixed(2)}p, over the ${maxPence}p limit`);
  return problems;
}

/** A Markdown summary of the run for the job summary: one row per report, and the total. */
export function summaryMarkdown({ reports, costPence, maxPence, problems }) {
  const rows = reports.map((r) => readReport(r.text)).filter(Boolean);
  const lines = [
    "### Real-model eval run",
    "",
    "| Agent | Model | Passed | Cost |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.agent} | ${r.model} | ${r.passed} of ${r.cases} | ${r.costPence.toFixed(2)}p |`),
    "",
    `Total real cost from the usage ledger: **${Number.isFinite(costPence) ? costPence.toFixed(2) : "unknown"}p** (limit ${maxPence}p).`,
    "",
    ...(problems.length ? ["Problems:", "", ...problems.map((p) => `- ${p}`), ""] : ["Every agent has a report, and the total is within the limit.", ""]),
  ];
  return lines.join("\n");
}
