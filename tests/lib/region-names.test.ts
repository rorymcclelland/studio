// Sprint 10b, QA finding (Japan's places): the name check (undeclaredNames)
// knew the UK's places only, so a brand whose customers are in Japan's regions
// (D-3) had "Japan", "Japanese" or "Tokyo" refused as another brand in its
// copy, and needed them declared as companies in its market notes. Each region
// set now has its ordinary words, applied by the brand's places; the UK's are
// unchanged. Hyphenated places ("Kyushu-Okinawa") are judged part by part, as
// the own words are split. Every brand name here is fictional (rule 2).
import { describe, expect, it } from "vitest";
import { marketInput, noteProblems } from "@/lib/agents/market";
import { setProblems, translationProblems, type CopyRules } from "@/lib/creative/copy-rules";
import { REGION_SETS } from "@/lib/demo/profile";
import { JAPAN_REGIONS, undeclaredNames } from "@/lib/text/names";
import { JAPAN_REGIONS as FIXTURE_JAPAN, TIDEWELL, UK_REGIONS } from "../fixtures/new-brand";

const owners = (places: readonly string[]) => ({ brandName: TIDEWELL.name, category: "", products: [], places: [...places] });

const rules = (places: readonly string[]): CopyRules => ({
  brandName: TIDEWELL.name,
  products: [],
  places: [...places],
  bannedTerms: [],
  evidenceClaims: [],
  realNames: [],
  legalLines: [],
  pool: [],
});

const set = (body: string) => ({ headline: "Supper after work", body, cta: "Watch now" });

describe("QA: Japan's places are ordinary words for a brand whose customers are there", () => {
  it("the name check's Japan regions are the simulated-data profile's", () => {
    expect([...JAPAN_REGIONS]).toEqual([...REGION_SETS.japan]);
    expect([...JAPAN_REGIONS]).toEqual([...FIXTURE_JAPAN]);
  });

  it("with Japan's regions, Japan, Japanese, its cities and its regions (Kyushu-Okinawa whole) are not names", () => {
    const text = "Cook with Japanese recipes from Tokyo, Osaka and Kyoto. Suppers in Japan, from Hokkaido to Kyushu-Okinawa, and Kobe or Sendai too.";
    expect(undeclaredNames(text, [], owners(JAPAN_REGIONS))).toEqual([]);
    // A company is still a name.
    expect(undeclaredNames("Cook with Japanese recipes from Brackenfell Foods.", [], owners(JAPAN_REGIONS))).toEqual(["Brackenfell Foods"]);
  });

  it("with Japan's regions, copy saying \"Japanese recipes\" or \"Tokyo\" passes", () => {
    expect(setProblems("paid social", set("Cook with Japanese recipes for a ten-minute supper."), rules(JAPAN_REGIONS), { where: "the set" })).toEqual([]);
    expect(setProblems("paid social", set("A Tokyo supper in ten minutes, in Kyushu-Okinawa too."), rules(JAPAN_REGIONS), { where: "the set" })).toEqual([]);
    expect(
      translationProblems("paid social", set("Cook with Japanese recipes from Tokyo kitchens."), { ...rules(JAPAN_REGIONS), lang: "fr-FR", langName: "French" }, { where: "the French set" }),
    ).toEqual([]);
  });

  it("with Japan's regions, a market note naming Japan needs no declaration", async () => {
    const PAGE = { url: "https://cooking-notes.example.test/japan", title: "Home cooking (sample page)", citedText: ["Home cooks in Japan and Tokyo look for quick suppers."] };
    const extra = { sources: [PAGE], readPage: async () => PAGE.citedText[0] };
    const note = { kind: "trend" as const, title: "Quick suppers", text: "Home cooks in Japan, Tokyo and Kyushu-Okinawa look for quick Japanese suppers.", sources: [PAGE.url], names: [] };
    const input = marketInput.parse({ brandName: TIDEWELL.name, category: "Home cooking", description: "", products: [], bannedTerms: [], places: [...JAPAN_REGIONS], month: "November 2026" });
    expect(await noteProblems(input, { notes: [note] }, extra)).toEqual([[]]);
    // With UK places, as before, Japan's words must be declared.
    const uk = marketInput.parse({ ...input, places: [...UK_REGIONS] });
    const ukProblems = (await noteProblems(uk, { notes: [note] }, extra))[0].join(" ");
    expect(ukProblems).toMatch(/names "Japan Tokyo" without declaring it/);
    expect(ukProblems).toMatch(/names "Japanese" without declaring it/);
  });

  it("with UK regions, the behaviour is unchanged: UK places pass, Japan's words are names", () => {
    expect(undeclaredNames("Walkers in Yorkshire, Wales and the Lake District buy layers.", [], owners(UK_REGIONS))).toEqual([]);
    expect(undeclaredNames("Walkers love Japanese recipes from Tokyo.", [], owners(UK_REGIONS))).toEqual(["Japanese", "Tokyo"]);
    expect(setProblems("paid social", set("Cook with Japanese recipes for a ten-minute supper."), rules(UK_REGIONS), { where: "the set" })).toEqual([
      `the set body names "Japanese", which looks like another brand; name only ${TIDEWELL.name} and its products, and write in sentence case`,
    ]);
    // No places at all (a brand with no customers): as the UK.
    expect(undeclaredNames("A supper from Tokyo.", [], owners([]))).toEqual(["Tokyo"]);
  });
});
