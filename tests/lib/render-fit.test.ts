// S5-3: text fitted in code by measuring with the font file's metrics.
import { describe, expect, it } from "vitest";
import { fitText, measureWidth, missingGlyphs, wrapText } from "@/lib/creative/render/fit";
import { loadOpenType } from "@/lib/creative/render/fonts";

describe("measureWidth", () => {
  it("grows with the size and the text", async () => {
    const font = await loadOpenType("Inter", 400);
    const a = measureWidth("Walk further", font, 40);
    expect(a).toBeGreaterThan(150);
    expect(a).toBeLessThan(350);
    expect(measureWidth("Walk further", font, 80)).toBeCloseTo(a * 2, 0);
    expect(measureWidth("Walk further today", font, 40)).toBeGreaterThan(a);
  });

  it("adds letter spacing per character", async () => {
    const font = await loadOpenType("Inter", 400);
    const plain = measureWidth("abc", font, 40);
    expect(measureWidth("abc", font, 40, 0.1)).toBeCloseTo(plain + 3 * 4, 5);
  });
});

describe("wrapText", () => {
  it("breaks at spaces, greedily, and keeps every word", async () => {
    const font = await loadOpenType("Inter", 400);
    const lines = wrapText("one two three four five six seven", font, 40, 260) ?? [];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("one two three four five six seven");
    for (const line of lines) expect(measureWidth(line, font, 40)).toBeLessThanOrEqual(260);
  });

  it("reports a word wider than the box as unbreakable", async () => {
    const font = await loadOpenType("Inter", 400);
    expect(wrapText("Supercalifragilistic", font, 80, 200)).toBeNull();
  });
});

describe("fitText", () => {
  it("uses the largest size that fits", async () => {
    const font = await loadOpenType("Inter", 700);
    const fit = fitText("Short line", font, [80, 64, 48], 900, 2);
    expect(fit).toMatchObject({ ok: true, size: 80, lineCount: 1, lines: ["Short line"] });
  });

  it("steps down a size when the text runs past its lines", async () => {
    const font = await loadOpenType("Inter", 700);
    const text = "Put a little aside every week without thinking";
    const big = fitText(text, font, [120], 900, 2);
    expect(big.ok).toBe(false);
    const fit = fitText(text, font, [120, 72], 900, 2);
    expect(fit).toMatchObject({ ok: true, size: 72 });
    if (fit.ok) expect(fit.lineCount).toBeLessThanOrEqual(2);
  });

  it("refuses with a reason when even the smallest size runs over", async () => {
    const font = await loadOpenType("Inter", 700);
    const fit = fitText("word ".repeat(60).trim(), font, [60, 48], 900, 2);
    expect(fit).toEqual({ ok: false, reason: "needs more than 2 lines at 48 px" });
  });

  it("refuses empty text", async () => {
    const font = await loadOpenType("Inter", 700);
    expect(fitText("   ", font, [60], 900, 2)).toEqual({ ok: false, reason: "empty" });
  });

  it("collapses runs of white space", async () => {
    const font = await loadOpenType("Inter", 700);
    const fit = fitText("  Two \n  words ", font, [60], 900, 2);
    expect(fit).toMatchObject({ ok: true, lines: ["Two words"] });
  });
});

describe("missingGlyphs", () => {
  it("passes British punctuation and currency", async () => {
    const font = await loadOpenType("Inter", 400);
    expect(missingGlyphs("£3 a month – it’s “simple” € café", font)).toEqual([]);
  });

  it("lists characters the bundled font can't draw (no network fallback)", async () => {
    const font = await loadOpenType("Source Serif 4", 400);
    expect(missingGlyphs("Save 😀 now 你好", font)).toEqual(["😀", "你", "好"]);
  });
});
