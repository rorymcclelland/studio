// Decision 0021: the demo page Rory signs a sprint off from
// (scripts/demo-page.mjs) and the CI step that gathers its results
// (scripts/e2e-results.mjs), against a small fixture run
// (tests/fixtures/demo-results): a passed, a failed, a flaky, a skipped and a
// missing browser test, an untagged one, CI checks with and without results,
// and hand checks. A case shows Passed or Failed only from a tagged browser
// test that ran; nothing by hand or unread is ever shown as passed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemo, caseStatus, outcomes, sprintGoal } from "../../scripts/demo-page.mjs";
import { casesOf, prepare, runInfo, slimVitest } from "../../scripts/e2e-results.mjs";
import type { Case, Story } from "../e2e/cases";

const dir = join(process.cwd(), "tests/fixtures/demo-results");
const fixture = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const report = fixture("report.json");
const vitest = fixture("vitest.json");
const run = fixture("run.json");

const SPEC = "sample.spec.ts";
const stories: Story[] = [
  { sprint: 99, id: "X-1", title: "A story in a made-up sprint" },
  { sprint: 98, id: "Y-1", title: "Another sprint's story" },
];
const c = (n: number, checks: Case["checks"]): Case => ({ id: `X-1.${n}`, sprint: 99, story: "X-1", words: `Case ${n} in a few words.`, checks });
const browser = (title: string) => ({ kind: "browser" as const, spec: SPEC, title });
const cases: Case[] = [
  c(1, [browser("X-1 #1: shows the thing")]),
  c(2, [browser("X-1 #2: refuses the other thing")]),
  c(3, [browser("X-1 #3: a test that isn't in this run")]),
  c(4, [{ kind: "hand", why: "Needs real model output, checked on production." }]),
  c(5, [browser("X-1 #5: flaky but passed")]),
  c(6, [browser("X-1 #6: skipped here")]),
  c(7, [browser("X-1 #7: not tagged")]),
  c(8, [{ kind: "ci", file: "tests/lib/sample.test.ts", test: "a group" }]),
  c(9, [{ kind: "ci", file: "tests/lib/sample.test.ts", test: "fails" }]),
  c(10, [{ kind: "ci", file: "tests/lib/sample.test.ts", test: "a test that was removed" }]),
  c(11, [browser("X-1 #1: shows the thing"), { kind: "hand", why: "Translation quality, on production." }]),
  { id: "Y-1.1", sprint: 98, story: "Y-1", words: "Another sprint's case.", checks: [{ kind: "hand", why: "Not this sprint." }] },
];
const refinement = [
  "# Sprint 99 refinement",
  "",
  "## Sprint goal",
  "",
  "A picked ad becomes a **launch pack**, in `every` size.",
  "",
  "**Demo:** pick four ads.",
  "",
  "## Stories",
].join("\n");

const statusOf = (id: string, v: unknown = vitest) => caseStatus(cases.find((x) => x.id === id)!, outcomes(report), v).status;

describe("the demo page's case statuses", () => {
  it("Passed and Failed come only from a tagged browser test that ran", () => {
    expect(statusOf("X-1.1")).toBe("passed");
    expect(statusOf("X-1.2")).toBe("failed");
    expect(statusOf("X-1.5")).toBe("passed-on-retry");
  });

  it("a missing, skipped or untagged browser test is Not run, never Passed", () => {
    expect(statusOf("X-1.3")).toBe("not-run");
    expect(statusOf("X-1.6")).toBe("not-run");
    expect(statusOf("X-1.7")).toBe("not-run");
  });

  it("a CI check shows a result only when the run has one", () => {
    expect(statusOf("X-1.8")).toBe("ci-passed");
    expect(statusOf("X-1.9")).toBe("ci-failed");
    expect(statusOf("X-1.10")).toBe("ci");
    expect(statusOf("X-1.8", null)).toBe("ci");
  });

  it("a hand check is a hand check", () => {
    expect(statusOf("X-1.4")).toBe("hand");
  });

  it("reads the failure without terminal colours, and the steps and recording of the last attempt", () => {
    const tests = outcomes(report);
    expect(tests.find((t) => t.title.startsWith("X-1 #2"))).toMatchObject({
      error: "Error: expect(locator).toBeVisible() failed\nLocator: getByText('Refused')",
      video: "videos/sample-2.webm",
      steps: [{ title: "Try the other thing", failed: true }],
    });
    expect(tests.find((t) => t.title.startsWith("X-1 #5"))).toMatchObject({ status: "passed-on-retry", error: "first try" });
    expect(outcomes(null)).toEqual([]);
  });
});

describe("the demo page", () => {
  const { html, markdown, videos } = buildDemo({ sprint: 99, refinement, stories, cases, report, vitest, run });

  it("takes the sprint goal and demo from the refinement", () => {
    expect(sprintGoal(refinement)).toEqual(["A picked ad becomes a **launch pack**, in `every` size.", "**Demo:** pick four ads."]);
    expect(html).toContain("<p>A picked ad becomes a <strong>launch pack</strong>, in <code>every</code> size.</p>");
  });

  it("has the run, commit, date and totals in the header", () => {
    expect(html).toContain('<a href="https://github.com/example/studio/actions/runs/123456789">123456789</a>');
    expect(html).toContain('<a href="https://github.com/example/studio/commit/0fcc4750000000000000000000000000000000aa"><code>0fcc475</code></a>');
    expect(html).toContain("2 November 2026, 14:30 (London)");
    expect(html).toContain("<li>11 cases</li><li>3 passed</li><li>1 failed</li><li>3 not run</li>");
    expect(html).toContain("<li>1 passed in CI, 1 failed in CI, 1 CI without a result</li><li>1 by hand</li>");
  });

  it("lists only this sprint's stories and cases, in order, each with its result", () => {
    expect(html).not.toContain("Y-1");
    const order = [...html.matchAll(/<li class="case" id="([^"]+)">/g)].map((m) => m[1]);
    expect(order).toEqual(cases.filter((x) => x.sprint === 99).map((x) => x.id));
    const pillOf = (id: string) => new RegExp(`id="${id.replace(".", "\\.")}"><div class="head"><span class="id">[^<]+</span><span class="pill ([a-z-]+)">([^<]+)</span>`).exec(html)!.slice(1);
    expect(pillOf("X-1.1")).toEqual(["passed", "Passed"]);
    expect(pillOf("X-1.2")).toEqual(["failed", "Failed"]);
    expect(pillOf("X-1.3")).toEqual(["not-run", "Not run"]);
    expect(pillOf("X-1.4")).toEqual(["hand", "Hand check"]);
    expect(pillOf("X-1.10")).toEqual(["ci", "CI check"]);
    expect(pillOf("X-1.11")).toEqual(["passed", "Passed"]);
  });

  it("embeds each recording from a relative path beside the page, and lists the files to copy", () => {
    expect(html).toContain('<video controls preload="none" src="videos/sample-1.webm"></video>');
    expect(videos.sort()).toEqual(["videos/sample-1.webm", "videos/sample-2.webm"]);
    expect(html).not.toMatch(/src="\/|src="https?:/);
  });

  it("says why a case wasn't run, names a CI check without claiming a result it can't read, and gives each hand check's reason", () => {
    expect(html).toContain("X-1 #3: a test that isn&#39;t in this run <span class=\"res\">did not run in this build</span>");
    expect(html).toContain('tests/lib/sample.test.ts: &quot;a test that was removed&quot;</span> <span class="res">no result in this run&#39;s files</span>');
    expect(html).toContain("Needs real model output, checked on production.");
    // A case with a browser test and a hand check shows both: the hand check is still to do.
    expect(html).toMatch(/id="X-1\.11">[\s\S]*?Translation quality, on production\./);
  });

  it("escapes everything it shows, and is honest that the recordings are simulated", () => {
    expect(html).toContain("See it &lt;works&gt;");
    expect(html).not.toContain("<works>");
    expect(html).toContain("every picture and every word the AI would write is simulated");
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).not.toContain("—");
    expect(markdown).not.toContain("—");
  });

  it("says plainly when a page is from a local run, and never reads unread CI results as passed", () => {
    const local = buildDemo({ sprint: 99, refinement, stories, cases, report, vitest: null, run: { source: "local", date: run.date, commit: run.commit } });
    expect(local.html).toContain("<strong>Local run</strong> (not CI)");
    expect(local.html).toContain("3 CI checks, no results read");
    expect(local.html).not.toContain("Passed in CI");
    // A local run's unit-test results are local, never "in CI".
    const withTests = buildDemo({ sprint: 99, refinement, stories, cases, report, vitest, run: { source: "local", date: run.date, commit: run.commit } });
    expect(withTests.html).toContain('<span class="pill ci-passed">Passed in local tests</span>');
    expect(withTests.html).toContain("1 passed in local tests, 1 failed in local tests");
    expect(withTests.html).not.toMatch(/in CI\b/);
    expect(local.markdown).toContain("From a **local run** (not CI)");
  });

  it("writes the same table as Markdown, without videos", () => {
    expect(markdown).toContain("# Sprint 99 demo: case results");
    expect(markdown).toContain("## X-1 A story in a made-up sprint");
    expect(markdown).toContain("| X-1.2 | Case 2 in a few words. | Failed | Browser: sample.spec.ts |");
    expect(markdown).toContain("| X-1.3 | Case 3 in a few words. | Not run | Browser: sample.spec.ts (did not run) |");
    expect(markdown).toContain("| X-1.8 | Case 8 in a few words. | Passed in CI | CI: tests/lib/sample.test.ts: \"a group\" (passed in this run) |");
    expect(markdown).not.toContain(".webm");
  });
});

describe("gathering a run's results", () => {
  it("keeps the last attempt's main recording of tagged tests only, made relative; every other path is dropped", () => {
    const raw = {
      suites: [
        {
          specs: [
            {
              title: "tagged",
              file: "sizes.spec.ts",
              tests: [
                {
                  annotations: [{ type: "case", description: "C7-1.1" }],
                  results: [
                    { attachments: [{ name: "video", path: "/abs/first.webm" }, { name: "trace", path: "/abs/trace.zip" }] },
                    { attachments: [{ name: "video", path: "/abs/axe-blank.webm" }, { name: "video", path: "/abs/second.webm" }] },
                  ],
                },
              ],
            },
            { title: "untagged", file: "brands.spec.ts", tests: [{ annotations: [], results: [{ attachments: [{ name: "video", path: "/abs/other.webm" }] }] }] },
          ],
        },
      ],
    };
    // Each page a test opens is recorded (axe opens a blank one per check): the largest is the test's own page.
    const sizes: Record<string, number> = { "/abs/axe-blank.webm": 3_000, "/abs/second.webm": 9_000_000 };
    expect(prepare(raw, (p: string) => sizes[p] ?? 0)).toEqual([{ from: "/abs/second.webm", to: "videos/sizes-1.webm" }]);
    const [tagged, untagged] = raw.suites[0].specs;
    expect(tagged.tests[0].results[1].attachments).toEqual([{ name: "video" }, { name: "video", path: "videos/sizes-1.webm" }]);
    expect(tagged.tests[0].results[0].attachments).toEqual([{ name: "video" }, { name: "trace" }]);
    expect(untagged.tests[0].results[0].attachments).toEqual([{ name: "video" }]);
  });

  it("reads case annotations from the test or its results", () => {
    expect(casesOf({ annotations: [{ type: "case", description: "A.1" }, { type: "issue", description: "x" }], results: [{ annotations: [{ type: "case", description: "A.2" }] }] })).toEqual(["A.1", "A.2"]);
  });

  it("slims Vitest's report to relative files, titles and statuses", () => {
    const slim = slimVitest(
      { success: true, testResults: [{ name: "/repo/tests/lib/x.test.ts", assertionResults: [{ title: "t", ancestorTitles: ["d"], status: "passed", failureMessages: [] }] }] },
      "/repo",
    );
    expect(slim).toEqual({ success: true, files: [{ file: "tests/lib/x.test.ts", tests: [{ title: "t", ancestors: ["d"], status: "passed" }] }] });
  });

  it("records the run from GitHub's variables, or says local", () => {
    const now = new Date("2026-11-02T10:00:00Z");
    expect(
      runInfo({ GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_SHA: "abc", SOURCE_BRANCH: "sprint-8", CHECKS_RESULT: "success" }, now),
    ).toEqual({ source: "ci", runId: "42", runAttempt: "1", runUrl: "https://github.com/o/r/actions/runs/42", repository: "o/r", commit: "abc", branch: "sprint-8", date: "2026-11-02T10:00:00.000Z", checksJob: "success" });
    expect(runInfo({}, now)).toMatchObject({ source: "local", runId: "local", runUrl: null, checksJob: null });
  });
});
