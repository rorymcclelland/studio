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
