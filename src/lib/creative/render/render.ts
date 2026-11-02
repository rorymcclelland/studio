import { ImageResponse } from "next/og";
import sharp from "sharp";
import { logoPlate, pickButton, pickTextPair, recordRatio, contrastRatio, type PaletteColour } from "./colour";
import { fitText, missingGlyphs, normaliseText, visibleText, wrapText, type FitResult } from "./fit";
import { imageResponseFonts, loadTextFont, mapBrandFont, type BundledFamily, type FontMatch, type FontWeight } from "./fonts";
import { SIMULATED_LABEL_TEXT, drawLayout, layoutSpec, linesHeight, type DrawProps, type LayoutId, type LayoutSpec, type Part, type PictureBox, type TextStyle } from "./layouts";
import { prepareLogo, type LogoInput } from "./logo";
import { SIZES, SQUARE, type DrawLayoutId, type SizeId } from "./sizes";

// Renders a finished ad (S5-3, rule 8): the picture, the words, the logo and the
// legal lines composed in code. Contrast and fit are decided here, before
// drawing, and recorded in the checks; anything that can't be made legible is
// refused with a reason rather than drawn.
//
// Drawn with `ImageResponse` from next/og (Satori, then sharp or resvg), which
// runs outside a route on the Node runtime, so the same function serves the
// route, workflows and tests. Fonts are bundled; nothing is fetched at render
// time (characters the fonts lack are refused, since Satori would otherwise
// fetch a fallback font or emoji).

export type RenderInput<L extends DrawLayoutId = LayoutId> = {
  layout: L;
  /** C7-1: the canvas (sizes.ts); the 1080 square when left out. */
  size?: SizeId;
  image: { bytes: Buffer; mime: string };
  copy: { headline: string; body: string; cta: string };
  legalLines: string[];
  logo: LogoInput;
  palette: PaletteColour[];
  fontPrimary: string;
  fontSecondary: string;
  brandName: string;
  /** The picture came from the mock image model: the ad is labelled "Simulated image" (rule 1). */
  simulated?: boolean;
};

export type RenderChecks<L extends DrawLayoutId = LayoutId> = {
  layout: L;
  /** C7-1: the canvas drawn. Ads drawn before sizes don't record it (they are all the 1080 square). */
  size?: SizeId;
  /**
   * C7-1: how the picture was fitted. `cover`: cropped to its box around the
   * subject (sharp's attention strategy); `whole`: the square picture in a
   * square box; `as before`: the square's own fitting (Sprint 5). `upscale` is
   * how many times the picture was enlarged (below 1: reduced).
   */
  picture?: { source: { width: number; height: number }; box: { width: number; height: number }; fit: PictureBox["fit"]; upscale: number };
  contrast: {
    source: "palette" | "fallback";
    panel: string;
    text: string;
    button: string;
    buttonText: string;
    /** Recorded ratios, rounded down. */
    headline: number;
    body: number;
    legal: number;
    cta: number;
    /** The button's fill against its panel (non-text contrast). */
    buttonEdge: number;
    note: string;
  };
  fit: {
    headline: { size: number; lines: string[] };
    body: { size: number; lines: string[] };
    cta: { size: number; lines: string[] };
    legal: { size: number; paragraphs: number; lines: string[] };
  };
  legalLinePresent: boolean;
  /** "no legal line in the kit" when the brand has none. */
  legalNote?: string;
  logo: "drawn" | "none";
  fonts: { primary: FontMatch; secondary: FontMatch };
  /** True when the ad carries the "Simulated image" label. Ads drawn before review finding 3 don't record it. */
  simulatedLabel?: boolean;
};

export type RenderResult<L extends DrawLayoutId = LayoutId> = { png: Buffer; checks: RenderChecks<L> } | { refused: string };

const DRAW_LAYOUTS: readonly DrawLayoutId[] = ["full-bleed", "split", "card", "banner"];
const PICTURE_TYPES: Record<string, string> = { "image/png": "image/png", "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg" };

function styleFor(family: BundledFamily, role: "headline" | "body" | "cta" | "legal"): TextStyle {
  const serif = family === "Source Serif 4";
  switch (role) {
    case "headline":
      return { family, weight: serif ? 600 : 700, letterSpacing: serif ? -0.01 : -0.025 };
    case "cta":
      return { family, weight: 600, letterSpacing: 0 };
    default:
      return { family, weight: 400, letterSpacing: 0 };
  }
}

/** Fits every legal line at one size (stepping down), within the layout's total line limit. */
function fitLegal(paragraphs: string[], fontFor: (size: number) => Parameters<typeof wrapText>[1], sizes: number[], width: number, maxLines: number, ls: number) {
  for (const size of sizes) {
    const wrapped = paragraphs.map((p) => wrapText(p, fontFor(size), size, width, ls));
    if (wrapped.some((w) => w === null)) continue;
    const lines = wrapped as string[][];
    if (lines.flat().length <= maxLines) return { size, paragraphs: lines };
  }
  return null;
}

/**
 * The picture for its box: as given for the square (its drawing is unchanged
 * since Sprint 5), otherwise cropped or sized to the box with sharp so Satori
 * draws it at one to one and never stretches it. A cover crop is taken around
 * the picture's subject (sharp's attention strategy: the busiest region).
 */
async function fitPicture(bytes: Buffer, type: string, box: PictureBox) {
  const meta = await sharp(bytes).metadata();
  const source = { width: meta.width ?? 0, height: meta.height ?? 0 };
  if (!source.width || !source.height) throw new Error("the picture has no size");
  const upscale = Math.round(Math.max(box.width / source.width, box.height / source.height) * 100) / 100;
  if (box.fit === "as before") return { url: `data:${type};base64,${bytes.toString("base64")}`, source, upscale };
  const out = await sharp(bytes)
    .resize(box.width, box.height, { fit: "cover", position: sharp.strategy.attention })
    .png({ compressionLevel: 1 })
    .toBuffer();
  return { url: `data:image/png;base64,${out.toString("base64")}`, source, upscale };
}

/**
 * C7-2: which part of an ad a refusal is about, so a translation that doesn't
 * fit a size can be sent back to be shortened ("the German headline is too
 * long ..."). `glyphs`: characters the fonts can't draw; `other`: anything
 * about the picture, colours, logo or canvas.
 */
export type RefusalPart = Part | "glyphs" | "other";

type Refusal = { refused: string; part: RefusalPart };

type Planned<L extends DrawLayoutId> = {
  sizeId: SizeId;
  spec: LayoutSpec;
  pair: Extract<ReturnType<typeof pickTextPair>, { panel: string }>;
  button: ReturnType<typeof pickButton>;
  primary: FontMatch;
  secondary: FontMatch;
  styles: { headline: TextStyle; cta: TextStyle; body: TextStyle; legal: TextStyle };
  labelStyle: TextStyle;
  cta: string;
  ctaFit: Extract<FitResult, { ok: true }>;
  ctaWidth: number;
  legalFit: { size: number; paragraphs: string[][] };
  logo: Awaited<ReturnType<typeof prepareLogo>>;
  heights: { cta: number; legal: number; logo: number };
  headlineFit: Extract<FitResult, { ok: true }>;
  bodyFit: Extract<FitResult, { ok: true }>;
  layout: L;
};

/**
 * Everything but the drawing: the canvas, colours, fonts, the words' fit and
 * the logo, decided as renderAd always has, or the refusal with the part it
 * is about. The picture isn't needed (C7-2 checks a translation's fit in every
 * size with this, without drawing).
 */
async function planAd<L extends DrawLayoutId>(input: Omit<RenderInput<L>, "image">): Promise<Planned<L> | Refusal> {
  const sizeId = input.size ?? SQUARE;
  if (!SIZES[sizeId]) return { refused: `unknown size ${JSON.stringify(sizeId)}`, part: "other" };
  const spec = layoutSpec(input.layout, sizeId);
  if (!spec) {
    const known = (DRAW_LAYOUTS as readonly string[]).includes(input.layout);
    return {
      refused: known ? `the ${JSON.stringify(input.layout)} layout isn't drawn in ${SIZES[sizeId].phrase}` : `unknown layout ${JSON.stringify(input.layout)}`,
      part: "other",
    };
  }

  const headline = normaliseText(input.copy.headline);
  const body = normaliseText(input.copy.body);
  const cta = normaliseText(input.copy.cta);
  if (!headline) return { refused: "the headline is empty", part: "headline" };
  if (!body) return { refused: "the body is empty", part: "body" };
  if (!cta) return { refused: "the call to action is empty", part: "cta" };
  const legalLines = (input.legalLines ?? []).map(normaliseText).filter(Boolean);

  // Colour first: no legible pair, no ad.
  const pair = pickTextPair(input.palette ?? [], undefined, { prefer: spec.prefer });
  if ("failure" in pair) return { refused: pair.failure, part: "other" };
  const button = pickButton(input.palette ?? [], pair);

  // Fonts: the primary draws the headline and button, the secondary the body and legal lines.
  const primary = mapBrandFont(input.fontPrimary);
  const secondary = mapBrandFont(input.fontSecondary);
  const styles = {
    headline: styleFor(primary.family, "headline"),
    cta: styleFor(primary.family, "cta"),
    body: styleFor(secondary.family, "body"),
    legal: styleFor(secondary.family, "legal"),
  };
  const fonts = new Map<string, Awaited<ReturnType<typeof loadTextFont>>>();
  for (const s of Object.values(styles)) {
    const key = `${s.family}:${s.weight}`;
    if (!fonts.has(key)) fonts.set(key, await loadTextFont(s.family, s.weight as FontWeight));
  }
  const fontOf = (s: TextStyle) => fonts.get(`${s.family}:${s.weight}`)!;

  const glyphChecks: [string, string, TextStyle, RefusalPart][] = [
    ["the headline", headline, styles.headline, "glyphs"],
    ["the body", body, styles.body, "glyphs"],
    ["the call to action", cta, styles.cta, "glyphs"],
    ["the legal lines", legalLines.join(" "), styles.legal, "legal"],
  ];
  for (const [label, text, style, part] of glyphChecks) {
    const missing = missingGlyphs(text, fontOf(style));
    if (missing.length) return { refused: `${label} uses characters the bundled fonts can't draw: ${missing.join(" ")}`, part };
  }

  // Fit: the button first, since the body may share its row.
  const ctaFit = fitText(cta, fontOf(styles.cta), [spec.cta.size], spec.cta.maxWidth - 2 * spec.cta.padX, 1, styles.cta.letterSpacing);
  if (!ctaFit.ok) return { refused: spec.refusal("cta"), part: "cta" };
  const ctaWidth = Math.ceil(ctaFit.widths[0]) + 2 * spec.cta.padX;

  const legalFit = legalLines.length
    ? fitLegal(legalLines, () => fontOf(styles.legal), spec.legal.sizes, spec.legal.width, spec.legal.maxLines, styles.legal.letterSpacing)
    : { size: 0, paragraphs: [] as string[][] };
  if (!legalFit) return { refused: spec.refusal("legal"), part: "legal" };

  let logo;
  try {
    logo = await prepareLogo(input.logo, spec.logo.maxWidth, spec.logo.maxHeight);
  } catch (e) {
    return { refused: `the logo can't be drawn: ${(e as Error).message}`, part: "other" };
  }

  // Headline and body: the largest headline size, then body size, that keeps
  // each within its lines and the whole stack within the layout's height.
  // The banners draw no body (C7-1): it is fitted as empty.
  const noBody: Extract<FitResult, { ok: true }> = { ok: true, size: 0, lines: [], lineCount: 0, widths: [] };
  const bodyWidth = spec.body.besideCta ? spec.body.width - ctaWidth - spec.cta.gap : spec.body.width;
  const heights = {
    cta: spec.cta.height,
    legal: linesHeight(legalFit.paragraphs.flat().length, legalFit.size, spec.legal.lineHeight),
    logo: logo?.height ?? 0,
  };
  let headlineFits = false;
  let bodyFits = false;
  let chosen: { headline: Extract<FitResult, { ok: true }>; body: Extract<FitResult, { ok: true }> } | null = null;
  search: for (const hSize of spec.headline.sizes) {
    const h = fitText(headline, fontOf(styles.headline), [hSize], spec.headline.width, spec.headline.maxLines, styles.headline.letterSpacing);
    if (!h.ok) continue;
    headlineFits = true;
    for (const bSize of spec.body.none ? [0] : spec.body.sizes) {
      const b = spec.body.none ? noBody : fitText(body, fontOf(styles.body), [bSize], bodyWidth, spec.body.maxLines, styles.body.letterSpacing);
      if (!b.ok) continue;
      bodyFits = true;
      const { needed, max } = spec.stack({
        ...heights,
        headline: linesHeight(h.lineCount, h.size, spec.headline.lineHeight),
        body: linesHeight(b.lineCount, b.size, spec.body.lineHeight),
      });
      if (needed <= max) {
        chosen = { headline: h, body: b };
        break search;
      }
    }
  }
  if (!headlineFits) return { refused: spec.refusal("headline"), part: "headline" };
  if (!bodyFits) {
    const anyBody = fitText(body, fontOf(styles.body), spec.body.sizes, bodyWidth, spec.body.maxLines, styles.body.letterSpacing);
    if (!anyBody.ok) return { refused: spec.refusal("body"), part: "body" };
  }
  if (!chosen) return { refused: spec.refusal("copy"), part: "copy" };
  const headlineFit = chosen.headline;
  const bodyFit = chosen.body;

  // The "Simulated image" label, in the body font at its semibold weight; it must fit its pill.
  const labelStyle: TextStyle = { family: secondary.family, weight: 600, letterSpacing: 0 };
  if (input.simulated) {
    if (!fonts.has(`${labelStyle.family}:600`)) fonts.set(`${labelStyle.family}:600`, await loadTextFont(labelStyle.family, 600));
    const b = spec.label;
    const fit = fitText(SIMULATED_LABEL_TEXT, fontOf(labelStyle), [b.size], b.width - 2 * b.padX, 1, 0);
    if (!fit.ok) return { refused: `the "${SIMULATED_LABEL_TEXT}" label doesn't fit`, part: "other" };
  }
  return { sizeId, spec, pair, button, primary, secondary, styles, labelStyle, cta, ctaFit, ctaWidth, legalFit, logo, heights, headlineFit, bodyFit, layout: input.layout };
}

/**
 * C7-2: whether an ad's words, logo and legal lines fit a size in a layout,
 * without drawing it (no picture needed): what renderAd would decide, or its
 * refusal with the part it is about.
 */
export async function fitAd<L extends DrawLayoutId>(input: Omit<RenderInput<L>, "image">): Promise<{ ok: true; headline: { size: number; lines: string[] } } | { ok: false; refused: string; part: RefusalPart }> {
  const p = await planAd(input);
  if ("refused" in p) return { ok: false, refused: p.refused, part: p.part };
  return { ok: true, headline: { size: p.headlineFit.size, lines: p.headlineFit.lines } };
}

export async function renderAd<L extends DrawLayoutId = LayoutId>(input: RenderInput<L>): Promise<RenderResult<L>> {
  const pictureType = PICTURE_TYPES[(input.image?.mime ?? "").toLowerCase()];
  // The canvas and layout are refused first, as before; then the picture.
  const sizeId = input.size ?? SQUARE;
  if (SIZES[sizeId] && layoutSpec(input.layout, sizeId)) {
    if (!pictureType) return { refused: `the picture must be PNG or JPEG, not ${input.image?.mime || "unknown"}` };
    if (!input.image.bytes?.length) return { refused: "the picture is empty" };
  }
  const planned = await planAd(input);
  if ("refused" in planned) return { refused: planned.refused };
  const { spec, pair, button, primary, secondary, styles, labelStyle, cta, ctaFit, ctaWidth, legalFit, logo, heights, headlineFit, bodyFit } = planned;

  const pictureBox = spec.picture({
    ...heights,
    headline: linesHeight(headlineFit.lineCount, headlineFit.size, spec.headline.lineHeight),
    body: linesHeight(bodyFit.lineCount, bodyFit.size, spec.body.lineHeight),
  });
  let picture;
  try {
    picture = await fitPicture(input.image.bytes, pictureType!, pictureBox);
  } catch (e) {
    return { refused: `the picture can't be read: ${(e as Error).message}` };
  }

  const props: DrawProps = {
    spec,
    picture: picture.url,
    pictureBox,
    logo,
    colours: { panel: pair.panel, text: pair.text, button: button.fill, buttonText: button.text, plate: logoPlate(input.palette) },
    headline: { size: headlineFit.size, lines: headlineFit.lines, style: styles.headline },
    body: { size: bodyFit.size, lines: bodyFit.lines, style: styles.body },
    cta: { size: ctaFit.size, text: visibleText(cta), width: ctaWidth, style: styles.cta },
    legal: { size: legalFit.size, paragraphs: legalFit.paragraphs, style: styles.legal },
    ...(input.simulated ? { simulated: { style: labelStyle } } : {}),
  };

  let png: Buffer;
  try {
    const response = new ImageResponse(drawLayout(props), {
      width: spec.geo.W,
      height: spec.geo.H,
      fonts: await imageResponseFonts([primary.family, secondary.family]),
    });
    png = Buffer.from(await response.arrayBuffer());
  } catch (e) {
    return { refused: `the ad could not be drawn: ${(e as Error).message}` };
  }

  const textRatio = recordRatio(contrastRatio(pair.text, pair.panel));
  return {
    png,
    checks: {
      layout: input.layout,
      size: sizeId,
      picture: { source: picture.source, box: { width: pictureBox.width, height: pictureBox.height }, fit: pictureBox.fit, upscale: picture.upscale },
      contrast: {
        source: pair.source,
        panel: pair.panel,
        text: pair.text,
        button: button.fill,
        buttonText: button.text,
        headline: textRatio,
        body: textRatio,
        legal: textRatio,
        cta: button.ratio,
        buttonEdge: button.edge,
        note: pair.note,
      },
      fit: {
        headline: { size: headlineFit.size, lines: headlineFit.lines },
        body: { size: bodyFit.size, lines: bodyFit.lines },
        cta: { size: ctaFit.size, lines: ctaFit.lines },
        legal: { size: legalFit.size, paragraphs: legalFit.paragraphs.length, lines: legalFit.paragraphs.flat() },
      },
      legalLinePresent: legalFit.paragraphs.length > 0,
      ...(legalFit.paragraphs.length === 0 ? { legalNote: "no legal line in the kit" } : {}),
      logo: logo ? "drawn" : "none",
      fonts: { primary, secondary },
      simulatedLabel: input.simulated === true,
    },
  };
}
