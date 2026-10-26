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
