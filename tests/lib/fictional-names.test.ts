// Sprint 10b, D-5 Rule 2, as Rory answered A1 on 10 November 2026: a person
// may add their own real brand to their own workspace, but the seeds, demo
// data, tests, fixtures, evals and screenshots stay fictional. This is the CI
// check that finds no real company names in the seeds and fixtures, extended
// from S2-4 #7 (tests/lib/demo-generate.test.ts, the demo generator's output)
// to the files themselves, Sprint 10b's new fixtures and tests among them. It
// also holds the reworded rule, its decision record and the README to Rory's words.
//
// The list below names real companies on purpose, so this file is the one place
// they appear and is never scanned itself. Market notes may name real
// companies with their sources (rule 2's market exception); the agent tests
// that check those names are refused (tests/agents/*.test.ts) are not seeds or
// fixtures, so they are not scanned.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Real companies a fixture for these categories (outdoor clothing, money, home cooking) might borrow by mistake. */
const REAL_COMPANIES = [
  "patagonia", "the north face", "arc'teryx", "arcteryx", "berghaus", "montane", "mountain warehouse", "jack wolfskin", "fjallraven",
  "craghoppers", "monzo", "revolut", "barclays", "hsbc", "lloyds bank", "natwest", "santander", "klarna", "paypal", "moneybox",
  "mastercard", "nike", "adidas", "cookpad", "deliveroo", "hellofresh", "gousto", "tesco", "sainsbury's", "waitrose", "ocado",
  "just eat", "uber eats", "le creuset", "ottolenghi", "jamie oliver", "bbc good food", "allrecipes", "kikkoman", "muji", "uniqlo",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(${REAL_COMPANIES.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu");

function filesUnder(dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(root, p)).isDirectory() ? filesUnder(p) : [p];
  });
}

/** The seeds, demo data and fixtures, and Sprint 10b's new tests (which build brands and profiles of their own). */
function scanned(): string[] {
  const text = (f: string) => /\.(ts|tsx|sql|json|md|csv|txt)$/.test(f);
  const sets = [
    ["db/seed.sql"],
    filesUnder("src/lib/demo"),
    filesUnder("tests/fixtures"),
    filesUnder("tests/evals/fixtures"),
    filesUnder("tests/helpers"),
    readdirSync(join(root, "tests/e2e"))
      .filter((f) => /fixture\.ts$|\.setup\.ts$|^fullest-data\.ts$/.test(f))
      .map((f) => join("tests/e2e", f)),
    [
      "tests/e2e/new-brand.spec.ts",
      "tests/e2e/campaign-line.spec.ts",
      "tests/e2e/suggest-lines.spec.ts",
      "tests/lib/new-brand.test.ts",
      "tests/lib/own-names.test.ts",
      "tests/lib/simulated-profile.test.ts",
      "tests/lib/campaign-line.test.ts",
      "tests/db/new-brand.test.ts",
      "tests/db/fictional-brands.test.ts",
      "tests/flows/simulated-data.test.ts",
      "tests/flows/campaign-line.test.ts",
      "tests/agents/campaign-line.test.ts",
      "tests/agents/suggest-lines.test.ts",
    ],
  ];
  return [...new Set(sets.flat())].filter((f) => text(f) && existsSync(join(root, f)));
}

describe("D-5 rule 2: fictional brands in seeds, demo data, tests and fixtures", () => {
  it("D-5 #1 no real company names in the seeds and fixtures, Sprint 10b's new fixtures and tests included", () => {
    const files = scanned();
    // The scan reaches what it should: the seed, the demo briefs, the shared fixtures and Sprint 10b's own.
    for (const f of ["db/seed.sql", "src/lib/demo/briefs.ts", "tests/fixtures/new-brand.ts", "tests/fixtures/uploaded-ads.ts", "tests/e2e/new-brand.spec.ts", "tests/helpers/copy-input.ts"]) {
      expect(files, f).toContain(f);
    }
    expect(files).not.toContain("tests/lib/fictional-names.test.ts");
    const found = files.flatMap((f) => {
      const m = PATTERN.exec(read(f));
      return m ? [`${f}: "${m[1]}"`] : [];
    });
    expect(found).toEqual([]);
  });

  it("D-5 #1 the check finds a real name in any case and form, and only as a whole name", () => {
    expect(PATTERN.test("A recipe from Cookpad tonight")).toBe(true);
    expect(PATTERN.test("cookpad's weekly box")).toBe(true);
    expect(PATTERN.test("MONZO pots")).toBe(true);
    expect(PATTERN.test("Brightwater Kitchen")).toBe(false);
    expect(PATTERN.test("Cairnwick Outdoor")).toBe(false);
    // Not inside another word.
    expect(PATTERN.test("monzonite rock")).toBe(false);
  });

  it("D-5 rule 2 is reworded as Rory answered, with a decision record, and the README no longer says every brand is fictional", () => {
    const rule =
      "Fictional brands in seeds, demo data, tests, evals and screenshots. A person may add their own real brand to their own workspace; a real brand's logo is used only with its owner's permission. Market notes may name real companies with their sources; those names never reach a brief or creative unless they are the brand's own names.";
    expect(read("CLAUDE.md")).toContain(rule);
    expect(read("CLAUDE.md")).not.toContain("No real company names, logos or trademarks in seeds, creative prompts, generated assets or screenshots.");
    const decisions = readdirSync(join(root, "docs/decisions")).filter((f) => /^\d{4}-.+\.md$/.test(f));
    const record = decisions.find((f) => /rule 2/i.test(read(join("docs/decisions", f))) && /own real brand|their own (real )?brand/i.test(read(join("docs/decisions", f))));
    expect(record, "a decision record for rule 2's answer").toBeDefined();
    expect(Number(record!.slice(0, 4))).toBeGreaterThan(27);
    const readme = read("README.md");
    expect(readme).not.toContain("All brands and figures in the app are fictional or simulated.");
    expect(readme).not.toMatch(/fictional brands only;/i);
  });

  // QA finding (Sprint 10b): the sign-in, invite and welcome pages and the
  // sign-in email still said every brand in Studio is fictional (rule 1), which
  // stopped being true when a person could add their own real brand (A1).
  const EVERY_BRAND_FICTIONAL =
    /\b(?:the|all|its)\s+brands(?:\s+in\s+(?:it|studio|the\s+app))?\s+(?:are|is)\s+(?:all\s+)?fictional\b|\b(?:for|of|with)\s+fictional\s+brands\b|\ball\s+brands\b[^.]{0,60}\bfictional\b|\bevery\s+brand\b[^.]{0,60}\bfictional\b/i;

  /** A label (a pill, a heading) that says only "Fictional brands", as the welcome page's pill did. */
  const FICTIONAL_BRANDS_LABEL = />\s*fictional brands\s*</i;

  it("D-5 the check for 'every brand is fictional' catches the old sentences and passes the new ones", () => {
    for (const old of [
      "Studio is a multi-agent campaign studio built by Rory McClelland. The brands in it are fictional and their data is simulated.",
      "The brands are fictional, and their customers and orders are simulated.",
      "AI agents propose briefs and creative for fictional brands, and a person approves every move.",
      "All brands and figures in the app are fictional or simulated.",
      "Every brand in Studio is fictional.",
    ]) {
      expect(EVERY_BRAND_FICTIONAL.test(old), old).toBe(true);
    }
    expect(FICTIONAL_BRANDS_LABEL.test('<Pill tone="review">Fictional brands</Pill>')).toBe(true);
    expect(FICTIONAL_BRANDS_LABEL.test('<Pill tone="review">Fictional demo brands</Pill>')).toBe(false);
    for (const now of [
      "Its demo brands are fictional and their data is simulated; a brand you add yourself may be real, and any data Studio generates for it is simulated.",
      "The demo brands are fictional, and their customers and orders are simulated.",
      "AI agents propose briefs and creative for its fictional demo brands or a brand you add yourself.",
      "Studio is a working title. The brand in this pack is fictional.",
    ]) {
      expect(EVERY_BRAND_FICTIONAL.test(now), now).toBe(false);
    }
  });

  it("D-5 the sign-in, invite and welcome pages and the sign-in email say the demo brands are fictional, never every brand, and that a brand you add may be real", () => {
    const pages = [
      "src/app/signin/link/[token]/page.tsx",
      "src/app/invite/[token]/page.tsx",
      "src/app/welcome/page.tsx",
      "src/lib/auth/sign-in-email.ts",
    ];
    for (const f of pages) {
      // JSX wraps sentences over lines; read them as one line.
      const text = read(f).replace(/\s+/g, " ");
      expect(text, f).not.toMatch(EVERY_BRAND_FICTIONAL);
      expect(text, f).not.toMatch(FICTIONAL_BRANDS_LABEL);
      expect(text, f).toMatch(/\bdemo brands\b/i);
      expect(text, f).toMatch(/fictional/i);
      expect(text, f).toMatch(/a brand you add yourself/i);
      expect(text, f).toMatch(/simulated/i);
      expect(text, f).not.toContain(String.fromCharCode(0x2014)); // no em dash
    }
    // And nowhere else the app speaks to people, nor the README.
    const copy = [
      ...filesUnder("src/app"),
      ...filesUnder("src/components"),
      ...filesUnder("src/lib/auth"),
      ...filesUnder("src/lib/email"),
      "README.md",
    ].filter((f) => /\.(ts|tsx|md)$/.test(f) && existsSync(join(root, f)));
    expect(copy).toEqual(expect.arrayContaining(pages));
    const found = copy.filter((f) => {
      const text = read(f).replace(/\s+/g, " ");
      return EVERY_BRAND_FICTIONAL.test(text) || FICTIONAL_BRANDS_LABEL.test(text);
    });
    expect(found).toEqual([]);
  });
});
