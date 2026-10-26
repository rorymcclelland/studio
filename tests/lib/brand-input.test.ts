// S2-2 test cases 5 and 6: brand validation and SVG sanitising.
import { describe, expect, it } from "vitest";
import { parseBrandInput } from "@/lib/brands/schema";
import { checkUploadedSvg, sanitizeLogoSvg, LogoError } from "@/lib/brands/svg";

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

describe("F-10 logo upload checks", () => {
  const base = (inner: string, attrs = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"') => `<svg ${attrs}>${inner}</svg>`;

  it("#1 an id or label containing https or data: is accepted and kept", () => {
    const out = checkUploadedSvg(base('<rect id="https-badge" width="5" height="5"/>', 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-label="data: chart"'));
    expect(out).toContain('id="https-badge"');
    expect(out).toContain('aria-label="data: chart"');
  });

  it("#2 a linked picture or an outside url() is refused with a reason", () => {
    expect(() => checkUploadedSvg(base('<image href="https://x.example/a.png"/>'))).toThrow(/embedded or linked picture/);
    expect(() => checkUploadedSvg(base('<rect style="background:url(http://x.example/p)"/>'))).toThrow(/outside file/);
    expect(() => checkUploadedSvg(base('<rect fill="url(https://x.example/#g)"/>'))).toThrow(/outside file/);
    expect(checkUploadedSvg(base('<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/>'))).toContain('fill="url(#g)"');
  });

  it("#3 an SVG without xmlns is stored with it", () => {
    expect(checkUploadedSvg('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(sanitizeLogoSvg('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("#5 scripts, handlers and HTML are refused, and an oversized SVG", () => {
    expect(() => checkUploadedSvg(base("<script>alert(1)</script>"))).toThrow(/script/);
    expect(() => checkUploadedSvg(base("", 'xmlns="http://www.w3.org/2000/svg" onload="alert(1)"'))).toThrow(/event handler/);
    expect(() => checkUploadedSvg(base("<foreignObject><p>x</p></foreignObject>"))).toThrow(/HTML/);
    expect(() => checkUploadedSvg(base('<use href="other.svg#x"/>'))).toThrow(/links to another file/);
    expect(() => checkUploadedSvg(base(`<desc>${"x".repeat(200_001)}</desc>`))).toThrow(/too large/);
    expect(() => checkUploadedSvg("<p>not svg</p>")).toThrow(LogoError);
  });
});
