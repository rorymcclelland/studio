// S5-3: contrast maths, text-pair choice and colour words for image prompts.
import { describe, expect, it } from "vitest";
import {
  AA_LARGE,
  AA_TEXT,
  contrastRatio,
  hexToColourWords,
  pickButton,
  pickTextPair,
  relativeLuminance,
} from "@/lib/creative/render/colour";
import { FERNHOLLOW, QUILLMOOR } from "@/lib/demo/briefs";

describe("relativeLuminance and contrastRatio (WCAG 2)", () => {
  it("black on white is 21:1 and a colour on itself is 1:1", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#3F5B3A", "#3f5b3a")).toBeCloseTo(1, 5);
  });

  it("matches known reference values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    // #767676 on white is the classic just-passing grey (4.54:1).
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    // #777777 just fails (4.48:1).
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("refuses a malformed colour rather than guessing", () => {
    expect(() => contrastRatio("not-a-colour", "#fff")).toThrow(/colour/);
  });
});

describe("pickTextPair", () => {
  it("picks a palette pair that reaches AA for the Quillmoor kit", () => {
    const pair = pickTextPair(QUILLMOOR.kit.palette, undefined, { prefer: "dark" });
    if ("failure" in pair) throw new Error(pair.failure);
    expect(pair.source).toBe("palette");
    expect(pair.panelName).toBe("Ink");
    expect(pair.ratios.body).toBeGreaterThanOrEqual(AA_TEXT);
    expect(pair.ratios.headline).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("prefers a light panel when asked", () => {
    const pair = pickTextPair(FERNHOLLOW.kit.palette, undefined, { prefer: "light" });
    if ("failure" in pair) throw new Error(pair.failure);
    expect(pair.panelName).toBe("Fog");
    expect(pair.textName).toBe("Peat");
  });

  it("uses the given background when there is one", () => {
    const pair = pickTextPair(QUILLMOOR.kit.palette, "#1F4E79");
    if ("failure" in pair) throw new Error(pair.failure);
    expect(pair.panel).toBe("#1F4E79");
    expect(pair.ratios.body).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("S5-3 #2: falls back to near-black or white on a palette scrim when no pair passes", () => {
    const greys = [
      { name: "Pebble", hex: "#7A7A7A" },
      { name: "Flint", hex: "#787878" },
      { name: "Slate", hex: "#7D7F7C" },
    ];
    const pair = pickTextPair(greys);
    if ("failure" in pair) throw new Error(pair.failure);
    expect(pair.source).toBe("fallback");
    expect(["#111111", "#FFFFFF"]).toContain(pair.text);
    expect(pair.ratios.body).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(pair.text, pair.panel)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(pair.note).toMatch(/no palette pair reaches AA/);
  });

  it("reports ratios rounded down, so a recorded 4.5 really passes", () => {
    const pair = pickTextPair([{ name: "Grey", hex: "#767676" }, { name: "White", hex: "#FFFFFF" }]);
    if ("failure" in pair) throw new Error(pair.failure);
    expect(pair.ratios.body).toBe(4.54);
  });

  it("says so clearly when nothing can pass", () => {
    const empty = pickTextPair([]);
    expect(empty).toEqual({ failure: "no text colour reaches AA contrast: the palette is empty" });
    const broken = pickTextPair([{ name: "Oops", hex: "blue" }]);
    expect("failure" in broken && broken.failure).toMatch(/no text colour reaches AA contrast/);
  });
});

describe("pickButton", () => {
  it("chooses a palette fill that stands out from the panel, with AA text on it", () => {
    const pair = pickTextPair(QUILLMOOR.kit.palette, undefined, { prefer: "dark" });
    if ("failure" in pair) throw new Error(pair.failure);
    const button = pickButton(QUILLMOOR.kit.palette, pair);
    expect(button.fillName).toBe("Gold leaf");
    expect(button.ratio).toBeGreaterThanOrEqual(AA_TEXT);
    expect(button.edge).toBeGreaterThanOrEqual(3);
  });

  it("inverts the text pair when no palette colour stands out enough", () => {
    const pair = pickTextPair([{ name: "Night", hex: "#101010" }, { name: "Snow", hex: "#FAFAFA" }], undefined, {
      prefer: "dark",
    });
    if ("failure" in pair) throw new Error(pair.failure);
    const button = pickButton([{ name: "Night", hex: "#101010" }, { name: "Snow", hex: "#FAFAFA" }], pair);
    expect(button.fill).toBe(pair.text);
    expect(button.text).toBe(pair.panel);
    expect(button.ratio).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("hexToColourWords", () => {
  it.each([
    ["#14213D", "navy blue"],
    ["#1E4D2B", "deep forest green"],
    ["#E8D9B5", "warm sand"],
    ["#F2C14E", "golden yellow"],
    ["#6B9080", "sage green"],
    ["#B5653A", "burnt orange"],
    ["#808080", "mid grey"],
    ["#FFFFFF", "white"],
    ["#0A0A0A", "near-black"],
    ["#F7F5F0", "off-white"],
  ])("%s reads as %s", (hex, words) => {
    expect(hexToColourWords(hex)).toBe(words);
  });

  it("never returns the hex code or an empty string", () => {
    for (const hex of ["#123456", "#abcdef", "#ff00ff", "#00ffff", "#7f00ff", "#c0392b"]) {
      const words = hexToColourWords(hex);
      expect(words).toMatch(/^[a-z -]+$/);
    }
  });

  it("refuses a malformed colour", () => {
    expect(() => hexToColourWords("#12")).toThrow(/colour/);
  });
});
