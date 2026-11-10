#!/usr/bin/env node
// Decision 0021: the sprint demo page Rory signs a sprint off from, built from
// one CI run's results (a checkout of e2e-results/ci/<branch>, written by
// scripts/e2e-results.mjs) and the case list (tests/e2e/cases.ts).
//
//   node scripts/demo-page.mjs --results <folder> --sprint 7 --out <folder> [--md docs/testing/sprint-7-demo.md]
//
// Writes <out>/index.html (one self-contained page) with the recordings beside
// it in <out>/videos, so the folder can be published as it is, and the same
// case table as Markdown (no videos).
//
// Honesty rules: a case shows Passed or Failed only from a browser test that
// ran in this run and carries the case's annotation; a case whose browser test
// didn't run says Not run. A CI check shows a result only if the run recorded
// one (vitest.json); otherwise it is named and says so. A hand check is never
// shown as passed, and a case Rory withdrew says Withdrawn with the reason. A
// browser test's measurements (annotations of type "measure") are shown with
// it. The recordings use the mock model: pictures and words in them are
// simulated, and the page says so.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { allTests, casesOf } from "./e2e-results.mjs";

const FAILED = new Set(["unexpected", "failed", "timedOut", "interrupted"]);

/** Each test in a Playwright report as the demo page needs it. */
export function outcomes(report) {
  if (!report) return [];
  const out = [];
  for (const { spec, test } of allTests(report)) {
    const last = (test.results ?? []).at(-1);
    const status =
      test.status === "expected" ? "passed" : test.status === "flaky" ? "passed-on-retry" : test.status === "skipped" ? "skipped" : "failed";
    const video = last?.attachments?.find((a) => a.name === "video" && a.path)?.path ?? null;
    const failure = (test.results ?? []).filter((r) => FAILED.has(r.status)).at(-1);
    // A measurement the test recorded ({ type: "measure", description }), from its last attempt.
    const measures = [...new Set([...(test.annotations ?? []), ...(last?.annotations ?? [])].filter((a) => a.type === "measure" && a.description).map((a) => a.description))];
    out.push({
      file: (spec.file ?? "").replace(/^.*\//, ""),
      title: spec.title,
      project: test.projectName ?? null,
      cases: casesOf(test),
      status,
      durationMs: last?.duration ?? null,
      video,
      steps: (last?.steps ?? []).map((s) => ({ title: s.title, failed: Boolean(s.error) })),
      measures,
      error: failure ? stripAnsi(failure.error?.message ?? failure.errors?.[0]?.message ?? "").split("\n").slice(0, 6).join("\n") : null,
    });
  }
  return out;
}

const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, "");

/** The result of one CI check, from the run's Vitest results; null when the run recorded none. */
export function ciResult(check, vitest) {
  if (!vitest || !("file" in check)) return null;
  const file = vitest.files.find((f) => f.file === check.file);
  if (!file) return null;
  const tests = file.tests.filter((t) => t.title === check.test || t.ancestors.includes(check.test));
  if (tests.length === 0) return null;
  if (tests.some((t) => t.status === "failed")) return "failed";
  if (tests.every((t) => t.status === "passed")) return "passed";
  return "skipped";
}

/**
 * A case's status in this run:
 * - passed / failed / not-run, from its browser tests (every one must have run and passed);
 * - ci-passed / ci-failed / ci, from its CI checks when it has no browser test;
 * - hand, when it has only hand checks;
 * - withdrawn, when Rory withdrew it by his decision (only withdrawn checks).
 */
export function caseStatus(c, tests, vitest) {
  const browser = c.checks.filter((x) => x.kind === "browser");
  const ci = c.checks.filter((x) => x.kind === "ci");
  const hand = c.checks.filter((x) => x.kind === "hand");
  const withdrawn = c.checks.filter((x) => x.kind === "withdrawn");
  const found = browser.map((x) => tests.find((t) => t.file === x.spec && t.title === x.title && t.cases.includes(c.id)) ?? null);
  const ciResults = ci.map((x) => ciResult(x, vitest));
  let status;
  if (browser.length > 0) {
    if (found.some((t) => t?.status === "failed")) status = "failed";
    else if (found.every((t) => t && t.status.startsWith("passed"))) status = found.some((t) => t.status === "passed-on-retry") ? "passed-on-retry" : "passed";
    else status = "not-run";
  } else if (ci.length > 0) {
    if (ciResults.some((r) => r === "failed")) status = "ci-failed";
    else if (ciResults.every((r) => r === "passed")) status = "ci-passed";
    else status = "ci";
  } else if (hand.length > 0) status = "hand";
  else status = withdrawn.length > 0 ? "withdrawn" : "hand";
  return { status, browser: browser.map((check, i) => ({ check, test: found[i] })), ci: ci.map((check, i) => ({ check, result: ciResults[i] })), hand, withdrawn };
}

export const LABEL = {
  passed: "Passed",
  "passed-on-retry": "Passed on a retry",
  failed: "Failed",
  "not-run": "Not run",
  "ci-passed": "Passed in CI",
  "ci-failed": "Failed in CI",
  ci: "CI check",
  hand: "Hand check",
  withdrawn: "Withdrawn",
};

/** The sprint goal and demo from the refinement's "## Sprint goal" section, as plain paragraphs. */
export function sprintGoal(refinement) {
  const m = /^## Sprint goal\s*\n([\s\S]*?)(?=^## )/m.exec(refinement ?? "");
  if (!m) return [];
  return m[1]
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
/** Markdown's **bold** and `code` in a paragraph, escaped. */
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
const mdCell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");

function totals(rows) {
  const t = { cases: rows.length, passed: 0, failed: 0, notRun: 0, ciPassed: 0, ciFailed: 0, ciUnread: 0, hand: 0, withdrawn: 0 };
  for (const { s } of rows) {
    if (s.status === "passed" || s.status === "passed-on-retry") t.passed++;
    else if (s.status === "failed") t.failed++;
    else if (s.status === "not-run") t.notRun++;
    else if (s.status === "ci-passed") t.ciPassed++;
    else if (s.status === "ci-failed") t.ciFailed++;
    else if (s.status === "ci") t.ciUnread++;
    else if (s.status === "withdrawn") t.withdrawn++;
    else t.hand++;
  }
  return t;
}

function ciLine(x) {
  const where = "job" in x.check ? `the ${x.check.job} job` : `${x.check.file}: "${x.check.test}"`;
  const result = x.result === "passed" ? "passed in this run" : x.result === "failed" ? "failed in this run" : x.result === "skipped" ? "skipped in this run" : "no result in this run's files";
  return { where, result };
}

function dateLabel(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} (London)`;
}

/**
 * Builds the page and the Markdown summary.
 * { sprint, refinement, stories, cases, report, vitest, run } -> { html, markdown, videos }
 */
export function buildDemo({ sprint, refinement, stories, cases, report, vitest, run }) {
  const tests = outcomes(report);
  const goal = sprintGoal(refinement);
  const mine = cases.filter((c) => c.sprint === sprint);
  const rows = mine.map((c) => ({ c, s: caseStatus(c, tests, vitest) }));
  const t = totals(rows);
  const videos = [...new Set(rows.flatMap(({ s }) => s.browser.map((b) => b.test?.video).filter(Boolean)))];
  const local = run?.source !== "ci";
  const commit = run?.commit ? run.commit.slice(0, 7) : "unknown";
  const repoUrl = run?.repository ? `https://github.com/${run.repository}` : null;
  const ciRead = Boolean(vitest);
  // A local run's unit tests ran on this machine, not in CI: say so.
  const where = local ? "in local tests" : "in CI";
  const label = (status) => (local && status.startsWith("ci-") ? `${status === "ci-passed" ? "Passed" : "Failed"} in local tests` : LABEL[status]);

  const summary = [
    `${t.cases} cases`,
    `${t.passed} passed in the browser`,
    `${t.failed} failed`,
    `${t.notRun} not run`,
    ciRead ? `${t.ciPassed} passed ${where}, ${t.ciFailed} failed ${where}${t.ciUnread ? `, ${t.ciUnread} CI checks without a result` : ""}` : `${t.ciPassed + t.ciFailed + t.ciUnread} CI checks (no results in this run)`,
    `${t.hand} by hand`,
    ...(t.withdrawn ? [`${t.withdrawn} withdrawn`] : []),
  ].join(", ");

  // ---- Markdown ----
  const md = [];
  md.push(`# Sprint ${sprint} demo: case results`, "");
  md.push(
    local
      ? `From a **local run** (not CI), ${dateLabel(run?.date)}, commit \`${commit}\`. A local run is a rehearsal: Rory signs off from a CI run.`
      : `From CI run [${esc(run.runId)}](${run.runUrl}) on \`${run.branch}\`, commit \`${commit}\`, ${dateLabel(run.date)}.`,
    "",
  );
  md.push(`**Totals:** ${summary}.`, "");
  md.push(
    "Built by `scripts/demo-page.mjs` (decision 0021). A case shows Passed or Failed only from a browser test that ran in this run. The recordings are on the demo page; they use the mock model, so their pictures and words are simulated.",
    "",
  );
  if (goal.length) md.push("## Sprint goal", "", ...goal.flatMap((p) => [p, ""]));
  for (const story of stories.filter((s) => s.sprint === sprint)) {
    const list = rows.filter((r) => r.c.story === story.id);
    if (!list.length) continue;
    md.push(`## ${story.id} ${story.title}`, "", "| Case | What | Result | How it is checked |", "| --- | --- | --- | --- |");
    for (const { c, s } of list) {
      const how = [
        ...s.browser.map(
          (b) =>
            `Browser: ${b.check.spec}${b.test ? "" : " (did not run)"}${b.check.note ? `. ${b.check.note}` : ""}${
              b.test?.measures?.length ? `${b.check.note ? "" : "."} Measured: ${b.test.measures.join("; ")}.` : ""
            }`,
        ),
        ...s.ci.map((x) => {
          const l = ciLine(x);
          return `CI: ${l.where} (${l.result})`;
        }),
        ...s.hand.map((h) => `By hand: ${h.why}`),
        ...s.withdrawn.map((w) => `Withdrawn: ${w.why}`),
      ].join("<br>");
      md.push(`| ${c.id} | ${mdCell(c.words)} | ${label(s.status)} | ${mdCell(how)} |`);
    }
    md.push("");
  }

  // ---- HTML ----
  const pill = (status) => `<span class="pill ${status}">${esc(label(status))}</span>`;
  const caseHtml = ({ c, s }) => {
    const parts = [];
    for (const b of s.browser) {
      const tst = b.test;
      parts.push(`<li><span class="k">Browser test</span> <span class="src">${esc(b.check.spec)}</span>: ${esc(b.check.title)}${
        tst
          ? ` <span class="res">${esc(LABEL[tst.status === "skipped" ? "not-run" : tst.status])}${tst.durationMs != null ? `, ${Math.round(tst.durationMs / 1000)} s` : ""}</span>`
          : ` <span class="res">did not run in this build</span>`
      }${b.check.note ? `<br><span class="note">${esc(b.check.note)}</span>` : ""}${
        tst?.measures?.length ? `<br><span class="measure"><span class="k">Measured:</span> ${tst.measures.map(esc).join("; ")}</span>` : ""
      }${tst?.error ? `<pre class="err">${esc(tst.error)}</pre>` : ""}${
        tst?.steps?.length
          ? `<details class="steps"><summary>Steps (${tst.steps.length})</summary><ol>${tst.steps.map((st) => `<li${st.failed ? ' class="bad"' : ""}>${esc(st.title)}${st.failed ? " (failed here)" : ""}</li>`).join("")}</ol></details>`
          : ""
      }${
        tst?.video
          ? `<details class="video"><summary>Watch the recording</summary><video controls preload="none" src="${esc(tst.video)}"></video><a href="${esc(tst.video)}">Open the recording</a></details>`
          : ""
      }</li>`);
    }
    for (const x of s.ci) {
      const l = ciLine(x);
      parts.push(`<li><span class="k">CI check</span> <span class="src">${esc(l.where)}</span> <span class="res">${esc(l.result)}</span>${x.check.note ? `<br><span class="note">${esc(x.check.note)}</span>` : ""}</li>`);
    }
    for (const h of s.hand) parts.push(`<li><span class="k">By hand</span> ${esc(h.why)}</li>`);
    for (const w of s.withdrawn) parts.push(`<li><span class="k">Withdrawn</span> ${esc(w.why)}</li>`);
    return `<li class="case" id="${esc(c.id)}"><div class="head"><span class="id">${esc(c.id)}</span>${pill(s.status)}</div><p class="words">${esc(c.words)}</p><ul class="checks">${parts.join("")}</ul></li>`;
  };

  const storiesHtml = stories
    .filter((st) => st.sprint === sprint)
    .map((st) => {
      const list = rows.filter((r) => r.c.story === st.id);
      if (!list.length) return "";
      const p = totals(list);
      const counts = [p.passed && `${p.passed} passed`, p.failed && `${p.failed} failed`, p.notRun && `${p.notRun} not run`, p.ciPassed && `${p.ciPassed} passed ${where}`, p.ciFailed && `${p.ciFailed} failed ${where}`, p.ciUnread && `${p.ciUnread} CI`, p.hand && `${p.hand} by hand`, p.withdrawn && `${p.withdrawn} withdrawn`].filter(Boolean).join(", ");
      return `<section class="story" aria-labelledby="s-${esc(st.id)}"><h2 id="s-${esc(st.id)}">${esc(st.id)} ${esc(st.title)}</h2><p class="sub">${esc(counts)}</p><ol class="cases">${list.map(caseHtml).join("")}</ol></section>`;
    })
    .join("\n");

  const runLine = local
    ? `<strong>Local run</strong> (not CI): a rehearsal. Rory signs off from a CI run.`
    : `CI run <a href="${esc(run.runUrl)}">${esc(run.runId)}</a>${run.runAttempt && run.runAttempt !== "1" ? ` (attempt ${esc(run.runAttempt)})` : ""}`;
  const commitHtml = repoUrl && run?.commit ? `<a href="${esc(`${repoUrl}/commit/${run.commit}`)}"><code>${esc(commit)}</code></a>` : `<code>${esc(commit)}</code>`;

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Studio, Sprint ${sprint} demo</title>
<style>
:root{color-scheme:light;--ink:#1c1b22;--ink2:#4a4857;--line:#d9d6e3;--bg:#f7f6fb;--surface:#fff;--primary:#4b3fb0;
--good:#13603a;--good-bg:#e3f4ea;--bad:#a1162b;--bad-bg:#fbe5e8;--wait:#6a4a00;--wait-bg:#fff2cc;--ci:#1f4f8a;--ci-bg:#e3eefb;--hand:#5a3a78;--hand-bg:#f0e7f8;--gone:#3f3d4a;--gone-bg:#ebeaef}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:72rem;margin:0 auto;padding:1.25rem}
h1{font-size:1.75rem;line-height:1.2;margin:.25rem 0 .75rem}
h2{font-size:1.25rem;margin:0 0 .25rem}
a{color:var(--primary)}
code,.src{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em;overflow-wrap:anywhere}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem 1.25rem;margin:0 0 1rem}
.meta{display:flex;flex-wrap:wrap;gap:.25rem 1.25rem;color:var(--ink2);margin:0 0 .75rem}
.totals{display:flex;flex-wrap:wrap;gap:.5rem;margin:.5rem 0 0;padding:0;list-style:none}
.totals li{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:.2rem .75rem;font-weight:600}
.sub{color:var(--ink2);margin:0 0 .75rem}
.honest{color:var(--ink2);font-size:.95rem}
ol.cases{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
.case{border:1px solid var(--line);border-radius:10px;padding:.75rem 1rem;background:var(--surface)}
.head{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.id{font-weight:700;font-family:ui-monospace,Menlo,monospace}
.words{margin:.35rem 0 .5rem}
.pill{display:inline-block;border-radius:999px;padding:.1rem .65rem;font-weight:700;font-size:.875rem}
.pill.passed,.pill.passed-on-retry,.pill.ci-passed{background:var(--good-bg);color:var(--good)}
.pill.failed,.pill.ci-failed{background:var(--bad-bg);color:var(--bad)}
.pill.not-run{background:var(--wait-bg);color:var(--wait)}
.pill.ci{background:var(--ci-bg);color:var(--ci)}
.pill.hand{background:var(--hand-bg);color:var(--hand)}
.pill.withdrawn{background:var(--gone-bg);color:var(--gone)}
.measure{font-size:.925rem}
ul.checks{margin:0;padding-left:1.1rem;display:grid;gap:.4rem;color:var(--ink)}
.k{font-weight:700}
.res{color:var(--ink2)}
.note{color:var(--ink2);font-size:.925rem}
.err{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bad-bg);color:var(--bad);padding:.5rem .75rem;border-radius:8px;font-size:.85rem;margin:.4rem 0}
details{margin:.35rem 0}
summary{cursor:pointer;color:var(--primary);font-weight:600;min-height:44px;display:flex;align-items:center}
summary:focus-visible,a:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
video{display:block;width:100%;max-width:960px;aspect-ratio:16/9;background:#000;border-radius:8px;margin:.25rem 0}
.steps ol{margin:.25rem 0;padding-left:1.25rem}
.steps li.bad{color:var(--bad);font-weight:600}
.story{margin:1.5rem 0}
@media (min-width:60rem){main{padding:2rem}h1{font-size:2.25rem}}
</style>
</head>
<body>
<main>
<header class="card">
<p class="meta"><span>Studio (working title)</span><span>Sprint ${sprint} review</span></p>
<h1>Sprint ${sprint} demo</h1>
<p class="meta"><span>${runLine}</span><span>Commit ${commitHtml}${run?.branch ? ` on <code>${esc(run.branch)}</code>` : ""}</span><span>${esc(dateLabel(run?.date))}</span>${run?.checksJob ? `<span>First CI job: ${esc(run.checksJob)}</span>` : ""}</p>
${run?.note ? `<p class="err">${esc(run.note)}</p>` : ""}
<ul class="totals" aria-label="Totals">
<li>${t.cases} cases</li><li>${t.passed} passed</li><li>${t.failed} failed</li><li>${t.notRun} not run</li><li>${ciRead ? `${t.ciPassed} passed ${where}${t.ciFailed ? `, ${t.ciFailed} failed ${where}` : ""}${t.ciUnread ? `, ${t.ciUnread} CI without a result` : ""}` : `${t.ciPassed + t.ciFailed + t.ciUnread} CI checks, no results read`}</li><li>${t.hand} by hand</li>${t.withdrawn ? `<li>${t.withdrawn} withdrawn</li>` : ""}
</ul>
</header>
${goal.length ? `<section class="card" aria-labelledby="goal"><h2 id="goal">Sprint goal</h2>${goal.map((p) => `<p>${inline(p)}</p>`).join("")}</section>` : ""}
<section class="card honest" aria-label="How to read this page">
<p><strong>Passed</strong> and <strong>Failed</strong> come only from a browser test that ran in this build and is tagged with the case. <strong>Not run</strong> means no such test ran. <strong>CI check</strong> names the unit, database or agent test that covers the case${ciRead ? ", with its result in this run" : "; this run's results for those weren't available, so none is claimed"}. <strong>Hand check</strong> needs a person, with the reason. <strong>Withdrawn</strong> is a case Rory withdrew by his decision, with the reason; it is not counted as passed. <strong>Measured</strong> is a time or size a browser test recorded in this run.</p>
<p>The recordings run against the mock model: every picture and every word the AI would write is simulated, and the brands are fictional. Anything that needs real AI output is a hand check on production after the deploy.</p>
</section>
${storiesHtml}
</main>
</body>
</html>
`;
  return { html, markdown: md.join("\n").replace(/\n{3,}/g, "\n\n"), videos };
}

/** The --sprint value: a sprint number (10), or a named sprint such as "10b"; null for anything else. */
export function sprintArg(raw) {
  const v = (raw ?? "").trim();
  if (/^\d+$/.test(v)) return Number(v) || null;
  if (/^\d+[a-z]$/.test(v)) return v;
  return null;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = arg("results");
  const sprint = sprintArg(arg("sprint"));
  const out = arg("out");
  if (!results || !sprint || !out) {
    console.error("Usage: node scripts/demo-page.mjs --results <results folder> --sprint <N, or a name such as 10b> --out <folder> [--md <file>]");
    process.exit(1);
  }
  const readJson = (f) => (existsSync(join(results, f)) ? JSON.parse(readFileSync(join(results, f), "utf8")) : null);
  const root = new URL("..", import.meta.url).pathname;
  const { CASES, STORIES } = await import(pathToFileURL(join(root, "tests/e2e/cases.ts")).href);
  const refinementPath = join(root, `docs/refinement/sprint-${sprint}.md`);
  const { html, markdown, videos } = buildDemo({
    sprint,
    refinement: existsSync(refinementPath) ? readFileSync(refinementPath, "utf8") : "",
    stories: STORIES,
    cases: CASES,
    report: readJson("report.json"),
    vitest: readJson("vitest.json"),
    run: readJson("run.json") ?? { source: "local" },
  });
  mkdirSync(join(out, "videos"), { recursive: true });
  for (const v of videos) {
    if (existsSync(join(results, v))) copyFileSync(join(results, v), join(out, v));
    else console.warn(`[demo-page] missing recording ${v}`);
  }
  writeFileSync(join(out, "index.html"), html);
  writeFileSync(join(out, `sprint-${sprint}-demo.md`), markdown);
  const md = arg("md") ?? join(root, `docs/testing/sprint-${sprint}-demo.md`);
  if (arg("md") !== "none") {
    mkdirSync(dirname(md), { recursive: true });
    writeFileSync(md, markdown);
  }
  console.log(`[demo-page] ${join(out, "index.html")} with ${videos.length} recordings; Markdown at ${arg("md") === "none" ? join(out, `sprint-${sprint}-demo.md`) : md}`);
}
