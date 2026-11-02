/* eslint-disable @next/next/no-img-element -- Satori (ImageResponse) draws plain <img> elements; next/image does not apply. */
import type { CSSProperties, ReactElement } from "react";
import { relativeLuminance, rgba } from "./colour";
import type { BundledFamily, FontWeight } from "./fonts";
import type { LogoImage } from "./logo";
import { SIZES, SQUARE, type DrawLayoutId, type SizeId, type SizeSpec } from "./sizes";

// Ad layouts composed in code (S5-3, rule 8), in every size of a channel
// (C7-1). Satori supports flexbox and absolute positioning only (no grid), and
// every element with more than one child needs display flex. Text is drawn
// line by line, as measured in fit.ts, so the line count recorded in the
// checks is the one drawn.
//
// Specs are per layout and size. The 1080 square keeps the numbers it was
// tuned with in Sprint 5 (its drawing is pixel-identical to before sizes, a
// golden test checks it). The other social sizes scale the fixed parts with
// the canvas and arrange the picture so it is never stretched: Full bleed
// covers the canvas with a crop of the picture (sharp's attention strategy,
// in render.ts), Split and Card keep the square picture whole in a square box.
// The banners have a compact layout of their own: headline, button, logo and
// legal lines, no body.

export const AD_SIZE = 1080;
export const LAYOUT_IDS = ["full-bleed", "split", "card"] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export type TextSpec = { sizes: number[]; maxLines: number; lineHeight: number };

/** The parts of an ad, for refusals ("the headline doesn't fit ..."). */
export type Part = "headline" | "body" | "cta" | "legal" | "copy";

/** Fixed parts of a drawing, in pixels, scaled with the canvas. */
type Common = {
  W: number;
  H: number;
  margin: number;
  accent: { width: number; height: number; gap: number; radius: number };
  plate: { padY: number; padX: number; radius: number; shadow: string };
};

export type Geometry =
  | (Common & { kind: "full-bleed"; bottomPad: number; bodyGap: number; legalGap: number; fade: number; logoTop: number })
  | (Common & { kind: "split"; mode: "square" | "top" | "side"; band: number; border: number; padTop: number; padBottom: number; bodyGap: number; ctaGap: number; logoTop: number })
  | (Common & { kind: "card"; mode: "square" | "side" | "stacked"; pad: number; imageWidth: number; gap: number; radius: number; shadow: string; legalGap: number; logoGap: number; bodyGap: number; ctaGap: number; imageGap: number; minPicture: number })
  | (Common & { kind: "banner"; mode: "rectangle" | "half-page" | "leaderboard"; padX: number; padY: number; gap: number; legalGap: number; minPicture: number });

/** The box the picture is drawn in, and how it is fitted: as the square always has (render.ts passes it as it is), cropped to the box around its subject, or whole in a square box. */
export type PictureBox = { width: number; height: number; fit: "cover" | "whole" | "as before" };

export type LayoutSpec = {
  id: DrawLayoutId;
  /** Shown to people, and used in refusals ("headline too long for Split"). */
  name: string;
  /** The tone of panel to look for first in the palette. */
  prefer: "dark" | "light";
  size: SizeId;
  headline: TextSpec & { width: number };
  /** The body shares a row with the button in some layouts (then its width is what the button leaves). Banners have none. */
  body: TextSpec & { width: number; besideCta: boolean; none?: true };
  cta: { size: number; height: number; padX: number; maxWidth: number; gap: number };
  /** The smallest legal size is never below 22 px in the 1080 square (S5-3), and is the smallest readable step in other sizes. maxLines counts every legal line drawn. */
  legal: TextSpec & { width: number };
  logo: { maxWidth: number; maxHeight: number };
  /**
   * The height the text stack needs against the room it has, given each part's
   * drawn height (0 for a part that is absent). The fit takes the largest
   * headline, then body, size that fits both its lines and this budget.
   */
  stack: (h: StackHeights) => { needed: number; max: number };
  /** The box the picture is drawn in, once the words are fitted. */
  picture: (h: StackHeights) => PictureBox;
  /** The plain reason a part can't be drawn in this layout and size. */
  refusal: (part: Part) => string;
  /** The "Simulated image" pill (rule 1): in the top right corner of every size. */
  label: { top: number; right: number; width: number; height: number; size: number; padX: number };
  geo: Geometry;
};

export type StackHeights = { headline: number; body: number; cta: number; legal: number; logo: number };

/** Drawn height of a block of lines (each line is its own row, rounded as drawn). */
export function linesHeight(lines: number, size: number, lineHeight: number): number {
  return lines * Math.round(size * lineHeight);
}

/**
 * Where "Simulated image" is drawn on an ad whose picture came from the mock
 * image model (rule 1, review finding 3). The mock's own stamp sits bottom
 * right of the picture, which Full bleed covers with its scrim and Split and
 * Card crop, so the renderer draws its own label in the ad's top right corner:
 * over the picture in Full bleed and Split, and on the panel's margin in Card,
 * clear of the logo in all three. An opaque pill, so its contrast doesn't
 * depend on what is behind it. These are the square's numbers; other sizes
 * scale them (spec.label), and the banners use the smallest readable pill.
 */
export const SIMULATED_LABEL_TEXT = "Simulated image";
export const SIMULATED_LABEL_BOX = { top: 14, right: 14, width: 214, height: 40, size: 22, padX: 14 };
export const SIMULATED_LABEL_COLOURS = { fill: "#161616", text: "#FFFFFF" };
const BANNER_LABEL = { top: 4, right: 4, width: 100, height: 18, size: 10, padX: 6 };

/** The smallest legal size in a banner: below this the legal lines aren't readable, so the size is refused (Q2). */
export const BANNER_LEGAL_MIN = 10;

const sizePhrase = (size: SizeSpec, name: string) => (size.channel === "display" ? size.phrase : `${size.phrase} in ${name}`);

function refusalFor(size: SizeSpec, name: string): (part: Part) => string {
  if (size.id === SQUARE) {
    // The square's reasons are the ones people have seen since Sprint 5.
    return (part) => (part === "cta" ? `call to action too long for ${name}` : part === "legal" ? `legal lines too long for ${name}` : `${part} too long for ${name}`);
  }
  const where = sizePhrase(size, name);
  return (part) =>
    part === "legal"
      ? `the legal lines don't fit ${where} at a readable size`
      : part === "copy"
        ? `the words don't fit ${where} at a readable size`
        : `the ${part === "cta" ? "call to action" : part} doesn't fit ${where} at a readable size`;
}

/** Scales a square number to a canvas; the square's own numbers are unchanged (s = 1). */
const scaler = (s: number) => (n: number) => Math.round(n * s);
const scaleAll = (r: (n: number) => number, ns: number[]) => [...new Set(ns.map(r))];

function common(size: SizeSpec, s: number): Common {
  const r = scaler(s);
  return {
    W: size.width,
    H: size.height,
    margin: r(72),
    accent: { width: r(72), height: r(6), gap: r(28), radius: r(3) },
    plate: { padY: r(16), padX: r(24), radius: r(18), shadow: `0 ${r(6)}px ${r(24)}px rgba(0, 0, 0, 0.18)` },
  };
}

function labelFor(s: number) {
  const b = SIMULATED_LABEL_BOX;
  const r = scaler(s);
  return { top: r(b.top), right: r(b.right), width: r(b.width), height: r(b.height), size: Math.max(BANNER_LABEL.size, r(b.size)), padX: r(b.padX) };
}

const accentHeight = (c: Common) => c.accent.height + c.accent.gap;

/** The scale of type and fixed parts in each social size: the portrait sizes keep the square's, the landscape is smaller. */
const SOCIAL_SCALE: Partial<Record<SizeId, number>> = { "1080x1080": 1, "1080x1350": 1, "1080x1920": 1, "1200x628": 0.72 };
/** Full bleed's tallest text panel per size (the square's 580 is Sprint 5's). */
const FULL_BLEED_PANEL: Partial<Record<SizeId, number>> = { "1080x1080": 580, "1080x1350": 720, "1080x1920": 1000, "1200x628": 400 };

function fullBleed(size: SizeSpec): LayoutSpec {
  const s = SOCIAL_SCALE[size.id] ?? 1;
  const r = scaler(s);
  const c = common(size, s);
  const content = c.W - 2 * c.margin;
  const g = { ...c, kind: "full-bleed" as const, bottomPad: r(60), bodyGap: r(20), legalGap: r(36), fade: r(220), logoTop: r(64) };
  const square = size.id === SQUARE;
  return {
    id: "full-bleed",
    name: "Full bleed",
    prefer: "dark",
    size: size.id,
    headline: { sizes: scaleAll(r, [80, 72, 64, 56]), maxLines: 2, lineHeight: 1.06, width: content },
    body: { sizes: scaleAll(r, [32, 30, 28]), maxLines: 3, lineHeight: 1.36, width: content, besideCta: true },
    cta: { size: r(30), height: r(80), padX: r(44), maxWidth: r(420), gap: r(48) },
    legal: { sizes: scaleAll(r, [24, 22]), maxLines: 3, lineHeight: 1.32, width: content },
    logo: { maxWidth: r(280), maxHeight: r(56) },
    stack: (h) => ({
      needed: accentHeight(c) + h.headline + g.bodyGap + Math.max(h.body, h.cta) + (h.legal ? g.legalGap + h.legal : 0) + g.bottomPad,
      max: FULL_BLEED_PANEL[size.id] ?? Math.round(c.H * 0.54),
    }),
    picture: () => ({ width: c.W, height: c.H, fit: square ? "as before" : "cover" }),
    refusal: refusalFor(size, "Full bleed"),
    label: labelFor(s),
    geo: g,
  };
}

function split(size: SizeSpec): LayoutSpec {
  const s = SOCIAL_SCALE[size.id] ?? 1;
  const r = scaler(s);
  const c = common(size, s);
  const mode = size.id === SQUARE ? "square" : c.W > c.H ? "side" : "top";
  // The square's picture band is 60% of its height (cropped, as in Sprint 5). Portrait sizes keep the
  // square picture whole in a band at most as tall as the canvas is wide, leaving the square's text room;
  // the landscape puts it whole on the left, as tall as the canvas.
  const band = mode === "square" ? Math.round(c.H * 0.6) : mode === "top" ? Math.min(c.W, c.H - 432) : c.H;
  // Beside the picture, the words start below the "Simulated image" pill in the top right corner.
  const g = { ...c, kind: "split" as const, mode, band, border: r(8), padTop: mode === "side" ? r(72) : r(44), padBottom: r(40), bodyGap: r(14), ctaGap: r(24), logoTop: r(56) } as const;
  const side = mode === "side";
  const textWidth = side ? c.W - band - g.border - 2 * c.margin : c.W - 2 * c.margin;
  return {
    id: "split",
    name: "Split",
    prefer: "light",
    size: size.id,
    headline: { sizes: scaleAll(r, [72, 64, 58, 52, 46]), maxLines: side ? 3 : 2, lineHeight: 1.06, width: textWidth },
    body: { sizes: scaleAll(r, [30, 28, 26]), maxLines: side ? 4 : 2, lineHeight: 1.36, width: textWidth, besideCta: !side },
    cta: { size: r(28), height: r(72), padX: r(40), maxWidth: side ? Math.min(textWidth, r(380)) : r(380), gap: r(48) },
    legal: { sizes: scaleAll(r, [22]), maxLines: side ? 5 : 3, lineHeight: 1.32, width: textWidth },
    logo: { maxWidth: r(260), maxHeight: r(52) },
    stack: (h) => ({
      needed: side
        ? h.headline + g.bodyGap + h.body + g.ctaGap + h.cta + (h.legal ? r(20) + h.legal : 0)
        : h.headline + g.bodyGap + Math.max(h.body, h.cta) + (h.legal ? r(20) + h.legal : 0),
      max: side ? c.H - g.padTop - g.padBottom : c.H - band - g.border - g.padTop - g.padBottom,
    }),
    picture: () => (mode === "square" ? { width: c.W, height: band, fit: "as before" } : { width: band, height: band, fit: "whole" }),
    refusal: refusalFor(size, "Split"),
    label: labelFor(s),
    geo: g,
  };
}

function card(size: SizeSpec): LayoutSpec {
  const s = SOCIAL_SCALE[size.id] ?? 1;
  const r = scaler(s);
  const c = common(size, s);
  const mode = size.id === SQUARE ? "square" : c.W > c.H ? "side" : "stacked";
  const pad = r(64);
  const gap = r(56);
  // The square's picture column is 468 wide (Sprint 5). The landscape's picture is a square as tall as the room
  // above the legal lines; its column is what is left beside the tallest such square.
  const imageWidth = mode === "square" ? 468 : mode === "side" ? c.H - 2 * pad : c.W - 2 * pad;
  const column = mode === "stacked" ? c.W - 2 * pad : c.W - 2 * pad - imageWidth - gap;
  const g = {
    ...c,
    kind: "card" as const,
    mode,
    pad,
    imageWidth,
    gap,
    radius: r(36),
    // The square's soft shadow under the picture costs about 0.4 s to draw in a tall canvas (Satori's shadow
    // filter covers the whole box), which would take 9:16 past a second; Card's panel is dark, where it barely shows.
    shadow: mode === "square" ? `0 ${r(18)}px ${r(48)}px rgba(0, 0, 0, 0.28)` : "none",
    legalGap: r(40),
    logoGap: r(40),
    bodyGap: r(22),
    ctaGap: r(40),
    imageGap: r(48),
    minPicture: Math.round(c.W * 0.4),
  } as const;
  const legalRoom = (h: StackHeights) => c.H - 2 * pad - (h.legal ? h.legal + g.legalGap : 0);
  const plated = (h: StackHeights) => (h.logo ? h.logo + 2 * c.plate.padY : 0);
  const stackedText = (h: StackHeights) => accentHeight(c) + h.headline + g.bodyGap + h.body + g.ctaGap + Math.max(h.cta, plated(h));
  return {
    id: "card",
    name: "Card",
    prefer: "dark",
    size: size.id,
    headline: { sizes: scaleAll(r, [60, 54, 48, 44]), maxLines: mode === "stacked" ? 3 : 4, lineHeight: 1.08, width: column },
    body: { sizes: scaleAll(r, [28, 26, 24]), maxLines: mode === "stacked" ? 4 : 6, lineHeight: 1.42, width: column, besideCta: false },
    cta: { size: r(28), height: r(72), padX: r(40), maxWidth: mode === "stacked" ? r(520) : column, gap: 0 },
    legal: { sizes: scaleAll(r, [22]), maxLines: 4, lineHeight: 1.32, width: c.W - 2 * pad },
    logo: { maxWidth: r(260), maxHeight: r(52) },
    stack: (h) =>
      mode === "stacked"
        ? { needed: g.minPicture + g.imageGap + stackedText(h), max: legalRoom(h) }
        : { needed: (h.logo ? plated(h) + g.logoGap : 0) + accentHeight(c) + h.headline + g.bodyGap + h.body + g.ctaGap + h.cta, max: legalRoom(h) },
    picture: (h) => {
      if (mode === "square") return { width: imageWidth, height: legalRoom(h), fit: "as before" };
      if (mode === "side") return { width: legalRoom(h), height: legalRoom(h), fit: "whole" };
      const side = Math.min(c.W - 2 * pad, legalRoom(h) - g.imageGap - stackedText(h));
      return { width: side, height: side, fit: "whole" };
    },
    refusal: refusalFor(size, "Card"),
    label: labelFor(s),
    geo: g,
  };
}

/** The banners' compact layout (C7-1, Q2): headline, button, logo and legal lines; no body. */
function banner(size: SizeSpec): LayoutSpec {
  const W = size.width;
  const H = size.height;
  const mode = size.id === "728x90" ? "leaderboard" : size.id === "300x600" ? "half-page" : "rectangle";
  const c: Common = {
    W,
    H,
    margin: 12,
    accent: { width: 0, height: 0, gap: 0, radius: 0 },
    plate: { padY: 4, padX: 8, radius: 6, shadow: "0 2px 6px rgba(0, 0, 0, 0.18)" },
  };
  const t = {
    rectangle: { padX: 12, padY: 10, gap: 8, legalGap: 6, headline: [22, 20, 18, 16, 14], hLines: 2, cta: { size: 14, height: 30, padX: 14, maxWidth: 200 }, legal: [11, 10], logo: { maxWidth: 96, maxHeight: 22 }, minPicture: 44 },
    "half-page": { padX: 18, padY: 16, gap: 14, legalGap: 10, headline: [32, 30, 28, 26, 24, 22, 20], hLines: 3, cta: { size: 17, height: 40, padX: 20, maxWidth: 264 }, legal: [12, 11, 10], logo: { maxWidth: 150, maxHeight: 34 }, minPicture: 120 },
    leaderboard: { padX: 14, padY: 8, gap: 12, legalGap: 3, headline: [22, 20, 18, 16, 14], hLines: 1, cta: { size: 14, height: 34, padX: 16, maxWidth: 150 }, legal: [10], logo: { maxWidth: 100, maxHeight: 28 }, minPicture: H },
  }[mode];
  const g = { ...c, kind: "banner" as const, mode, padX: t.padX, padY: t.padY, gap: t.gap, legalGap: t.legalGap, minPicture: t.minPicture } as const;
  // The leaderboard is one row: the square picture, the logo, the words and the button. The other two put the
  // logo on the picture's top left corner (as Full bleed does), so the button has its row to itself.
  const logoRoom = t.logo.maxWidth + 2 * c.plate.padX;
  const textWidth = mode === "leaderboard" ? W - H - 4 * t.padX - logoRoom - t.cta.maxWidth : W - 2 * t.padX;
  const legalBlock = (h: StackHeights) => (h.legal ? t.legalGap + h.legal : 0);
  const text = (h: StackHeights) => 2 * t.padY + h.headline + t.gap + h.cta + legalBlock(h);
  return {
    id: "banner",
    name: "Banner",
    prefer: "dark",
    size: size.id,
    headline: { sizes: t.headline, maxLines: t.hLines, lineHeight: 1.1, width: textWidth },
    body: { sizes: [], maxLines: 0, lineHeight: 1.3, width: textWidth, besideCta: false, none: true },
    cta: { ...t.cta, gap: t.gap },
    legal: { sizes: t.legal.filter((n) => n >= BANNER_LEGAL_MIN), maxLines: mode === "half-page" ? 9 : mode === "rectangle" ? 6 : 4, lineHeight: 1.25, width: textWidth },
    logo: t.logo,
    stack: (h) =>
      mode === "leaderboard"
        ? { needed: 2 * t.padY + h.headline + legalBlock(h), max: H }
        : { needed: t.minPicture + text(h), max: H },
    picture: (h) => {
      if (mode === "leaderboard") return { width: H, height: H, fit: "whole" };
      const room = Math.min(W, H - text(h));
      return room >= W ? { width: W, height: W, fit: "whole" } : { width: W, height: room, fit: "cover" };
    },
    refusal: refusalFor(size, "Banner"),
    label: BANNER_LABEL,
    geo: g,
  };
}

/** A layout's spec in a size, or null when the size doesn't draw that layout. */
export function layoutSpec(layout: string, sizeId: SizeId = SQUARE): LayoutSpec | null {
  const size = SIZES[sizeId];
  if (!size || !(size.layouts as readonly string[]).includes(layout)) return null;
  switch (layout as DrawLayoutId) {
    case "full-bleed":
      return fullBleed(size);
    case "split":
      return split(size);
    case "card":
      return card(size);
    case "banner":
      return banner(size);
  }
}

/** The square's specs (Sprint 5's numbers), by layout. */
export const LAYOUT_SPECS: Record<LayoutId, LayoutSpec> = {
  "full-bleed": fullBleed(SIZES[SQUARE]),
  split: split(SIZES[SQUARE]),
  card: card(SIZES[SQUARE]),
};

export type TextStyle = { family: BundledFamily; weight: FontWeight; letterSpacing: number };

export type DrawProps = {
  spec: LayoutSpec;
  picture: string;
  /** The box the picture is drawn in (render.ts has already cropped or sized it, except in the square). */
  pictureBox: PictureBox;
  logo: LogoImage | null;
  colours: { panel: string; text: string; button: string; buttonText: string; plate: string };
  headline: { size: number; lines: string[]; style: TextStyle };
  body: { size: number; lines: string[]; style: TextStyle };
  cta: { size: number; text: string; width: number; style: TextStyle };
  legal: { size: number; paragraphs: string[][]; style: TextStyle };
  /** Draws the "Simulated image" label (the picture came from the mock image model). */
  simulated?: { style: TextStyle };
};

function Lines(props: { lines: string[]; size: number; lineHeight: number; style: TextStyle; color: string }) {
  const height = linesHeight(1, props.size, props.lineHeight);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {props.lines.map((line, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            height,
            alignItems: "center",
            whiteSpace: "nowrap",
            fontFamily: props.style.family,
            fontWeight: props.style.weight,
            fontSize: props.size,
            letterSpacing: `${props.style.letterSpacing}em`,
            color: props.color,
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

function Headline({ p }: { p: DrawProps }) {
  return <Lines lines={p.headline.lines} size={p.headline.size} lineHeight={p.spec.headline.lineHeight} style={p.headline.style} color={p.colours.text} />;
}

function Body({ p }: { p: DrawProps }) {
  return <Lines lines={p.body.lines} size={p.body.size} lineHeight={p.spec.body.lineHeight} style={p.body.style} color={p.colours.text} />;
}

function Button({ p }: { p: DrawProps }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: p.cta.width,
        height: p.spec.cta.height,
        borderRadius: p.spec.cta.height / 2,
        background: p.colours.button,
        color: p.colours.buttonText,
        fontFamily: p.cta.style.family,
        fontWeight: p.cta.style.weight,
        fontSize: p.cta.size,
        letterSpacing: `${p.cta.style.letterSpacing}em`,
        whiteSpace: "nowrap",
      }}
    >
      {p.cta.text}
    </div>
  );
}

function Legal({ p, style }: { p: DrawProps; style?: CSSProperties }) {
  if (p.legal.paragraphs.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", ...style }}>
      {p.legal.paragraphs.map((lines, i) => (
        <Lines key={i} lines={lines} size={p.legal.size} lineHeight={p.spec.legal.lineHeight} style={p.legal.style} color={p.colours.text} />
      ))}
    </div>
  );
}

/** The logo on a light plate, so a wordmark made for light grounds reads on any picture or panel. */
function Logo({ p, plate, style }: { p: DrawProps; plate: boolean; style?: CSSProperties }) {
  if (!p.logo) return null;
  const pl = p.spec.geo.plate;
  const img = <img src={p.logo.src} width={p.logo.width} height={p.logo.height} alt="" style={{ width: p.logo.width, height: p.logo.height }} />;
  if (!plate) return <div style={{ display: "flex", ...style }}>{img}</div>;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: `${pl.padY}px ${pl.padX}px`,
        borderRadius: pl.radius,
        background: p.colours.plate,
        boxShadow: pl.shadow,
        ...style,
      }}
    >
      {img}
    </div>
  );
}

/** A short bar in the button colour that leads into the headline. */
function Accent({ p }: { p: DrawProps }) {
  const a = p.spec.geo.accent;
  return <div style={{ display: "flex", width: a.width, height: a.height, borderRadius: a.radius, background: p.colours.button, marginBottom: a.gap }} />;
}

function BodyAndButton({ p, width }: { p: DrawProps; width: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", width }}>
      <Body p={p} />
      <Button p={p} />
    </div>
  );
}

/** The picture in its box: whole, or already cropped to the box (render.ts), so it is never stretched. */
function Picture({ p, box, style }: { p: DrawProps; box: { width: number; height: number }; style?: CSSProperties }) {
  return <img src={p.picture} width={box.width} height={box.height} alt="" style={{ width: box.width, height: box.height, objectFit: "cover", ...style }} />;
}

function FullBleed(p: DrawProps): ReactElement {
  const g = p.spec.geo as Extract<Geometry, { kind: "full-bleed" }>;
  const { panel } = p.colours;
  return (
    <div style={{ display: "flex", position: "relative", width: g.W, height: g.H, background: panel }}>
      <img src={p.picture} width={g.W} height={g.H} alt="" style={{ position: "absolute", top: 0, left: 0, width: g.W, height: g.H, objectFit: "cover" }} />
      <Logo p={p} plate style={{ position: "absolute", top: g.logoTop, left: g.margin - g.plate.padX }} />
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 0, bottom: 0, width: g.W }}>
        {/* A fade into the scrim. Words sit only on the solid part, where the contrast is measured. */}
        <div style={{ display: "flex", height: g.fade, backgroundImage: `linear-gradient(to bottom, ${rgba(panel, 0)}, ${rgba(panel, 0.72)} 60%, ${panel})` }} />
        <div style={{ display: "flex", flexDirection: "column", background: panel, padding: `0 ${g.margin}px ${g.bottomPad}px` }}>
          <Accent p={p} />
          <Headline p={p} />
          <div style={{ display: "flex", marginTop: g.bodyGap }}>
            <BodyAndButton p={p} width={g.W - 2 * g.margin} />
          </div>
          <Legal p={p} style={{ marginTop: g.legalGap }} />
        </div>
      </div>
    </div>
  );
}

function Split(p: DrawProps): ReactElement {
  const g = p.spec.geo as Extract<Geometry, { kind: "split" }>;
  if (g.mode === "side") return SplitSide(p, g);
  const box = p.pictureBox;
  const left = Math.round((g.W - box.width) / 2);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: g.W, height: g.H, background: p.colours.panel }}>
      <div style={{ display: "flex", position: "relative", width: g.W, height: g.band, overflow: "hidden", ...(left > 0 ? { justifyContent: "center" } : {}) }}>
        <Picture p={p} box={box} />
        <Logo p={p} plate style={{ position: "absolute", top: g.logoTop, left: left + g.margin - g.plate.padX }} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: g.H - g.band,
          padding: `${g.padTop}px ${g.margin}px ${g.padBottom}px`,
          borderTop: `${g.border}px solid ${p.colours.button}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Headline p={p} />
          <div style={{ display: "flex", marginTop: g.bodyGap }}>
            <BodyAndButton p={p} width={g.W - 2 * g.margin} />
          </div>
        </div>
        <Legal p={p} />
      </div>
    </div>
  );
}

/** Split in a landscape canvas: the square picture whole on the left, the words beside it. */
function SplitSide(p: DrawProps, g: Extract<Geometry, { kind: "split" }>): ReactElement {
  const box = p.pictureBox;
  return (
    <div style={{ display: "flex", width: g.W, height: g.H, background: p.colours.panel }}>
      <div style={{ display: "flex", position: "relative", width: box.width, height: g.H, overflow: "hidden" }}>
        <Picture p={p} box={box} />
        <Logo p={p} plate style={{ position: "absolute", top: g.logoTop, left: g.margin - g.plate.padX }} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: g.W - box.width,
          height: g.H,
          padding: `${g.padTop}px ${g.margin}px ${g.padBottom}px`,
          borderLeft: `${g.border}px solid ${p.colours.button}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Headline p={p} />
          <div style={{ display: "flex", marginTop: g.bodyGap }}>
            <Body p={p} />
          </div>
          <div style={{ display: "flex", marginTop: g.ctaGap }}>
            <Button p={p} />
          </div>
        </div>
        <Legal p={p} />
      </div>
    </div>
  );
}

function Card(p: DrawProps): ReactElement {
  const g = p.spec.geo as Extract<Geometry, { kind: "card" }>;
  const legalHeight = linesHeight(p.legal.paragraphs.flat().length, p.legal.size, p.spec.legal.lineHeight);
  const legalGap = legalHeight > 0 ? g.legalGap : 0;
  const topHeight = g.H - 2 * g.pad - legalHeight - legalGap;
  const lightPanel = relativeLuminance(p.colours.panel) > 0.55;
  if (g.mode === "stacked") return CardStacked(p, g, topHeight, legalGap, lightPanel);
  const image = g.mode === "square" ? { width: g.imageWidth, height: topHeight } : p.pictureBox;
  const column = p.spec.headline.width;
  const gap = g.mode === "square" ? g.gap : g.W - 2 * g.pad - image.width - column;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: g.W, height: g.H, padding: g.pad, background: p.colours.panel }}>
      <div style={{ display: "flex", height: topHeight }}>
        <div style={{ display: "flex", width: image.width, height: image.height, borderRadius: g.radius, overflow: "hidden", ...(g.shadow === "none" ? {} : { boxShadow: g.shadow }) }}>
          <Picture p={p} box={image} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: column, marginLeft: gap }}>
          <div style={{ display: "flex" }}>
            <Logo p={p} plate={!lightPanel} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Accent p={p} />
            <Headline p={p} />
            <div style={{ display: "flex", marginTop: g.bodyGap }}>
              <Body p={p} />
            </div>
            <div style={{ display: "flex", marginTop: g.ctaGap }}>
              <Button p={p} />
            </div>
          </div>
        </div>
      </div>
      <Legal p={p} style={{ marginTop: legalGap }} />
    </div>
  );
}

/** Card in a portrait canvas: the square picture whole on top, the words below, the logo beside the button. */
function CardStacked(p: DrawProps, g: Extract<Geometry, { kind: "card" }>, topHeight: number, legalGap: number, lightPanel: boolean): ReactElement {
  const box = p.pictureBox;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: g.W, height: g.H, padding: g.pad, background: p.colours.panel }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: topHeight }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", width: box.width, height: box.height, borderRadius: g.radius, overflow: "hidden", ...(g.shadow === "none" ? {} : { boxShadow: g.shadow }) }}>
            <Picture p={p} box={box} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Accent p={p} />
          <Headline p={p} />
          <div style={{ display: "flex", marginTop: g.bodyGap }}>
            <Body p={p} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: g.ctaGap }}>
            <Button p={p} />
            <Logo p={p} plate={!lightPanel} />
          </div>
        </div>
      </div>
      <Legal p={p} style={{ marginTop: legalGap }} />
    </div>
  );
}

function Banner(p: DrawProps): ReactElement {
  const g = p.spec.geo as Extract<Geometry, { kind: "banner" }>;
  const lightPanel = relativeLuminance(p.colours.panel) > 0.55;
  const box = p.pictureBox;
  if (g.mode === "leaderboard") {
    return (
      <div style={{ display: "flex", alignItems: "center", width: g.W, height: g.H, background: p.colours.panel }}>
        <Picture p={p} box={box} style={{ flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, marginLeft: g.padX }}>
          <Logo p={p} plate={!lightPanel} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: p.spec.headline.width, marginLeft: g.padX, flexShrink: 0 }}>
          <Headline p={p} />
          <Legal p={p} style={{ marginTop: g.legalGap }} />
        </div>
        <div style={{ display: "flex", flexGrow: 1, justifyContent: "flex-end", paddingRight: g.padX }}>
          <Button p={p} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", width: g.W, height: g.H, background: p.colours.panel }}>
      <div style={{ display: "flex", position: "relative", width: g.W, height: box.height, overflow: "hidden", flexShrink: 0 }}>
        <Picture p={p} box={box} />
        <Logo p={p} plate style={{ position: "absolute", top: BANNER_LABEL.top, left: BANNER_LABEL.top }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1, padding: `${g.padY}px ${g.padX}px` }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Headline p={p} />
          <div style={{ display: "flex", marginTop: g.gap }}>
            <Button p={p} />
          </div>
        </div>
        <Legal p={p} style={{ marginTop: g.legalGap }} />
      </div>
    </div>
  );
}

const DRAW: Record<DrawLayoutId, (p: DrawProps) => ReactElement> = { "full-bleed": FullBleed, split: Split, card: Card, banner: Banner };

function SimulatedLabel({ style, box }: { style: TextStyle; box: LayoutSpec["label"] }) {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: box.top,
        right: box.right,
        width: box.width,
        height: box.height,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: box.height / 2,
        background: SIMULATED_LABEL_COLOURS.fill,
        color: SIMULATED_LABEL_COLOURS.text,
        fontFamily: style.family,
        fontWeight: style.weight,
        fontSize: box.size,
        whiteSpace: "nowrap",
      }}
    >
      {SIMULATED_LABEL_TEXT}
    </div>
  );
}

/** The layout as a React element for ImageResponse (Satori), with the "Simulated image" label on top when the picture is simulated. */
export function drawLayout(props: DrawProps): ReactElement {
  const ad = DRAW[props.spec.id](props);
  if (!props.simulated) return ad;
  const { W, H } = props.spec.geo;
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H }}>
      {ad}
      <SimulatedLabel style={props.simulated.style} box={props.spec.label} />
    </div>
  );
}
