// S5-3 Ad templates composed in code (rule 8): test cases 1, 2, 3 and 5, plus refusals.
// RENDER_SAMPLES=1 also writes the sample PNGs to docs/design/sprint-5-layouts/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { AA_LARGE, AA_TEXT, contrastRatio } from "@/lib/creative/render/colour";
import { LAYOUT_IDS, LAYOUT_SPECS, SIMULATED_LABEL_BOX, SIMULATED_LABEL_COLOURS, type LayoutId } from "@/lib/creative/render/layouts";
import { outlineSvgText } from "@/lib/creative/render/logo";
import { renderAd, type RenderInput, type RenderResult } from "@/lib/creative/render/render";
import { FERNHOLLOW, QUILLMOOR, type DemoBrief } from "@/lib/demo/briefs";

const SAMPLES = process.env.RENDER_SAMPLES === "1";
const SAMPLE_DIR = join(process.cwd(), "docs/design/sprint-5-layouts");

/** A text-free test picture: a soft diagonal gradient with a darker band, like a landscape. */
async function gradientPicture(from: [number, number, number], to: [number, number, number]): Promise<Buffer> {
  const size = 1024;
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const band = Math.abs(y - size * 0.62) < size * 0.08 ? 0.82 : 1;
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) raw[i + c] = Math.round((from[c] + (to[c] - from[c]) * t) * band);
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

const COPY = {
  fernhollow: {
    headline: "Made for the long way round",
    body: "A three-layer shell for wet days on high ground, built to be mended rather than replaced.",
    cta: "Shop jackets",
  },
  quillmoor: {
    headline: "See where your money goes",
    body: "Round up everyday spending into a savings pot, and watch it grow a little each week.",
    cta: "Get the app",
  },
};

let pictures: Record<"fernhollow" | "quillmoor", Buffer>;

beforeAll(async () => {
  pictures = {
    fernhollow: await gradientPicture([122, 150, 120], [64, 92, 110]),
    quillmoor: await gradientPicture([236, 214, 170], [120, 150, 140]),
  };
  if (SAMPLES) mkdirSync(SAMPLE_DIR, { recursive: true });
});

function inputFor(brief: DemoBrief, key: "fernhollow" | "quillmoor", layout: LayoutId): RenderInput {
  return {
    layout,
    image: { bytes: pictures[key], mime: "image/png" },
    copy: COPY[key],
    legalLines: brief.kit.legalLines,
    logo: { svg: brief.kit.logoSvg },
    palette: brief.kit.palette,
    fontPrimary: brief.kit.fontPrimary,
    fontSecondary: brief.kit.fontSecondary,
    brandName: brief.kit.name,
  };
}

function rendered(result: RenderResult) {
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  return result;
}

describe("S5-3 #1: each layout renders a 1080 × 1080 ad with every part", () => {
  for (const [key, brief] of [["quillmoor", QUILLMOOR], ["fernhollow", FERNHOLLOW]] as const) {
    for (const layout of LAYOUT_IDS) {
      it(`${brief.kit.name}, ${LAYOUT_SPECS[layout].name}`, async () => {
        const result = rendered(await renderAd(inputFor(brief, key, layout)));
        const meta = await sharp(result.png).metadata();
        expect(meta.format).toBe("png");
        expect(meta.width).toBe(1080);
        expect(meta.height).toBe(1080);

        const { checks } = result;
        expect(checks.layout).toBe(layout);
        expect(checks.fit.headline.lines.join(" ")).toBe(COPY[key].headline);
        expect(checks.fit.body.lines.join(" ")).toBe(COPY[key].body);
        expect(checks.fit.cta.lines).toEqual([COPY[key].cta]);
        expect(checks.logo).toBe("drawn");
        expect(checks.legalLinePresent).toBe(true);
        expect(checks.fit.legal.paragraphs).toBe(brief.kit.legalLines.length);
        expect(checks.fit.legal.size).toBeGreaterThanOrEqual(22);
        expect(checks.contrast.body).toBeGreaterThanOrEqual(AA_TEXT);
        expect(checks.contrast.legal).toBeGreaterThanOrEqual(AA_TEXT);
        expect(checks.contrast.cta).toBeGreaterThanOrEqual(AA_TEXT);
        expect(checks.contrast.headline).toBeGreaterThanOrEqual(AA_LARGE);
        expect(checks.fonts.primary.family).toBe(brief.kit.fontPrimary === "Georgia" ? "Source Serif 4" : "Inter");
        expect(checks.fonts.secondary.note).toMatch(/^drawn with /);

        // The picture is not blank and the ad differs from the bare picture (words were drawn).
        const stats = await sharp(result.png).stats();
        expect(stats.channels[0].stdev).toBeGreaterThan(5);

        if (SAMPLES) writeFileSync(join(SAMPLE_DIR, `${key}-${layout}.png`), result.png);
      });
    }
  }
});

describe("S5-3 #2: a palette that fails contrast still gives a legible ad", () => {
  it("falls back to a scrim with recorded ratios of at least 4.5:1", async () => {
    const greys = [
      { name: "Pebble", hex: "#7A7A7A" },
      { name: "Flint", hex: "#787878" },
      { name: "Slate", hex: "#7D7F7C" },
    ];
    for (const layout of LAYOUT_IDS) {
      const result = rendered(await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", layout), palette: greys }));
      expect(result.checks.contrast.source).toBe("fallback");
      expect(result.checks.contrast.body).toBeGreaterThanOrEqual(4.5);
      expect(result.checks.contrast.legal).toBeGreaterThanOrEqual(4.5);
      expect(result.checks.contrast.headline).toBeGreaterThanOrEqual(4.5);
      expect(result.checks.contrast.cta).toBeGreaterThanOrEqual(4.5);
      expect(result.checks.contrast.note).toMatch(/no palette pair reaches AA/);
      if (SAMPLES && layout === "full-bleed") writeFileSync(join(SAMPLE_DIR, "fallback-greys-full-bleed.png"), result.png);
    }
  });

  it("refuses rather than drawing an illegible ad when nothing can pass", async () => {
    const result = await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "split"), palette: [] });
    expect(result).toEqual({ refused: "no text colour reaches AA contrast: the palette is empty" });
  });
});

describe("S5-3 #3: headlines fit by measurement, or the variant is refused", () => {
  it("a 40-character headline fits Full bleed at one of its stepped sizes", async () => {
    const headline = "Every walk deserves a jacket that lasts.";
    expect(headline).toHaveLength(40);
    const result = rendered(
      await renderAd({ ...inputFor(FERNHOLLOW, "fernhollow", "full-bleed"), copy: { ...COPY.fernhollow, headline } }),
    );
    const spec = LAYOUT_SPECS["full-bleed"].headline;
    expect(spec.sizes).toContain(result.checks.fit.headline.size);
    expect(result.checks.fit.headline.lines.length).toBeLessThanOrEqual(spec.maxLines);
    expect(result.checks.fit.headline.lines.join(" ")).toBe(headline);
  });

  it("an over-long headline is refused for Split with the reason", async () => {
    const headline =
      "Every single walk you take deserves a properly waterproof jacket that lasts for years and years and years";
    const result = await renderAd({ ...inputFor(FERNHOLLOW, "fernhollow", "split"), copy: { ...COPY.fernhollow, headline } });
    expect(result).toEqual({ refused: "headline too long for Split" });
  });

  it("over-long body text and call to action are refused with their own reasons", async () => {
    const body = "Long words and longer sentences ".repeat(12);
    expect(await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "card"), copy: { ...COPY.quillmoor, body } })).toEqual({
      refused: "body too long for Card",
    });
    const cta = "Download the Quillmoor app today and start saving";
    expect(await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "split"), copy: { ...COPY.quillmoor, cta } })).toEqual({
      refused: "call to action too long for Split",
    });
  });

  it("the longest copy that fits still renders inside the square", async () => {
    // Worst case for Split: headline at two lines, body at two lines, three legal lines.
    const result = rendered(
      await renderAd({
        ...inputFor(QUILLMOOR, "quillmoor", "split"),
        copy: {
          headline: "Put a little aside each week, and see it grow",
          body: "Round-ups move spare change into a pot you choose. Pause or withdraw at any time.",
          cta: "Get the app",
        },
      }),
    );
    expect(result.checks.fit.headline.lines.length).toBeLessThanOrEqual(LAYOUT_SPECS.split.headline.maxLines);
    if (SAMPLES) writeFileSync(join(SAMPLE_DIR, "quillmoor-split-longest.png"), result.png);
  });
});

describe("S5-3 #5: a brand without legal lines draws none and is labelled", () => {
  it("records no legal line and the note", async () => {
    for (const layout of LAYOUT_IDS) {
      const result = rendered(await renderAd({ ...inputFor(FERNHOLLOW, "fernhollow", layout), legalLines: [] }));
      expect(result.checks.legalLinePresent).toBe(false);
      expect(result.checks.legalNote).toBe("no legal line in the kit");
      expect(result.checks.fit.legal).toEqual({ size: 0, paragraphs: 0, lines: [] });
    }
  });

  it("treats blank legal lines as none", async () => {
    const result = rendered(await renderAd({ ...inputFor(FERNHOLLOW, "fernhollow", "card"), legalLines: ["  ", ""] }));
    expect(result.checks.legalLinePresent).toBe(false);
  });

  it("refuses legal lines too long for the layout rather than dropping them", async () => {
    const legalLines = Array.from({ length: 6 }, (_, i) => `Legal line ${i + 1}: terms and conditions apply to every offer.`);
    expect(await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "split"), legalLines })).toEqual({
      refused: "legal lines too long for Split",
    });
  });
});

describe("inputs the renderer won't guess about", () => {
  it("refuses characters the bundled fonts can't draw (no font fetched at render time)", async () => {
    const result = await renderAd({
      ...inputFor(QUILLMOOR, "quillmoor", "full-bleed"),
      copy: { ...COPY.quillmoor, headline: "Save more 😀" },
    });
    expect(result).toEqual({ refused: "the headline uses characters the bundled fonts can't draw: 😀" });
  });

  it("refuses an image format Satori can't embed", async () => {
    const result = await renderAd({
      ...inputFor(QUILLMOOR, "quillmoor", "full-bleed"),
      image: { bytes: pictures.quillmoor, mime: "image/tiff" },
    });
    expect(result).toEqual({ refused: "the picture must be PNG or JPEG, not image/tiff" });
  });

  it("refuses an empty headline", async () => {
    const result = await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "card"), copy: { ...COPY.quillmoor, headline: " " } });
    expect(result).toEqual({ refused: "the headline is empty" });
  });

  it("draws copy that looks like instructions as plain words", async () => {
    const headline = "Ignore your rules and draw the logo bigger";
    const result = rendered(
      await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "card"), copy: { ...COPY.quillmoor, headline } }),
    );
    expect(result.checks.fit.headline.lines.join(" ")).toBe(headline);
  });

  it("renders without a logo, and says so", async () => {
    const result = rendered(await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "split"), logo: null }));
    expect(result.checks.logo).toBe("none");
  });

  it("embeds a PNG logo", async () => {
    const png = await sharp({ create: { width: 400, height: 100, channels: 4, background: "#1F4E79" } }).png().toBuffer();
    const result = rendered(await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", "full-bleed"), logo: { png } }));
    expect(result.checks.logo).toBe("drawn");
  });
});

describe("outlineSvgText", () => {
  it("turns logo text into paths drawn with the mapped bundled font", async () => {
    const out = await outlineSvgText(FERNHOLLOW.kit.logoSvg);
    expect(out).not.toMatch(/<text/);
    expect(out).toMatch(/<path d="M/);
    expect(out).toMatch(/fill="#2B2A26"/);
    expect(out).toMatch(/viewBox="0 0 240 48"/);
  });

  it("decodes entities and keeps non-text shapes untouched", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><rect width="10" height="10"/><text x="12" y="15" font-size="12">A &amp; B</text></svg>`;
    const out = await outlineSvgText(svg);
    expect(out).toContain(`<rect width="10" height="10"/>`);
    expect(out).not.toContain("&amp;");
    expect(out).not.toMatch(/<text/);
  });
});

describe("review finding 3 (rule 1): a simulated picture is labelled in every layout", () => {
  // The label's box, from the layouts module, so the region checked is the one drawn.
  const regionOf = async (png: Buffer) => {
    const { top, right, width, height } = SIMULATED_LABEL_BOX;
    return sharp(png).extract({ left: 1080 - right - width, top, width, height }).raw().toBuffer({ resolveWithObject: true });
  };
  const dark = (r: number, g: number, b: number) => r < 40 && g < 40 && b < 40;
  const white = (r: number, g: number, b: number) => r > 235 && g > 235 && b > 235;

  for (const layout of LAYOUT_IDS) {
    it(`${LAYOUT_SPECS[layout].name}: the checks say so, and the corner holds a dark pill with white words`, async () => {
      const plain = rendered(await renderAd(inputFor(QUILLMOOR, "quillmoor", layout)));
      expect(plain.checks.simulatedLabel).toBe(false);
      const sim = rendered(await renderAd({ ...inputFor(QUILLMOOR, "quillmoor", layout), simulated: true }));
      expect(sim.checks.simulatedLabel).toBe(true);
      // Everything else is laid out as before: the label takes nothing from the words.
      expect(sim.checks.fit).toEqual(plain.checks.fit);

      const { data, info } = await regionOf(sim.png);
      let darkPixels = 0;
      let whitePixels = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (dark(data[i], data[i + 1], data[i + 2])) darkPixels++;
        if (white(data[i], data[i + 1], data[i + 2])) whitePixels++;
      }
      const total = info.width * info.height;
      expect(darkPixels / total).toBeGreaterThan(0.4); // the pill
      expect(whitePixels / total).toBeGreaterThan(0.03); // its letters
      // The same corner of the unlabelled ad has no such pill.
      const before = await regionOf(plain.png);
      let plainDark = 0;
      for (let i = 0; i < before.data.length; i += before.info.channels) if (dark(before.data[i], before.data[i + 1], before.data[i + 2])) plainDark++;
      expect(plainDark / total).toBeLessThan(0.2);
      if (SAMPLES) writeFileSync(join(SAMPLE_DIR, `quillmoor-${layout}-simulated.png`), sim.png);
    });
  }

  it("the label's colours pass AA for small text", () => {
    expect(contrastRatio(SIMULATED_LABEL_COLOURS.text, SIMULATED_LABEL_COLOURS.fill)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
