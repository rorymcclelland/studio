import { describe, expect, it } from "vitest";
import { containsName, evidenceProblems } from "@/lib/brief/checks";

// 10 November 2026, production: market notes for a real brand named "ONS" (the Office for
// National Statistics). The name check trimmed word endings, so "ONS" became "on", and every
// picture prompt and ad with the word "on" was refused as naming a real company.

describe("a company's name in a text", () => {
  it("ONS is not the word 'on', nor 'ons' inside other words", () => {
    expect(containsName("A family cooks dinner on a weekday evening.", "ONS")).toBe(false);
    expect(containsName("Lessons, onions and seasons on the table.", "ONS")).toBe(false);
    expect(containsName("Cooks ons the go", "ONS")).toBe(false);
  });

  it("ONS in capitals is still caught, with a possessive or punctuation", () => {
    expect(containsName("Figures from the ONS show more home cooking.", "ONS")).toBe(true);
    expect(containsName("The ONS's survey says so.", "ONS")).toBe(true);
    expect(containsName("(ONS)", "ONS")).toBe(true);
  });

  it("an acronym with & matches only as itself", () => {
    expect(containsName("Lunch from M&S today", "M&S")).toBe(true);
    expect(containsName("M and S", "M&S")).toBe(false);
  });

  it("an ordinary name matches whole words in any case, with a possessive, and never part of a word", () => {
    expect(containsName("Rival recipe sites such as Cairnwick Outdoor are growing.", "Cairnwick Outdoor")).toBe(true);
    expect(containsName("cairnwick outdoor's members", "Cairnwick Outdoor")).toBe(true);
    expect(containsName("Cairnwick's", "Cairnwick")).toBe(true);
    expect(containsName("Cairnwickshire walks", "Cairnwick")).toBe(false);
    expect(containsName("Outdoor cooking at Cairnwick", "Cairnwick Outdoor")).toBe(false);
  });

  it("the brief check refuses 'the ONS' but not the word 'on' when the notes name ONS", () => {
    const kit = { legalLines: [], bannedTerms: [], dontRules: [], evidenceClaims: [], realNames: ["ONS"] };
    const check = (summary: string) =>
      evidenceProblems({ title: "Cook on weeknights", summary, story: "", insights: [], audiences: [], channels: [], kpi: { metric: "reactivation rate" } } as never, [], kit, {
        objective: "Bring lapsed home cooks back",
        allowUnsourcedNumbers: true,
        sections: ["title", "summary"],
      }).filter((p) => p.includes("ONS"));
    expect(check("Bring lapsed home cooks back on weeknights.")).toEqual([]);
    expect(check("The ONS says home cooking is up.")).toHaveLength(1);
  });
});
