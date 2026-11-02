// The Sizes view's and the launch pack's note on an enlarged picture (C7-1,
// review fix 7): above 1.1 times, "Upscaled from a 1K picture" for a picture
// 1024 on its longer side, "Upscaled picture" otherwise; the detail says new
// pictures are drawn at 2K (not "from Sprint 7").
import { describe, expect, it } from "vitest";
import { upscaleNote } from "@/lib/creative/ad-sizes";

const pic = (side: number, upscale: number) => ({ source: { width: side, height: side }, box: { width: 1080, height: 1920 }, fit: "cover" as const, upscale });

describe("upscale note", () => {
  it("names a 1K picture, says new pictures are 2K, and stays quiet up to 1.1 times", () => {
    expect(upscaleNote(pic(1024, 1.875))).toEqual({
      label: "Upscaled from a 1K picture",
      detail: "The picture is 1024 × 1024 and is enlarged 1.88 times to fill 1080 × 1920, so it may look soft. New pictures are drawn at 2K.",
    });
    expect(upscaleNote(pic(1536, 1.25))?.label).toBe("Upscaled picture");
    expect(upscaleNote(pic(1024, 1.1))).toBeNull();
    expect(upscaleNote(pic(2048, 0.94))).toBeNull();
  });
});
