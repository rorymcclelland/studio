// Sprint 10b, D-2 (decision 0029): the Market agent and a person's own real
// brand. For a fictional brand (the demo brands) it searches about the category
// and its customers, never about the brand, as before. For a real brand
// (brands.is_fictional false) it may also search about the brand itself and its
// own names, and its notes may name the brand. Every name here is fictional (rule 2).
import { describe, expect, it } from "vitest";
import { FICTIONAL_SEARCH, marketAgent, marketCountry, marketInput, noteProblems, REAL_SEARCH, type MarketInput } from "@/lib/agents/market";
import { JAPAN_REGIONS, TIDEWELL, UK_REGIONS } from "../fixtures/new-brand";

const base = {
  brandName: TIDEWELL.name,
  category: TIDEWELL.category,
  description: TIDEWELL.description,
  products: [],
  bannedTerms: [],
  places: [],
  month: "November 2026",
};

const PAGE = { url: "https://cooking-notes.example.test/videos", title: "Cooking videos (sample page)", citedText: "Tidewell Moments and Brightwater both publish short recipe videos for weeknights." };
const extra = { sources: [PAGE], readPage: { read: async () => PAGE.citedText } } as unknown as Parameters<typeof noteProblems>[2];
const note = { kind: "rival_move" as const, title: "Short recipe videos", text: "Tidewell Moments and Brightwater both publish short recipe videos for weeknights.", sources: [PAGE.url], names: ["Tidewell Moments", "Brightwater"] };

describe("D-2 the Market agent's prompt for a fictional brand and a real one", () => {
  it("a fictional brand (or an input from before Sprint 10b): search about the category and its customers, never about the brand", () => {
    for (const input of [marketInput.parse(base), marketInput.parse({ ...base, fictional: true, ownNames: ["Brightwater"] })]) {
      const prompt = marketAgent.buildPrompt(input);
      expect(prompt).toContain(`Brand (fictional): "${TIDEWELL.name}"`);
      expect(prompt).toContain("The brand is fictional: search about the category and its customers, never about the brand.");
      expect(prompt).not.toContain(REAL_SEARCH);
      // A fictional brand's own names never reach the search.
      expect(prompt).not.toContain("Own names");
    }
  });

  it("a real brand: search about the brand itself and its own names too", () => {
    const input: MarketInput = marketInput.parse({ ...base, fictional: false, ownNames: [...TIDEWELL.ownNames] });
    const prompt = marketAgent.buildPrompt(input);
    expect(prompt).toContain(`Brand (real): "${TIDEWELL.name}"`);
    expect(prompt).toContain('Own names: ["Brightwater"]');
    expect(prompt).toContain(REAL_SEARCH);
    expect(REAL_SEARCH).toMatch(/about the brand itself and its own names/);
    expect(prompt).not.toContain(FICTIONAL_SEARCH);
    expect(prompt).not.toContain("Brand (fictional)");
    // The instructions say both, and which applies is in the prompt.
    expect(marketAgent.instructions).toContain(FICTIONAL_SEARCH);
    expect(marketAgent.instructions).toContain(REAL_SEARCH);
  });

  it("a real brand's note may name the brand and its own names; a fictional brand's may not name the brand", async () => {
    const real = marketInput.parse({ ...base, fictional: false, ownNames: [...TIDEWELL.ownNames] });
    expect(await noteProblems(real, { notes: [note] }, extra)).toEqual([[]]);
    const fictional = marketInput.parse(base);
    expect((await noteProblems(fictional, { notes: [note] }, extra))[0]).toContain(`note 1 is about ${TIDEWELL.name} itself; notes are about the market`);
  });

  // QA, Sprint 10b: the market's country comes from where most of the brand's customers are.
  it("QA: the United Kingdom's prompt, for a brand whose customers are in the UK (and for inputs from before)", () => {
    for (const input of [marketInput.parse(base), marketInput.parse({ ...base, country: "United Kingdom" })]) {
      const prompt = marketAgent.buildPrompt(input);
      expect(prompt.split("\n")).toContain('Country: "United Kingdom"');
      expect(prompt).not.toContain("Japan");
      // The fictional wording is otherwise as it was.
      expect(prompt).toContain(`Brand (fictional): "${TIDEWELL.name}"`);
      expect(prompt).toContain(FICTIONAL_SEARCH);
    }
    expect(marketAgent.instructions).toMatch(/in the country the prompt gives \(the United Kingdom or Japan\), and write about that country/);
    expect(marketAgent.instructions).not.toMatch(/category in the United Kingdom\./);
  });

  it("QA: Japan's prompt, for a brand whose customers are mostly in Japan's regions", () => {
    const input = marketInput.parse({ ...base, places: [...JAPAN_REGIONS], country: "Japan" });
    const prompt = marketAgent.buildPrompt(input);
    expect(prompt.split("\n")).toContain('Country: "Japan"');
    expect(prompt).not.toContain("United Kingdom");
    expect(prompt).toContain(FICTIONAL_SEARCH);
    expect(marketInput.safeParse({ ...base, country: "France" }).success).toBe(false);
  });

  it("QA: the country is Japan only when most customers are in Japan's regions", () => {
    const jp = (n: number) => JAPAN_REGIONS.map((region) => ({ region, customers: n }));
    const uk = (n: number) => UK_REGIONS.map((region) => ({ region, customers: n }));
    expect(marketCountry(jp(100))).toBe("Japan");
    expect(marketCountry([...jp(100), ...uk(10)])).toBe("Japan");
    expect(marketCountry(uk(100))).toBe("United Kingdom");
    // Half is not most.
    expect(marketCountry([{ region: "Kanto", customers: 50 }, { region: "London", customers: 50 }])).toBe("United Kingdom");
    expect(marketCountry([])).toBe("United Kingdom");
  });
});
