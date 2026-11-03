// C8-3: the rules for an uploaded ad, as pure functions, and the contrast
// measured from its pixels. The thresholds are C8-1's (src/config/compliance.ts);
// estimates are always Review, a model's findings are Review at most, and a
// model's "no" is "No issues found by AI", never "Pass" (decision 0009, Q4).
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  maskNames,
  outcomeLine,
  realNameRule,
  statusLabel,
  uploadContrastRule,
  uploadDensityRule,
  uploadDontRules,
  uploadLegalRule,
  uploadLogoRule,
  uploadOutcome,
  type Word,
} from "@/lib/compliance/upload-rules";
import { contrastRatio } from "@/lib/creative/render/colour";
import { measureBox, measureContrast, otsu } from "@/lib/uploads/contrast";
import { fixtureAd } from "../fixtures/uploaded-ads";

const w = (text: string, part: Word["part"], box = { x: 0.1, y: 0.1, width: 0.5, height: 0.05 }): Word => ({ text, part, box });
const PALETTE = [
  { name: "Moss", hex: "#3F5B3A" },
  { name: "Fog", hex: "#E8EBE4" },
  { name: "Peat", hex: "#2B2A26" },
];

describe("C8-3 upload rules", () => {
  it("contrast is measured from the pixels under the boxes: Peat on Fog is well above AA, Moss on Loch below it, always Review", async () => {
    const dark = await measureContrast(await fixtureAd(), [{ x: 0.07, y: 0.2, width: 0.62, height: 0.07 }]);
    expect(dark[0].ratio).not.toBeNull();
    // The measured pair is the fixture's own colours, give or take the edges' anti-aliasing.
    expect(dark[0].ratio!).toBeGreaterThan(contrastRatio("#2B2A26", "#E8EBE4") * 0.9);
    expect(dark[0]).toMatchObject({ index: 0 });

    const low = await measureContrast(await fixtureAd({ background: "#4F7A8C", text: "#3F5B3A" }), [{ x: 0.07, y: 0.2, width: 0.62, height: 0.07 }, { x: 0, y: 0, width: 0.0001, height: 0.0001 }]);
    expect(low[0].ratio!).toBeLessThan(2);
    expect(low[1]).toEqual({ index: 1, ratio: null });
    const words = [w("Walk the long way home", "headline"), w("x", "other")];
    const f = uploadContrastRule(words, low, PALETTE);
    expect(f).toMatchObject({ rule: "contrast", status: "review", how: "estimated" });
    expect(f.reason).toMatch(/^The lowest is about 1\.\d\d:1, for "Walk the long way home"\. One line looks below AA \(4\.5:1 for words\)\. Estimated from the pixels under the boxes the AI drew round 1 line, so a person judges it\.$/);
    expect(f.fix).toMatch(/^Use Fog behind those words \(about \d+\.\d\d:1 with them\)$/);
    // Even a pair far below AA is Review, never Fail: the boxes are an estimate.
    expect(uploadContrastRule([], [], PALETTE)).toMatchObject({ status: "na", reason: "No words were read, so there is no contrast to measure." });
  });

  it("the measurement splits a box's pixels in two by lightness and takes the smaller group as the letters", () => {
    expect(otsu([10, 10, 12, 200, 205, 210, 210])).toBeGreaterThanOrEqual(12);
    expect(otsu([10, 10, 12, 200, 205, 210, 210])).toBeLessThan(200);
    // 4 × 2 pixels: three white, then one black, per row.
    const px = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0]);
    expect(measureBox(px, 4, 2, { x: 0, y: 0, width: 1, height: 1 })).toEqual({ ratio: 21, text: "#000000", background: "#FFFFFF" });
    expect(measureBox(px, 4, 2, { x: 0, y: 0, width: 0.25, height: 0.5 })).toBeNull();
  });

  it("text density from the AI's boxes is always Review, Estimated, with where it falls; banners are not applied", () => {
    const small = uploadDensityRule([w("a", "headline", { x: 0, y: 0, width: 0.4, height: 0.2 })], "paid social");
    expect(small).toMatchObject({ status: "review", how: "estimated", fix: null, reason: "The words cover about 8% of the ad, within the 25% that passes for Studio's own ads. Estimated from the boxes the AI drew round the words, so a person judges it." });
    const mid = uploadDensityRule([w("a", "body", { x: 0, y: 0, width: 1, height: 0.3 })], "paid social");
    expect(mid).toMatchObject({ status: "review", fix: "Shorten the words" });
    expect(mid.reason).toMatch(/^The words cover about 30% of the ad, between 25% and 40%, which needs a look\./);
    // A box running off the picture counts only inside it.
    const big = uploadDensityRule([w("a", "body", { x: 0, y: 0.5, width: 1, height: 0.8 })], "paid social");
    expect(big).toMatchObject({ status: "review", fix: "Shorten the words" });
    expect(big.reason).toMatch(/^The words cover about 50% of the ad, over the 40% that fails\./);
    expect(uploadDensityRule([], "display")).toMatchObject({ status: "na", reason: "Not applied to banners: their words naturally fill them." });
  });

  it("legal lines are found across wrapped lines, ignoring case, accents and the last full stop", () => {
    const lines = ["Free returns within 30 days on unworn items.", "Prices include VAT."];
    const read = [w("FREE RETURNS WITHIN 30", "legal"), w("days on unworn items", "legal"), w("Prices include VAT", "legal")];
    expect(uploadLegalRule(read, lines, lines, "English", true)).toMatchObject({ status: "pass", how: "code" });
    expect(uploadLegalRule([w("Prix TVA incluse", "legal")], ["Prix TVA incluse."], lines, "French", false)).toMatchObject({ status: "pass" });
    expect(uploadLegalRule([], null, lines, "German", false)).toMatchObject({ status: "fail", fix: "Add the legal lines in German on the Languages page" });
    expect(uploadLegalRule([], [], [], "English", true)).toMatchObject({ status: "pass", reason: "The brand has no legal line for English, so none is needed." });
    expect(uploadLegalRule([w("Prices include VAT", "legal")], lines, lines, "English", true)).toMatchObject({
      status: "fail",
      reason: `A legal line is missing in English: "Free returns within 30 days on unworn items.".`,
      fix: `Add "Free returns within 30 days on unworn items." to the ad, as the kit writes it`,
    });
  });

  it("a real company's name fails once, and is masked in the words shown", () => {
    const words = [w("Warmer than Monzo's best", "headline")];
    expect(realNameRule(words, ["Monzo"])).toMatchObject({ name: "Real company name", status: "fail" });
    expect(realNameRule(words, [])).toMatchObject({ status: "pass", reason: "The brand's market notes name no real companies, so there were none to look for." });
    expect(maskNames("Warmer than Monzo's best, unlike monzo or Monzoland", ["Monzo"])).toBe("Warmer than [a named company]'s best, unlike [a named company] or Monzoland");
    expect(maskNames("Kit from North  Face", ["North Face"])).toBe("Kit from [a named company]");
  });

  it("the AI's no is shown as No issues found by AI, never Pass; its findings are Review at most", () => {
    expect(statusLabel({ status: "pass", how: "ai" })).toBe("No issues found by AI");
    expect(statusLabel({ status: "pass", how: "code" })).toBe("Pass");
    expect(statusLabel({ status: "review", how: "estimated" })).toBe("Review");
    expect(statusLabel({ status: "na", how: "estimated" })).toBe("Not applied");
    const size = { width: 1000, height: 1000 };
    expect(uploadLogoRule({ present: false, box: null }, [], true, size)).toMatchObject({ status: "review", how: "ai", reason: "No logo found by AI. A person checks whether the brand's logo is in the ad." });
    expect(uploadLogoRule({ present: true, box: { x: 0.01, y: 0.01, width: 0.2, height: 0.05 } }, [], true, size)).toMatchObject({ status: "review", fix: "Give the logo more clear space" });
    expect(uploadLogoRule({ present: true, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 } }, [], true, size)).toMatchObject({ status: "review", fix: null });
    expect(uploadLogoRule({ present: false, box: null }, [], false, size)).toMatchObject({ status: "na" });
    const dont = uploadDontRules(["Use fear to sell", "Use fear to sell", "Mock beginners"], [{ key: "D1", breaks: true, reason: "A storm is shown." }]);
    // Each rule once (C8-1's list), always Review, with the AI's view.
    expect(dont.map((d) => [d.status, d.fix])).toEqual([["review", "Use fear to sell"], ["review", "Mock beginners"]]);
    expect(dont[0].reason).toBe("The AI thinks the ad may break this rule: A storm is shown. A person decides.");
    expect(dont[1].reason).toBe("The AI gave no answer for this rule. A person confirms the ad keeps it.");
  });

  it("the outcome: fails on any fail, else review, else passes; the line names rules, never the ad's words", () => {
    const pass = realNameRule([], []);
    const review = uploadDensityRule([], "paid social");
    const fail = realNameRule([w("Monzo", "body")], ["Monzo"]);
    expect(uploadOutcome([pass])).toBe("passes");
    expect(uploadOutcome([pass, review])).toBe("review");
    expect(uploadOutcome([pass, review, fail])).toBe("fails");
    expect(outcomeLine([pass, review, fail])).toBe("Fails: real company name. 1 to review.");
    expect(outcomeLine([pass])).toBe("Passes.");
  });

  it("a fixture ad's re-encode keeps its pixels: contrast measured on the PNG and on a JPEG agree", async () => {
    const box = [{ x: 0.07, y: 0.2, width: 0.62, height: 0.07 }];
    const png = (await measureContrast(await fixtureAd(), box))[0].ratio!;
    const jpeg = (await measureContrast(await sharp(await fixtureAd()).jpeg({ quality: 90 }).toBuffer(), box))[0].ratio!;
    expect(Math.abs(png - jpeg)).toBeLessThan(1.5);
  });
});
