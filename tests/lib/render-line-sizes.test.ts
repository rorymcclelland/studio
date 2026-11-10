// D-4 (Sprint 10b), QA finding 6: a campaign line is the headline of every
// paid-social and display ad, and the line is at most 30 characters
// (CAMPAIGN_LINE_MAX) so that it fits every headline. This draws a worst-case
// 30-character line, in the widest capitals, as the headline of every size and
// layout of both channels, for both demo kits, with the kit's legal lines and
// without, through the real compose code (renderAd) and the demo kits.
//
// What it found (10 November 2026): every paid-social size and layout, and the
// 300 × 250 and 300 × 600 banners, hold the worst-case line whole. The 728 × 90
// leaderboard can't: it refuses the size with its plain reason ("the headline
// doesn't fit a 728 × 90 leaderboard at a readable size"), with or without legal
// lines (Quillmoor's three legal lines are refused there first, as C7-1 #4
// already pins). The widest line it holds is 25 characters of W and M; ordinary
// 30-character lines fit it. The limit is not changed here: that is Rory's call.
// The leaderboard's refusal is pinned below, so a change either way is seen.
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { CAMPAIGN_LINE_MAX } from "@/lib/brief/schema";
import { AA_TEXT } from "@/lib/creative/render/colour";
import { renderAd, type RenderInput, type RenderResult } from "@/lib/creative/render/render";
import { sizesFor, type DrawLayoutId, type SizeId } from "@/lib/creative/render/sizes";
import { FERNHOLLOW, QUILLMOOR, type DemoBrief } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";

/** The worst case: 30 characters of the widest capitals, in words, so it can wrap. */
const WIDE_LINE = "WWWWWW MMMMMM WWWWWW MMMMMM WW";
/** Ordinary 30-character lines, fictional words only (rule 2). */
const PLAIN_LINES = ["Out on the fells before frost!", "Round up and watch it grow now"];

const KITS = { fernhollow: FERNHOLLOW, quillmoor: QUILLMOOR } satisfies Record<string, DemoBrief>;
type Key = keyof typeof KITS;
const BODY = "A three-layer shell for wet days on high ground, built to be mended rather than replaced.";
const LEADERBOARD = "728x90" satisfies SizeId;

let pictures: Record<Key, Buffer>;

beforeAll(async () => {
  pictures = {
    fernhollow: Buffer.from(await drawMockImage({ prompt: "line sizes", palette: FERNHOLLOW.kit.palette.map((p) => p.hex), seed: 3 })),
    quillmoor: Buffer.from(await drawMockImage({ prompt: "line sizes", palette: QUILLMOOR.kit.palette.map((p) => p.hex), seed: 3 })),
  };
});

function input(key: Key, layout: DrawLayoutId, size: SizeId, headline: string, legal: boolean): RenderInput<DrawLayoutId> {
  const { kit } = KITS[key];
  return {
    layout,
    size,
    image: { bytes: pictures[key], mime: "image/png" },
    copy: { headline, body: BODY, cta: "Shop jackets" },
    legalLines: legal ? kit.legalLines : [],
    logo: { svg: kit.logoSvg },
    palette: kit.palette,
    fontPrimary: kit.fontPrimary,
    fontSecondary: kit.fontSecondary,
    brandName: kit.name,
  };
}

function drawn<L extends DrawLayoutId>(r: RenderResult<L>) {
  if ("refused" in r) throw new Error(`refused: ${r.refused}`);
  return r;
}

const EVERY_SIZE = [...sizesFor("paid social"), ...sizesFor("display")];

describe("D-4 QA finding 6: a worst-case 30-character line as the headline of every size", () => {
  it("the worst case is exactly the line's limit, in the widest capitals", () => {
    expect(WIDE_LINE).toHaveLength(CAMPAIGN_LINE_MAX);
    expect(CAMPAIGN_LINE_MAX).toBe(30);
    for (const line of PLAIN_LINES) expect(line).toHaveLength(CAMPAIGN_LINE_MAX);
  });

  for (const key of ["fernhollow", "quillmoor"] as const) {
    for (const size of EVERY_SIZE.filter((s) => s.id !== LEADERBOARD)) {
      for (const layout of size.layouts) {
        for (const legal of [true, false]) {
          it(`${KITS[key].kit.name}, ${size.name}, ${layout}, ${legal ? "with" : "without"} legal lines: the whole line, AA contrast`, async () => {
            const r = drawn(await renderAd(input(key, layout, size.id, WIDE_LINE, legal)));
            const meta = await sharp(r.png).metadata();
            expect([meta.width, meta.height]).toEqual([size.width, size.height]);
            // Every character of the line is drawn, wrapped only at its spaces.
            expect(r.checks.fit.headline.lines.join(" ")).toBe(WIDE_LINE);
            expect(r.checks.contrast.headline).toBeGreaterThanOrEqual(AA_TEXT);
            expect(r.checks.logo).toBe("drawn");
            if (legal) {
              expect(r.checks.legalLinePresent).toBe(true);
              expect(r.checks.fit.legal.lines.join(" ")).toBe(KITS[key].kit.legalLines.join(" "));
            } else {
              expect(r.checks.fit.legal.lines).toEqual([]);
            }
          });
        }
      }
    }
  }

  // Reported to Rory with the finding: the leaderboard can't hold the worst case. Pinned, not fixed (the limit is his call).
  it("728 × 90 leaderboard: the worst-case line is refused with the reason, with and without legal lines, for both kits", async () => {
    const headline = "the headline doesn't fit a 728 × 90 leaderboard at a readable size";
    expect(await renderAd(input("fernhollow", "banner", LEADERBOARD, WIDE_LINE, true))).toEqual({ refused: headline });
    expect(await renderAd(input("fernhollow", "banner", LEADERBOARD, WIDE_LINE, false))).toEqual({ refused: headline });
    expect(await renderAd(input("quillmoor", "banner", LEADERBOARD, WIDE_LINE, false))).toEqual({ refused: headline });
    // Quillmoor's three legal lines don't fit the leaderboard whatever the headline (C7-1 #4).
    expect(await renderAd(input("quillmoor", "banner", LEADERBOARD, WIDE_LINE, true))).toEqual({ refused: "the legal lines don't fit a 728 × 90 leaderboard at a readable size" });
  });

  it("728 × 90 leaderboard: ordinary 30-character lines fit it, and so do 25 characters of W and M", async () => {
    for (const key of ["fernhollow", "quillmoor"] as const) {
      for (const line of [...PLAIN_LINES, "WWWWWW MMMMMM WWWWWW MMMM"]) {
        const r = drawn(await renderAd(input(key, "banner", LEADERBOARD, line, false)));
        expect(r.checks.fit.headline.lines.join(" ")).toBe(line);
      }
    }
    const fern = drawn(await renderAd(input("fernhollow", "banner", LEADERBOARD, PLAIN_LINES[0], true)));
    expect(fern.checks.legalLinePresent).toBe(true);
  });
});
