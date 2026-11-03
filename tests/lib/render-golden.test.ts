// C7-1 #6: the 1080 square is pixel-identical to the ads drawn before sizes
// existed. The hashes in tests/fixtures/square-golden.json were made by this
// file from the renderer at 1db34b0 (before C7-1), with GOLDEN_WRITE=1; they
// hash the decoded pixels (RGBA), not the PNG bytes, so only a change a person
// could see (or a pixel's value) fails it.
//
// Sprint 8 review nit 9: the 4:5 portrait, the 1.91:1 landscape (1200 × 628)
// and the leaderboard (728 × 90) have golden hashes too, in
// tests/fixtures/sizes-golden.json. Unlike the square's, they were taken from
// the renderer as it was at Sprint 8 (s8-fixes, after C8-1's banner and 9:16
// changes), with GOLDEN_WRITE=1: they don't prove those drawings match an older
// one, they guard them against any later change. A drawing that changes on
// purpose writes them again and says so in its decision record.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderAd, type RenderInput } from "@/lib/creative/render/render";
import { SIZES, type DrawLayoutId, type SizeId } from "@/lib/creative/render/sizes";
import { FERNHOLLOW, QUILLMOOR } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";

const FIXTURE = join(process.cwd(), "tests/fixtures/square-golden.json");
const WRITE = process.env.GOLDEN_WRITE === "1";

const COPY = {
  fernhollow: { headline: "Made for the long way round", body: "A three-layer shell for wet days on high ground, built to be mended rather than replaced.", cta: "Shop jackets" },
  quillmoor: { headline: "See where your money goes", body: "Round up everyday spending into a savings pot, and watch it grow a little each week.", cta: "Get the app" },
};

type Case = { name: string; input: () => Promise<RenderInput> };

async function picture(palette: string[]): Promise<Buffer> {
  // A 1K mock picture (1024 × 1024), as every picture made before Sprint 7 is.
  const png = await drawMockImage({ prompt: "golden", palette, aspect: "1:1", seed: 1, size: "1K" });
  return Buffer.from(png);
}

const cases: Case[] = [];
for (const [key, brief] of [["quillmoor", QUILLMOOR], ["fernhollow", FERNHOLLOW]] as const) {
  for (const layout of ["full-bleed", "split", "card"] as const) {
    for (const simulated of [false, true]) {
      cases.push({
        name: `${key} ${layout}${simulated ? " simulated" : ""}`,
        input: async () => ({
          layout,
          image: { bytes: await picture(brief.kit.palette.map((p) => p.hex)), mime: "image/png" },
          copy: COPY[key],
          legalLines: brief.kit.legalLines,
          logo: { svg: brief.kit.logoSvg },
          palette: brief.kit.palette,
          fontPrimary: brief.kit.fontPrimary,
          fontSecondary: brief.kit.fontSecondary,
          brandName: brief.kit.name,
          simulated,
        }),
      });
    }
  }
}
// No legal lines and no logo.
cases.push({
  name: "quillmoor split, no legal lines, no logo",
  input: async () => ({
    layout: "split",
    image: { bytes: await picture(["#14213D", "#F2C14E"]), mime: "image/png" },
    copy: COPY.quillmoor,
    legalLines: [],
    logo: null,
    palette: QUILLMOOR.kit.palette,
    fontPrimary: QUILLMOOR.kit.fontPrimary,
    fontSecondary: QUILLMOOR.kit.fontSecondary,
    brandName: QUILLMOOR.kit.name,
  }),
});

async function pixelHash(png: Buffer): Promise<{ hash: string; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { hash: createHash("sha256").update(data).digest("hex"), width: info.width, height: info.height };
}

describe("C7-1 #6: the 1080 square is pixel-identical to today's ad", () => {
  const golden: Record<string, string> = WRITE ? {} : JSON.parse(readFileSync(FIXTURE, "utf8"));
  for (const c of cases) {
    it(c.name, async () => {
      const r = await renderAd(await c.input());
      if ("refused" in r) throw new Error(`refused: ${r.refused}`);
      const { hash, width, height } = await pixelHash(r.png);
      expect([width, height]).toEqual([1080, 1080]);
      if (WRITE) golden[c.name] = hash;
      else expect(hash).toBe(golden[c.name]);
    });
  }
  if (WRITE) it("writes the fixture", () => writeFileSync(FIXTURE, `${JSON.stringify(golden, null, 2)}\n`));
});

const SIZES_FIXTURE = join(process.cwd(), "tests/fixtures/sizes-golden.json");
const OTHER_SIZES = ["1080x1350", "1200x628", "728x90"] as const satisfies readonly SizeId[];

const sizeCases: { name: string; size: SizeId; input: () => Promise<RenderInput<DrawLayoutId>> }[] = [];
for (const [key, brief] of [["quillmoor", QUILLMOOR], ["fernhollow", FERNHOLLOW]] as const) {
  for (const size of OTHER_SIZES) {
    for (const layout of SIZES[size].layouts) {
      sizeCases.push({
        name: `${key} ${size} ${layout}`,
        size,
        input: async () => ({
          layout,
          size,
          image: { bytes: await picture(brief.kit.palette.map((p) => p.hex)), mime: "image/png" },
          copy: COPY[key],
          // The leaderboard's row can't hold the demo brands' legal lines (decision 0018), so it is drawn without them.
          legalLines: size === "728x90" ? [] : brief.kit.legalLines,
          logo: { svg: brief.kit.logoSvg },
          palette: brief.kit.palette,
          fontPrimary: brief.kit.fontPrimary,
          fontSecondary: brief.kit.fontSecondary,
          brandName: brief.kit.name,
          simulated: true,
        }),
      });
    }
  }
}

describe("Sprint 8 nit 9: the 4:5, 1200 × 628 and 728 × 90 drawings are unchanged since Sprint 8", () => {
  const golden: Record<string, string> = WRITE ? {} : JSON.parse(readFileSync(SIZES_FIXTURE, "utf8"));
  for (const c of sizeCases) {
    it(c.name, async () => {
      const r = await renderAd(await c.input());
      if ("refused" in r) throw new Error(`refused: ${r.refused}`);
      const { hash, width, height } = await pixelHash(r.png);
      expect([width, height]).toEqual([SIZES[c.size].width, SIZES[c.size].height]);
      if (WRITE) golden[c.name] = hash;
      else expect(hash).toBe(golden[c.name]);
    });
  }
  if (WRITE) it("writes the fixture", () => writeFileSync(SIZES_FIXTURE, `${JSON.stringify(golden, null, 2)}\n`));
});
