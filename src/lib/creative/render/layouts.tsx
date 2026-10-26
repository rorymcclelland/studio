/* eslint-disable @next/next/no-img-element -- Satori (ImageResponse) draws plain <img> elements; next/image does not apply. */
import type { CSSProperties, ReactElement } from "react";
import { relativeLuminance, rgba } from "./colour";
import type { BundledFamily, FontWeight } from "./fonts";
import type { LogoImage } from "./logo";

// Three 1080 × 1080 ad layouts composed in code (S5-3, rule 8). Satori supports
// flexbox and absolute positioning only (no grid), and every element with more
// than one child needs display flex. Text is drawn line by line, as measured in
// fit.ts, so the line count recorded in the checks is the one drawn.

export const AD_SIZE = 1080;
export const LAYOUT_IDS = ["full-bleed", "split", "card"] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export type TextSpec = { sizes: number[]; maxLines: number; lineHeight: number };

export type LayoutSpec = {
  id: LayoutId;
  /** Shown to people, and used in refusals ("headline too long for Split"). */
  name: string;
  /** The tone of panel to look for first in the palette. */
  prefer: "dark" | "light";
  headline: TextSpec & { width: number };
  /** The body shares a row with the button in some layouts (then its width is what the button leaves). */
  body: TextSpec & { width: number; besideCta: boolean };
  cta: { size: number; height: number; padX: number; maxWidth: number; gap: number };
  /** The smallest legal size is never below 22 px (S5-3). maxLines counts every legal line drawn. */
  legal: TextSpec & { width: number };
  logo: { maxWidth: number; maxHeight: number };
  /**
   * The height the text stack needs against the room it has, given each part's
   * drawn height (0 for a part that is absent). The fit takes the largest
   * headline, then body, size that fits both its lines and this budget.
   */
  stack: (h: StackHeights) => { needed: number; max: number };
};

export type StackHeights = { headline: number; body: number; cta: number; legal: number; logo: number };

/** Drawn height of a block of lines (each line is its own row, rounded as drawn). */
export function linesHeight(lines: number, size: number, lineHeight: number): number {
  return lines * Math.round(size * lineHeight);
}

// Fixed parts of each stack, shared with the drawing code below.
const ACCENT = 6 + 28; // the short accent bar and its gap
const PLATE_PAD_Y = 16; // the logo plate's padding (top and bottom)
const FB = { bottomPad: 60, bodyGap: 20, legalGap: 36, maxPanel: 580 };
const SPLIT = { image: Math.round(AD_SIZE * 0.6), border: 8, padTop: 44, padBottom: 40, bodyGap: 14, legalGap: 20 };
const CARD = { radius: 36, legalGap: 40, logoGap: 40, bodyGap: 22, ctaGap: 40 };

const MARGIN = 72;
const CONTENT = AD_SIZE - 2 * MARGIN; // 936
const CARD_PAD = 64;
const CARD_IMAGE_WIDTH = 468;
const CARD_GAP = 56;
const CARD_COLUMN = AD_SIZE - 2 * CARD_PAD - CARD_IMAGE_WIDTH - CARD_GAP; // 428

export const LAYOUT_SPECS: Record<LayoutId, LayoutSpec> = {
  "full-bleed": {
    id: "full-bleed",
    name: "Full bleed",
    prefer: "dark",
    headline: { sizes: [80, 72, 64, 56], maxLines: 2, lineHeight: 1.06, width: CONTENT },
    body: { sizes: [32, 30, 28], maxLines: 3, lineHeight: 1.36, width: CONTENT, besideCta: true },
    cta: { size: 30, height: 80, padX: 44, maxWidth: 420, gap: 48 },
    legal: { sizes: [24, 22], maxLines: 3, lineHeight: 1.32, width: CONTENT },
    logo: { maxWidth: 280, maxHeight: 56 },
    stack: (h) => ({
      needed: ACCENT + h.headline + FB.bodyGap + Math.max(h.body, h.cta) + (h.legal ? FB.legalGap + h.legal : 0) + FB.bottomPad,
      max: FB.maxPanel,
    }),
  },
  split: {
    id: "split",
    name: "Split",
    prefer: "light",
    headline: { sizes: [72, 64, 58, 52, 46], maxLines: 2, lineHeight: 1.06, width: CONTENT },
    body: { sizes: [30, 28, 26], maxLines: 2, lineHeight: 1.36, width: CONTENT, besideCta: true },
    cta: { size: 28, height: 72, padX: 40, maxWidth: 380, gap: 48 },
    legal: { sizes: [22], maxLines: 3, lineHeight: 1.32, width: CONTENT },
    logo: { maxWidth: 260, maxHeight: 52 },
    stack: (h) => ({
      needed: h.headline + SPLIT.bodyGap + Math.max(h.body, h.cta) + (h.legal ? SPLIT.legalGap + h.legal : 0),
      max: AD_SIZE - SPLIT.image - SPLIT.border - SPLIT.padTop - SPLIT.padBottom,
    }),
  },
  card: {
    id: "card",
    name: "Card",
    prefer: "dark",
    headline: { sizes: [60, 54, 48, 44], maxLines: 4, lineHeight: 1.08, width: CARD_COLUMN },
    body: { sizes: [28, 26, 24], maxLines: 6, lineHeight: 1.42, width: CARD_COLUMN, besideCta: false },
    cta: { size: 28, height: 72, padX: 40, maxWidth: CARD_COLUMN, gap: 0 },
    legal: { sizes: [22], maxLines: 4, lineHeight: 1.32, width: AD_SIZE - 2 * CARD_PAD },
    logo: { maxWidth: 260, maxHeight: 52 },
    stack: (h) => ({
      needed: (h.logo ? h.logo + 2 * PLATE_PAD_Y + CARD.logoGap : 0) + ACCENT + h.headline + CARD.bodyGap + h.body + CARD.ctaGap + h.cta,
      max: AD_SIZE - 2 * CARD_PAD - (h.legal ? h.legal + CARD.legalGap : 0),
    }),
  },
};

export type TextStyle = { family: BundledFamily; weight: FontWeight; letterSpacing: number };

/**
 * Where "Simulated image" is drawn on an ad whose picture came from the mock
 * image model (rule 1, review finding 3). The mock's own stamp sits bottom
 * right of the picture, which Full bleed covers with its scrim and Split and
 * Card crop, so the renderer draws its own label in the ad's top right corner:
 * over the picture in Full bleed and Split, and on the panel's margin in Card,
 * clear of the logo in all three. An opaque pill, so its contrast doesn't
 * depend on what is behind it.
 */
export const SIMULATED_LABEL_TEXT = "Simulated image";
export const SIMULATED_LABEL_BOX = { top: 14, right: 14, width: 214, height: 40, size: 22, padX: 14 };
export const SIMULATED_LABEL_COLOURS = { fill: "#161616", text: "#FFFFFF" };

export type DrawProps = {
  spec: LayoutSpec;
  picture: string;
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
  const img = <img src={p.logo.src} width={p.logo.width} height={p.logo.height} alt="" style={{ width: p.logo.width, height: p.logo.height }} />;
  if (!plate) return <div style={{ display: "flex", ...style }}>{img}</div>;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: `${PLATE_PAD_Y}px 24px`,
        borderRadius: 18,
        background: p.colours.plate,
        boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
        ...style,
      }}
    >
      {img}
    </div>
  );
}

/** A short bar in the button colour that leads into the headline. */
function Accent({ p }: { p: DrawProps }) {
  return <div style={{ display: "flex", width: 72, height: 6, borderRadius: 3, background: p.colours.button, marginBottom: ACCENT - 6 }} />;
}

function BodyAndButton({ p }: { p: DrawProps }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", width: CONTENT }}>
      <Body p={p} />
      <Button p={p} />
    </div>
  );
}

function FullBleed(p: DrawProps): ReactElement {
  const { panel } = p.colours;
  return (
    <div style={{ display: "flex", position: "relative", width: AD_SIZE, height: AD_SIZE, background: panel }}>
      <img src={p.picture} width={AD_SIZE} height={AD_SIZE} alt="" style={{ position: "absolute", top: 0, left: 0, width: AD_SIZE, height: AD_SIZE, objectFit: "cover" }} />
      <Logo p={p} plate style={{ position: "absolute", top: 64, left: MARGIN - 24 }} />
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 0, bottom: 0, width: AD_SIZE }}>
        {/* A fade into the scrim. Words sit only on the solid part, where the contrast is measured. */}
        <div style={{ display: "flex", height: 220, backgroundImage: `linear-gradient(to bottom, ${rgba(panel, 0)}, ${rgba(panel, 0.72)} 60%, ${panel})` }} />
        <div style={{ display: "flex", flexDirection: "column", background: panel, padding: `0 ${MARGIN}px ${FB.bottomPad}px` }}>
          <Accent p={p} />
          <Headline p={p} />
          <div style={{ display: "flex", marginTop: FB.bodyGap }}>
            <BodyAndButton p={p} />
          </div>
          <Legal p={p} style={{ marginTop: FB.legalGap }} />
        </div>
      </div>
    </div>
  );
}

const SPLIT_IMAGE = SPLIT.image; // 648

function Split(p: DrawProps): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: AD_SIZE, height: AD_SIZE, background: p.colours.panel }}>
      <div style={{ display: "flex", position: "relative", width: AD_SIZE, height: SPLIT_IMAGE, overflow: "hidden" }}>
        <img src={p.picture} width={AD_SIZE} height={SPLIT_IMAGE} alt="" style={{ width: AD_SIZE, height: SPLIT_IMAGE, objectFit: "cover" }} />
        <Logo p={p} plate style={{ position: "absolute", top: 56, left: MARGIN - 24 }} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: AD_SIZE - SPLIT_IMAGE,
          padding: `${SPLIT.padTop}px ${MARGIN}px ${SPLIT.padBottom}px`,
          borderTop: `${SPLIT.border}px solid ${p.colours.button}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Headline p={p} />
          <div style={{ display: "flex", marginTop: SPLIT.bodyGap }}>
            <BodyAndButton p={p} />
          </div>
        </div>
        <Legal p={p} />
      </div>
    </div>
  );
}

function Card(p: DrawProps): ReactElement {
  const legalHeight = linesHeight(p.legal.paragraphs.flat().length, p.legal.size, p.spec.legal.lineHeight);
  const legalGap = legalHeight > 0 ? CARD.legalGap : 0;
  const topHeight = AD_SIZE - 2 * CARD_PAD - legalHeight - legalGap;
  const lightPanel = relativeLuminance(p.colours.panel) > 0.55;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: AD_SIZE, height: AD_SIZE, padding: CARD_PAD, background: p.colours.panel }}>
      <div style={{ display: "flex", height: topHeight }}>
        <div style={{ display: "flex", width: CARD_IMAGE_WIDTH, height: topHeight, borderRadius: CARD.radius, overflow: "hidden", boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)" }}>
          <img src={p.picture} width={CARD_IMAGE_WIDTH} height={topHeight} alt="" style={{ width: CARD_IMAGE_WIDTH, height: topHeight, objectFit: "cover" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: CARD_COLUMN, marginLeft: CARD_GAP }}>
          <div style={{ display: "flex" }}>
            <Logo p={p} plate={!lightPanel} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Accent p={p} />
            <Headline p={p} />
            <div style={{ display: "flex", marginTop: CARD.bodyGap }}>
              <Body p={p} />
            </div>
            <div style={{ display: "flex", marginTop: CARD.ctaGap }}>
              <Button p={p} />
            </div>
          </div>
        </div>
      </div>
      <Legal p={p} style={{ marginTop: legalGap }} />
    </div>
  );
}

const DRAW: Record<LayoutId, (p: DrawProps) => ReactElement> = { "full-bleed": FullBleed, split: Split, card: Card };

function SimulatedLabel({ style }: { style: TextStyle }) {
  const b = SIMULATED_LABEL_BOX;
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: b.top,
        right: b.right,
        width: b.width,
        height: b.height,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: b.height / 2,
        background: SIMULATED_LABEL_COLOURS.fill,
        color: SIMULATED_LABEL_COLOURS.text,
        fontFamily: style.family,
        fontWeight: style.weight,
        fontSize: b.size,
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
  return (
    <div style={{ display: "flex", position: "relative", width: AD_SIZE, height: AD_SIZE }}>
      {ad}
      <SimulatedLabel style={props.simulated.style} />
    </div>
  );
}
