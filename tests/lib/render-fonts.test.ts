// S5-3 and Q7: bundled open fonts, each brand font mapped to its nearest.
import { describe, expect, it } from "vitest";
import { BUNDLED_FONT_FILES, loadFontData, loadOpenType, mapBrandFont } from "@/lib/creative/render/fonts";

describe("mapBrandFont", () => {
  it("maps Georgia to Source Serif 4 and says so", () => {
    expect(mapBrandFont("Georgia")).toEqual({
      requested: "Georgia",
      family: "Source Serif 4",
      exact: false,
      note: "drawn with Source Serif 4, the nearest open font to Georgia",
    });
  });

  it("maps other serif names to Source Serif 4", () => {
    for (const name of ["Times New Roman", "Garamond", "EB Garamond", "Baskerville", "Playfair Display", "Merriweather", "serif"]) {
      expect(mapBrandFont(name).family).toBe("Source Serif 4");
    }
  });

  it("maps Helvetica, Arial and sans names to Inter", () => {
    expect(mapBrandFont("Helvetica")).toEqual({
      requested: "Helvetica",
      family: "Inter",
      exact: false,
      note: "drawn with Inter, the nearest open font to Helvetica",
    });
    for (const name of ["Arial", "Helvetica Neue", "Open Sans", "sans-serif", "Roboto"]) {
      expect(mapBrandFont(name).family).toBe("Inter");
    }
  });

  it("says when the brand font is bundled exactly", () => {
    expect(mapBrandFont("Inter")).toEqual({
      requested: "Inter",
      family: "Inter",
      exact: true,
      note: "drawn with Inter, the brand font",
    });
    expect(mapBrandFont("source serif 4")).toMatchObject({ family: "Source Serif 4", exact: true });
  });

  it("falls back to Inter for unknown names, and says there was no close match", () => {
    expect(mapBrandFont("Zorblax Display")).toEqual({
      requested: "Zorblax Display",
      family: "Inter",
      exact: false,
      note: "drawn with Inter: no bundled open font is close to Zorblax Display",
    });
    expect(mapBrandFont("")).toMatchObject({ family: "Inter", note: "drawn with Inter: the kit names no font" });
  });

  it("reads the first name of a CSS font stack", () => {
    expect(mapBrandFont("Georgia, 'Times New Roman', serif").requested).toBe("Georgia");
  });
});

describe("bundled font files", () => {
  it("loads every bundled weight as woff, from a stable path", async () => {
    for (const [family, weights] of Object.entries(BUNDLED_FONT_FILES)) {
      for (const weight of Object.keys(weights)) {
        const data = await loadFontData(family as "Inter", Number(weight) as 400);
        expect(data.subarray(0, 4).toString("latin1")).toBe("wOFF");
      }
    }
  });

  it("caches the parsed font", async () => {
    const a = await loadOpenType("Inter", 700);
    const b = await loadOpenType("Inter", 700);
    expect(a).toBe(b);
    expect(a.unitsPerEm).toBeGreaterThan(0);
  });
});
