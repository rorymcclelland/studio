// C8-3: what the mock model "reads" in an uploaded ad. The mock can't see the
// picture, so it answers with fixed words for the demo brands, chosen by the
// picture's size in pixels (which the prompt states for the real model, so
// its boxes can be checked against it). The fixture ads in the tests are drawn
// in code with marks exactly where these boxes are (tests/fixtures/uploaded-ads.ts),
// so the contrast measured from their pixels is real. Plain TypeScript with no
// imports, so the browser tests can use it too. Every brand here is fictional.

export type MockBox = { x: number; y: number; width: number; height: number };
export type MockWord = { text: string; part: "headline" | "body" | "button" | "legal" | "other"; box: MockBox };
export type MockReading = { words: MockWord[]; logo: { present: boolean; box: MockBox | null } };

/** The picture sizes that pick another reading; any other size reads the clean ad. */
export const MOCK_UPLOAD_SIZES = {
  /** A 4:5 social ad whose body has a banned term. */
  banned: { width: 1080, height: 1350 },
  /** A square ad of 1200 px with no legal lines. */
  noLegal: { width: 1200, height: 1200 },
} as const;

export type MockKind = keyof typeof MOCK_UPLOAD_SIZES | "clean";

const LOGO: MockBox = { x: 0.07, y: 0.06, width: 0.2, height: 0.06 };

type BrandWords = { headline: string; body: [string, string]; button: string; legal: string[]; banned: string };

const BRANDS: Record<string, BrandWords> = {
  "Fernhollow Outfitters": {
    headline: "Walk the long way home",
    body: ["Merino layers made to be mended,", "for ridges, bogs and coast paths."],
    button: "Shop the layers",
    legal: ["Prices include VAT.", "Free returns within 30 days on unworn items."],
    banned: "An indestructible shell for every ridge.",
  },
  "Quillmoor Money": {
    headline: "Saving, at your own pace",
    body: ["Put a little aside each week,", "and see where your money goes."],
    button: "Open the app",
    legal: [
      "Savings rates are variable and can change.",
      "Fees apply to Plus and Premium plans; see the price list in the app.",
      "Quillmoor Money is a fictional company created for demonstration.",
    ],
    banned: "Risk-free saving, every single week.",
  },
};

const OTHER: BrandWords = {
  headline: "A simulated headline",
  body: ["Simulated words read by the mock model,", "for a brand it has no fixed words for."],
  button: "Find out more",
  legal: [],
  banned: "",
};

/** Which fixed reading a picture of this size gets. */
export function mockKindFor(width: number, height: number): MockKind {
  for (const [kind, size] of Object.entries(MOCK_UPLOAD_SIZES) as [keyof typeof MOCK_UPLOAD_SIZES, { width: number; height: number }][]) {
    if (size.width === width && size.height === height) return kind;
  }
  return "clean";
}

/** The mock's fixed reading for a brand and picture size: words in reading order, each with its box, and the logo. */
export function mockReading(brandName: string, width: number, height: number): MockReading {
  const kind = mockKindFor(width, height);
  const b = BRANDS[brandName] ?? OTHER;
  const words: MockWord[] = [
    { text: b.headline, part: "headline", box: { x: 0.07, y: 0.2, width: 0.62, height: 0.07 } },
    { text: kind === "banned" && b.banned ? b.banned : b.body[0], part: "body", box: { x: 0.07, y: 0.31, width: 0.56, height: 0.04 } },
  ];
  if (!(kind === "banned" && b.banned)) words.push({ text: b.body[1], part: "body", box: { x: 0.07, y: 0.36, width: 0.54, height: 0.04 } });
  words.push({ text: b.button, part: "button", box: { x: 0.07, y: 0.46, width: 0.26, height: 0.05 } });
  if (kind !== "noLegal") {
    b.legal.forEach((line, i) => words.push({ text: line, part: "legal", box: { x: 0.07, y: 0.86 + i * 0.035, width: Math.min(0.86, 0.012 * line.length), height: 0.025 } }));
  }
  return { words, logo: { present: true, box: LOGO } };
}
