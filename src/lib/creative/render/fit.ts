import type { Font } from "opentype.js";

// Text fitted in code (S5-3): measured with the font file's own metrics, so the
// line breaks chosen here are the ones drawn (layouts draw each line as its own
// unwrapped row rather than leaving the wrapping to Satori).

/** Collapses runs of white space and trims. */
export function normaliseText(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Width in px of one line at a size, with pair kerning and letter spacing (in em).
 * Glyph by glyph (cmap, advance, kerning) rather than opentype.js's shaper, which
 * throws on some GSUB lookups in these fonts. Satori's own shaping can differ by
 * a few pixels a line; lines are drawn unwrapped, and the margins and button
 * padding absorb the difference.
 */
export function measureWidth(text: string, font: Font, size: number, letterSpacingEm = 0): number {
  const scale = size / font.unitsPerEm;
  let units = 0;
  let prev: ReturnType<Font["charToGlyph"]> | null = null;
  let chars = 0;
  for (const ch of Array.from(text)) {
    const glyph = font.charToGlyph(ch);
    units += glyph.advanceWidth ?? 0;
    if (prev) units += font.getKerningValue(prev, glyph) || 0;
    prev = glyph;
    chars++;
  }
  return units * scale + letterSpacingEm * size * chars;
}

/**
 * Greedy word wrap at spaces into lines no wider than maxWidth. Returns null if
 * a single word is wider than the box (it would have to be broken mid-word).
 */
export function wrapText(text: string, font: Font, size: number, maxWidth: number, letterSpacingEm = 0): string[] | null {
  const words = normaliseText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (measureWidth(word, font, size, letterSpacingEm) > maxWidth) return null;
    const candidate = line ? `${line} ${word}` : word;
    if (measureWidth(candidate, font, size, letterSpacingEm) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type FitResult =
  | { ok: true; size: number; lines: string[]; lineCount: number; widths: number[] }
  | { ok: false; reason: string };

/**
 * Tries each size in order (largest first) and returns the first at which the
 * text wraps into at most maxLines lines of at most maxWidth, or a refusal.
 */
export function fitText(
  text: string,
  font: Font,
  sizes: number[],
  maxWidth: number,
  maxLines: number,
  letterSpacingEm = 0,
): FitResult {
  const clean = normaliseText(text);
  if (!clean) return { ok: false, reason: "empty" };
  if (sizes.length === 0) return { ok: false, reason: "no sizes to try" };
  for (const size of sizes) {
    const lines = wrapText(clean, font, size, maxWidth, letterSpacingEm);
    if (lines && lines.length <= maxLines) {
      return {
        ok: true,
        size,
        lines,
        lineCount: lines.length,
        widths: lines.map((l) => measureWidth(l, font, size, letterSpacingEm)),
      };
    }
  }
  return { ok: false, reason: `needs more than ${maxLines} ${maxLines === 1 ? "line" : "lines"} at ${sizes[sizes.length - 1]} px` };
}

/**
 * Characters the font has no glyph for, in order of first use. Satori would
 * otherwise fetch a fallback font or emoji over the network at render time.
 */
export function missingGlyphs(text: string, font: Font): string[] {
  const missing: string[] = [];
  for (const ch of Array.from(text ?? "")) {
    if (/\s/.test(ch) || missing.includes(ch)) continue;
    if (font.charToGlyphIndex(ch) === 0) missing.push(ch);
  }
  return missing;
}
