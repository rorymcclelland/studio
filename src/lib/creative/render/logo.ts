import type { Font } from "opentype.js";
import { measureWidth } from "./fit";
import { loadOpenType, mapBrandFont, nearestWeight } from "./fonts";

// Logos for ads (S5-3). A logo arrives as a sanitised SVG string (F-10) or PNG
// bytes, and is embedded through a data URL <img>.
//
// SVG <text> inside a logo would be drawn by whatever fonts the host has (sharp
// and librsvg on Node, or a single default font in resvg), so a wordmark could
// change shape between a laptop and Vercel. Each <text> is outlined into a
// <path> with the nearest bundled font first, so the logo looks the same
// everywhere and nothing is fetched.

export type LogoInput = { svg?: string; png?: Buffer } | null;
export type LogoImage = { src: string; width: number; height: number };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? "");
  }
  // Inline style wins over presentation attributes, as in CSS.
  for (const decl of (attrs.style ?? "").split(";")) {
    const [k, ...v] = decl.split(":");
    if (k && v.length) attrs[k.trim().toLowerCase()] = v.join(":").trim();
  }
  return attrs;
}

function firstNumber(value: string | undefined, fallback: number): number {
  const n = parseFloat((value ?? "").trim().split(/[\s,]+/)[0] ?? "");
  return Number.isFinite(n) ? n : fallback;
}

function glyphPath(text: string, font: Font, x: number, y: number, size: number, letterSpacing: number): string {
  const parts: string[] = [];
  let pen = x;
  let prev: ReturnType<Font["charToGlyph"]> | null = null;
  const scale = size / font.unitsPerEm;
  for (const ch of Array.from(text)) {
    const glyph = font.charToGlyph(ch);
    if (prev) pen += (font.getKerningValue(prev, glyph) || 0) * scale;
    const d = glyph.getPath(pen, y, size).toPathData(2);
    if (d) parts.push(d);
    pen += (glyph.advanceWidth ?? 0) * scale + letterSpacing;
    prev = glyph;
  }
  return parts.join("");
}

const KEPT = ["fill", "fill-opacity", "opacity", "transform", "stroke", "stroke-width", "stroke-opacity"];

/** Replaces each <text> in an SVG with outlines drawn with the nearest bundled font. */
export async function outlineSvgText(svg: string): Promise<string> {
  const matches = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text\s*>/gi)];
  let out = svg;
  for (const m of matches) {
    const attrs = parseAttrs(m[1]);
    const text = decodeEntities(m[2].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    let replacement = "";
    if (text) {
      const family = mapBrandFont(attrs["font-family"] ?? "").family;
      const font = await loadOpenType(family, nearestWeight(attrs["font-weight"]));
      const size = firstNumber(attrs["font-size"], 16);
      const spacing = firstNumber(attrs["letter-spacing"], 0);
      let x = firstNumber(attrs.x, 0);
      const y = firstNumber(attrs.y, 0);
      const anchor = attrs["text-anchor"];
      if (anchor === "middle" || anchor === "end") {
        const width = measureWidth(text, font, size) + spacing * Array.from(text).length;
        x -= anchor === "middle" ? width / 2 : width;
      }
      const d = glyphPath(text, font, x, y, size, spacing);
      const kept = KEPT.filter((k) => attrs[k] !== undefined).map((k) => ` ${k}="${escapeAttr(attrs[k])}"`);
      if (attrs.fill === undefined) kept.unshift(` fill="#000000"`);
      replacement = d ? `<path d="${d}"${kept.join("")}/>` : "";
    }
    out = out.replace(m[0], () => replacement);
  }
  return out;
}

type Box = { x: number; y: number; width: number; height: number };

function svgBox(svg: string): Box | null {
  const open = /<svg\b([^>]*)>/i.exec(svg);
  if (!open) return null;
  const attrs = parseAttrs(open[1]);
  const box = (attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    return { x: box[0], y: box[1], width: box[2], height: box[3] };
  }
  const w = parseFloat(attrs.width ?? "");
  const h = parseFloat(attrs.height ?? "");
  return w > 0 && h > 0 ? { x: 0, y: 0, width: w, height: h } : null;
}

/** Sets the root viewBox and drops a fixed width and height, so the <img> size rules. */
function withViewBox(svg: string, box: Box): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return svg.replace(/<svg\b([^>]*)>/i, (_whole, attrs: string) => {
    const kept = attrs.replace(/\s(?:viewBox|width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
    return `<svg${kept} viewBox="${r(box.x)} ${r(box.y)} ${r(box.width)} ${r(box.height)}">`;
  });
}

function pngSize(png: Buffer): { width: number; height: number } | null {
  const signature = "89504e470d0a1a0a";
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== signature) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function fitBox(size: { width: number; height: number }, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

type Sharp = typeof import("sharp").default;
let sharpModule: Promise<Sharp | null> | undefined;
/** sharp comes with Next (image optimisation); trimming is skipped if it is missing. */
function loadSharp(): Promise<Sharp | null> {
  sharpModule ??= import("sharp").then((m) => m.default).catch(() => null);
  return sharpModule;
}

/**
 * Trims the empty margin many logo files carry (a wordmark in a wide viewBox), so
 * the logo fills its box. Measured by drawing the outlined SVG once with sharp.
 */
async function trimSvg(svg: string, box: Box): Promise<Box> {
  const sharp = await loadSharp();
  if (!sharp) return box;
  try {
    const target = 1200; // px across, enough to measure to a fraction of a unit
    const scale = target / box.width;
    const density = Math.max(1, Math.min(2400, 72 * scale));
    const { info } = await sharp(Buffer.from(svg), { density }).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    const drawn = (await sharp(Buffer.from(svg), { density }).metadata()).width ?? target;
    const k = drawn / box.width;
    const left = -(info.trimOffsetLeft ?? 0) / k;
    const top = -(info.trimOffsetTop ?? 0) / k;
    const width = info.width / k;
    const height = info.height / k;
    if (!(width > 0 && height > 0)) return box;
    const pad = Math.max(width, height) * 0.02;
    return { x: box.x + left - pad, y: box.y + top - pad, width: width + 2 * pad, height: height + 2 * pad };
  } catch {
    return box;
  }
}

async function trimPng(png: Buffer): Promise<Buffer> {
  const sharp = await loadSharp();
  if (!sharp) return png;
  try {
    return await sharp(png).trim({ threshold: 1 }).png().toBuffer();
  } catch {
    return png;
  }
}

/**
 * The logo as a data URL sized to fit the box (keeping its shape), or null for no
 * logo. Throws with a reason if the logo can't be read.
 */
export async function prepareLogo(logo: LogoInput, maxWidth: number, maxHeight: number): Promise<LogoImage | null> {
  if (!logo || (!logo.svg && !logo.png)) return null;
  if (logo.svg) {
    let svg = await outlineSvgText(logo.svg);
    if (!/<svg\b[^>]*\bxmlns=/i.test(svg)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    const box = svgBox(svg);
    if (!box) throw new Error("the logo SVG has no viewBox or size");
    svg = withViewBox(svg, box);
    const trimmed = await trimSvg(svg, box);
    svg = withViewBox(svg, trimmed);
    return { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, ...fitBox(trimmed, maxWidth, maxHeight) };
  }
  if (!pngSize(logo.png as Buffer)) throw new Error("the logo is not a PNG");
  const png = await trimPng(logo.png as Buffer);
  const size = pngSize(png) ?? pngSize(logo.png as Buffer)!;
  return { src: `data:image/png;base64,${png.toString("base64")}`, ...fitBox(size, maxWidth, maxHeight) };
}
