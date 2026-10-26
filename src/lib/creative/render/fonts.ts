import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, type Font } from "opentype.js";

// Bundled open fonts (SIL OFL) for ads composed in code (S5-3, Q7). Each brand
// font is drawn with the nearest bundled family, and the mapping is shown.
//
// The files are read from node_modules at runtime on the Node runtime. They
// reach the Vercel bundle through `outputFileTracingIncludes` in next.config.ts
// (a computed path is not traced on its own). Satori takes ttf, otf or woff,
// not woff2, so the woff files are used.

export type BundledFamily = "Inter" | "Source Serif 4";
export type FontWeight = 400 | 600 | 700;

/** Files under node_modules, by family and weight (Latin subset). */
export const BUNDLED_FONT_FILES: Record<BundledFamily, Record<FontWeight, string>> = {
  Inter: {
    400: "@fontsource/inter/files/inter-latin-400-normal.woff",
    600: "@fontsource/inter/files/inter-latin-600-normal.woff",
    700: "@fontsource/inter/files/inter-latin-700-normal.woff",
  },
  "Source Serif 4": {
    400: "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff",
    600: "@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff",
    700: "@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff",
  },
};

export const BUNDLED_FAMILIES = Object.keys(BUNDLED_FONT_FILES) as BundledFamily[];

const dataCache = new Map<string, Promise<Buffer>>();
const fontCache = new Map<string, Promise<Font>>();

/** The raw woff bytes for a bundled family and weight, read once and cached. */
export function loadFontData(family: BundledFamily, weight: FontWeight): Promise<Buffer> {
  const file = BUNDLED_FONT_FILES[family]?.[weight];
  if (!file) return Promise.reject(new Error(`no bundled font for ${family} ${weight}`));
  let data = dataCache.get(file);
  if (!data) {
    data = readFile(path.join(process.cwd(), "node_modules", file));
    data.catch(() => dataCache.delete(file));
    dataCache.set(file, data);
  }
  return data;
}

/** The parsed font (for measuring and outlining), parsed once and cached. */
export function loadOpenType(family: BundledFamily, weight: FontWeight): Promise<Font> {
  const key = `${family}:${weight}`;
  let font = fontCache.get(key);
  if (!font) {
    font = loadFontData(family, weight).then((buf) =>
      parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer),
    );
    font.catch(() => fontCache.delete(key));
    fontCache.set(key, font);
  }
  return font;
}

/** Every bundled weight of the given families, in the shape `ImageResponse` takes. */
export async function imageResponseFonts(families: BundledFamily[]) {
  const unique = [...new Set(families)];
  const weights: FontWeight[] = [400, 600, 700];
  return Promise.all(
    unique.flatMap((name) =>
      weights.map(async (weight) => {
        const buf = await loadFontData(name, weight);
        const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        return { name, data, weight, style: "normal" as const };
      }),
    ),
  );
}

/** Nearest bundled weight for a CSS or SVG font-weight value. */
export function nearestWeight(weight: string | number | undefined): FontWeight {
  if (weight === undefined || weight === "" || weight === "normal") return 400;
  if (weight === "bold" || weight === "bolder") return 700;
  const n = Number(weight);
  if (!Number.isFinite(n)) return 400;
  if (n >= 650) return 700;
  if (n >= 550) return 600;
  return 400;
}

export type FontMatch = {
  /** The brand font as the kit names it (first name of a stack). */
  requested: string;
  family: BundledFamily;
  exact: boolean;
  /** Shown on the brand page, e.g. "drawn with Source Serif 4, the nearest open font to Georgia". */
  note: string;
};

// Lower-case fragments that mark a serif face. Checked after sans markers, since
// "sans-serif" contains "serif".
const SERIF_HINTS = [
  "serif", "georgia", "times", "garamond", "baskerville", "caslon", "didot", "bodoni", "palatino",
  "cambria", "merriweather", "playfair", "lora", "minion", "book antiqua", "charter", "crimson",
  "libre", "tiempos", "freight", "chronicle", "sabon", "bembo", "plantin", "century", "cormorant",
  "spectral", "domine", "noto serif", "pt serif", "roboto slab", "rockwell", "clarendon", "slab",
  "goudy", "jenson", "perpetua", "hoefler", "iowan", "constantia", "warnock", "utopia", "newsreader",
];
const SANS_HINTS = [
  "sans", "helvetica", "arial", "inter", "roboto", "open sans", "lato", "montserrat", "futura",
  "avenir", "gill", "frutiger", "univers", "verdana", "tahoma", "segoe", "calibri", "proxima",
  "gotham", "poppins", "nunito", "source sans", "ibm plex sans", "work sans", "dm sans", "figtree",
  "manrope", "system-ui", "grotesk", "grotesque", "neue haas", "akzidenz", "franklin", "trebuchet",
  "circular", "graphik", "sf pro", "san francisco", "geist", "raleway", "ubuntu", "fira sans", "noto sans",
];

function firstName(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "").trim();
}

/** Maps a brand font name to the nearest bundled open family, with a human note. */
export function mapBrandFont(name: string): FontMatch {
  const requested = firstName(name ?? "");
  const key = requested.toLowerCase().replace(/\s+/g, " ");
  if (!key) return { requested, family: "Inter", exact: false, note: "drawn with Inter: the kit names no font" };

  const exact = BUNDLED_FAMILIES.find((f) => f.toLowerCase() === key);
  if (exact) return { requested, family: exact, exact: true, note: `drawn with ${exact}, the brand font` };

  const nearest = (family: BundledFamily): FontMatch => ({
    requested,
    family,
    exact: false,
    note: `drawn with ${family}, the nearest open font to ${requested}`,
  });

  // Sans first ("sans-serif", "Noto Sans"), then serif names.
  if (SANS_HINTS.some((h) => key.includes(h)) && !/\bslab\b/.test(key)) return nearest("Inter");
  if (SERIF_HINTS.some((h) => key.includes(h))) return nearest("Source Serif 4");
  return {
    requested,
    family: "Inter",
    exact: false,
    note: `drawn with Inter: no bundled open font is close to ${requested}`,
  };
}
