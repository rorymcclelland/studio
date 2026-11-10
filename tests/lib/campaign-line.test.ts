// Sprint 10b, D-4 The campaign's line: the pure parts. The brief's optional
// line is 3 to 30 characters and passes the same checks as the brief's other
// words (banned terms, claims, companies from the market notes); the Copy
// checks refuse a paid-social or display set whose headline isn't the line;
// a brief with no line works as today. The interface is in the header of
// tests/e2e/campaign-line.spec.ts.
import { describe, expect, it } from "vitest";
import { checkCopy, copyAgent, readCopyInput } from "@/lib/agents/copy";
import { changedSections, evidenceProblems, type EvidenceItem, type KitLists } from "@/lib/brief/checks";
import { BRIEF_SECTIONS, briefCore, CAMPAIGN_LINE_MAX, CAMPAIGN_LINE_MIN, storedBrief, type BriefCore } from "@/lib/brief/schema";
import { setProblems, type CopyRules } from "@/lib/creative/copy-rules";
import { FERNHOLLOW, QUILLMOOR } from "@/lib/demo/briefs";
import { FERNHOLLOW_LINE, LINE_31, OTHER_COMPANY, QUILLMOOR_LINE } from "../fixtures/new-brand";
import { checkTagline, taglineInput } from "@/lib/agents/tagline";
import { mockCopyReply, quillmoorCopyInput } from "../helpers/copy-input";

const CONTEXT: EvidenceItem[] = [
  { ref: "C1", kind: "insight", title: "Winter walking", text: "Walkers buy layers before the first cold weekend." },
  { ref: "C2", kind: "insight", title: "Repairs", text: "Repairs keep a jacket in use for longer." },
  { ref: "C3", kind: "result", title: "Market note", text: "Cairnwick Outdoor opened a repair counter in September." },
];

const BRIEF: BriefCore = {
  title: "Further this winter",
  summary: "We meet walkers before the first cold weekend with layers that last.",
  story: "A walker sets out on a frosty ridge at first light, warm and unhurried.",
  insights: [
    { text: "Walkers buy layers before the first cold weekend.", cites: ["C1"] },
    { text: "Repairs keep a jacket in use for longer.", cites: ["C2"] },
    { text: "Repair counters are spreading in outdoor retail.", cites: ["C3"] },
  ],
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach walkers where they scroll." }],
  kpi: { metric: "conversions" },
};

const FERN_KIT = {
  legalLines: FERNHOLLOW.kit.legalLines,
  bannedTerms: FERNHOLLOW.kit.bannedTerms,
  dontRules: FERNHOLLOW.kit.dontRules,
  evidenceClaims: FERNHOLLOW.kit.evidenceClaims,
  realNames: [OTHER_COMPANY],
};

const lineProblems = (line: string) => evidenceProblems({ ...BRIEF, line }, CONTEXT, FERN_KIT, { objective: "Bring walkers back this winter", allowUnsourcedNumbers: true, sections: ["line"] });

/** A Copy input for Quillmoor (fictional) with one audience and paid social, display and search to write. */
const input = quillmoorCopyInput;
const mockReply = mockCopyReply;

const rules = (line: string | null): CopyRules => ({
  brandName: QUILLMOOR.kit.name,
  products: [],
  places: [],
  bannedTerms: QUILLMOOR.kit.bannedTerms,
  evidenceClaims: QUILLMOOR.kit.evidenceClaims,
  realNames: [],
  legalLines: [],
  pool: [],
  line,
});

describe("D-4 the campaign's line", () => {
  it("D-4 #3 a line of 31 characters is refused with the field's words; 3 to 30 characters pass, trimmed", () => {
    expect(CAMPAIGN_LINE_MIN).toBe(3);
    expect(CAMPAIGN_LINE_MAX).toBe(30);
    expect(LINE_31).toHaveLength(31);
    const long = briefCore.safeParse({ ...BRIEF, line: LINE_31 });
    expect(long.success).toBe(false);
    expect(long.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([["line", "The campaign line must be 30 characters or fewer."]]);
    const short = briefCore.safeParse({ ...BRIEF, line: "Go" });
    expect(short.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([["line", "The campaign line must be at least 3 characters."]]);
    expect(briefCore.parse({ ...BRIEF, line: `  ${FERNHOLLOW_LINE}  ` }).line).toBe(FERNHOLLOW_LINE);
    expect(briefCore.parse({ ...BRIEF, line: LINE_31.slice(0, 30) }).line).toHaveLength(30);
    expect(briefCore.parse({ ...BRIEF, line: "Go!" }).line).toBe("Go!");
  });

  it("D-4 #3 a line with a banned term, a claim that needs evidence, or a company from the market notes is refused by the brief checks", () => {
    expect(lineProblems(FERNHOLLOW_LINE)).toEqual([]);
    expect(lineProblems("Indestructible, all winter")).toEqual(['the campaign line uses the banned term "indestructible"']);
    expect(lineProblems("Our warmest layers yet")).toEqual([expect.stringMatching(/^the campaign line claims "warmest"/)]);
    expect(lineProblems("Unlike Cairnwick Outdoor")).toEqual([expect.stringMatching(/^the campaign line names Cairnwick Outdoor, a real company from the market notes/)]);
  });

  it("D-4 #3 the line is a section of the brief: versioned, compared and edited like the others", () => {
    expect(BRIEF_SECTIONS).toContain("line");
    expect(BRIEF_SECTIONS.indexOf("line")).toBe(BRIEF_SECTIONS.indexOf("title") + 1);
    expect(changedSections(BRIEF, { ...BRIEF, line: FERNHOLLOW_LINE })).toEqual(["line"]);
    expect(changedSections({ ...BRIEF, line: FERNHOLLOW_LINE }, { ...BRIEF, line: FERNHOLLOW_LINE })).toEqual([]);
    const stored = storedBrief.parse({ ...BRIEF, line: FERNHOLLOW_LINE, mustInclude: [], avoid: [] });
    expect(stored.line).toBe(FERNHOLLOW_LINE);
  });

  it("D-4 #4 a brief with no line works as today: old versions parse, and Copy writes its own headlines", () => {
    const old = storedBrief.parse({ ...BRIEF, mustInclude: [], avoid: [] });
    expect(old.line).toBeUndefined();
    expect(briefCore.parse(BRIEF)).toEqual(BRIEF);
    const i = input(null);
    expect(i.line).toBeNull();
    expect(copyAgent.buildPrompt(i)).not.toContain("Campaign line");
    const reply = mockReply(i);
    expect(checkCopy(i, reply)).toEqual([]);
    // As today: the alternatives for one audience have different headlines.
    const social = reply.sets.filter((s) => s.channel === "paid social").map((s) => (s.copy as { headline: string }).headline);
    expect(social).toHaveLength(3);
    expect(new Set(social).size).toBe(3);
    // The Copy input without a line reads back from its prompt as before.
    expect(readCopyInput(copyAgent.buildPrompt(i))).toEqual(i);
  });

  it("D-4 #5 with a line, every paid-social and display headline must be the line exactly; search keeps its own", () => {
    const i = input(QUILLMOOR_LINE);
    const prompt = copyAgent.buildPrompt(i);
    expect(prompt).toContain(`Campaign line (every paid-social and display headline is exactly this): ${JSON.stringify(QUILLMOOR_LINE)}`);
    expect(readCopyInput(prompt)?.line).toBe(QUILLMOOR_LINE);
    // The mock answer: the line on every social and display set, three different bodies, and passes every check.
    const good = mockReply(i);
    expect(checkCopy(i, good)).toEqual([]);
    for (const s of good.sets.filter((x) => x.channel === "paid social" || x.channel === "display")) {
      expect((s.copy as { headline: string }).headline, s.channel).toBe(QUILLMOOR_LINE);
    }
    const bodies = good.sets.filter((s) => s.channel === "paid social").map((s) => (s.copy as { body: string }).body);
    expect(new Set(bodies).size).toBe(3);
    const search = good.sets.find((s) => s.channel === "search")!.copy as { headlines: string[] };
    expect(search.headlines).toHaveLength(3);
    expect(search.headlines.some((h) => h !== QUILLMOOR_LINE)).toBe(true);

    // A reply whose second social headline isn't the line is refused, naming it.
    const bad = structuredClone(good);
    const second = bad.sets.filter((s) => s.channel === "paid social")[1];
    (second.copy as { headline: string }).headline = "Save a little each week";
    expect(checkCopy(i, bad)).toEqual([
      `paid social set 2 for A1 headline is "Save a little each week"; every paid-social and display headline is the campaign line, "${QUILLMOOR_LINE}", exactly`,
    ]);
    // A display headline that differs only in case or a full stop is still not the line.
    const display = structuredClone(good);
    (display.sets.find((s) => s.channel === "display")!.copy as { headline: string }).headline = `${QUILLMOOR_LINE.toLowerCase()}.`;
    expect(checkCopy(i, display).join(" ")).toMatch(/display set 1 for A1 headline is .*the campaign line/);
    // Alternatives that repeat a body are still refused.
    const same = structuredClone(good);
    const socials = same.sets.filter((s) => s.channel === "paid social");
    (socials[1].copy as { body: string }).body = (socials[0].copy as { body: string }).body;
    expect(checkCopy(i, same).join(" ")).toMatch(/the paid social sets for A1 repeat a body/);
  });

  it("D-4 #5 the copy rules hold the line for a person's edit too", () => {
    const set = { headline: QUILLMOOR_LINE, body: "Set up one small pot this January.", cta: "Start saving" };
    expect(setProblems("paid social", set, rules(QUILLMOOR_LINE), { where: "the set", allowFigures: true })).toEqual([]);
    expect(setProblems("paid social", { ...set, headline: "Save a little each week" }, rules(QUILLMOOR_LINE), { where: "the set", allowFigures: true })).toEqual([
      `the set headline is "Save a little each week"; every paid-social and display headline is the campaign line, "${QUILLMOOR_LINE}", exactly`,
    ]);
    // No line: any headline, as today.
    expect(setProblems("paid social", { ...set, headline: "Save a little each week" }, rules(null), { where: "the set" })).toEqual([]);
    // Search is never held to the line.
    expect(setProblems("search", { headlines: ["Savings app for January", "Start one small pot", "Calm money help"], descriptions: ["Set up one small pot.", "Plain words about money."] }, rules(QUILLMOOR_LINE), { where: "the set" })).toEqual([]);
  });

  // Review fix B1 (rules 1 and 2): a campaign line is every social and display headline, so even a person's line
  // carries no figure, no quantity, no quote and no company's name but the brand's own; a hand edit's
  // allowUnsourcedNumbers no longer lets one through.
  const KIT: KitLists = { ...FERN_KIT, brandName: FERNHOLLOW.kit.name, ownNames: [] };
  const handEdit = (line: string, kit: KitLists = KIT) =>
    evidenceProblems({ ...BRIEF, line }, CONTEXT, kit, { objective: "Bring walkers back this winter", allowUnsourcedNumbers: true, sections: ["line"] });

  it("D-4 #3 review fix B1: a line with a figure or a quantity in words is refused by the brief checks, even as a person's edit", () => {
    expect(handEdit("Loved by 10,000 walkers")).toEqual(["the campaign line says 10000; a campaign line can't carry a figure, so say it without one"]);
    expect(handEdit("Save 20% this winter")).toEqual(["the campaign line says 20%; a campaign line can't carry a figure, so say it without one"]);
    expect(handEdit("Half of walkers agree")).toEqual(['the campaign line says "Half of"; a campaign line can\'t carry a quantity, in figures or in words']);
    // Even a figure the context holds: the line is in every ad, where no source is shown.
    const withFigure: EvidenceItem[] = [...CONTEXT, { ref: "C4", kind: "insight", title: "Walkers", text: "12 months since the last order." }];
    expect(evidenceProblems({ ...BRIEF, line: "Back after 12 months" }, withFigure, KIT, { objective: "x", sections: ["line"] })).toEqual([
      "the campaign line says 12; a campaign line can't carry a figure, so say it without one",
    ]);
    // An agent's draft gets the same line messages, once each, not the evidence messages as well.
    expect(evidenceProblems({ ...BRIEF, line: "Loved by 10,000 walkers" }, CONTEXT, KIT, { objective: "x", sections: ["line"] })).toHaveLength(1);
  });

  it("D-4 #3 review fix B1: a line naming another company, quoting anyone or showing a rating is refused; the brand's own names pass", () => {
    expect(handEdit("Warmer than Brackenfell")).toEqual([
      `the campaign line names "Brackenfell", which looks like another company; a campaign line can't carry another company's name (only ${FERNHOLLOW.kit.name})`,
    ]);
    expect(handEdit("\u201cBest kit\u201d says Ana")[0]).toMatch(/^the campaign line has quotation marks; .*a campaign line can't carry a quote/);
    expect(handEdit("Five stars from walkers")).toEqual([expect.stringMatching(/^the campaign line shows a rating; .*a campaign line can't carry a quote/)]);
    expect(handEdit("Walk further - Ana, Leeds")[0]).toMatch(/^the campaign line attributes words to a person/);
    // The market notes' company keeps its own message, once.
    expect(handEdit(`Unlike ${OTHER_COMPANY}`)).toEqual([expect.stringMatching(new RegExp(`^the campaign line names ${OTHER_COMPANY}, a real company from the market notes`))]);
    // The brand's name, its own names (a real brand's, D-2), its products in the context, and ordinary lines pass.
    expect(handEdit("Further with Fernhollow")).toEqual([]);
    expect(handEdit("Cook with Brightwater", { ...KIT, brandName: "Tidewell Moments", ownNames: ["Brightwater"] })).toEqual([]);
    const product: EvidenceItem[] = [...CONTEXT, { ref: "C5", kind: "product", title: "Ridgeway Jacket", text: "A warm jacket." }];
    expect(evidenceProblems({ ...BRIEF, line: "Meet the Ridgeway Jacket" }, product, KIT, { objective: "x", allowUnsourcedNumbers: true, sections: ["line"] })).toEqual([]);
    expect(handEdit(FERNHOLLOW_LINE)).toEqual([]);
  });

  it("D-4 #3 review fix N5: a line with a line break, a tab or a control character is refused with a field error", () => {
    for (const line of ["Walk\nfurther", "Walk\tfurther", "Walk\u0007further", "Walk\u2028further", "Walk\rfurther"]) {
      const r = briefCore.safeParse({ ...BRIEF, line });
      expect(r.success, JSON.stringify(line)).toBe(false);
      expect(r.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([["line", "The campaign line must be one line, with no tabs, line breaks or control characters."]]);
    }
    // Spaces at the ends (a newline included) are trimmed, as before.
    expect(briefCore.parse({ ...BRIEF, line: `${FERNHOLLOW_LINE}\n` }).line).toBe(FERNHOLLOW_LINE);
  });

  it("D-4 #5 review fix B1: a line headline is still held to banned terms, claims and the market notes' companies added after sign-off", () => {
    const set = { headline: QUILLMOOR_LINE, body: "Set up one small pot this January.", cta: "Start saving" };
    // QUILLMOOR_LINE ("One calm step back to saving") passed at sign-off; then the kit bans "calm step" and notes a company called "Calm".
    const later = { ...rules(QUILLMOOR_LINE), bannedTerms: [...QUILLMOOR.kit.bannedTerms, "calm step"], evidenceClaims: ["back to saving"], realNames: ["Calm"] };
    expect(setProblems("paid social", set, later, { where: "the set", allowFigures: true })).toEqual([
      'the set headline uses the banned term "calm step"',
      'the set headline claims "back to saving", which needs evidence the brief does not hold',
      "the set headline names Calm, a real company from the market notes; name no other company",
    ]);
    // Length and voice are the brief's, at sign-off: a line headline isn't re-measured here.
    expect(setProblems("paid social", set, rules(QUILLMOOR_LINE), { where: "the set", allowFigures: true })).toEqual([]);
  });

  it("D-4 #5 review fix B1: the line's words aren't the brand's: a body copying a name from the line is refused", () => {
    // A line from before review fix B1 that names something; the body may not borrow the name.
    const line = "Save with Penrose";
    const set = { headline: line, body: "Penrose Bank helps you set up one small pot.", cta: "Start saving" };
    expect(setProblems("paid social", set, rules(line), { where: "the set", allowFigures: true })).toEqual([
      'the set body names "Penrose Bank", which looks like another brand; name only Quillmoor Money and its products, and write in sentence case',
    ]);
    // A call to action that quotes the line's words in a customer's voice is refused too.
    expect(setProblems("paid social", { ...set, body: "Set up one small pot this January.", cta: "Penrose says save" }, rules(line), { where: "the set", allowFigures: true }).join(" ")).toMatch(
      /the set call to action (names "Penrose"|reports what someone said)/,
    );
  });

  it("D-4 #2 review fix B1: with a campaign, the Tagline agent's check refuses figures, quantities and names other than the brand's own; the home card is unchanged", () => {
    const campaign = { campaignId: "5a0e8f3c-1b2d-4c3e-9f4a-0b1c2d3e4f5a", version: 1, title: "Further this winter", story: "A walk.", audiences: [], voice: "" };
    const input = taglineInput.parse({ brandName: "Tidewell Moments", campaign: { ...campaign, ownNames: ["Brightwater"] } });
    expect(checkTagline(input, { taglines: ["Loved by 10,000 cooks", "Half of cooks agree", "Better than Brackenfell"] })).toEqual([
      "line 1 has a figure; a campaign line can't carry one",
      'line 2 says "Half of"; a campaign line can\'t carry a quantity, in figures or in words',
      'line 3 names "Brackenfell"; a campaign line names no company but Tidewell Moments',
    ]);
    expect(checkTagline(input, { taglines: ["Cook with Brightwater", "Supper with Tidewell Moments", "Start where you are"] })).toEqual([]);
    // The home card: a brand name alone, no checks, as before.
    const home = taglineInput.parse({ brandName: "Tidewell Moments" });
    expect(checkTagline(home, { taglines: ["Loved by 10,000 cooks", "Half of cooks agree", "Better than Brackenfell"] })).toEqual([]);
  });
});
