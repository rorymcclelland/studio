// Decision 0021: the case list (tests/e2e/cases.ts) names real tests. Every
// browser check names a spec in tests/e2e and a test title in it, and that
// test carries the case's annotation, so the demo page can match the run's
// results to the case; every CI check names a Vitest file that exists, with
// the test or describe title in it, or a job in ci.yml.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASES, STORIES, caseKind, type Case } from "../e2e/cases";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where a test or describe titled `title` is declared in a source file: a real
 * call, `it(`, `test(`, `describe(` or `test.describe(`, followed by the title
 * in double quotes, single quotes or backticks. A title in a comment, in a
 * string elsewhere, or on a skipped test (`it.skip(`) doesn't count. -1 if none.
 */
function declaredAt(src: string, title: string): number {
  // Comments (whole-line and block) are blanked, keeping every other character where it was.
  const code = src.replace(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
  const forms = [JSON.stringify(title), `'${title.replace(/'/g, "\\'")}'`, `\`${title}\``].map(escape).join("|");
  const m = new RegExp(`(?<![\\w.$])(?:it|test|describe|test\\.describe)\\(\\s*(?:${forms})`).exec(code);
  return m ? m.index : -1;
}

describe("the case list", () => {
  it("has every agreed Sprint 7 case, once each, in story order", () => {
    const expected = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `C7-1.${n}`),
      ...[1, 2, 3, 4, 5, 6, 7, 8, "Q4"].map((n) => `C7-2.${n}`),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `C7-3.${n}`),
      ...[1, 2, 3, 4].map((n) => `F-27.${n}`),
      ...[1, 2, 3, 4].map((n) => `F-26.${n}`),
      ...[1, 2].map((n) => `F-28.${n}`),
      ...[1, 2, 3].map((n) => `N-7a.${n}`),
    ];
    expect(CASES.filter((c) => c.sprint === 7).map((c) => c.id)).toEqual(expected);
  });

  it("has every agreed C8-1 case, once each, in order, with a CI or browser check each", () => {
    const c81 = CASES.filter((c) => c.story === "C8-1");
    expect(c81.map((c) => c.id)).toEqual(Array.from({ length: 11 }, (_, i) => `C8-1.${i + 1}`));
    for (const c of c81) {
      expect(c.sprint, c.id).toBe(8);
      expect(["browser", "ci"], c.id).toContain(caseKind(c));
    }
    // The browser parts the refinement names: cases 1, 2, 3, 8, 9 and 11.
    expect(c81.filter((c) => caseKind(c) === "browser").map((c) => c.id)).toEqual(["C8-1.1", "C8-1.2", "C8-1.3", "C8-1.8", "C8-1.9", "C8-1.11"]);
  });

  it("every case belongs to a known story of its sprint, with an id of that story, words and at least one check", () => {
    for (const c of CASES) {
      const story = STORIES.find((s) => s.id === c.story);
      expect(story, c.id).toBeDefined();
      expect(story!.sprint, c.id).toBe(c.sprint);
      expect(c.id.startsWith(`${c.story}.`), c.id).toBe(true);
      expect(c.words.length, c.id).toBeGreaterThan(10);
      expect(c.checks.length, c.id).toBeGreaterThan(0);
      for (const x of c.checks) if (x.kind === "hand" || x.kind === "withdrawn") expect(x.why.length, c.id).toBeGreaterThan(10);
      // A withdrawn case has nothing else left to check.
      if (c.checks.some((x) => x.kind === "withdrawn")) expect(c.checks.every((x) => x.kind === "withdrawn"), c.id).toBe(true);
    }
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it("every browser check names a spec in tests/e2e and a test in it that carries the case's annotation", () => {
    for (const c of CASES) {
      for (const x of c.checks) {
        if (x.kind !== "browser") continue;
        const path = join("tests/e2e", x.spec);
        expect(existsSync(join(root, path)), `${c.id}: ${path}`).toBe(true);
        const src = read(path);
        const at = declaredAt(src, x.title);
        expect(at, `${c.id}: a test "${x.title}" in ${path}`).toBeGreaterThan(-1);
        // The annotation sits in the test's details, between its title and its body.
        const details = src.slice(at, src.indexOf("async (", at));
        expect(details, `${c.id}: the annotation on "${x.title}"`).toContain(`{ type: "case", description: "${c.id}" }`);
      }
    }
  });

  it("every case annotation in the specs is a case in the list with a browser check on that test", () => {
    const specs = readdirSync(join(root, "tests/e2e")).filter((f) => f.endsWith(".spec.ts"));
    expect(specs).toContain("sizes.spec.ts");
    for (const spec of specs) {
      const src = read(join("tests/e2e", spec));
      for (const m of src.matchAll(/\{ type: "case", description: "([^"]+)" \}/g)) {
        const c = CASES.find((x) => x.id === m[1]);
        expect(c, `${spec}: ${m[1]}`).toBeDefined();
        expect(c!.checks.some((x) => x.kind === "browser" && x.spec === spec), `${spec}: ${m[1]} lists this spec`).toBe(true);
      }
    }
  });

  it("every CI check names a Vitest file that exists, with the test or describe title in it, or a job in ci.yml", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const c of CASES) {
      for (const x of c.checks) {
        if (x.kind !== "ci") continue;
        if ("job" in x) {
          expect(ci, `${c.id}: job ${x.job}`).toContain(`name: ${x.job}`);
          continue;
        }
        expect(x.file, c.id).toMatch(/^tests\/.+\.test\.ts$/);
        expect(existsSync(join(root, x.file)), `${c.id}: ${x.file}`).toBe(true);
        expect(declaredAt(read(x.file), x.test), `${c.id}: a test or describe "${x.test}" in ${x.file}`).toBeGreaterThan(-1);
      }
    }
  });

  it("is honest about what needs real AI output, time or Rory: F-28 and N-7a are by hand or withdrawn, and so are crops, translations and the demo legal lines", () => {
    const kinds = (story: string) => CASES.filter((c) => c.story === story).map(caseKind);
    expect(kinds("F-28")).toEqual(["withdrawn", "hand"]);
    expect(kinds("N-7a")).toEqual(["hand", "hand", "hand"]);
    const hand = (id: string) => CASES.find((c) => c.id === id)!.checks.find((x) => x.kind === "hand");
    // Each hand check that needs the test pack names its check there.
    expect(hand("C7-1.3")).toMatchObject({ why: expect.stringMatching(/real 2K pictures.*HC-1 in docs\/testing\/sprint-7-test-pack\.md/) });
    expect(hand("C7-2.1")).toMatchObject({ why: expect.stringMatching(/Translation quality.*HC-3 in docs\/testing\/sprint-7-test-pack\.md/) });
    expect(hand("C7-2.Q4")).toMatchObject({ why: expect.stringMatching(/demo legal lines.*Q4.*HC-2 in docs\/testing\/sprint-7-test-pack\.md/) });
    const pack = read("docs/testing/sprint-7-test-pack.md");
    for (const id of ["HC-1 Crops on real 2K pictures", "HC-2 The demo legal lines", "HC-3 Translation quality"]) expect(pack).toContain(`### ${id}`);
    expect(CASES.find((c) => c.id === "F-28.1")!.checks).toEqual([{ kind: "withdrawn", why: expect.stringContaining("Rory's decision on 2 November 2026") }]);
  });

  it("has every agreed C8-2 case, once each, in order; the browser shows 2 and 4, and the real model's eyes are a hand check", () => {
    expect(CASES.filter((c) => c.story === "C8-2").map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `C8-2.${n}`));
    expect(CASES.filter((c) => c.story === "C8-2").map(caseKind)).toEqual(["ci", "browser", "ci", "browser", "ci", "ci", "hand"]);
    expect(CASES.find((c) => c.id === "C8-2.7")!.checks).toEqual([{ kind: "hand", why: expect.stringMatching(/^CI runs the mock model and has no real keys.*N-8e/) }]);
  });

  it("has every agreed C8-4 case, once each, in order; the real model's reasons are a hand check", () => {
    expect(CASES.filter((c) => c.story === "C8-4").map((c) => c.id)).toEqual([1, 2, 3, 4, 5].map((n) => `C8-4.${n}`));
    expect(CASES.filter((c) => c.story === "C8-4").map(caseKind)).toEqual(["browser", "ci", "ci", "ci", "hand"]);
    expect(CASES.find((c) => c.id === "C8-4.5")!.checks).toEqual([{ kind: "hand", why: expect.stringMatching(/^CI runs the mock model and has no real keys/) }]);
  });

  it("counts a case as browser, ci, hand or withdrawn by its strongest check", () => {
    const c = (checks: Case["checks"]): Case => ({ id: "X-1.1", sprint: 0, story: "X-1", words: "x", checks });
    expect(caseKind(c([{ kind: "hand", why: "w" }, { kind: "browser", spec: "s", title: "t" }]))).toBe("browser");
    expect(caseKind(c([{ kind: "hand", why: "w" }, { kind: "ci", job: "j" }]))).toBe("ci");
    expect(caseKind(c([{ kind: "hand", why: "w" }]))).toBe("hand");
    expect(caseKind(c([{ kind: "withdrawn", why: "w" }]))).toBe("withdrawn");
  });

  it("finds a title only where a test or describe declares it", () => {
    const title = "#1 does the thing";
    expect(declaredAt(`it("${title}", () => {});`, title)).toBe(0);
    expect(declaredAt(`describe('${title}', () => {});`, title)).toBe(0);
    expect(declaredAt(`test.describe(\n  \`${title}\`,\n  () => {});`, title)).toBe(0);
    expect(declaredAt(`x;\ntest(\n  "${title}",\n  { annotation: [] },\n  async () => {});`, title)).toBe(3);
    // A comment, another string, a skipped test or a look-alike call is not a declaration.
    expect(declaredAt(`  // it("${title}") used to be here`, title)).toBe(-1);
    expect(declaredAt(`/* it("${title}") */`, title)).toBe(-1);
    expect(declaredAt(`// "${title}"\nconst t = "${title}";`, title)).toBe(-1);
    expect(declaredAt(`it.skip("${title}", () => {});`, title)).toBe(-1);
    expect(declaredAt(`split("${title}");`, title)).toBe(-1);
    expect(declaredAt(`it("${title} and more", () => {});`, title)).toBe(-1);
  });
});
