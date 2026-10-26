// Colour in code for ads (S5-3): WCAG contrast, text and panel pairs from the
// brand palette, and plain colour words for image prompts.

export type PaletteColour = { name: string; hex: string };

/** WCAG AA for body and legal text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text (the headline, over 24 px) and for a button's edge against its panel. */
export const AA_LARGE = 3;

/** What a fallback pair aims for (WCAG AAA) before settling for AA. */
export const FALLBACK_TARGET = 7;

export const NEAR_BLACK = "#111111";
export const WHITE = "#FFFFFF";

type Rgb = { r: number; g: number; b: number };

/** Parses #rgb or #rrggbb (case-insensitive); null if it is anything else. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function rgbOf(hex: string): Rgb {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`not a colour: ${JSON.stringify(hex)}`);
  return rgb;
}

/** Upper-case #RRGGBB. */
export function normaliseHex(hex: string): string {
  const { r, g, b } = rgbOf(hex);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** The colour with an alpha, as rgba() for CSS. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = rgbOf(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio, 1 to 21 (unrounded). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Rounded down to two places, so a recorded ratio never overstates the real one. */
export function recordRatio(ratio: number): number {
  return Math.floor(ratio * 100 + 1e-9) / 100;
}

/** Mixes a colour toward another by t (0 keeps it, 1 is the other). */
export function mix(hex: string, toward: string, t: number): string {
  const a = rgbOf(hex);
  const b = rgbOf(toward);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return normaliseHex(
    "#" + [m(a.r, b.r), m(a.g, b.g), m(a.b, b.b)].map((v) => v.toString(16).padStart(2, "0")).join(""),
  );
}

export type TextPair = {
  panel: string;
  panelName: string;
  text: string;
  textName: string;
  source: "palette" | "fallback";
  /** Recorded ratios (rounded down). The headline uses the same text colour, so it shares the ratio. */
  ratios: { body: number; headline: number };
  note: string;
};

export type TextPairFailure = { failure: string };

function validPalette(palette: PaletteColour[]): PaletteColour[] {
  return palette.filter((c) => parseHex(c.hex)).map((c) => ({ name: c.name, hex: normaliseHex(c.hex) }));
}

function toneMatches(hex: string, prefer?: "dark" | "light"): boolean {
  if (!prefer) return true;
  const l = relativeLuminance(hex);
  return prefer === "dark" ? l < 0.18 : l > 0.7;
}

function pairOf(panel: PaletteColour, text: PaletteColour, source: TextPair["source"], note: string): TextPair {
  const ratio = recordRatio(contrastRatio(panel.hex, text.hex));
  return {
    panel: panel.hex,
    panelName: panel.name,
    text: text.hex,
    textName: text.name,
    source,
    ratios: { body: ratio, headline: ratio },
    note,
  };
}

/**
 * Chooses the panel (or scrim) colour and the text colour from the brand palette
 * so body and legal text reach AA (4.5:1); the headline then passes its 3:1 too.
 *
 * Order: (1) a palette panel (in palette order, the preferred tone first) with
 * the palette text colour of highest contrast; then fallbacks, which aim for 7:1:
 * (2) a palette panel with near-black #111 or white; (3) a palette colour
 * darkened or lightened into a scrim for white or #111. If nothing reaches AA,
 * a failure says so.
 */
export function pickTextPair(
  palette: PaletteColour[],
  background?: string,
  opts: { prefer?: "dark" | "light" } = {},
): TextPair | TextPairFailure {
  const colours = validPalette(palette);
  if (palette.length === 0) return { failure: "no text colour reaches AA contrast: the palette is empty" };
  if (colours.length === 0) return { failure: "no text colour reaches AA contrast: the palette has no valid colours" };

  let panels: PaletteColour[];
  if (background !== undefined) {
    if (!parseHex(background)) return { failure: `no text colour reaches AA contrast: ${background} is not a colour` };
    const hex = normaliseHex(background);
    panels = [colours.find((c) => c.hex === hex) ?? { name: hex, hex }];
  } else {
    panels = [...colours.filter((c) => toneMatches(c.hex, opts.prefer)), ...colours.filter((c) => !toneMatches(c.hex, opts.prefer))];
  }

  // 1. A pair from the palette.
  for (const panel of panels) {
    const best = colours
      .filter((t) => t.hex !== panel.hex)
      .map((t) => ({ t, ratio: contrastRatio(panel.hex, t.hex) }))
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (best && best.ratio >= AA_TEXT) {
      return pairOf(panel, best.t, "palette", `${best.t.name} on ${panel.name}`);
    }
  }

  // Fallbacks draw on colours the brand did not pair, so they aim for 7:1 (AAA)
  // where they can, and settle for AA only if nothing stronger can be made.
  const fallbacks = [
    { name: "white", hex: WHITE },
    { name: "near-black", hex: NEAR_BLACK },
  ];

  // 2. A palette panel with near-black or white text.
  let marginal: TextPair | null = null;
  for (const panel of panels) {
    const best = fallbacks
      .map((t) => ({ t, ratio: contrastRatio(panel.hex, t.hex) }))
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (best.ratio < AA_TEXT) continue;
    const pair = pairOf(panel, best.t, "fallback", `no palette pair reaches AA; ${best.t.name} text on ${panel.name}`);
    if (best.ratio >= FALLBACK_TARGET) return pair;
    marginal ??= pair;
  }

  // 3. A palette scrim, darkened for white text or lightened for #111.
  const base = panels[0];
  const towardDark = relativeLuminance(base.hex) < 0.18 || opts.prefer !== "light";
  const order = towardDark ? (["dark", "light"] as const) : (["light", "dark"] as const);
  const scrim = (target: number): TextPair | null => {
    for (const way of order) {
      const text = way === "dark" ? fallbacks[0] : fallbacks[1];
      for (let step = 1; step <= 10; step++) {
        const hex = mix(base.hex, way === "dark" ? "#000000" : "#FFFFFF", step / 10);
        if (contrastRatio(hex, text.hex) >= target) {
          const scrimName = `${way === "dark" ? "darkened" : "lightened"} ${base.name}`;
          return pairOf({ name: scrimName, hex }, text, "fallback", `no palette pair reaches AA; ${text.name} text on a ${scrimName} scrim`);
        }
      }
    }
    return null;
  };
  const found = scrim(FALLBACK_TARGET) ?? marginal ?? scrim(AA_TEXT);
  if (found) return found;
  return { failure: "no text colour reaches AA contrast with the palette" };
}

export type ButtonColours = {
  fill: string;
  fillName: string;
  text: string;
  /** Recorded contrast of the button's words on its fill (AA 4.5:1). */
  ratio: number;
  /** Recorded contrast of the fill against the panel (WCAG non-text contrast 3:1). */
  edge: number;
};

/**
 * The call-to-action button: the first palette colour (in palette order) that
 * stands out from the panel by 3:1 and carries palette words (else white or
 * #111) at 4.5:1. If none does, the text pair is inverted (the text colour as the fill),
 * which passes by construction.
 */
export function pickButton(palette: PaletteColour[], pair: TextPair): ButtonColours {
  const colours = validPalette(palette);
  const fallbackWords = [{ name: "white", hex: WHITE }, { name: "near-black", hex: NEAR_BLACK }];
  for (const fill of colours) {
    if (fill.hex === pair.panel || fill.hex === pair.text) continue;
    const edge = contrastRatio(fill.hex, pair.panel);
    if (edge < AA_LARGE) continue;
    // Brand-coloured words first, then white or #111.
    const rank = (list: PaletteColour[]) =>
      list
        .filter((w) => w.hex !== fill.hex)
        .map((w) => ({ w, ratio: contrastRatio(fill.hex, w.hex) }))
        .filter((x) => x.ratio >= AA_TEXT)
        .sort((a, b) => b.ratio - a.ratio)[0];
    const best = rank(colours) ?? rank(fallbackWords);
    if (best) {
      return { fill: fill.hex, fillName: fill.name, text: best.w.hex, ratio: recordRatio(best.ratio), edge: recordRatio(edge) };
    }
  }
  // Inverted: the text colour as the fill, with the strongest of the panel colour,
  // white or #111 for its words (the panel colour passes by construction).
  const edge = recordRatio(contrastRatio(pair.text, pair.panel));
  // The brand's panel colour is kept unless white or #111 is clearly stronger (by 3 or more).
  const brand = { hex: pair.panel, ratio: contrastRatio(pair.text, pair.panel) };
  const strongest = [WHITE, NEAR_BLACK]
    .map((hex) => ({ hex, ratio: contrastRatio(pair.text, hex) }))
    .sort((a, b) => b.ratio - a.ratio)[0];
  const choice = strongest.ratio - brand.ratio >= 3 ? strongest : brand;
  return { fill: pair.text, fillName: pair.textName, text: choice.hex, ratio: recordRatio(choice.ratio), edge };
}

/** The palette colour to sit a logo on: the lightest, if it is light enough, else white. */
export function logoPlate(palette: PaletteColour[]): string {
  const lightest = validPalette(palette).sort((a, b) => relativeLuminance(b.hex) - relativeLuminance(a.hex))[0];
  return lightest && relativeLuminance(lightest.hex) > 0.7 ? lightest.hex : WHITE;
}

// Hue families: [upper bound in degrees, vivid words, muted words]. Each word list is
// by lightness: dark, deep, mid, light.
type Words = [string, string, string, string];
const HUES: [number, string, Words, Words][] = [
  [15, "red", ["deep wine red", "crimson red", "bright red", "coral pink"], ["dark maroon", "brick red", "dusty rose", "pale blush pink"]],
  [38, "orange", ["dark chestnut brown", "rust orange", "burnt orange", "soft peach"], ["dark brown", "warm brown", "terracotta", "pale apricot"]],
  [65, "yellow", ["dark olive", "olive gold", "golden yellow", "pale butter yellow"], ["dark olive brown", "khaki", "muted mustard", "warm sand"]],
  [160, "green", ["deep forest green", "forest green", "leaf green", "mint green"], ["dark moss green", "moss green", "sage green", "pale sage"]],
  [195, "teal", ["deep teal", "dark teal", "teal", "aqua"], ["dark slate teal", "slate teal", "dusty teal", "pale seafoam"]],
  [250, "blue", ["navy blue", "deep blue", "cobalt blue", "sky blue"], ["dark slate blue", "slate blue", "steel blue", "pale powder blue"]],
  [290, "purple", ["deep aubergine", "deep purple", "violet", "lavender"], ["dark plum", "plum", "dusty mauve", "pale lilac"]],
  [345, "pink", ["deep magenta", "raspberry", "hot pink", "soft pink"], ["dark mulberry", "mulberry", "dusty pink", "pale rose"]],
  [361, "red", ["deep wine red", "crimson red", "bright red", "coral pink"], ["dark maroon", "brick red", "dusty rose", "pale blush pink"]],
];

/**
 * Plain hue words for a colour ("navy blue", "warm sand", "deep forest green"),
 * for image prompts, which should describe colours rather than quote hex codes.
 */
export function hexToColourWords(hex: string): string {
  const { r, g, b } = rgbOf(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const lightness = (max + min) / 2;
  const saturation = max === 0 ? 0 : d / max; // HSV saturation: steadier for light tints than HSL's

  if (saturation < 0.1 || d < 0.04) {
    if (lightness < 0.12) return "near-black";
    if (lightness < 0.3) return "charcoal grey";
    if (lightness < 0.62) return "mid grey";
    if (lightness < 0.88) return "light grey";
    if (lightness < 0.985) return "off-white";
    return "white";
  }
  if (lightness < 0.06) return "near-black";
  if (lightness > 0.97) return "off-white";

  let hue: number;
  if (max === R) hue = 60 * (((G - B) / d) % 6);
  else if (max === G) hue = 60 * ((B - R) / d + 2);
  else hue = 60 * ((R - G) / d + 4);
  if (hue < 0) hue += 360;

  const family = HUES.find(([upper]) => hue < upper) ?? HUES[0];
  const words = saturation >= 0.45 ? family[2] : family[3];
  const tier = lightness < 0.23 ? 0 : lightness < 0.38 ? 1 : lightness < 0.7 ? 2 : 3;
  return words[tier];
}
