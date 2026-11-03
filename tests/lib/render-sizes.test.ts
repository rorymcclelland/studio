// C7-1 Sizes at the renderer: test cases 1 to 5 and 8 (6, the square, is
// render-golden.test.ts; 7 and the route are tests/db/ad-sizes.test.ts).
// RENDER_SAMPLES=1 writes a sample of each size to docs/design/sprint-7-sizes/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { AA_TEXT } from "@/lib/creative/render/colour";
import { BANNER_LEGAL_MIN, layoutSpec } from "@/lib/creative/render/layouts";
import { renderAd, type RenderChecks, type RenderInput, type RenderResult } from "@/lib/creative/render/render";
import { SIZE_IDS, SIZES, sizesFor, type DrawLayoutId, type SizeId } from "@/lib/creative/render/sizes";
import { FERNHOLLOW, QUILLMOOR, type DemoBrief } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";

const SAMPLES = process.env.RENDER_SAMPLES === "1";
const SAMPLE_DIR = join(process.cwd(), "docs/design/sprint-7-sizes");
/** One drawing per size (and the tall Card), kept in the repo as the design record; RENDER_SAMPLES=1 rewrites them. */
const SAMPLE_SET = new Set([
  "quillmoor-1080x1080-card",
  "quillmoor-1080x1350-split",
  "quillmoor-1080x1920-full-bleed",
  "fernhollow-1080x1920-card",
  "fernhollow-1200x628-split",
  "fernhollow-300x250-banner",
  "fernhollow-300x600-banner",
  "fernhollow-728x90-banner",
]);
const sample = (name: string, png: Buffer) => {
  if (SAMPLES && SAMPLE_SET.has(name)) writeFileSync(join(SAMPLE_DIR, `${name}.png`), png);
};

const COPY = {
  fernhollow: { headline: "Made for the long way round", body: "A three-layer shell for wet days on high ground, built to be mended rather than replaced.", cta: "Shop jackets" },
  quillmoor: { headline: "See where your money goes", body: "Round up everyday spending into a savings pot, and watch it grow a little each week.", cta: "Get the app" },
};
type Key = keyof typeof COPY;
const BRIEFS: Record<Key, DemoBrief> = { quillmoor: QUILLMOOR, fernhollow: FERNHOLLOW };

let pictures: Record<Key, Buffer>;

beforeAll(async () => {
  pictures = {
    quillmoor: Buffer.from(await drawMockImage({ prompt: "sizes", palette: QUILLMOOR.kit.palette.map((p) => p.hex), seed: 3 })),
    fernhollow: Buffer.from(await drawMockImage({ prompt: "sizes", palette: FERNHOLLOW.kit.palette.map((p) => p.hex), seed: 3 })),
  };
  if (SAMPLES) mkdirSync(SAMPLE_DIR, { recursive: true });
});

function input(key: Key, layout: DrawLayoutId, size: SizeId, extra: Partial<RenderInput<DrawLayoutId>> = {}): RenderInput<DrawLayoutId> {
  const brief = BRIEFS[key];
  return {
    layout,
    size,
    image: { bytes: pictures[key], mime: "image/png" },
    copy: COPY[key],
    legalLines: brief.kit.legalLines,
    logo: { svg: brief.kit.logoSvg },
    palette: brief.kit.palette,
    fontPrimary: brief.kit.fontPrimary,
    fontSecondary: brief.kit.fontSecondary,
    brandName: brief.kit.name,
    ...extra,
  };
}

function drawn<L extends DrawLayoutId>(r: RenderResult<L>) {
  if ("refused" in r) throw new Error(`refused: ${r.refused}`);
  return r;
}

const words = (lines: string[]) => lines.join(" ");

/** Every word, logo and legal line is in the checks, and the contrast is AA. */
function expectWhole(checks: RenderChecks<DrawLayoutId>, key: Key, opts: { body: boolean }) {
  const copy = COPY[key];
  expect(words(checks.fit.headline.lines)).toBe(copy.headline);
  expect(words(checks.fit.cta.lines)).toBe(copy.cta);
  if (opts.body) expect(words(checks.fit.body.lines)).toBe(copy.body);
  else expect(checks.fit.body.lines).toEqual([]);
  expect(words(checks.fit.legal.lines)).toBe(BRIEFS[key].kit.legalLines.join(" "));
  expect(checks.fit.legal.paragraphs).toBe(BRIEFS[key].kit.legalLines.length);
  expect(checks.legalLinePresent).toBe(true);
  expect(checks.logo).toBe("drawn");
  expect(checks.contrast.headline).toBeGreaterThanOrEqual(AA_TEXT);
  expect(checks.contrast.legal).toBeGreaterThanOrEqual(AA_TEXT);
  expect(checks.contrast.cta).toBeGreaterThanOrEqual(AA_TEXT);
}

async function dims(png: Buffer) {
  const m = await sharp(png).metadata();
  return [m.format, m.width, m.height];
}

describe("sizes as data", () => {
  it("paid social has the four social sizes, display the three banners (Q2), each with its layouts", () => {
    expect(sizesFor("paid social").map((s) => s.id)).toEqual(["1080x1080", "1080x1350", "1080x1920", "1200x628"]);
    expect(sizesFor("display").map((s) => s.id)).toEqual(["300x250", "300x600", "728x90"]);
    expect(sizesFor("email")).toEqual([]);
    for (const s of sizesFor("paid social")) expect(s.layouts).toEqual(["full-bleed", "split", "card"]);
    for (const s of sizesFor("display")) expect(s.layouts).toEqual(["banner"]);
    for (const id of SIZE_IDS) expect(`${SIZES[id].width}x${SIZES[id].height}`).toBe(id);
  });

  it("specs scale with the canvas: the portrait sizes keep the square's type, the landscape's is smaller, the banners' smallest", () => {
    const square = layoutSpec("full-bleed", "1080x1080")!;
    expect(layoutSpec("full-bleed", "1080x1920")!.headline.sizes).toEqual(square.headline.sizes);
    expect(Math.max(...layoutSpec("full-bleed", "1200x628")!.headline.sizes)).toBeLessThan(Math.max(...square.headline.sizes));
    expect(layoutSpec("banner", "728x90")!.body.none).toBe(true);
    // A layout a size doesn't draw has no spec.
    expect(layoutSpec("banner", "1080x1080")).toBeNull();
    expect(layoutSpec("split", "728x90")).toBeNull();
    for (const id of ["300x250", "300x600", "728x90"] as const) expect(Math.min(...layoutSpec("banner", id)!.legal.sizes)).toBeGreaterThanOrEqual(BANNER_LEGAL_MIN);
  });
});

describe("C7-1 #1: a paid-social ad renders in all four social sizes with every part, passing contrast and fit", () => {
  for (const key of ["quillmoor", "fernhollow"] as const) {
    for (const size of sizesFor("paid social")) {
      for (const layout of ["full-bleed", "split", "card"] as const) {
        it(`${BRIEFS[key].kit.name}, ${size.name}, ${layout}`, async () => {
          const r = drawn(await renderAd(input(key, layout, size.id)));
          expect(await dims(r.png)).toEqual(["png", size.width, size.height]);
          expect(r.checks.size).toBe(size.id);
          expect(r.checks.layout).toBe(layout);
          expectWhole(r.checks, key, { body: true });
          sample(`${key}-${size.id}-${layout}`, r.png);
        });
      }
    }
  }
});

describe("C7-1 #2: a display ad renders in the banner sizes with headline, button, logo and legal lines (no body)", () => {
  for (const size of sizesFor("display")) {
    it(`${FERNHOLLOW.kit.name}, ${size.name}`, async () => {
      const r = drawn(await renderAd(input("fernhollow", "banner", size.id)));
      expect(await dims(r.png)).toEqual(["png", size.width, size.height]);
      expectWhole(r.checks, "fernhollow", { body: false });
      expect(r.checks.fit.legal.size).toBeGreaterThanOrEqual(BANNER_LEGAL_MIN);
      sample(`fernhollow-${size.id}-banner`, r.png);
    });
  }
  it("the social layouts aren't drawn in a banner, and the banner isn't drawn in a social size", async () => {
    expect(await renderAd(input("fernhollow", "split", "300x250"))).toEqual({ refused: 'the "split" layout isn\'t drawn in a 300 × 250 medium rectangle' });
    expect(await renderAd(input("fernhollow", "banner", "1080x1350"))).toEqual({ refused: 'the "banner" layout isn\'t drawn in a 4:5 (1080 × 1350) portrait' });
    expect(await renderAd(input("fernhollow", "split", "640x480" as SizeId))).toEqual({ refused: 'unknown size "640x480"' });
  });
});

/** A picture with a bright red disc near its right edge on a plain grey ground; with markers, a colour in each corner. */
// The disc sits in the upper part of the picture: since C8-1, a 9:16 Full bleed's words (and so its panel) sit
// above the platforms' bottom band, and the panel would cover a disc lower down.
async function subjectPicture(markers: boolean): Promise<Buffer> {
  const corners = markers
    ? `<rect x="0" y="0" width="40" height="40" fill="#00c000"/><rect x="984" y="0" width="40" height="40" fill="#0000e0"/>
       <rect x="0" y="984" width="40" height="40" fill="#e0e000"/><rect x="984" y="984" width="40" height="40" fill="#00e0e0"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#8a8a8a"/>
    <circle cx="880" cy="240" r="90" fill="#e01010"/>${corners}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Bounding box of pixels close to a colour. */
async function boxOf(png: Buffer, rgb: [number, number, number], region?: { left: number; top: number; width: number; height: number }) {
  const img = region ? sharp(png).extract(region) : sharp(png);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1, n] = [Infinity, Infinity, -1, -1, 0];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (Math.abs(data[i] - rgb[0]) < 40 && Math.abs(data[i + 1] - rgb[1]) < 40 && Math.abs(data[i + 2] - rgb[2]) < 40) {
        n++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return n ? { n, width: x1 - x0 + 1, height: y1 - y0 + 1, x0, y0 } : null;
}

describe("C7-1 #3: the picture is fitted, never stretched", () => {
  let subject: Buffer;
  let picture: Buffer;
  beforeAll(async () => {
    subject = await subjectPicture(false);
    picture = await subjectPicture(true);
  });

  it("Full bleed at 9:16 crops around the subject (attention), keeping it round", async () => {
    const r = drawn(await renderAd(input("quillmoor", "full-bleed", "1080x1920", { image: { bytes: subject, mime: "image/png" } })));
    expect(r.checks.picture).toMatchObject({ fit: "cover", box: { width: 1080, height: 1920 }, source: { width: 1024, height: 1024 } });
    // A centred crop (x 224 to 800 of the source) would cut the disc (x 790 to 970) off; the attention crop keeps it whole.
    const disc = await boxOf(r.png, [224, 16, 16], { left: 0, top: 0, width: 1080, height: 1200 });
    expect(disc).not.toBeNull();
    const scale = 1920 / 1024; // the crop is the source's full height, enlarged to the canvas
    expect(disc!.width).toBeGreaterThan(180 * scale * 0.95);
    expect(Math.abs(disc!.width - disc!.height)).toBeLessThanOrEqual(4); // round, so not stretched
  });

  for (const [layout, size] of [["split", "1080x1920"], ["split", "1080x1350"], ["split", "1200x628"], ["card", "1080x1350"], ["card", "1080x1920"], ["card", "1200x628"]] as const) {
    it(`${layout} at ${SIZES[size].name} keeps the square picture whole in a square box`, async () => {
      const r = drawn(await renderAd(input("quillmoor", layout, size, { image: { bytes: picture, mime: "image/png" } })));
      const pic = r.checks.picture!;
      expect(pic.fit).toBe("whole");
      expect(pic.box.width).toBe(pic.box.height);
      // All four corner markers are drawn, and the disc is round.
      for (const marker of [[0, 192, 0], [0, 0, 224], [224, 224, 0], [0, 224, 224]] as [number, number, number][]) {
        expect(await boxOf(r.png, marker), `marker ${marker}`).not.toBeNull();
      }
      const disc = await boxOf(r.png, [224, 16, 16]);
      expect(Math.abs(disc!.width - disc!.height)).toBeLessThanOrEqual(3);
    });
  }

  it("the square keeps its Sprint 5 fitting (pixel-identical, render-golden.test.ts)", async () => {
    const r = drawn(await renderAd(input("quillmoor", "split", "1080x1080")));
    expect(r.checks.picture).toMatchObject({ fit: "as before", box: { width: 1080, height: 648 } });
  });
});

describe("C7-1 #4: a size whose box can't hold the words at the smallest step is refused with the reason", () => {
  it("Quillmoor's three legal lines don't fit a 728 × 90 leaderboard; its other banners still render", async () => {
    expect(await renderAd(input("quillmoor", "banner", "728x90"))).toEqual({ refused: "the legal lines don't fit a 728 × 90 leaderboard at a readable size" });
    for (const size of ["300x250", "300x600"] as const) {
      const r = drawn(await renderAd(input("quillmoor", "banner", size)));
      expectWhole(r.checks, "quillmoor", { body: false });
    }
  });

  it("a headline too long for a size names the part and the size; the square's reasons are as before", async () => {
    const long = { ...COPY.fernhollow, headline: "Waterproof shells for the long way round and every hill on it" };
    expect(await renderAd(input("fernhollow", "banner", "728x90", { copy: long }))).toEqual({ refused: "the headline doesn't fit a 728 × 90 leaderboard at a readable size" });
    const longer = { ...COPY.fernhollow, headline: "Unbreakablewaterproofshellsforeveryhillandeverywetday" };
    expect(await renderAd(input("fernhollow", "split", "1080x1080", { copy: longer }))).toEqual({ refused: "headline too long for Split" });
  });
});

describe("C7-1 #5 (rule 1): a simulated picture carries its label in every size, including 728 × 90", () => {
  for (const size of SIZE_IDS) {
    it(SIZES[size].name, async () => {
      const layout = SIZES[size].layouts[0];
      const r = drawn(await renderAd(input("fernhollow", layout, size, { simulated: true })));
      expect(r.checks.simulatedLabel).toBe(true);
      const spec = layoutSpec(layout, size)!;
      const { top, right, width, height } = spec.label;
      const { data, info } = await sharp(r.png).extract({ left: SIZES[size].width - right - width, top, width, height }).raw().toBuffer({ resolveWithObject: true });
      let pill = 0;
      let white = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) pill++;
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) white++;
      }
      expect(pill / (width * height)).toBeGreaterThan(0.4);
      expect(white).toBeGreaterThan(20); // the words
      const plain = drawn(await renderAd(input("fernhollow", layout, size)));
      expect(plain.checks.simulatedLabel).toBe(false);
    });
  }
});

describe("C7-1 #8: a 1K picture still renders in every size; the enlargement is recorded", () => {
  it("records how much a 1K and a 2K picture are enlarged in 9:16 Full bleed", async () => {
    const oneK = drawn(await renderAd(input("quillmoor", "full-bleed", "1080x1920")));
    expect(oneK.checks.picture).toMatchObject({ source: { width: 1024, height: 1024 }, upscale: 1.88 });
    const twoK = Buffer.from(await drawMockImage({ prompt: "sizes", palette: QUILLMOOR.kit.palette.map((p) => p.hex), seed: 3, size: "2K" }));
    const r = drawn(await renderAd(input("quillmoor", "full-bleed", "1080x1920", { image: { bytes: twoK, mime: "image/png" } })));
    expect(r.checks.picture).toMatchObject({ source: { width: 2048, height: 2048 }, upscale: 0.94 });
  });

  it("a 1K picture renders in every size of both channels", async () => {
    for (const size of SIZE_IDS) {
      if (size === "728x90") continue; // Quillmoor's legal lines don't fit it (#4)
      const r = drawn(await renderAd(input("quillmoor", SIZES[size].layouts[0], size)));
      expect(r.checks.picture!.source).toEqual({ width: 1024, height: 1024 });
    }
  });
});
