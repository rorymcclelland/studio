import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Review nit: a curl that hangs would hold a GitHub Action until its job
// timeout, so every curl in a workflow has its own limit.
describe("GitHub workflows", () => {
  const dir = join(process.cwd(), ".github/workflows");
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

  it("give every curl call a --max-time", () => {
    const calls = files.flatMap((f) =>
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => /\bcurl\s/.test(l))
        .map((l) => ({ f, l: l.trim() })),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const { f, l } of calls) expect(l, `${f}: ${l}`).toMatch(/--max-time \d+/);
  });
});

// Decision 0021: the browser tests' results reach the demo page through a branch.
describe("the e2e job's results branch", () => {
  const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const e2e = ci.slice(ci.indexOf("\n  e2e:"), ci.indexOf("\n  real-stack:"));

  it("may write contents, and is the only job given any permission", () => {
    expect(e2e).toMatch(/\n {4}permissions:\n {6}contents: write\n/);
    expect(ci.match(/permissions:/g)).toHaveLength(1);
  });

  it("gathers and pushes the results whether the tests passed or failed, on pushes only, to e2e-results/ci/<branch>", () => {
    for (const name of ["Gather the results and recordings for the demo page", "Push them to e2e-results/ci/<branch> as one orphan commit"]) {
      const at = e2e.indexOf(`name: ${name}`);
      expect(at, name).toBeGreaterThan(e2e.indexOf("- run: npx playwright test"));
      expect(e2e.slice(at, at + 200)).toContain("if: ${{ !cancelled() && github.event_name == 'push' }}");
    }
    expect(e2e).toContain('git push --force origin "$commit:refs/heads/e2e-results/ci/$SOURCE_BRANCH"');
    expect(e2e).toContain("git commit-tree \"$tree\" -m");
    expect(ci).toContain('branches-ignore: ["e2e-results/**"]');
  });
});

// F-16a: the real-model eval workflow shows the estimate before spending, fails a run
// over 100p or with an agent missing its report (scripts/eval-check.mjs), keeps the key
// to the one step that calls a model, and pushes the reports to e2e-results/evals/<branch>.
describe("F-16a the real-model eval workflow", () => {
  const yml = readFileSync(join(process.cwd(), ".github/workflows/evals.yml"), "utf8");
  const evalsJob = yml.slice(yml.indexOf("\n  evals:"), yml.indexOf("\n  publish:"));
  const publish = yml.slice(yml.indexOf("\n  publish:"));
  const stepOf = (job: string, name: string) => {
    const at = job.indexOf(`- name: ${name}`);
    expect(at, name).toBeGreaterThan(-1);
    const next = job.indexOf("\n      - ", at + 1);
    return job.slice(at, next === -1 ? undefined : next);
  };

  it("prints the estimate, with no key, before the run, and puts it in the job summary", () => {
    const estimate = stepOf(evalsJob, "Estimate the cost before spending");
    expect(evalsJob.indexOf("Estimate the cost before spending")).toBeLessThan(evalsJob.indexOf("- name: Run the evals"));
    expect(estimate).toContain("npm run eval -- $AGENTS ${PART:+--part=$PART} --real");
    expect(estimate).not.toContain("--yes");
    expect(estimate).not.toMatch(/secrets\.|API_KEY/);
    expect(estimate).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(estimate).toMatch(/exit 1/);
  });

  it("runs with the keys in that step only, capped at 100p and failing over it", () => {
    const run = stepOf(evalsJob, "Run the evals");
    expect(run).toContain("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}");
    expect(run).toContain("GOOGLE_GENERATIVE_AI_API_KEY: ${{ secrets.GOOGLE_GENERATIVE_AI_API_KEY }}");
    expect(run).toContain("npm run eval -- $AGENTS ${PART:+--part=$PART} --yes --max-pence=100");
    expect(yml.match(/^.*ANTHROPIC_API_KEY.*$/gm)).toHaveLength(1);
    expect(yml.match(/^.*GOOGLE_GENERATIVE_AI_API_KEY.*$/gm)).toHaveLength(1);
    expect([...yml.matchAll(/secrets\.(\w+)/g)].map((m) => m[1])).toEqual(["ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]);
    expect(evalsJob).toContain('DAILY_CAP_PENCE: "100"');
    expect(evalsJob).toContain("persist-credentials: false");
  });

  it("reads contents only, except the publish job, which may write and has no key", () => {
    expect(yml).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(evalsJob).not.toContain("permissions:");
    expect(publish).toMatch(/\n {4}permissions:\n {6}contents: write\n/);
    expect(publish).not.toMatch(/secrets\.|npm /);
    expect(yml.match(/^ +contents: write$/gm)).toHaveLength(1);
  });

  it("keeps the artefact and pushes the real-model reports to e2e-results/evals/<branch> as one orphan commit, whether the evals passed or not", () => {
    const upload = stepOf(evalsJob, "Upload the reports");
    expect(upload).toContain("if: ${{ !cancelled() }}");
    expect(upload).toContain("path: evals/reports/*.md");
    expect(publish).toContain("needs: evals");
    expect(publish).toContain("if: ${{ !cancelled() }}");
    const push = stepOf(publish, "Push them to e2e-results/evals/<branch> as one orphan commit");
    expect(push).toContain('GIT_INDEX_FILE="$RUNNER_TEMP/eval-results.index"');
    expect(push).toContain('git commit-tree "$tree" -m');
    expect(push).toContain('git push --force origin "$commit:refs/heads/e2e-results/evals/$SOURCE_BRANCH"');
    // A run is often one batch of several, so the reports already on the branch are kept,
    // without overwriting this run's (cp -n), and before the commit is made.
    expect(push).toContain('git fetch --depth=1 origin "refs/heads/e2e-results/evals/$SOURCE_BRANCH"');
    expect(push).toContain('cp -rn "$earlier/." "$RUNNER_TEMP/eval-results/"');
    expect(push.indexOf("cp -rn")).toBeLessThan(push.indexOf("git add --all"));
    // Two runs' publish jobs never push at once, so neither force-pushes over the other's reports: they queue, never cancel.
    expect(publish).toMatch(/\n {4}concurrency:\n {6}group: eval-reports-\$\{\{ github\.ref \}\}\n {6}cancel-in-progress: false\n/);
    expect(evalsJob).not.toContain("concurrency:");
    const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain('branches-ignore: ["e2e-results/**"]');
  });
});
