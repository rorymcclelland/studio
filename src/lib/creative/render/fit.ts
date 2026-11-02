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
    // C7-2: a soft hyphen is a break point, invisible unless a line breaks there.
    if (ch === SHY) continue;
    const glyph = font.charToGlyph(ch);
    units += glyph.advanceWidth ?? 0;
    if (prev) units += font.getKerningValue(prev, glyph) || 0;
    prev = glyph;
    chars++;
  }
  return units * scale + letterSpacingEm * size * chars;
}

/** C7-2: the soft hyphen (U+00AD). The Localise agent may mark break points in long words (German compounds) with it. */
export const SHY = "\u00AD";

/** Text as drawn when no line breaks inside a word: soft hyphens removed. */
export function visibleText(text: string): string {
  return (text ?? "").split(SHY).join("");
}

/**
 * The longest start of a word, up to a soft hyphen, that fits in `room` with
 * a visible hyphen after it; null if none does.
 */
function hyphenatedStart(word: string, font: Font, size: number, room: number, ls: number): { head: string; rest: string } | null {
  const parts = word.split(SHY);
  for (let n = parts.length - 1; n >= 1; n--) {
    const head = `${parts.slice(0, n).join("")}-`;
    if (measureWidth(head, font, size, ls) <= room) return { head, rest: parts.slice(n).join(SHY) };
  }
  return null;
}

/**
 * Greedy word wrap at spaces into lines no wider than maxWidth. Returns null if
 * a single word is wider than the box (it would have to be broken mid-word).
 *
 * C7-2: a word with soft hyphens that is wider than the box is broken at
 * them, with a visible hyphen at the end of the line (still null if a piece
 * is too wide). With `eager`, a word that doesn't fit the rest of a line is
 * broken at a soft hyphen there, as a browser does, rather than moved whole to
 * the next line. Text without soft hyphens wraps exactly as before.
 */
export function wrapText(text: string, font: Font, size: number, maxWidth: number, letterSpacingEm = 0, opts: { eager?: boolean } = {}): string[] | null {
  const words = normaliseText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const width = (s: string) => measureWidth(s, font, size, letterSpacingEm);
  for (const original of words) {
    let word = original;
    for (;;) {
      const shown = visibleText(word);
      const candidate = line ? `${line} ${shown}` : shown;
      if (width(candidate) <= maxWidth) {
        line = candidate;
        break;
      }
      const hasShy = word.includes(SHY);
      // Eager: fill the rest of this line with the word's start.
      if (hasShy && opts.eager && line) {
        const split = hyphenatedStart(word, font, size, maxWidth - width(`${line} `), letterSpacingEm);
        if (split) {
          lines.push(`${line} ${split.head}`);
          line = "";
          word = split.rest;
          continue;
        }
      }
      if (width(shown) <= maxWidth) {
        // The whole word fits a line of its own.
        lines.push(line);
        line = shown;
        break;
      }
      if (!hasShy) return null;
      // Wider than the box: break it at its soft hyphens, from a fresh line.
      if (line) {
        lines.push(line);
        line = "";
      }
      const split = hyphenatedStart(word, font, size, maxWidth, letterSpacingEm);
      if (!split) return null;
      lines.push(split.head);
      word = split.rest;
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
  const hyphens = clean.includes(SHY);
  for (const size of sizes) {
    let lines = wrapText(clean, font, size, maxWidth, letterSpacingEm);
    // C7-2: soft hyphens may save a line at this size before a smaller size is tried.
    if (hyphens && (!lines || lines.length > maxLines)) lines = wrapText(clean, font, size, maxWidth, letterSpacingEm, { eager: true });
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
    if (/\s/.test(ch) || ch === SHY || missing.includes(ch)) continue;
    if (font.charToGlyphIndex(ch) === 0) missing.push(ch);
  }
  return missing;
}
