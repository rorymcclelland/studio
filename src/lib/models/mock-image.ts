import { createHash } from "node:crypto";
import sharp from "sharp";

// The mock image model's pictures (S5-1): soft gradient shapes in the brand's
// palette, deterministic for a prompt, palette and seed, with "Simulated
// image" stamped in a corner by code (rule 1). The stamp is drawn from stroke
// paths, not a font, so it looks the same wherever sharp runs (Vercel's image
// libraries have no fonts).

const FALLBACK = ["#1F4E79", "#F2C14E", "#6B9080", "#F7F5F0", "#14213D"];

/** Pixel size for an aspect ratio: 1024 on the longer side at 1K, 2048 at 2K (C7-1, Q1), as the real model draws. */
export function imageSize(aspect: string, size: "1K" | "2K" = "1K"): { width: number; height: number } {
  const long = size === "2K" ? 2048 : 1024;
  const m = /^(\d+):(\d+)$/.exec(aspect);
  const [w, h] = m ? [Number(m[1]), Number(m[2])] : [1, 1];
  if (!w || !h) return { width: long, height: long };
  return w >= h ? { width: long, height: Math.round((long * h) / w) } : { width: Math.round((long * w) / h), height: long };
}

function rng(seedText: string): () => number {
  let a = createHash("sha256").update(seedText).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

// Stroke glyphs on a grid: baseline y=10, x-height y=5, cap and ascender y=2.
const GLYPHS: Record<string, { w: number; d: string }> = {
  S: { w: 8.6, d: "M7 3.2 C6 2 4.5 1.9 3.4 2.2 C1.9 2.6 1.6 4.3 2.6 5.2 C3.6 6.1 6.4 6.3 7.2 7.6 C8 9 6.8 10.2 5 10.2 C3.6 10.2 2.4 9.8 1.6 8.8" },
  i: { w: 2.6, d: "M1.3 5 L1.3 10 M1.3 2.7 L1.3 2.9" },
  m: { w: 8.6, d: "M1 10 L1 5 M1 6.6 C1.5 5.1 4.3 4.6 4.3 6.6 L4.3 10 M4.3 6.6 C4.8 5.1 7.6 4.6 7.6 6.6 L7.6 10" },
  u: { w: 6, d: "M1 5 L1 8.3 C1 10.6 4.6 10.6 5 8.2 M5 5 L5 10" },
  l: { w: 2.6, d: "M1.3 2 L1.3 10" },
  a: { w: 6, d: "M5 5.4 L5 10 M5 7.5 C5 4.5 1 4.5 1 7.5 C1 10.5 5 10.5 5 7.5" },
  t: { w: 4.6, d: "M2 2.8 L2 9 C2 10 3 10.3 4 10 M0.6 5 L3.8 5" },
  e: { w: 6, d: "M1 7.5 L5 7.5 C5 4.5 1 4.5 1 7.5 C1 10.5 4.1 10.7 5 9.4" },
  d: { w: 6, d: "M5 2 L5 10 M5 7.5 C5 4.5 1 4.5 1 7.5 C1 10.5 5 10.5 5 7.5" },
  g: { w: 6, d: "M5 5 L5 11 C5 13.4 1.8 13.4 1.2 12 M5 7.5 C5 4.5 1 4.5 1 7.5 C1 10.5 5 10.5 5 7.5" },
  " ": { w: 2.4, d: "" },
};

export const STAMP_TEXT = "Simulated image";

/** The stamp as an SVG: a dark pill with the words in white strokes. */
export function stampSvg(scale: number): { svg: string; width: number; height: number } {
  const gap = 1.1;
  let x = 0;
  const paths: string[] = [];
  for (const ch of STAMP_TEXT) {
    const g = GLYPHS[ch];
    if (g.d) paths.push(`<path transform="translate(${x.toFixed(2)} 0)" d="${g.d}"/>`);
    x += g.w + gap;
  }
  const pad = 3;
  const w = (x - gap + pad * 2) * scale;
  const h = (14.5 + pad) * scale;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}">` +
    `<rect width="100%" height="100%" rx="${(h / 2).toFixed(1)}" fill="#111111" fill-opacity="0.72"/>` +
    `<g transform="translate(${pad * scale} ${(pad / 2) * scale}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</g>` +
    `</svg>`;
  return { svg, width: Math.ceil(w), height: Math.ceil(h) };
}

/** A deterministic PNG of soft palette shapes, stamped "Simulated image" bottom right. 1K unless asked for 2K. */
export async function drawMockImage(opts: { prompt: string; palette?: string[]; aspect?: string; seed?: number; size?: "1K" | "2K" }): Promise<Uint8Array> {
  const palette = (opts.palette ?? []).filter((h) => /^#[0-9a-f]{6}$/i.test(h));
  const colours = palette.length >= 2 ? palette : FALLBACK;
  const { width, height } = imageSize(opts.aspect ?? "1:1", opts.size);
  const rand = rng(`${opts.prompt}|${colours.join(",")}|${opts.seed ?? 0}`);
  const pick = () => colours[Math.floor(rand() * colours.length)];
  const byLight = [...colours].sort((a, b) => lightness(b) - lightness(a));
  const defs: string[] = [
    `<linearGradient id="bg" x1="0" y1="0" x2="${rand() > 0.5 ? 1 : 0}" y2="1"><stop offset="0" stop-color="${byLight[0]}"/><stop offset="1" stop-color="${byLight[1]}"/></linearGradient>`,
  ];
  const shapes: string[] = [`<rect width="100%" height="100%" fill="url(#bg)"/>`];
  const count = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const c = pick();
    defs.push(`<radialGradient id="g${i}"><stop offset="0" stop-color="${c}" stop-opacity="0.9"/><stop offset="0.6" stop-color="${c}" stop-opacity="0.45"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`);
    const cx = rand() * width;
    const cy = rand() * height;
    const rx = (0.18 + rand() * 0.35) * width;
    const ry = (0.18 + rand() * 0.35) * height;
    shapes.push(`<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#g${i})" transform="rotate(${Math.round(rand() * 180)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${defs.join("")}</defs>${shapes.join("")}</svg>`;
  // The same softness at either size (the 1K picture is unchanged).
  const picture = await sharp(Buffer.from(svg)).blur((6 * Math.max(width, height)) / 1024).png().toBuffer();
  const stamp = stampSvg(Math.max(2, Math.round(width / 340)));
  const margin = Math.round(width * 0.025);
  const out = await sharp(picture)
    .composite([{ input: Buffer.from(stamp.svg), left: width - stamp.width - margin, top: height - stamp.height - margin }])
    .png()
    .toBuffer();
  return new Uint8Array(out);
}
