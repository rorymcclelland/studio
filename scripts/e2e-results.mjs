#!/usr/bin/env node
// Decision 0021: gathers one CI run's test results for the demo page, in a
// folder that CI pushes as the whole of the branch e2e-results/ci/<branch>
// (a cloud session can't download Actions artefacts, but it can fetch a branch).
//
//   node scripts/e2e-results.mjs --report playwright-report/results.json \
//     [--vitest vitest-results.json] --out <folder>
//
// The folder gets:
//   report.json   Playwright's JSON report, with the recordings' paths made
//                 relative (videos/...) and every other attachment's path dropped
//   videos/       the last attempt's recording of each test annotated with a case
//   vitest.json   the unit, database and agent tests' results (file, titles,
//                 status), when the first job's results were passed on
//   run.json      the run id and link, commit, branch, date, and the first job's result
//
// Run details come from GitHub's variables (GITHUB_RUN_ID, GITHUB_SHA, ...),
// SOURCE_BRANCH and CHECKS_RESULT; off CI they say "local".
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** Every test in a Playwright JSON report, with the spec it is in. */
export function* allTests(report) {
  const walk = function* (suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) yield { spec, test };
    for (const s of suite.suites ?? []) yield* walk(s);
  };
  for (const s of report.suites ?? []) yield* walk(s);
}

/** The case ids a test is annotated with ({ type: "case", description: "C7-1.1" }), from its details or its results. */
export function casesOf(test) {
  const notes = [...(test.annotations ?? []), ...(test.results ?? []).flatMap((r) => r.annotations ?? [])];
  return [...new Set(notes.filter((a) => a.type === "case" && a.description).map((a) => a.description))];
}

/** A short, safe file name for a test's recording. */
export function videoName(spec, n) {
  const base = (spec.file ?? "test").replace(/^.*\//, "").replace(/\.spec\.[cm]?[jt]s$/, "").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `${base}-${n}.webm`;
}

const fileSize = (path) => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/**
 * Rewrites a report in place for publishing: the last attempt's recording of
 * each case-annotated test is listed for copying (and its path made relative);
 * every other attachment loses its path (it isn't published). A test has a
 * recording for every page it opened, and the contrast checks (axe) open a
 * blank page each time, so the recording kept is the largest: the test's own
 * page. Others (a tab the test opened) are dropped.
 */
export function prepare(report, sizeOf = fileSize) {
  const copies = [];
  let n = 0;
  for (const { spec, test } of allTests(report)) {
    const results = test.results ?? [];
    const last = casesOf(test).length > 0 ? results.at(-1) : null;
    const videos = (last?.attachments ?? []).filter((a) => a.name === "video" && a.path);
    const keep = videos.reduce((best, a) => (best && sizeOf(best.path) >= sizeOf(a.path) ? best : a), null);
    for (const r of results) {
      for (const a of r.attachments ?? []) {
        if (a === keep) {
          const to = `videos/${videoName(spec, ++n)}`;
          copies.push({ from: a.path, to });
          a.path = to;
        } else {
          delete a.path;
          delete a.body;
        }
      }
    }
  }
  return copies;
}

/** The parts of Vitest's JSON report the demo page reads: each file's tests, their describe titles and status. */
export function slimVitest(vitest, root) {
  return {
    success: vitest.success ?? null,
    files: (vitest.testResults ?? []).map((f) => ({
      file: relative(root, f.name).replace(/\\/g, "/"),
      tests: (f.assertionResults ?? []).map((t) => ({ title: t.title, ancestors: t.ancestorTitles ?? [], status: t.status })),
    })),
  };
}

export function runInfo(env, now = new Date()) {
  const ci = Boolean(env.GITHUB_RUN_ID);
  return {
    source: ci ? "ci" : "local",
    runId: env.GITHUB_RUN_ID ?? "local",
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    runUrl: ci ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    repository: env.GITHUB_REPOSITORY ?? null,
    commit: env.GITHUB_SHA ?? env.SOURCE_COMMIT ?? null,
    branch: env.SOURCE_BRANCH ?? env.GITHUB_REF_NAME ?? null,
    date: now.toISOString(),
    // The first job (typecheck, lint, Vitest, build); the browser tests run only after it passes.
    checksJob: env.CHECKS_RESULT ?? null,
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const reportPath = arg("report") ?? "playwright-report/results.json";
  const out = arg("out");
  if (!out) {
    console.error("Usage: node scripts/e2e-results.mjs --report <playwright json> [--vitest <vitest json>] --out <folder>");
    process.exit(1);
  }
  mkdirSync(join(out, "videos"), { recursive: true });
  const run = runInfo(process.env);
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const copies = prepare(report);
    for (const c of copies) {
      if (existsSync(c.from)) copyFileSync(c.from, join(out, c.to));
      else console.warn(`[e2e-results] no recording at ${c.from}`);
    }
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
    console.log(`[e2e-results] ${copies.length} recordings`);
  } else {
    // The browser tests didn't get as far as a report (the app didn't start): say so rather than push nothing.
    run.note = "No Playwright report: the browser tests did not run to the end.";
    console.warn(`[e2e-results] ${reportPath} is missing`);
  }
  const vitestPath = arg("vitest");
  if (vitestPath && existsSync(vitestPath)) {
    writeFileSync(join(out, "vitest.json"), JSON.stringify(slimVitest(JSON.parse(readFileSync(vitestPath, "utf8")), process.cwd())));
  }
  writeFileSync(join(out, "run.json"), JSON.stringify(run, null, 2) + "\n");
  writeFileSync(
    join(out, "README.md"),
    `# Browser-test results\n\nThe latest CI run's results for \`${run.branch ?? "this branch"}\`, for the demo page (decision 0021). Each push replaces this branch with one commit. Build the page with:\n\n    node scripts/demo-page.mjs --results <this folder> --sprint <N> --out <folder>\n`,
  );
}
