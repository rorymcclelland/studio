import sharp from "sharp";
import type { Box, MeasuredContrast } from "@/lib/compliance/upload-rules";
import { contrastRatio } from "@/lib/creative/render/colour";

// C8-3: contrast measured in code from an uploaded ad's pixels, under the
// boxes the Read ad agent drew round each line of words. Within a box, the
// pixels are split in two by their lightness (Otsu's threshold: the split that
// best separates two groups), and the two groups' average colours are
// compared as WCAG does. The smaller group is taken as the letters. The
// boxes are the model's estimates, and a word over a photo has no single
// background, so the result is an estimate (shown as Review, "Estimated").

/** Pictures are measured at most this many pixels on their longest side (enough for small print, and quick). */
export const MEASURE_MAX_SIDE = 2048;
/** At most this many pixels are read from one box (evenly spread). */
const MAX_SAMPLES = 40_000;

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/** Otsu's threshold over 256 levels: the level that best splits the values in two. */
export function otsu(values: Uint8Array | number[]): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** The contrast under one box of raw RGB pixels (width × height × 3), or null if the box is too small. */
export function measureBox(data: Uint8Array, width: number, height: number, box: Box): { ratio: number; text: string; background: string } | null {
  const x0 = Math.max(0, Math.floor(box.x * width));
  const y0 = Math.max(0, Math.floor(box.y * height));
  const x1 = Math.min(width, Math.ceil((box.x + box.width) * width));
  const y1 = Math.min(height, Math.ceil((box.y + box.height) * height));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / MAX_SAMPLES)));
  const px: number[] = [];
  const levels: number[] = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 3;
      px.push(i);
      levels.push(Math.round(lum(data[i], data[i + 1], data[i + 2])));
    }
  }
  const t = otsu(levels);
  const groups = [
    { n: 0, r: 0, g: 0, b: 0 },
    { n: 0, r: 0, g: 0, b: 0 },
  ];
  px.forEach((i, k) => {
    const g = groups[levels[k] <= t ? 0 : 1];
    g.n++;
    g.r += data[i];
    g.g += data[i + 1];
    g.b += data[i + 2];
  });
  const [dark, light] = groups;
  if (dark.n === 0 || light.n === 0) {
    const only = dark.n ? dark : light;
    const c = hex(only.r / only.n, only.g / only.n, only.b / only.n);
    return { ratio: 1, text: c, background: c };
  }
  const darkHex = hex(dark.r / dark.n, dark.g / dark.n, dark.b / dark.n);
  const lightHex = hex(light.r / light.n, light.g / light.n, light.b / light.n);
  const textIsDark = dark.n <= light.n;
  return { ratio: contrastRatio(darkHex, lightHex), text: textIsDark ? darkHex : lightHex, background: textIsDark ? lightHex : darkHex };
}

/** The contrast under each word box of an uploaded ad (PNG or JPEG bytes), in the words' order. */
export async function measureContrast(bytes: Uint8Array, boxes: Box[]): Promise<MeasuredContrast[]> {
  if (boxes.length === 0) return [];
  const { data, info } = await sharp(bytes)
    .resize({ width: MEASURE_MAX_SIDE, height: MEASURE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#FFFFFF" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return boxes.map((box, index) => {
    const m = measureBox(pixels, info.width, info.height, box);
    return m ? { index, ...m } : { index, ratio: null };
  });
}
