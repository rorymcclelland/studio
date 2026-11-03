import type { Geometry, LayoutSpec, PictureBox } from "./layouts";
import { linesHeight } from "./layouts";
import type { LogoImage } from "./logo";

// C8-1: where planAd lays each part of an ad out, as boxes in the canvas's
// pixels, so the compliance rules (src/lib/compliance/rules.ts) can measure
// the logo's clear space, how much of the ad the words cover and whether
// anything sits under a 9:16 platform's own controls. The boxes follow the
// flex layouts in layouts.tsx step by step (the same specs, fits and
// heights); they are computed beside the drawing and never change it (the
// square's golden pixel hashes, C7-1.6, guard that). A word box is one drawn
// line: its measured width (opentype.js, as the fit measures it) by its line
// height. Satori's shaping can differ from the measure by a few pixels a line
// (decision 0012), so a box is accurate to a few pixels, not one.

export type Box = { x: number; y: number; width: number; height: number };

export type WordPart = "headline" | "body" | "cta" | "legal";

export type WordBox = Box & { part: WordPart; text: string };

export type AdBoxes = {
  canvas: { width: number; height: number };
  picture: Box;
  /** The logo itself (the mark), and the light plate it sits on where it has one. Null when the brand has no logo. */
  logo: { mark: Box; plate: Box | null } | null;
  /** One box per drawn line of the headline, body, button words and legal lines. */
  words: WordBox[];
  /** The button's shape (its words are a word box inside it). */
  button: Box;
  /** The "Simulated image" pill (rule 1), when the picture is simulated: Studio's label, not the ad's words. */
  label: Box | null;
};

export type BoxInput = {
  spec: LayoutSpec;
  pictureBox: PictureBox;
  logo: LogoImage | null;
  /** Whether the logo sits on its plate: Card and the leaderboard only plate it on a dark panel. */
  lightPanel: boolean;
  headline: { size: number; lines: string[]; widths: number[] };
  body: { size: number; lines: string[]; widths: number[] };
  cta: { text: string; width: number; textWidth: number };
  legal: { size: number; lines: string[]; widths: number[] };
  simulated: boolean;
};

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

function lineBoxes(part: WordPart, x: number, y: number, t: { size: number; lines: string[]; widths: number[] }, lineHeight: number): WordBox[] {
  const step = linesHeight(1, t.size, lineHeight);
  return t.lines.map((text, i) => ({ part, text, x, y: y + i * step, width: Math.ceil(t.widths[i] ?? 0), height: step }));
}

/** The boxes of an ad as layouts.tsx draws it. */
export function layOutBoxes(i: BoxInput): AdBoxes {
  const { spec } = i;
  const g = spec.geo;
  const hH = linesHeight(i.headline.lines.length, i.headline.size, spec.headline.lineHeight);
  const bH = linesHeight(i.body.lines.length, i.body.size, spec.body.lineHeight);
  const lH = linesHeight(i.legal.lines.length, i.legal.size, spec.legal.lineHeight);
  const ctaH = spec.cta.height;
  const accentH = g.accent.height + g.accent.gap;
  const logoW = i.logo?.width ?? 0;
  const logoH = i.logo?.height ?? 0;
  const words: WordBox[] = [];
  const headline = (x: number, y: number) => words.push(...lineBoxes("headline", x, y, i.headline, spec.headline.lineHeight));
  const body = (x: number, y: number) => words.push(...lineBoxes("body", x, y, i.body, spec.body.lineHeight));
  const legal = (x: number, y: number) => words.push(...lineBoxes("legal", x, y, i.legal, spec.legal.lineHeight));
  let button = box(0, 0, i.cta.width, ctaH);
  const placeButton = (x: number, y: number) => {
    button = box(x, y, i.cta.width, ctaH);
    // The button's words are centred in it on one line.
    const tw = Math.ceil(i.cta.textWidth);
    const lh = Math.round(spec.cta.size * 1.2);
    words.push({ part: "cta", text: i.cta.text, x: x + Math.round((i.cta.width - tw) / 2), y: y + Math.round((ctaH - lh) / 2), width: tw, height: lh });
  };
  /** The logo at (x, y): on its plate (the mark inset by the plate's padding) or bare. */
  const logoAt = (x: number, y: number, plate: boolean): AdBoxes["logo"] => {
    if (!i.logo) return null;
    const p = g.plate;
    return plate
      ? { mark: box(x + p.padX, y + p.padY, logoW, logoH), plate: box(x, y, logoW + 2 * p.padX, logoH + 2 * p.padY) }
      : { mark: box(x, y, logoW, logoH), plate: null };
  };
  const plateSize = (plate: boolean) => (i.logo ? (plate ? { w: logoW + 2 * g.plate.padX, h: logoH + 2 * g.plate.padY } : { w: logoW, h: logoH }) : { w: 0, h: 0 });

  let picture: Box;
  let logo: AdBoxes["logo"] = null;

  switch (g.kind) {
    case "full-bleed": {
      picture = box(0, 0, g.W, g.H);
      logo = logoAt(g.margin - g.plate.padX, g.logoTop, true);
      const rowH = Math.max(bH, ctaH);
      const legalBlock = lH ? g.legalGap + lH : 0;
      const top = g.H - g.bottomPad - legalBlock - rowH - g.bodyGap - hH - accentH;
      headline(g.margin, top + accentH);
      const rowTop = top + accentH + hH + g.bodyGap;
      body(g.margin, rowTop + rowH - bH);
      placeButton(g.W - g.margin - i.cta.width, rowTop + rowH - ctaH);
      if (lH) legal(g.margin, rowTop + rowH + g.legalGap);
      break;
    }
    case "split": {
      if (g.mode === "side") {
        const pb = i.pictureBox;
        picture = box(0, 0, pb.width, pb.height);
        logo = logoAt(g.margin - g.plate.padX, g.logoTop, true);
        const x = pb.width + g.border + g.margin;
        let y = g.padTop;
        headline(x, y);
        y += hH + g.bodyGap;
        body(x, y);
        y += bH + g.ctaGap;
        placeButton(x, y);
        if (lH) legal(x, g.H - g.padBottom - lH);
      } else {
        const pb = i.pictureBox;
        const left = Math.round((g.W - pb.width) / 2);
        picture = box(Math.max(0, left), 0, pb.width, Math.min(pb.height, g.band));
        logo = logoAt(left + g.margin - g.plate.padX, g.logoTop, true);
        const x = g.margin;
        const top = g.band + g.border + g.padTop;
        headline(x, top);
        const rowTop = top + hH + g.bodyGap;
        const rowH = Math.max(bH, ctaH);
        body(x, rowTop + rowH - bH);
        placeButton(g.W - g.margin - i.cta.width, rowTop + rowH - ctaH);
        if (lH) legal(x, g.H - g.padBottom - lH);
      }
      break;
    }
    case "card": {
      const legalGap = lH > 0 ? g.legalGap : 0;
      const topHeight = g.H - 2 * g.pad - g.bottomInset - lH - legalGap;
      const plate = !i.lightPanel;
      if (g.mode === "stacked") {
        const pb = i.pictureBox;
        picture = box(g.pad + Math.round((g.W - 2 * g.pad - pb.width) / 2), g.pad, pb.width, pb.height);
        const lb = plateSize(plate);
        const rowH = Math.max(ctaH, lb.h);
        const groupH = accentH + hH + g.bodyGap + bH + g.ctaGap + rowH;
        const top = g.pad + topHeight - groupH;
        headline(g.pad, top + accentH);
        body(g.pad, top + accentH + hH + g.bodyGap);
        const rowTop = top + accentH + hH + g.bodyGap + bH + g.ctaGap;
        placeButton(g.pad, rowTop + Math.round((rowH - ctaH) / 2));
        if (i.logo) logo = logoAt(g.W - g.pad - lb.w, rowTop + Math.round((rowH - lb.h) / 2), plate);
      } else {
        const image = g.mode === "square" ? { width: g.imageWidth, height: topHeight } : i.pictureBox;
        const column = spec.headline.width;
        const gap = g.mode === "square" ? g.gap : g.W - 2 * g.pad - image.width - column;
        picture = box(g.pad, g.pad, image.width, image.height);
        const colX = g.pad + image.width + gap;
        logo = logoAt(colX, g.pad, plate);
        const groupH = accentH + hH + g.bodyGap + bH + g.ctaGap + ctaH;
        const top = g.pad + topHeight - groupH;
        headline(colX, top + accentH);
        body(colX, top + accentH + hH + g.bodyGap);
        placeButton(colX, top + accentH + hH + g.bodyGap + bH + g.ctaGap);
      }
      if (lH) legal(g.pad, g.pad + topHeight + legalGap);
      break;
    }
    case "banner": {
      const pb = i.pictureBox;
      if (g.mode === "leaderboard") {
        picture = box(0, 0, pb.width, pb.height);
        const plate = !i.lightPanel;
        const lb = plateSize(plate);
        const logoX = pb.width + g.padX;
        if (i.logo) logo = logoAt(logoX, Math.round((g.H - lb.h) / 2), plate);
        const textX = logoX + lb.w + g.padX;
        const colH = hH + (lH ? g.legalGap + lH : 0);
        const top = Math.round((g.H - colH) / 2);
        headline(textX, top);
        if (lH) legal(textX, top + hH + g.legalGap);
        placeButton(g.W - g.padX - i.cta.width, Math.round((g.H - ctaH) / 2));
      } else {
        picture = box(0, 0, g.W, pb.height);
        // The logo's plate sits on the picture's top left corner, as the simulated label's offset (layouts.tsx).
        logo = logoAt(spec.label.top, spec.label.top, true);
        const top = pb.height + g.padY;
        headline(g.padX, top);
        placeButton(g.padX, top + hH + g.gap);
        if (lH) legal(g.padX, g.H - g.padY - lH);
      }
      break;
    }
  }

  const l = spec.label;
  return {
    canvas: { width: g.W, height: g.H },
    picture,
    logo,
    words,
    button,
    label: i.simulated ? box(g.W - l.right - l.width, l.top, l.width, l.height) : null,
  };
}

export type { Geometry };
