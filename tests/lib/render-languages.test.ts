// C7-2 Languages at the renderer: soft hyphens for long German words (the
// wrapper breaks there with a visible hyphen; words still wider than the box
// fail the fit check as before), latin-ext fonts for the next languages, the
// demo brands' French, German and Spanish legal lines drawn in every size, and
// the fit-only check (fitAd) that names the part that doesn't fit.
// RENDER_SAMPLES=1 writes samples to docs/design/sprint-7-languages/ (the design record).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fitText, measureWidth, missingGlyphs, SHY, visibleText, wrapText } from "@/lib/creative/render/fit";
import { fontStack, imageResponseFonts, loadOpenType, loadTextFont } from "@/lib/creative/render/fonts";
import { fitAd, renderAd, type RenderInput } from "@/lib/creative/render/render";
import { sizesFor, type DrawLayoutId, type SizeId } from "@/lib/creative/render/sizes";
import { DEMO_LANGUAGES, SUPPORTED_LANGS } from "@/lib/creative/languages";
import { QUILLMOOR, FERNHOLLOW, type DemoBrief } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";

const SAMPLE_DIR = join(process.cwd(), "docs/design/sprint-7-languages");
const sample = (name: string, png: Buffer) => {
  if (process.env.RENDER_SAMPLES === "1") {
    mkdirSync(SAMPLE_DIR, { recursive: true });
    writeFileSync(join(SAMPLE_DIR, `${name}.png`), png);
  }
};

let picture: Buffer;
beforeAll(async () => {
  picture = Buffer.from(await drawMockImage({ prompt: "languages", palette: QUILLMOOR.kit.palette.map((p) => p.hex), seed: 5 }));
});

function input(brief: DemoBrief, size: SizeId, layout: DrawLayoutId, copy: RenderInput["copy"], legalLines = brief.kit.legalLines): RenderInput<DrawLayoutId> {
  return {
    layout,
    size,
    image: { bytes: picture, mime: "image/png" },
    copy,
    legalLines,
    logo: { svg: brief.kit.logoSvg },
    palette: brief.kit.palette,
    fontPrimary: brief.kit.fontPrimary,
    fontSecondary: brief.kit.fontSecondary,
    brandName: brief.kit.name,
    simulated: true,
  };
}

const s = (...parts: string[]) => parts.join(SHY);

describe("C7-2 soft hyphens", () => {
  it("are invisible when no line breaks there, and measure as nothing", async () => {
    const font = await loadOpenType("Inter", 700);
    expect(measureWidth(s("Spar", "konto"), font, 40)).toBe(measureWidth("Sparkonto", font, 40));
    expect(visibleText(s("Spar", "konto"))).toBe("Sparkonto");
    expect(missingGlyphs(s("Spar", "konto"), font)).toEqual([]);
    expect(wrapText(`Ihr ${s("Spar", "konto")}`, font, 40, 1000)).toEqual(["Ihr Sparkonto"]);
  });

  it("a German compound wider than the box breaks at its soft hyphens, with a visible hyphen at the line's end", async () => {
    const font = await loadOpenType("Inter", 700);
    const word = s("Spar", "konto", "übersichts", "seite");
    const box = Math.max(measureWidth("Sparkonto-", font, 40), measureWidth("übersichts-", font, 40)) + 2;
    // Without break points the word can't be drawn: the fit check refuses it, as today.
    expect(wrapText(visibleText(word), font, 40, box)).toBeNull();
    const lines = wrapText(word, font, 40, box)!;
    expect(lines).toEqual(["Sparkonto-", "übersichts-", "seite"]);
    for (const l of lines) {
      expect(l).not.toContain(SHY);
      expect(measureWidth(l, font, 40)).toBeLessThanOrEqual(box);
    }
  });

  it("a piece still wider than the box fails the fit check as before", async () => {
    const font = await loadOpenType("Inter", 700);
    const box = measureWidth("Spar", font, 40);
    expect(wrapText(s("Spar", "kontoübersichtseite"), font, 40, box)).toBeNull();
  });

  it("fitText breaks a word at a soft hyphen to keep a larger size before stepping down (eager only when needed)", async () => {
    const font = await loadOpenType("Inter", 700);
    const text = `Jetzt die ${s("Monats", "übersicht")} öffnen`;
    const box = measureWidth("Jetzt die Monats-", font, 60) + 1;
    // Moving the compound whole would need three lines at 60 px; breaking it fits two.
    expect(wrapText(text, font, 60, box)!.length).toBe(3);
    const fit = fitText(text, font, [60, 50], box, 2);
    expect(fit.ok && fit.size).toBe(60);
    expect(fit.ok && fit.lines).toEqual(["Jetzt die Monats-", "übersicht öffnen"]);
  });

  it("English without soft hyphens wraps exactly as before (the golden square is render-golden.test.ts)", async () => {
    const font = await loadOpenType("Inter", 400);
    const text = "Round up everyday spending into a savings pot, and watch it grow a little each week.";
    expect(wrapText(text, font, 36, 400)).toEqual(wrapText(text, font, 36, 400, 0, { eager: true }));
  });
});

describe("C7-2 latin-ext fonts", () => {
  it("the measuring font falls back to latin-ext for characters the Latin subset lacks", async () => {
    const latin = await loadOpenType("Inter", 400);
    const both = await loadTextFont("Inter", 400);
    expect(missingGlyphs("Łódź, Kraków, Cymru ŵ ŷ", latin)).toEqual(["Ł", "ź", "ŵ", "ŷ"]);
    expect(missingGlyphs("Łódź, Kraków, Cymru ŵ ŷ", both)).toEqual([]);
    // Latin text measures the same through either.
    expect(measureWidth("Sparen Sie jeden Monat", both, 40)).toBe(measureWidth("Sparen Sie jeden Monat", latin, 40));
    expect(measureWidth("Łódź", both, 40)).toBeGreaterThan(0);
  });

  it("Satori gets each latin-ext file under its own name, and the layouts draw with a stack that falls back to it", async () => {
    // One file per name and weight: Satori ignored a second file under the same name and drew empty boxes.
    const fonts = await imageResponseFonts(["Inter", "Source Serif 4"]);
    expect(fonts.map((f) => `${f.name} ${f.weight}`)).toEqual([
      "Inter 400", "Inter 600", "Inter 700", "Source Serif 4 400", "Source Serif 4 600", "Source Serif 4 700",
      "Inter Ext 400", "Inter Ext 600", "Inter Ext 700", "Source Serif 4 Ext 400", "Source Serif 4 Ext 600", "Source Serif 4 Ext 700",
    ]);
    expect(fontStack("Source Serif 4")).toBe("Source Serif 4, Source Serif 4 Ext");
  });

  it("an ad with latin-ext characters is drawn, not refused (checked by eye: docs/design/sprint-7-languages)", async () => {
    const r = await renderAd(input(QUILLMOOR, "1080x1080", "full-bleed", { headline: "Oszczędzaj w Łodzi", body: "Zaokrąglaj codzienne wydatki do skarbonki.", cta: "Pobierz" }));
    expect("refused" in r ? r.refused : "drawn").toBe("drawn");
    if (!("refused" in r)) sample("latin-ext-polish", r.png);
  });

  it("characters outside latin and latin-ext are still refused (no font is fetched at render time)", async () => {
    const r = await renderAd(input(QUILLMOOR, "1080x1080", "full-bleed", { headline: "Сбережения", body: "Plain body.", cta: "Go" }));
    expect("refused" in r && r.refused).toMatch(/characters the bundled fonts can't draw/);
  });
});

describe("C7-2 translated words in every size", () => {
  const german = { headline: `Ihre ${s("Spar", "konto", "übersicht")} auf einen Blick`, body: "Runden Sie Alltagsausgaben auf und sehen Sie zu, wie Ihr Spartopf jede Woche ein wenig wächst.", cta: "App laden" };

  it("the demo brands' legal lines in each language fit every size their English ones fit", async () => {
    for (const brief of [QUILLMOOR, FERNHOLLOW]) {
      const slug = brief.kit.slug as "quillmoor" | "fernhollow";
      for (const channel of ["paid social", "display"] as const) {
        for (const size of sizesFor(channel)) {
          const layout: DrawLayoutId = channel === "display" ? "banner" : "full-bleed";
          const en = await fitAd(input(brief, size.id, layout, { headline: "See it all", body: "In plain words.", cta: "Go" }));
          for (const lang of SUPPORTED_LANGS) {
            const t = await fitAd(input(brief, size.id, layout, { headline: "Tout voir", body: "En mots simples.", cta: "Voir" }, DEMO_LANGUAGES[slug][lang].legalLines));
            // A size English can't hold the legal lines in is left out in every language too (Q2); otherwise the language fits.
            if (en.ok) expect(t.ok, `${slug} ${lang} ${size.id}: ${t.ok ? "" : t.refused}`).toBe(true);
          }
        }
      }
    }
  });

  it("a German headline with soft hyphens is drawn in every social size; no drawn line keeps a soft hyphen", async () => {
    for (const size of sizesFor("paid social")) {
      const r = await renderAd(input(QUILLMOOR, size.id, "full-bleed", german, DEMO_LANGUAGES.quillmoor["de-DE"].legalLines));
      expect("refused" in r ? r.refused : "drawn", size.id).toBe("drawn");
      if ("refused" in r) continue;
      const lines = [...r.checks.fit.headline.lines, ...r.checks.fit.body.lines, ...r.checks.fit.legal.lines];
      for (const l of lines) expect(l).not.toContain(SHY);
      if (size.id === "1080x1350") sample(`german-${size.id}`, r.png);
    }
  });

  it("fitAd names the part that doesn't fit, and agrees with renderAd", async () => {
    const long = { ...german, headline: "Sparen Sie mit der App jeden Monat ganz automatisch etwas Geld für später, für Urlaube und für unerwartete Rechnungen" };
    const fit = await fitAd(input(QUILLMOOR, "1080x1350", "full-bleed", long));
    const drawn = await renderAd(input(QUILLMOOR, "1080x1350", "full-bleed", long));
    expect(fit.ok).toBe(false);
    expect(fit.ok ? null : fit.part).toMatch(/^(headline|copy)$/);
    expect("refused" in drawn && drawn.refused).toBe(fit.ok ? "" : fit.refused);
    const legal = await fitAd(input(QUILLMOOR, "728x90", "banner", german));
    expect(legal.ok ? null : legal.part).toBe("legal");
    const ok = await fitAd(input(QUILLMOOR, "1080x1350", "full-bleed", german));
    expect(ok.ok).toBe(true);
  });
});
