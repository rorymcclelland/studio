// Decision 0021: the case list (tests/e2e/cases.ts) names real tests. Every
// browser check names a spec in tests/e2e and a test title in it, and that
// test carries the case's annotation, so the demo page can match the run's
// results to the case; every CI check names a Vitest file that exists, with
// the test or describe title in it, or a job in ci.yml.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASES, STORIES, caseKind, type Case } from "../e2e/cases";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** The title as it would appear in a source file, in double quotes, single quotes or backticks. */
const quoted = (src: string, title: string) =>
  [JSON.stringify(title), `'${title.replace(/'/g, "\\'")}'`, `\`${title}\``].some((q) => src.includes(q));

describe("the case list", () => {
  it("has every agreed Sprint 7 case, once each, in story order", () => {
    const expected = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `C7-1.${n}`),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `C7-2.${n}`),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `C7-3.${n}`),
      ...[1, 2, 3, 4].map((n) => `F-27.${n}`),
      ...[1, 2, 3, 4].map((n) => `F-26.${n}`),
      ...[1, 2].map((n) => `F-28.${n}`),
      ...[1, 2, 3].map((n) => `N-7a.${n}`),
    ];
    expect(CASES.filter((c) => c.sprint === 7).map((c) => c.id)).toEqual(expected);
  });

  it("every case belongs to a known story of its sprint, with an id of that story, words and at least one check", () => {
    for (const c of CASES) {
      const story = STORIES.find((s) => s.id === c.story);
      expect(story, c.id).toBeDefined();
      expect(story!.sprint, c.id).toBe(c.sprint);
      expect(c.id.startsWith(`${c.story}.`), c.id).toBe(true);
      expect(c.words.length, c.id).toBeGreaterThan(10);
      expect(c.checks.length, c.id).toBeGreaterThan(0);
      for (const x of c.checks) if (x.kind === "hand") expect(x.why.length, c.id).toBeGreaterThan(10);
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
        const at = src.indexOf(JSON.stringify(x.title));
        expect(at, `${c.id}: "${x.title}" in ${path}`).toBeGreaterThan(-1);
        // The annotation sits in the test's details, between its title and its body.
        const details = src.slice(at, src.indexOf("async (", at));
        expect(details, `${c.id}: the annotation on "${x.title}"`).toContain(`{ type: "case", description: "${c.id}" }`);
      }
    }
  });

  it("every case annotation in the specs is a case in the list with a browser check on that test", () => {
    const specs = ["sizes.spec.ts", "several-audiences.spec.ts", "languages.spec.ts", "launch-pack.spec.ts", "creative.spec.ts"];
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
        expect(quoted(read(x.file), x.test), `${c.id}: "${x.test}" in ${x.file}`).toBe(true);
      }
    }
  });

  it("is honest about what needs real AI output or time: F-28 and N-7a are by hand, and so is crop quality and translation quality", () => {
    const kinds = (story: string) => CASES.filter((c) => c.story === story).map(caseKind);
    expect(kinds("F-28")).toEqual(["hand", "hand"]);
    expect(kinds("N-7a")).toEqual(["hand", "hand", "hand"]);
    const hand = (id: string) => CASES.find((c) => c.id === id)!.checks.find((x) => x.kind === "hand");
    expect(hand("C7-1.3")).toMatchObject({ why: expect.stringContaining("real 2K pictures") });
    expect(hand("C7-2.1")).toMatchObject({ why: expect.stringContaining("Translation quality") });
  });

  it("counts a case as browser, ci or hand by its strongest check", () => {
    const c = (checks: Case["checks"]): Case => ({ id: "X-1.1", sprint: 0, story: "X-1", words: "x", checks });
    expect(caseKind(c([{ kind: "hand", why: "w" }, { kind: "browser", spec: "s", title: "t" }]))).toBe("browser");
    expect(caseKind(c([{ kind: "hand", why: "w" }, { kind: "ci", job: "j" }]))).toBe("ci");
    expect(caseKind(c([{ kind: "hand", why: "w" }]))).toBe("hand");
  });
});
