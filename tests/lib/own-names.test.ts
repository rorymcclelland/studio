// Sprint 10b, D-2 Fictional versus simulated, and a brand's own names: the
// pure parts. A brand's own names (such as its parent brand's, as Rory's
// answer A2 describes) are treated like its name by the brief, copy, translation
// and upload checks, even when the market notes name them; any other company
// the notes name is still refused (rule 2's market exception, as Rory answered
// A1 and A2 on 10 November 2026). The image-prompt model never sees the brand's
// name or its own names (rule 8 and BUG-11 unchanged). The launch pack README
// says the brand is fictional only when it is (is_fictional, not is_simulated).
// The interface is in the header of tests/e2e/new-brand.spec.ts.
import { describe, expect, it } from "vitest";
import { imageryAgent, imageryInput, promptProblems, type ImageryInput } from "@/lib/agents/imagery";
import { refusableNames } from "@/lib/brands/own-names";
import { parseBrandInput } from "@/lib/brands/schema";
import { evidenceProblems, type EvidenceItem } from "@/lib/brief/checks";
import type { BriefCore } from "@/lib/brief/schema";
import { realNameRule, type Word } from "@/lib/compliance/upload-rules";
import { setProblems, translationProblems, type CopyRules, type TranslationRules } from "@/lib/creative/copy-rules";
import { readme, type PackPlan } from "@/lib/creative/pack";
import { OTHER_COMPANY, TIDEWELL } from "../fixtures/new-brand";

const OWN = [...TIDEWELL.ownNames];
/** The market notes name the brand's parent brand and another company. */
const NOTES_NAME = ["Brightwater", OTHER_COMPANY];

const CONTEXT: EvidenceItem[] = [
  { ref: "C1", kind: "insight", title: "Weeknight cooking", text: "Home cooks look for short recipes on weeknights." },
  { ref: "C2", kind: "insight", title: "Video habits", text: "Short cooking videos are watched in the evening." },
  { ref: "C3", kind: "result", title: "Market note", text: "Brightwater and Cairnwick Outdoor both publish recipe videos." },
];

const brief = (summary: string): BriefCore => ({
  title: "Supper in ten minutes",
  summary,
  story: "A home cook films a quick supper at dusk and shares it with friends.",
  insights: [
    { text: "Home cooks look for short recipes on weeknights.", cites: ["C1"] },
    { text: "Short cooking videos are watched in the evening.", cites: ["C2"] },
    { text: "Recipe videos are a crowded space for home cooks.", cites: ["C3"] },
  ],
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach home cooks in the evening." }],
  kpi: { metric: "reach" },
});

const kit = (ownNames?: string[]) => ({ legalLines: [], bannedTerms: [], dontRules: [], evidenceClaims: [], realNames: NOTES_NAME, ...(ownNames ? { ownNames } : {}) });

const copyRules = (ownNames?: string[]): CopyRules => ({
  brandName: TIDEWELL.name,
  products: [],
  places: [],
  bannedTerms: [],
  evidenceClaims: [],
  realNames: NOTES_NAME,
  legalLines: [],
  pool: [],
  ...(ownNames ? { ownNames } : {}),
});

const translationRules = (ownNames?: string[]): TranslationRules => ({
  lang: "fr-FR",
  langName: "French",
  brandName: TIDEWELL.name,
  products: [],
  places: [],
  bannedTerms: [],
  evidenceClaims: [],
  realNames: NOTES_NAME,
  legalLines: [],
  pool: [],
  ...(ownNames ? { ownNames } : {}),
});

const named = (problems: string[], name: string) => problems.filter((p) => p.includes(name));

describe("D-2 a brand's own names", () => {
  it("D-2 #3 refusableNames() drops the brand's name and its own names from the market notes' names, ignoring case and spacing", () => {
    expect(refusableNames(NOTES_NAME, { name: TIDEWELL.name, ownNames: OWN })).toEqual([OTHER_COMPANY]);
    expect(refusableNames([" BRIGHTWATER ", "brightwater", "Tidewell Moments", OTHER_COMPANY], { name: TIDEWELL.name, ownNames: OWN })).toEqual([OTHER_COMPANY]);
    // With no own names, only the brand's own name is exempt, as today.
    expect(refusableNames(NOTES_NAME, { name: TIDEWELL.name, ownNames: [] })).toEqual(NOTES_NAME);
    // A name that only contains an own name is another company.
    expect(refusableNames(["Brightwater Foods Group"], { name: TIDEWELL.name, ownNames: OWN })).toEqual(["Brightwater Foods Group"]);
  });

  it("D-2 #3 a brief saying Brightwater passes when it is an own name; Cairnwick Outdoor from the same notes is still refused", () => {
    const own = brief("We show people who cook at home how Brightwater cooks make a quick supper.");
    expect(evidenceProblems(own, CONTEXT, kit(OWN), { objective: "Reach home cooks" })).toEqual([]);
    // Not vacuous: without the own name, the same brief is refused for naming Brightwater.
    expect(named(evidenceProblems(own, CONTEXT, kit(), { objective: "Reach home cooks" }), "Brightwater")).toHaveLength(1);
    const other = brief("Unlike Cairnwick Outdoor, we show a quick supper to people who cook at home.");
    expect(evidenceProblems(other, CONTEXT, kit(OWN), { objective: "Reach home cooks" })).toEqual([
      expect.stringMatching(/^the summary names Cairnwick Outdoor, a real company from the market notes/),
    ]);
  });

  it("D-2 #3 a headline saying Brightwater passes the copy checks; Cairnwick Outdoor is still refused", () => {
    const copy = { headline: "Cook tonight with Brightwater", body: "Short videos from Brightwater, for busy evenings.", cta: "Watch now" };
    expect(setProblems("paid social", copy, copyRules(OWN), { where: "paid social set for A1" })).toEqual([]);
    // Not vacuous: without the own name, the headline and body are refused for naming Brightwater.
    expect(named(setProblems("paid social", copy, copyRules(), { where: "paid social set for A1" }), "Brightwater").length).toBeGreaterThan(0);
    const other = { ...copy, body: "Quicker than Cairnwick Outdoor, for busy evenings." };
    expect(setProblems("paid social", other, copyRules(OWN), { where: "paid social set for A1" })).toEqual([
      expect.stringMatching(/^paid social set for A1 body names Cairnwick Outdoor, a real company from the market notes/),
    ]);
  });

  it("D-2 #3 a translation saying Brightwater passes; Cairnwick Outdoor is still refused", () => {
    const fr = { headline: "Cuisinez avec Brightwater", body: "Des vidéos courtes pour les soirs pressés.", cta: "Regarder" };
    expect(translationProblems("paid social", fr, translationRules(OWN), { where: "the French paid-social set" })).toEqual([]);
    expect(named(translationProblems("paid social", fr, translationRules(), { where: "the French paid-social set" }), "Brightwater").length).toBeGreaterThan(0);
    const other = { ...fr, body: "Plus rapide que Cairnwick Outdoor, le soir." };
    expect(named(translationProblems("paid social", other, translationRules(OWN), { where: "the French paid-social set" }), OTHER_COMPANY)).toHaveLength(1);
  });

  it("D-2 #3 an uploaded ad naming Brightwater passes the real-name rule; one naming Cairnwick Outdoor fails", () => {
    const w = (text: string, part: Word["part"]): Word => ({ text, part, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 } });
    expect(realNameRule([w("Cook tonight with Brightwater", "headline")], NOTES_NAME, OWN)).toMatchObject({ name: "Real company name", status: "pass" });
    expect(realNameRule([w("Cook tonight with Brightwater", "headline")], NOTES_NAME)).toMatchObject({ status: "fail" });
    const fail = realNameRule([w("Quicker than Cairnwick Outdoor", "headline")], NOTES_NAME, OWN);
    expect(fail).toMatchObject({ status: "fail" });
    expect(fail.reason).toContain(OTHER_COMPANY);
    expect(fail.reason).not.toContain("Brightwater");
  });

  it("D-2 #4 own names: more than 5, or an empty one, are refused with field errors, and so is a name the brand also bans", () => {
    const base = { name: TIDEWELL.name, slug: TIDEWELL.slug };
    expect(parseBrandInput({ ...base, ownNames: ["Brightwater"] })).toMatchObject({ ok: true, data: { ownNames: ["Brightwater"] } });
    expect(parseBrandInput(base)).toMatchObject({ ok: true, data: { ownNames: [] } });
    expect(parseBrandInput({ ...base, ownNames: ["One", "Two", "Three", "Four", "Five"] })).toMatchObject({ ok: true });
    expect(parseBrandInput({ ...base, ownNames: ["One", "Two", "Three", "Four", "Five", "Six"] })).toEqual({ ok: false, fieldErrors: { ownNames: "No more than 5 own names." } });
    expect(parseBrandInput({ ...base, ownNames: ["Brightwater", "  "] })).toEqual({ ok: false, fieldErrors: { "ownNames.1": "Own name can't be empty." } });
    expect(parseBrandInput({ ...base, ownNames: ["b".repeat(81)] })).toEqual({ ok: false, fieldErrors: { "ownNames.0": "Own name must be 80 characters or fewer." } });
    expect(parseBrandInput({ ...base, ownNames: ["b".repeat(80)] })).toMatchObject({ ok: true });
    expect(parseBrandInput({ ...base, bannedTerms: ["brightwater"], ownNames: ["Brightwater"] })).toEqual({
      ok: false,
      fieldErrors: { "ownNames.0": "This name is also one of the brand's banned terms." },
    });
    expect(parseBrandInput({ ...base, ownNames: ["Brightwater", "brightwater"] })).toEqual({ ok: false, fieldErrors: { "ownNames.1": "This own name is already in the list." } });
  });

  it("D-2 #5 the imagery prompt contains neither the brand's name nor its own names, and a prompt naming an own name is refused", () => {
    const input: ImageryInput = imageryInput.parse({
      brief: {
        title: "Tidewell Moments at home",
        story: "Brightwater's home cooks film a quick supper at dusk, in a warm kitchen with steam rising from a pan.",
        audiences: ["Home cooks who film their suppers for Brightwater"],
        channels: ["paid social: one warm picture with plain space for a short line"],
      },
      palette: [{ name: "Brightwater blue", hex: "#1F4E79", words: "deep blue" }],
      toneWords: ["warm", "quick"],
      doRules: ["Show real home kitchens, as Tidewell Moments does"],
      dontRules: ["Show Brightwater's packaging"],
      finance: false,
      brandName: TIDEWELL.name,
      ownNames: OWN,
      realNames: [OTHER_COMPANY],
      places: [],
    });
    const prompt = imageryAgent.buildPrompt(input);
    expect(prompt).not.toMatch(/brightwater/i);
    expect(prompt).not.toMatch(/tidewell/i);
    expect(prompt).toContain("home cooks film a quick supper at dusk");
    const p = { idea: "A pan at dusk", prompt: "A warm home kitchen at dusk, a pan of noodles steaming, deep blue tiles, the Brightwater way, plain space above.", aspect: "1:1" as const };
    expect(promptProblems(input, p, 1).join(" ")).toMatch(/prompt 1 names .*Brightwater/);
  });

  it("D-2 #2 the launch pack README says the brand is fictional only when it is fictional, not when its data is simulated", () => {
    const plan = (flags: { brandFictional: boolean; brandSimulated: boolean }): PackPlan => ({
      campaign: { id: "c", objective: "Reach home cooks", brandName: "Brightwater Kitchen", ...flags, briefTitle: "Supper in ten minutes", briefVersion: 2, signedOffAt: new Date("2026-11-10T09:00:00Z") },
      ads: [],
      items: [],
      leftOut: [],
      sources: new Map(),
    });
    const madeAt = new Date("2026-11-10T10:00:00Z");
    // A person's own brand with simulated data: no claim that it is fictional.
    const real = readme(plan({ brandFictional: false, brandSimulated: true }), [], [], madeAt);
    expect(real).toContain("Studio is a working title.");
    expect(real).not.toMatch(/fictional/i);
    // A demo brand: fictional and simulated.
    expect(readme(plan({ brandFictional: true, brandSimulated: true }), [], [], madeAt)).toContain("Studio is a working title. The brand in this pack is fictional.");
    // A person's own brand with no simulated data.
    expect(readme(plan({ brandFictional: false, brandSimulated: false }), [], [], madeAt)).not.toMatch(/fictional/i);
  });
});
