// The evidence checks (S3-2), including the Sprint 3 review's holes 1 to 3.
import { describe, expect, it } from "vitest";
import { checkBrief, type BriefInput } from "@/lib/agents/brief";
import { containsTerm, evidenceProblems, type EvidenceItem } from "@/lib/brief/checks";
import type { BriefCore } from "@/lib/brief/schema";

const context: EvidenceItem[] = [
  { ref: "C1", kind: "segment", title: "Lapsed customers (no order in 12 months)", text: "412 of 2,000 customers (20.6%) have not ordered in the 12 months to the data date." },
  { ref: "C2", kind: "product", title: "Heather fleece", text: "Fleeces. £45.00. Midweight fleece." },
  { ref: "C3", kind: "insight", title: "Customer base", text: "2,000 customers and 5,116 orders in the 24 months to the data date." },
];
const kit = { legalLines: [], bannedTerms: ["guaranteed returns", "risk-free"], dontRules: [], evidenceClaims: ["warmest"] };

const brief = (over: Partial<BriefCore> = {}): BriefCore => ({
  title: "Winter walks",
  summary: "Bring lapsed walkers back for the winter with plain words.",
  story: "The hills are still there, and so is the kit that lasts.",
  insights: [
    { text: "412 customers have not ordered in 12 months.", cites: ["C1"] },
    { text: "The fleece costs £45.", cites: ["C2"] },
    { text: "5116 orders in 24 months.", cites: ["C3"] },
  ],
  audiences: [{ segmentRef: "C1", why: "They know the brand already." }],
  channels: [{ channel: "email", role: "Reach those who agreed." }],
  kpi: { metric: "reactivation rate" },
  ...over,
});
const problems = (b: BriefCore) => evidenceProblems(b, context, kit, { objective: "Win back lapsed walkers" });

describe("evidence checks", () => {
  it("accepts figures written as in their source, with separators or not", () => {
    expect(problems(brief())).toEqual([]);
  });

  it("review 2: a figure needs the same unit as its source", () => {
    expect(problems(brief({ summary: "45% of customers want fleeces now, it seems." }))).toEqual([
      expect.stringContaining("the summary says 45%"),
    ]);
    const twelve = brief({ insights: [{ text: "12% of lapsed customers bought a jacket.", cites: ["C1"] }, ...brief().insights.slice(1)] });
    expect(problems(twelve)).toEqual([expect.stringContaining("insight 1 says 12%")]);
    expect(problems(brief({ story: "A fleece for £20 is a good start to winter." }))).toEqual([expect.stringContaining("the story says £20")]);
  });

  it("review 2: quantities in words are refused in model text", () => {
    for (const t of ["Half of our walkers come back each winter.", "One in four customers buys a fleece.", "Twenty per cent more people walk in winter.", "Two thirds of orders are jackets."]) {
      expect(problems(brief({ summary: t })), t).toEqual([expect.stringContaining("quantities in words")]);
    }
    expect(problems(brief({ summary: "One more winter on the hills for walkers who know us." }))).toEqual([]);
  });

  it("review 3: banned terms match with hyphens, endings and either order", () => {
    for (const t of ["returns are guaranteed", "a guaranteed return", "risk free saving", "Risk-Free!", "GUARANTEED RETURNS"]) {
      expect(containsTerm(t, kit.bannedTerms[0]) || containsTerm(t, kit.bannedTerms[1]), t).toBe(true);
    }
    expect(containsTerm("we return to the guarantee of plain fees", "guaranteed returns")).toBe(true);
    expect(containsTerm("Returns within 30 days on unworn items.", "guaranteed returns")).toBe(false);
    expect(problems(brief({ story: "Our warmest fleece yet." }))).toEqual([expect.stringContaining('claims "warmest"')]);
  });

  it("review 1: in a revision, a citation tag never makes its number allowed; the current brief's own figures are", () => {
    const current = brief({ insights: [...brief().insights.slice(0, 2), { text: "5116 orders in 24 months.", cites: ["C3"] }] });
    const input = {
      brandName: "Fernhollow", objective: "Win back lapsed walkers", voice: "", doRules: [], kit,
      context: context.map((c) => ({ tag: c.ref, kind: c.kind, title: c.title, text: c.text })),
      revise: { current: { ...current, story: "Plain story about 47 walkers." }, section: "summary" as const, instruction: "x" },
    } satisfies BriefInput;
    // C3 is cited; "3%" is not made allowed by the tag, and 47 (a person's figure) stays allowed.
    const reply = { ...input.revise.current, summary: "3% of walkers came back; the summary changed as asked." };
    expect(checkBrief(input, reply)).toEqual([expect.stringContaining("the summary says 3%")]);
    expect(checkBrief(input, { ...input.revise.current, summary: "47 walkers came back to the hills, as the story says." })).toEqual([]);
  });

  it("review 4: a section revision is checked on that section, so a removed source elsewhere doesn't block it", () => {
    const current = brief({ insights: [{ text: "A source that has since gone.", cites: ["0b5f1c1e-0000-4000-8000-000000000000"] }, ...brief().insights.slice(1)] });
    const input = {
      brandName: "Fernhollow", objective: "Win back lapsed walkers", voice: "", doRules: [], kit,
      context: context.map((c) => ({ tag: c.ref, kind: c.kind, title: c.title, text: c.text })),
      revise: { current, section: "story" as const, instruction: "warmer" },
    } satisfies BriefInput;
    expect(checkBrief(input, { ...current, story: "A warmer story about the hills in winter." })).toEqual([]);
    expect(checkBrief({ ...input, revise: { ...input.revise, section: null } }, current)).toEqual([expect.stringContaining("not in the context")]);
  });
});
