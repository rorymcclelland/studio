// C7-3 #7 (hostile), without a database: a file name in the launch pack takes
// only a slug from the words, so nothing in a headline can leave the channel
// and language folders; the CSV manifest quotes every field and defuses
// spreadsheet formulas.
import { describe, expect, it } from "vitest";
import { csvField, packFileName, packPath, slugify } from "@/lib/creative/pack";

describe("C7-3 pack file names", () => {
  it("slugs keep ASCII letters and digits only, fold accents and ß, and drop soft hyphens", () => {
    expect(slugify("See where your money goes")).toBe("see-where-your-money-goes");
    expect(slugify("Mira adónde va tu dinero")).toBe("mira-adonde-va-tu-dinero");
    expect(slugify("Spar\u00ADkonto für Groß und Klein")).toBe("sparkonto-fur-gross-und-klein");
    expect(slugify("Voyez où va votre argent — maintenant !")).toBe("voyez-ou-va-votre-argent-maintenant");
    expect(slugify("a".repeat(80))).toHaveLength(40);
    expect(slugify("word ".repeat(20))).not.toMatch(/-$/);
    expect(slugify("¿¡!?")).toBe("");
  });

  it("hostile words can't make a path: ../, backslashes, drive letters, NUL and control characters", () => {
    for (const headline of ["../../x", "..\\..\\x", "C:\\Windows\\x", "/etc/passwd", "x\u0000y", "x\ny/../z", "%2e%2e%2fx", "...."]) {
      const path = packPath("paid social", "en-GB", 3, "1080x1350", headline);
      expect(path, headline).toMatch(/^paid-social\/en-GB\/ad-03-1080x1350(-[a-z0-9]+(-[a-z0-9]+)*)?\.png$/);
      expect(path.split("/")).toHaveLength(3);
    }
    expect(packPath("display", "de-DE", 12, "300x250", "")).toBe("display/de-DE/ad-12-300x250.png");
  });

  it("the zip's own name is the brand's slug and the London date", () => {
    expect(packFileName("Quillmoor Money", new Date("2026-11-02T23:30:00Z"))).toBe("quillmoor-money-launch-pack-2026-11-02.zip");
    expect(packFileName('"; rm -rf /', new Date("2026-07-01T23:30:00Z"))).toBe("rm-rf-launch-pack-2026-07-02.zip");
    expect(packFileName("¿¡", new Date("2026-11-02T10:00:00Z"))).toBe("studio-launch-pack-2026-11-02.zip");
  });

  it("CSV fields are quoted, quotes doubled, and formulas defused", () => {
    expect(csvField('Say "hello", please')).toBe('"Say ""hello"", please"');
    expect(csvField("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    for (const s of ["+1", "-1", "@SUM(A1)", "\t=1", "\r=1"]) expect(csvField(s).startsWith("\"'")).toBe(true);
    expect(csvField(null)).toBe('""');
    expect(csvField(4.5)).toBe('"4.5"');
  });
});
