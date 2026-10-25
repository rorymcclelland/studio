// S2-2 test cases 5 and 6: brand validation and SVG sanitising.
import { describe, expect, it } from "vitest";
import { parseBrandInput } from "@/lib/brands/schema";
import { sanitizeLogoSvg, LogoError } from "@/lib/brands/svg";

const valid = {
  name: "Fernhollow Outfitters",
  slug: "fernhollow",
  description: "Outdoor clothing for people who walk far.",
  category: "Outdoor apparel",
  toneWords: ["warm", "plain-spoken"],
  voiceNotes: "Short sentences. No exclamation marks.",
  doRules: ["Name the landscape"],
  dontRules: ["Promise survival"],
  palette: [{ name: "Moss", hex: "#3F5B3A" }],
  fontPrimary: "Figtree",
  fontSecondary: "",
  legalLines: [],
  bannedTerms: ["waterproof forever"],
  evidenceClaims: ["warmest"],
};

describe("brand input validation", () => {
  it("accepts a complete, valid brand", () => {
    const r = parseBrandInput(valid);
    expect(r.ok).toBe(true);
  });

  it("S2-2 #5: refuses a bad hex colour with a field-level message", () => {
    const r = parseBrandInput({ ...valid, palette: [{ name: "Moss", hex: "green" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors)).toContain("palette.0.hex");
  });

  it("S2-2 #5: refuses 13 colours", () => {
    const palette = Array.from({ length: 13 }, (_, i) => ({ name: `C${i}`, hex: "#112233" }));
    const r = parseBrandInput({ ...valid, palette });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors)).toContain("palette");
  });

  it("S2-2 #5: refuses a 5,000-character rule", () => {
    const r = parseBrandInput({ ...valid, dontRules: ["x".repeat(5000)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors)).toContain("dontRules.0");
  });

  it("refuses more than 20 rules and an empty name", () => {
    const r = parseBrandInput({ ...valid, name: " ", doRules: Array.from({ length: 21 }, () => "rule") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors)).toEqual(expect.arrayContaining(["name", "doRules"]));
  });

  it("refuses a slug with spaces or capitals", () => {
    const r = parseBrandInput({ ...valid, slug: "Fern Hollow" });
    expect(r.ok).toBe(false);
  });
});

describe("logo SVG sanitising", () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><text x="0" y="15" fill="#3F5B3A">Fernhollow</text></svg>';

  it("keeps a plain SVG logo, including case-sensitive attributes", () => {
    const out = sanitizeLogoSvg(ok);
    expect(out).toContain("viewBox=\"0 0 100 20\"");
    expect(out).toContain("Fernhollow");
  });

  it("S2-2 #6: strips scripts, event handlers, external references and foreignObject", () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10">' +
      "<script>alert(2)</script>" +
      '<image xlink:href="http://evil.example/x.png" />' +
      '<a href="javascript:alert(3)"><rect width="10" height="10" onclick="alert(4)" /></a>' +
      '<use href="http://evil.example/sprite.svg#x" />' +
      "<foreignObject><div>hi</div></foreignObject>" +
      '<rect width="5" height="5" style="fill:url(http://evil.example/p)" />' +
      "</svg>";
    const out = sanitizeLogoSvg(hostile);
    expect(out).not.toMatch(/script|onload|onclick|alert|evil\.example|foreignObject|javascript|<image|<use|style=/i);
    expect(out).toContain("<rect");
  });

  it("keeps only the SVG namespace in xmlns", () => {
    const out = sanitizeLogoSvg('<svg xmlns="http://evil.example/ns" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
    expect(out).not.toContain("evil.example");
  });

  it("S2-2 #6: refuses something that is not SVG", () => {
    expect(() => sanitizeLogoSvg("<p>hello</p>")).toThrow(LogoError);
    expect(() => sanitizeLogoSvg("not markup at all")).toThrow(LogoError);
  });

  it("refuses an oversized logo", () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${"<rect/>".repeat(20000)}</svg>`;
    expect(() => sanitizeLogoSvg(big)).toThrow(LogoError);
  });
});
