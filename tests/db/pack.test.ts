// C7-3 Launch pack (decision 0020), through /campaigns/<id>/pack.zip as served
// (packResponse) and the gallery's summary (planPack, packSummary). The zip is
// unzipped with fflate and checked entry by entry: names and folders, PNG
// sizes, both manifests and the README. Test cases: 1 (folders, every size and
// language that passed, the count matching the gallery's), 2 (the manifests:
// every file with its words, checks and provenance, every left-out size or
// language with its reason), 3 (unpicked, discarded and earlier-version ads are
// not in it), 4 (no sign-off or nothing picked: a refusal, no zip), 6 (rule 1:
// simulated pictures and words and machine translations labelled), 7 (hostile:
// another workspace's campaign, no session and malformed ids are the same 404;
// words like "../../x" can't leave the folders). Test case 5 (a 60-file pack,
// timed) is the e2e spec's: CI's database is too far away to time here. Review
// fixes: a ceiling of 200 files and one pack at a time per instance (2), legal
// lines written for the demo marked (5), the README's claims only where true
// (6), and each file's picture size and upscale factor (7).
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertImage, toWebp } from "@/lib/assets/store";
import { clearSizeCache } from "@/lib/creative/ad-sizes";
import { getCreative } from "@/lib/creative/gallery";
import { DEMO_LANGUAGES, insertDemoLanguages, MACHINE_TRANSLATION, WRITTEN_FOR_DEMO } from "@/lib/creative/languages";
import {
  clearPackFitCache,
  CSV_COLUMNS,
  NOT_SIGNED_OFF_PACK,
  NOTHING_PICKED_PACK,
  PACK_BUSY,
  packResponse,
  packSummary,
  packTooLarge,
  planPack,
} from "@/lib/creative/pack";
import { SIZES, type SizeId } from "@/lib/creative/render/sizes";
import { renderAd } from "@/lib/creative/render/render";
import { loadParts, renderInputFor, type KitSnapshot, type LayoutId } from "@/lib/creative/variants";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { QUILLMOOR } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

const insight = (n: number) => ({ text: `Lapsed savers say reason number ${n} matters.`, cites: [`note-${n}`] });
const brief = (title: string) => ({
  title,
  summary: "Bring lapsed savers back to the Plus plan in January.",
  story: "Savers who stopped in the autumn come back when they see their money grow.",
  insights: [insight(1), insight(2), insight(3)],
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach lapsed savers where they scroll." }],
  kpi: { metric: "reach" },
  mustInclude: [],
  avoid: [],
});
const kit: KitSnapshot = { brandName: QUILLMOOR.kit.name, palette: QUILLMOOR.kit.palette, fontPrimary: QUILLMOOR.kit.fontPrimary, fontSecondary: QUILLMOOR.kit.fontSecondary, logo: { svg: QUILLMOOR.kit.logoSvg } };

const EN = { headline: "See where your money goes", body: "Round up everyday spending into a savings pot, and watch it grow a little each week.", cta: "Get the app" };
const WORDS = {
  "fr-FR": { headline: "Voyez où va votre argent", body: "Arrondissez vos dépenses et voyez votre épargne grandir chaque semaine.", cta: "Obtenir l'app" },
  "de-DE": { headline: "Sieh, wohin dein Geld geht", body: "Runde Ausgaben auf und sieh zu, wie dein Sparkonto jede Woche wächst.", cta: "App holen" },
  "es-ES": { headline: "Mira adónde va tu dinero", body: "Redondea tus gastos y mira cómo crecen tus ahorros cada semana.", cta: "Descarga la app" },
} as const;
type L = keyof typeof WORDS;

let a: Member;
let b: Member;
/** Campaign ids and the ads in the main one. */
let ids: {
  main: string;
  draft: string;
  nothingPicked: string;
  hostile: string;
  theirs: string;
  upscaled: string;
  social1: string;
  social2: string;
  display1: string;
  unpicked: string;
  discarded: string;
  oldVersion: string;
};

/** A Quillmoor brand with its demo languages; `simulated` as the demo loader marks its brands (is_simulated). */
async function brandFor(m: Member, slug: string, simulated: boolean) {
  return asUser(m.userId, async (tx) => {
    const [br] = await tx`insert into public.brands (workspace_id, name, slug, legal_lines, created_by, is_simulated)
      values (${m.workspaceId}, ${QUILLMOOR.kit.name}, ${slug}, ${QUILLMOOR.kit.legalLines}, ${m.userId}, ${simulated}) returning id`;
    await insertDemoLanguages(tx, m, br.id as string, "quillmoor");
    return br.id as string;
  });
}

const pictures = async () => ({
  sim: await toWebp(await drawMockImage({ prompt: "pack one", palette: QUILLMOOR.kit.palette.map((p) => p.hex), size: "2K" })),
  real: await toWebp(await drawMockImage({ prompt: "pack two", palette: QUILLMOOR.kit.palette.map((p) => p.hex), size: "2K" })),
});

/** A campaign with signed-off version `approved` (or a draft), and helpers to add pictures, words, translations and ads. */
async function campaign(m: Member, brandId: string, approved: number | null) {
  return asUser(m.userId, async (tx) => {
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${brandId}, 'Bring lapsed savers back in January', ${m.userId}, 1) returning id`;
    for (let v = 1; v <= (approved ?? 1); v++) {
      await tx`update public.campaigns set current_version = ${v} where id = ${c.id}`;
      await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
        values (${m.workspaceId}, ${c.id}, ${v}, ${tx.json(brief("Savers back in January"))}, 'agent', ${m.userId})`;
    }
    if (approved) await tx`update public.campaigns set status = 'approved', approved_version = ${approved}, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
    return c.id as string;
  });
}

function builder(m: Member, brandId: string, campaignId: string) {
  return {
    image: (webp: Awaited<ReturnType<typeof toWebp>>, simulated: boolean, idea: string) =>
      asUser(m.userId, (tx) =>
        insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId, campaignId, runId: null, webp, simulated, createdByKind: "agent", meta: { picture: 1, briefVersion: 1, idea, model: simulated ? "mock" : "an image model" } }),
      ),
    words: (version: number, channel: string, copy: unknown) =>
      asUser(m.userId, async (tx) => {
        const [s] = await tx`
          insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_title, set, legal_lines, source, created_by)
          values (${m.workspaceId}, ${campaignId}, ${version}, null, ${channel}, 'Lapsed savers', ${tx.json(copy as never)}, ${QUILLMOOR.kit.legalLines}, 'agent', ${m.userId})
          returning id`;
        return s.id as string;
      }),
    translation: (version: number, channel: string, from: string, lang: L) =>
      asUser(m.userId, async (tx) => {
        const [s] = await tx`
          insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by, lang, translated_from, simulated)
          values (${m.workspaceId}, ${campaignId}, ${version}, ${channel}, 'Lapsed savers', ${tx.json(WORDS[lang] as never)},
                  ${DEMO_LANGUAGES.quillmoor[lang].legalLines}, 'agent', ${m.userId}, ${lang}, ${from}, true)
          returning id`;
        return s.id as string;
      }),
    ad: (version: number, image: string, setId: string, layout: string, picked: boolean) =>
      asUser(m.userId, async (tx) => {
        // The checks the gallery shows, as Make creative records them.
        const parts = await loadParts(tx, image, setId, kit);
        const drawn = await renderAd(renderInputFor(parts!, layout as LayoutId));
        if ("refused" in drawn) throw new Error(drawn.refused);
        const [v] = await tx`
          insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by, picked_at)
          values (${m.workspaceId}, ${campaignId}, ${version}, ${image}, ${setId}, ${layout}, ${tx.json(drawn.checks as never)}, ${tx.json(kit as never)}, 'composed', ${m.userId}, ${picked ? new Date() : null})
          returning id`;
        return v.id as string;
      }),
  };
}

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  const pic = await pictures();
  // A's brand is a simulated demo brand (as the demo loader makes it, slug "quillmoor"); B's is a person's own brand.
  const brandA = await brandFor(a, "quillmoor", true);
  const brandB = await brandFor(b, "quillmoor-b", false);

  // The main campaign: version 2 signed off. Two picked social ads on one set of words (three translations), one picked
  // display ad (French and German only; its leaderboard can't hold Quillmoor's legal lines), one unpicked, one picked
  // then discarded, and a picked ad on version 1.
  const main = await campaign(a, brandA, 2);
  const m = builder(a, brandA, main);
  const sim = await m.image(pic.sim, true, "A glass jar of coins on a sunny kitchen windowsill");
  const real = await m.image(pic.real, false, "A phone showing a savings pot beside a cup of tea");
  const extra = await m.image(await toWebp(await drawMockImage({ prompt: "pack three", palette: ["#123456", "#abcdef"], size: "2K" })), true, "A third picture");
  const social = await m.words(2, "paid social", EN);
  const display = await m.words(2, "display", EN);
  for (const l of ["fr-FR", "de-DE", "es-ES"] as const) await m.translation(2, "paid social", social, l);
  for (const l of ["fr-FR", "de-DE"] as const) await m.translation(2, "display", display, l);
  const social1 = await m.ad(2, sim, social, "full-bleed", true);
  const social2 = await m.ad(2, real, social, "split", true);
  const display1 = await m.ad(2, sim, display, "full-bleed", true);
  const unpicked = await m.ad(2, extra, social, "card", false);
  const discarded = await m.ad(2, real, display, "card", true);
  await asUser(a.userId, (tx) => tx`update public.ad_variants set discarded_at = now() where id = ${discarded}`);
  const oldWords = await m.words(1, "paid social", { ...EN, headline: "An older headline" });
  const oldVersion = await m.ad(1, sim, oldWords, "full-bleed", true);

  // A draft (not signed off) with a picked ad; a signed-off campaign with nothing picked; one whose words try to leave the folders.
  const draft = await campaign(a, brandA, null);
  const d = builder(a, brandA, draft);
  await d.ad(1, await d.image(pic.sim, true, "x"), await d.words(1, "paid social", EN), "full-bleed", true);
  const nothingPicked = await campaign(a, brandA, 1);
  const n = builder(a, brandA, nothingPicked);
  await n.ad(1, await n.image(pic.sim, true, "x"), await n.words(1, "paid social", EN), "full-bleed", false);
  const hostile = await campaign(a, brandA, 1);
  const h = builder(a, brandA, hostile);
  await h.ad(1, await h.image(pic.sim, true, "../../etc/passwd"), await h.words(1, "paid social", { headline: "../../x/..\\evil:*?<>|", body: "/etc/passwd", cta: "C:\\x" }), "full-bleed", true);

  // Another workspace's signed-off campaign with a picked ad.
  const theirs = await campaign(b, brandB, 1);
  const t = builder(b, brandB, theirs);
  await t.ad(1, await t.image(pic.sim, true, "x"), await t.words(1, "paid social", EN), "full-bleed", true);

  // A picked ad on a 1K picture (drawn before Sprint 7), English only: enlarged to fill the taller sizes.
  const upscaled = await campaign(a, brandA, 1);
  const u = builder(a, brandA, upscaled);
  const oneK = await toWebp(await drawMockImage({ prompt: "pack one k", palette: QUILLMOOR.kit.palette.map((p) => p.hex), size: "1K" }));
  await u.ad(1, await u.image(oneK, true, "A 1K picture"), await u.words(1, "paid social", EN), "full-bleed", true);

  ids = { main, draft, nothingPicked, hostile, theirs, upscaled, social1, social2, display1, unpicked, discarded, oldVersion };
}, 120_000);
beforeEach(() => {
  clearSizeCache();
  clearPackFitCache();
});
afterAll(closeSql);

type Manifest = {
  pack: { campaign: { id: string; brand: string }; brief: { version: number; signedOffAt: string | null }; counts: { pickedAds: number; files: number; leftOut: number }; labels: Record<string, unknown> };
  files: {
    file: string;
    ad: { id: string; number: number };
    channel: string;
    audience: string;
    size: { id: SizeId; width: number; height: number };
    language: { tag: string; name: string };
    headline: string;
    body: string;
    button: string;
    legalLines: string[];
    legalLinesWrittenForDemo: boolean;
    altText: string;
    picture: { source: { width: number; height: number }; upscale: number; note: string | null } | null;
    checks: { contrast: { headline: number; button: number }; fit: { passed: boolean }; legalLinesPresent: boolean };
    provenance: { picture: string; words: string; machineTranslation: string | null };
    labels: string[];
  }[];
  leftOut: { ad: { id: string }; size: { id: SizeId } | string; language: { tag: string }; reason: string }[];
};

/** A small RFC 4180 reader for the manifest's CSV (every field quoted). */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  return rows;
}

let zipCache: { files: Record<string, Uint8Array>; res: Response } | null = null;
async function mainZip() {
  if (zipCache) return zipCache;
  const res = await packResponse(a.userId, ids.main, new Date("2026-11-02T10:00:00Z"));
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  zipCache = { files, res };
  return zipCache;
}

const SIZE_LIST = (ch: "paid social" | "display") => (Object.values(SIZES) as (typeof SIZES)[SizeId][]).filter((s) => s.channel === ch).map((s) => s.id);

describe("C7-3 the launch pack", () => {
  // The main pack draws 38 ads (about half a second each), once for the tests that read it.
  beforeAll(() => mainZip(), 300_000);

  it("#1 holds every picked ad in every size and language that passed, in channel and language folders, and the count matches the gallery's", async () => {
    const { files, res } = await mainZip();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="quillmoor-money-launch-pack-2026-11-02.zip"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const names = Object.keys(files);
    const pngs = names.filter((n) => n.endsWith(".png"));
    expect(names.filter((n) => !n.endsWith(".png")).sort()).toEqual(["README.txt", "manifest.csv", "manifest.json"]);

    // Ads 1 and 2 (social, one set of words in four languages): 4 sizes × 4 languages each. Ad 3 (display, French and
    // German only): the three banners in French and German (their demo legal lines are shorter), but in English the
    // leaderboard can't hold Quillmoor's legal lines, so it is left out; Spanish is left out (no words).
    const expected: string[] = [];
    for (const n of [1, 2]) for (const l of ["en-GB", "fr-FR", "de-DE", "es-ES"]) for (const s of SIZE_LIST("paid social")) expected.push(`paid-social/${l}/ad-0${n}-${s}`);
    for (const s of ["300x250", "300x600"]) expected.push(`display/en-GB/ad-03-${s}`);
    for (const l of ["fr-FR", "de-DE"]) for (const s of SIZE_LIST("display")) expected.push(`display/${l}/ad-03-${s}`);
    expect(pngs.map((p) => /^(.*\/ad-\d\d-\d+x\d+)[-.]/.exec(p)![1]).sort()).toEqual(expected.sort());
    expect(pngs).toContain("paid-social/en-GB/ad-01-1080x1080-see-where-your-money-goes.png");
    expect(pngs).toContain("paid-social/de-DE/ad-02-1080x1920-sieh-wohin-dein-geld-geht.png");
    expect(pngs).toContain("paid-social/es-ES/ad-01-1200x628-mira-adonde-va-tu-dinero.png");

    // Each PNG is the size its name says.
    for (const p of pngs) {
      const size = /-(\d+x\d+)(-|\.png)/.exec(p)![1] as SizeId;
      const meta = await sharp(Buffer.from(files[p])).metadata();
      expect([meta.format, meta.width, meta.height], p).toEqual(["png", SIZES[size].width, SIZES[size].height]);
    }

    // The gallery's count (before download) is the zip's.
    const view = await getCreative(a.userId, ids.main);
    const summary = packSummary((await planPack(a.userId, ids.main, view))!);
    if (!summary.allowed) throw new Error(summary.reason);
    expect(summary.files).toBe(pngs.length);
    expect(summary.zipEntries).toBe(names.length);
    expect(summary.ads).toBe(3);
    expect(summary.byLanguage).toEqual([
      { lang: "en-GB", name: "English", files: 10 },
      { lang: "fr-FR", name: "French", files: 11 },
      { lang: "de-DE", name: "German", files: 11 },
      { lang: "es-ES", name: "Spanish", files: 8 },
    ]);
    expect(summary.href).toBe(`/campaigns/${ids.main}/pack.zip`);
  });

  it("#2 the manifests list every file with its words, checks and provenance, and every left-out size or language with its reason", async () => {
    const { files } = await mainZip();
    const pngs = Object.keys(files).filter((n) => n.endsWith(".png")).sort();
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
    expect(manifest.files.map((f) => f.file).sort()).toEqual(pngs);
    expect(manifest.pack.counts).toEqual({ pickedAds: 3, files: pngs.length, leftOut: manifest.leftOut.length });
    expect(manifest.pack.brief.version).toBe(2);
    expect(manifest.pack.brief.signedOffAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(manifest.pack.campaign).toMatchObject({ id: ids.main, brand: "Quillmoor Money" });

    for (const f of manifest.files) {
      const lang = f.language.tag as "en-GB" | L;
      const words = lang === "en-GB" ? EN : WORDS[lang];
      expect([f.headline, f.body, f.button], f.file).toEqual([words.headline, words.body, words.cta]);
      expect(f.legalLines, f.file).toEqual(lang === "en-GB" ? QUILLMOOR.kit.legalLines : DEMO_LANGUAGES.quillmoor[lang].legalLines);
      expect(f.altText, f.file).toContain(`Headline: ${words.headline}.`);
      expect(f.altText, f.file).toContain(`Button: ${words.cta}.`);
      expect(f.checks.fit.passed).toBe(true);
      expect(f.checks.legalLinesPresent).toBe(true);
      expect(f.checks.contrast.headline).toBeGreaterThanOrEqual(4.5);
      expect(f.checks.contrast.button).toBeGreaterThanOrEqual(4.5);
      expect(f.audience).toBe("Lapsed savers");
      expect(f.size.width).toBe(SIZES[f.size.id].width);
    }
    const ad1 = manifest.files.find((f) => f.file.startsWith("paid-social/en-GB/ad-01-1080x1080"))!;
    expect(ad1.altText).toBe("A glass jar of coins on a sunny kitchen windowsill. Headline: See where your money goes. Round up everyday spending into a savings pot, and watch it grow a little each week. Button: Get the app.");
    expect(ad1.provenance).toMatchObject({ picture: "simulated (mock image model)", words: "Copy agent", machineTranslation: null });
    const ad2 = manifest.files.find((f) => f.file.startsWith("paid-social/en-GB/ad-02-1080x1080"))!;
    expect(ad2.provenance.picture).toBe("an image model");

    // Left out: ad 3's English leaderboard (Quillmoor's legal lines don't fit it), and Spanish for ad 3 (no words).
    const left = manifest.leftOut.map((l) => [l.ad.id, typeof l.size === "string" ? l.size : l.size.id, l.language.tag, l.reason]);
    expect(left).toEqual([
      [ids.display1, "728x90", "en-GB", "The legal lines don't fit a 728 × 90 leaderboard at a readable size."],
      [ids.display1, "every size", "es-ES", "There are no Spanish words for this ad: Translate the picked ads writes them, or its Translate run says why a translation was left out."],
    ]);

    // The CSV says the same: a row per file and per left-out item, with the same columns throughout.
    // A UTF-8 byte-order mark first, so spreadsheets read the accents (the decoder drops it).
    expect([...files["manifest.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = readCsv(strFromU8(files["manifest.csv"]).replace(/^\uFEFF/, ""));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    const body = rows.slice(1);
    expect(body.every((r) => r.length === CSV_COLUMNS.length)).toBe(true);
    const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    expect(body.filter((r) => r[col("status")] === "included").map((r) => r[col("file")]).sort()).toEqual(pngs);
    const leftRows = body.filter((r) => r[col("status")] === "left out");
    expect(leftRows.map((r) => [r[col("size")], r[col("language")], r[col("reason_left_out")]])).toEqual(left.map((l) => [l[1], l[2], l[3]]));
    const de = body.find((r) => r[col("file")] === manifest.files.find((f) => f.file.startsWith("paid-social/de-DE/ad-01-1080x1350"))!.file)!;
    expect([de[col("headline")], de[col("button")], de[col("fit")], de[col("legal_lines_present")]]).toEqual([WORDS["de-DE"].headline, WORDS["de-DE"].cta, "passed", "yes"]);
  });

  it("#3 unpicked, discarded and earlier-version ads are not in the pack", async () => {
    const { files } = await mainZip();
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
    expect([...new Set(manifest.files.map((f) => f.ad.id))].sort()).toEqual([ids.social1, ids.social2, ids.display1].sort());
    const all = JSON.stringify(manifest);
    for (const id of [ids.unpicked, ids.discarded, ids.oldVersion]) expect(all).not.toContain(id);
    expect(all).not.toContain("An older headline");
  });

  it("#6 rule 1: simulated pictures and machine translations are labelled in both manifests and the README", async () => {
    const { files } = await mainZip();
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
    for (const f of manifest.files) {
      const simulatedPicture = f.ad.id !== ids.social2;
      expect(f.labels.includes("Simulated image"), f.file).toBe(simulatedPicture);
      if (f.language.tag === "en-GB") {
        expect(f.provenance.machineTranslation, f.file).toBeNull();
        expect(f.labels, f.file).not.toContain(MACHINE_TRANSLATION.simulatedLabel);
      } else {
        expect(f.provenance.machineTranslation, f.file).toBe("Machine translation (simulated)");
        expect(f.labels, f.file).toContain("Machine translation (simulated)");
      }
    }
    expect(manifest.pack.labels.machineTranslation).toEqual({ label: MACHINE_TRANSLATION.label, detail: MACHINE_TRANSLATION.detail });
    expect(manifest.pack.labels.simulatedImages).toMatch(/mock image model/);

    const csv = readCsv(strFromU8(files["manifest.csv"]).replace(/^\uFEFF/, ""));
    const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    for (const r of csv.slice(1).filter((x) => x[col("status")] === "included")) {
      expect(r[col("machine_translation")], r[col("file")]).toBe(r[col("language")] === "en-GB" ? "" : "Machine translation (simulated)");
      expect(r[col("labels")].includes("Simulated image"), r[col("file")]).toBe(!r[col("file")].includes("/ad-02-"));
    }

    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain("LAUNCH PACK: Quillmoor Money");
    expect(readme).toContain("version 2, signed off on");
    expect(readme).toMatch(/Simulated images: 24 files use pictures drawn by the mock image model/);
    expect(readme).toContain(`Machine translation: 30 files are in a language other than English. ${MACHINE_TRANSLATION.detail}`);
    expect(readme).toContain(`30 of them are "${MACHINE_TRANSLATION.simulatedLabel}"`);
    expect(readme).toContain("Left out: 2 sizes or languages");
    expect(readme).toContain("Nothing in this pack has been published");
  });

  it("#4 no sign-off, or nothing picked: a refusal with the reason, never an empty zip; the gallery offers no download", async () => {
    for (const [id, reason] of [
      [ids.draft, NOT_SIGNED_OFF_PACK],
      [ids.nothingPicked, NOTHING_PICKED_PACK],
    ]) {
      const res = await packResponse(a.userId, id);
      expect(res.status, reason).toBe(409);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe(reason);
      expect(packSummary((await planPack(a.userId, id))!)).toEqual({ allowed: false, reason });
    }
  });

  it("#7 hostile: another workspace's campaign, no session and malformed ids are the same 404", async () => {
    const notFound = async (who: string | null, id: string) => {
      const r = await packResponse(who, id);
      expect(r.status, `${who} ${id}`).toBe(404);
      expect(await r.text()).toBe("Not found");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    };
    await notFound(b.userId, ids.main);
    await notFound(a.userId, ids.theirs);
    await notFound(null, ids.main);
    await notFound(b.userId, ids.draft);
    for (const id of ["not-an-id", `${ids.main}x`, "00000000-0000-0000-0000-000000000000", "../../etc/passwd", "1' or '1'='1", ""]) await notFound(a.userId, id);
    expect(await planPack(b.userId, ids.main)).toBeNull();
    // Their own campaign answers in B's workspace, so the 404s are about access.
    const own = await packResponse(b.userId, ids.theirs);
    expect(own.status).toBe(200);
    // Not read here: cancelled, as a closed tab is, which frees the one-pack-at-a-time slot (review fix 2).
    await own.body!.cancel();
  });

  it("#7 hostile: words like ../../x can't leave the zip's folders, and the CSV defuses formulas", async () => {
    const res = await packResponse(a.userId, ids.hostile);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files);
    expect(names).toHaveLength(4 + 3);
    for (const n of names) {
      expect(n, n).toMatch(/^(paid-social\/en-GB\/ad-01-\d+x\d+-x-evil\.png|manifest\.json|manifest\.csv|README\.txt)$/);
      expect(n).not.toContain("..");
      expect(n).not.toContain("\\");
    }
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
    expect(manifest.files[0].headline).toBe("../../x/..\\evil:*?<>|");
  });
  it("review fix 5 (rule 1, Q4): legal lines written for the demo are marked in both manifests and the README", async () => {
    const { files } = await mainZip();
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
    for (const f of manifest.files) expect(f.legalLinesWrittenForDemo, f.file).toBe(f.language.tag !== "en-GB");
    expect(manifest.pack.labels.legalLinesWrittenForDemo).toBe(WRITTEN_FOR_DEMO);
    const csv = readCsv(strFromU8(files["manifest.csv"]).replace(/^\uFEFF/, ""));
    const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    for (const r of csv.slice(1)) {
      const expected = r[col("status")] === "left out" ? "" : r[col("language")] === "en-GB" ? "no" : "yes";
      expect(r[col("legal_lines_written_for_demo")], r[col("file")]).toBe(expected);
    }
    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain(`- Legal lines written for the demo: 30 files have French, German and Spanish legal lines that say so in the manifests. ${WRITTEN_FOR_DEMO}`);
  });

  it("review fix 6: the README says the brand is fictional only for a simulated demo brand, and the legal lines only where the brand has them", async () => {
    const { files } = await mainZip();
    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain("each of which passed its checks (contrast, fit, and the legal lines where the brand has them)");
    expect(readme).toContain("Studio is a working title. The brand in this pack is fictional.");
    // B's brand is a person's own (not a simulated demo brand): no claim either way about it.
    const theirs = unzipSync(new Uint8Array(await (await packResponse(b.userId, ids.theirs)).arrayBuffer()));
    const theirReadme = strFromU8(theirs["README.txt"]);
    expect(theirReadme).toContain("Studio is a working title.");
    expect(theirReadme).not.toContain("fictional");
  });

  it("review fix 7: each file records its picture's size and upscale factor, and the README names the upscaled files", async () => {
    const { files } = await mainZip();
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
    // The 2K pictures are never enlarged more than 1.1 times.
    for (const f of manifest.files) {
      expect(f.picture, f.file).not.toBeNull();
      expect(f.picture!.source, f.file).toEqual({ width: 2048, height: 2048 });
      expect(f.picture!.note, f.file).toBeNull();
    }
    expect(strFromU8(files["README.txt"])).toContain("No picture is enlarged more than 1.1 times.");

    const res = await packResponse(a.userId, ids.upscaled);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const m = JSON.parse(strFromU8(zip["manifest.json"])) as Manifest;
    expect(m.files.map((f) => f.size.id).sort()).toEqual([...SIZE_LIST("paid social")].sort());
    const story = m.files.find((f) => f.size.id === "1080x1920")!;
    expect(story.picture).toEqual({ source: { width: 1024, height: 1024 }, upscale: 1.88, note: "Upscaled from a 1K picture" });
    // The square fills 1080 from 1024: 1.05 times, too little to see, so no note (as in the Sizes view).
    const square = m.files.find((f) => f.size.id === "1080x1080")!;
    expect(square.picture).toMatchObject({ source: { width: 1024, height: 1024 }, note: null });
    expect(square.picture!.upscale).toBeCloseTo(1.05, 2);
    const csv = readCsv(strFromU8(zip["manifest.csv"]).replace(/^\uFEFF/, ""));
    const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    const row = csv.find((r) => r[col("file")] === story.file)!;
    expect([row[col("picture_source_size")], row[col("picture_upscale")]]).toEqual(["1024x1024", "1.88"]);
    const upscaledFiles = m.files.filter((f) => f.picture?.note).length;
    expect(upscaledFiles).toBeGreaterThanOrEqual(2);
    expect(strFromU8(zip["README.txt"])).toContain(
      `- Upscaled from a 1K picture: ${upscaledFiles} files enlarge their pictures more than 1.1 times to fill the size, so they may look soft.`,
    );
  });

  it("review fix 2: a pack over the ceiling is refused with the reason, in the gallery and at the address, and no zip is drawn", async () => {
    const reason = packTooLarge(4, 3);
    expect(reason).toBe("This pack would have 4 files; the most one download can draw is 3. Pick fewer ads.");
    const res = await packResponse(a.userId, ids.hostile, new Date(), { maxFiles: 3 });
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(reason);
    expect(packSummary((await planPack(a.userId, ids.hostile))!, 3)).toEqual({ allowed: false, reason });
    // At the ceiling itself, the pack is allowed.
    expect(packSummary((await planPack(a.userId, ids.hostile))!, 4).allowed).toBe(true);
  });

  it("review fix 2: one pack at a time per instance; the slot is freed when the zip ends or is cancelled", async () => {
    const first = await packResponse(a.userId, ids.hostile);
    expect(first.status).toBe(200);
    for (const [who, id] of [[a.userId, ids.hostile], [b.userId, ids.theirs]] as const) {
      const busy = await packResponse(who, id);
      expect(busy.status).toBe(429);
      expect(busy.headers.get("retry-after")).toBe("60");
      expect(await busy.text()).toBe(PACK_BUSY);
    }
    // Refusals and 404s don't wait for the slot.
    expect((await packResponse(a.userId, ids.draft)).status).toBe(409);
    expect((await packResponse(b.userId, ids.main)).status).toBe(404);
    // Read to the end: the slot is free again.
    expect(Object.keys(unzipSync(new Uint8Array(await first.arrayBuffer())))).toHaveLength(7);
    const second = await packResponse(a.userId, ids.hostile);
    expect(second.status).toBe(200);
    expect((await packResponse(a.userId, ids.hostile)).status).toBe(429);
    // Cancelled part-way (a closed tab): free again.
    await second.body!.cancel();
    const third = await packResponse(a.userId, ids.hostile);
    expect(third.status).toBe(200);
    await third.arrayBuffer();
  });
});
