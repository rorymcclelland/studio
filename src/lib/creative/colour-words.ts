// S5-1: a palette colour in plain words ("deep navy blue"), made in code from
// its hex, so an image prompt can name the brand's colours without hex codes
// or the kit's own colour names (which may be brand words).

type Hsl = { h: number; s: number; l: number; r: number; b: number };

function hsl(hex: string): Hsl {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  const d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (510 - max - min) : d / (max + min);
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s, l, r, b };
}

function neutral({ l, r, b }: Hsl): string {
  if (l < 0.12) return "near black";
  if (l < 0.3) return "charcoal grey";
  if (l < 0.6) return "mid grey";
  if (l < 0.85) return "light grey";
  if (l < 0.97) return r > b + 3 ? "warm off-white" : b > r + 3 ? "cool off-white" : "off-white";
  return "white";
}

function hueName(h: number, l: number, s: number): string {
  if (h < 12 || h >= 345) return l < 0.3 ? "burgundy red" : "red";
  if (h < 40) return l < 0.35 ? "rust brown" : s < 0.6 && l < 0.55 ? "burnt orange" : "orange";
  if (h < 52) return "golden yellow";
  if (h < 68) return "yellow";
  if (h < 95) return l < 0.4 ? "olive green" : "lime green";
  if (h < 160) return "green";
  if (h < 190) return "teal";
  if (h < 205) return "petrol blue";
  if (h < 245) return l < 0.22 ? "navy blue" : "blue";
  if (h < 275) return "indigo";
  if (h < 310) return "purple";
  return l < 0.35 ? "plum" : "pink";
}

/** Plain colour words for a hex colour, e.g. "#1F4E79" is "deep blue" and "#F7F5F0" is "warm off-white". */
export function colourWords(hex: string): string {
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) return "neutral";
  const c = hsl(hex);
  // Very pale, very dark or nearly grey colours read as neutrals, whatever their hue.
  if (c.s < 0.12 || (c.l > 0.85 && c.s < 0.5) || c.l < 0.08) return neutral(c);
  const name = hueName(c.h, c.l, c.s);
  if (name === "navy blue") return "deep navy blue";
  if (name === "green" && c.s < 0.3) return c.l < 0.35 ? "deep sage green" : "sage green";
  const muted = c.s < 0.3 ? "muted" : "";
  const shade =
    c.s > 0.75 && c.l >= 0.4 && c.l <= 0.7 ? "bright" : c.l < 0.22 ? "very dark" : c.l < 0.38 ? "deep" : c.l > 0.78 ? "pale" : c.l > 0.62 ? "light" : "";
  return [shade, muted, name].filter(Boolean).join(" ");
}

/** The palette with each colour's words. Two close colours may share words; either then names both. */
export function paletteWords(palette: { name: string; hex: string }[]): { name: string; hex: string; words: string }[] {
  return palette.map((c) => ({ name: c.name, hex: c.hex, words: colourWords(c.hex) }));
}
