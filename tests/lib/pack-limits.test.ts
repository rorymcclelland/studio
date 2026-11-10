// Review fix 2, without a database: the launch pack has a ceiling (200
// drawings; about 250 would be cut off at the route's 300 s and leave a zip
// that won't open), and one pack is drawn at a time per instance. The slot is
// released when the stream ends, errors or is cancelled, and a slot older
// than the time limit (a stopped function) is taken over.
import { describe, expect, it, vi } from "vitest";
import { PACK_MAX_FILES, packStream, packSummary, takePackSlot, type PackItem, type PackPlan } from "@/lib/creative/pack";

const item = (n: number): PackItem => ({
  path: `paid-social/en-GB/ad-${n}-1080x1080.png`,
  adId: "00000000-0000-4000-8000-000000000001",
  adNumber: 1,
  channel: "paid social",
  audience: "Everyone",
  size: "1080x1080",
  sizeName: "1:1 square",
  width: 1080,
  height: 1080,
  lang: "en-GB",
  langName: "English",
  layout: "full-bleed",
  setId: "00000000-0000-4000-8000-000000000002",
  words: { headline: "H", body: "B", cta: "C" },
  legalLines: [],
  legalLinesWrittenForDemo: false,
  altText: "",
  picture: { assetId: "00000000-0000-4000-8000-000000000003", simulated: true, model: null, idea: null },
  wordsFrom: { setId: "00000000-0000-4000-8000-000000000002", source: "agent", runId: null, model: null, simulated: true },
  translation: null,
  compliance: { outcome: "passes", rules: [] },
});

const plan = (files: number): PackPlan => ({
  campaign: { id: "00000000-0000-4000-8000-000000000009", objective: "o", brandName: "Quillmoor Money", brandSimulated: true, brandFictional: true, briefTitle: null, briefVersion: 1, signedOffAt: null },
  ads: [],
  items: Array.from({ length: files }, (_, i) => item(i)),
  leftOut: [],
  // No sources: drawing the first item fails, which is how the error path is tested.
  sources: new Map(),
});

describe("launch pack limits", () => {
  it("the gallery refuses a pack over 200 files with the reason, and offers no download", () => {
    expect(PACK_MAX_FILES).toBe(200);
    expect(packSummary(plan(201))).toEqual({
      allowed: false,
      reason: "This pack would have 201 files; the most one download can draw is 200. Pick fewer ads.",
    });
    const atCeiling = packSummary(plan(200));
    expect(atCeiling.allowed).toBe(true);
    if (atCeiling.allowed) expect(atCeiling.seconds).toBeLessThanOrEqual(120);
  });

  it("one slot per instance: taken, refused while held, freed by its release, and taken over when stale", () => {
    const release = takePackSlot(1_000);
    expect(release).toBeTypeOf("function");
    expect(takePackSlot(2_000)).toBeNull();
    release!();
    const again = takePackSlot(3_000);
    expect(again).toBeTypeOf("function");
    // A slot held past the route's time limit (a stopped function) is stale.
    expect(takePackSlot(3_000 + 300_000)).toBeNull();
    const takeover = takePackSlot(3_000 + 331_000);
    expect(takeover).toBeTypeOf("function");
    // The old holder's late release doesn't free the new holder's slot.
    again!();
    expect(takePackSlot(3_000 + 332_000)).toBeNull();
    takeover!();
  });

  it("the stream calls onEnd once when it errors, so the slot is freed", async () => {
    const onEnd = vi.fn();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = packStream("00000000-0000-4000-8000-000000000004", plan(1), new Date(), undefined, onEnd);
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow();
    expect(onEnd).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it("the stream calls onEnd once when it is cancelled", async () => {
    const onEnd = vi.fn();
    const stream = packStream("00000000-0000-4000-8000-000000000004", plan(0), new Date(), undefined, onEnd);
    await stream.cancel();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
