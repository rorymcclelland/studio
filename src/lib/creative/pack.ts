import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { complianceFor, complianceForTx, fileCompliance } from "@/lib/compliance/compute";
import { noIssuesFoundByAi, type Judged } from "@/lib/compliance/rules";
import { asUser, asUserIn, type Tx } from "@/lib/db/scoped";
import { drawInSize, sentence, translationBadge, upscaleNote } from "./ad-sizes";
import { clearFitCache, fitBase, fitsFor, logoFor } from "./fit-cache";
import { getCreative, type CreativeView, type VariantView } from "./gallery";
import { brandLanguagesIn, DEMO_LANGUAGES, ENGLISH, isDemoSlug, LANG_NAMES, MACHINE_TRANSLATION, SUPPORTED_LANGS, WRITTEN_FOR_DEMO, type Lang } from "./languages";
import type { RenderChecks } from "./render/render";
import { SIZES, sizesFor, type DrawLayoutId, type SizeId } from "./render/sizes";
import { languageOptions } from "./translate";
import { OUT_OF_DATE, pretestViews, SYNTHETIC_PANEL, type PretestView } from "./pretest";
import {
  adEtag,
  loadParts,
  type AdChannel,
  type AdWords,
  type DrawableVariant,
  type EtagParts,
  type KitSnapshot,
  type LayoutId,
  type PictureCache,
} from "./variants";

// C7-3: the launch pack. Every picked ad of the signed-off brief version, in
// every size of its channel, in English and each current translation, as one
// zip streamed from /campaigns/<id>/pack.zip (decision 0020). Nothing is stored
// and nothing leaves Studio, so no approval is asked (rule 3, Q6); the access
// check is the gallery's (rule 7). The pack is planned first, without drawing:
// each ad, language and size is fitted as drawInSize would draw it, so the
// gallery can show the file count and what will be left out. The zip then
// draws one size at a time into the stream (the 4.5 MB limit is on buffered
// responses only), and writes manifest.json, manifest.csv and README.txt last,
// from what was actually drawn. Nothing is left out silently: a size or
// language that can't go in is listed with its reason. Simulated pictures and
// words and machine translations are labelled in both manifests and the
// README (rule 1), and so are legal lines written for the demo (Q4). A pack is
// at most PACK_MAX_FILES drawings, and one pack is drawn at a time per server
// instance (review fix 2): a larger or second one is refused with the reason.

export const PACK_VERSION = 1;

export type PackLang = Lang | typeof ENGLISH;

const CHANNEL_FOLDER: Record<AdChannel, string> = { "paid social": "paid-social", display: "display" };

export const NOT_SIGNED_OFF_PACK = "There's no launch pack until the brief is signed off: a pack holds only ads made from a signed-off brief.";
export const NOTHING_PICKED_PACK = "There's no launch pack yet: nothing is picked. Pick the ads to launch in the gallery, then build the pack.";
export const NOTHING_PASSES_PACK =
  "There's no launch pack yet: every size and language of the picked ads fails a compliance rule or awaits review. Each ad's Compliance view says why, and what would fix it.";

/** Words as a file name: ASCII letters and digits in lowercase, joined by hyphens, never a path. */
export function slugify(text: string, max = 40): string {
  return text
    .split("­")
    .join("")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/** paid-social/de-DE/ad-03-1080x1920-sieh-wohin-dein-geld-geht.png: the folders are fixed; only the slug comes from words. */
export function packPath(channel: AdChannel, lang: PackLang, adNumber: number, size: SizeId, headline: string): string {
  const slug = slugify(headline);
  return `${CHANNEL_FOLDER[channel]}/${lang}/ad-${String(adNumber).padStart(2, "0")}-${size}${slug ? `-${slug}` : ""}.png`;
}

const shown = (s: string) => s.split("­").join("");

export type PackWords = { headline: string; body: string; cta: string };

/** One file the pack will hold (planned), and once drawn, its checks. */
export type PackItem = {
  path: string;
  adId: string;
  adNumber: number;
  channel: AdChannel;
  audience: string;
  size: SizeId;
  sizeName: string;
  width: number;
  height: number;
  lang: PackLang;
  langName: string;
  /** The layout the size is drawn in (the ad's own, or the size's fallback). */
  layout: DrawLayoutId;
  setId: string;
  words: PackWords;
  legalLines: string[];
  /** Q4: the language's legal lines were written by Claude for the demo, not by the brand (never for English). */
  legalLinesWrittenForDemo: boolean;
  altText: string;
  picture: { assetId: string; simulated: boolean; model: string | null; idea: string | null };
  wordsFrom: { setId: string; source: "agent" | "person"; runId: string | null; model: string | null; simulated: boolean };
  /** Rule 1: every translated file says it is a machine translation. */
  translation: { label: string; detail: string; simulated: boolean; runId: string | null; fromSetId: string } | null;
  /** C8-1: each rule's status for this file (its own and the ad's don't rules), as the Compliance view shows it, with who accepted any review item. */
  compliance: PackCompliance;
};

export type PackCompliance = {
  /** "passes": every rule passed; "accepted": every review item was accepted by a person. */
  outcome: "passes" | "accepted";
  rules: {
    rule: string;
    name: string;
    /** "file" for this size and language; "ad" for a finding about the whole ad (a don't rule); "picture" for the picture check's (C8-2, checked by AI). */
    scope: "file" | "ad" | "picture";
    /** "no issues found by AI": the picture check's "no", never recorded as a pass (decision 0009, Q4). */
    status: "pass" | "review" | "fail" | "not applied" | "no issues found by AI";
    reason: string;
    /** Rule 1: "Checked by AI" (with "(simulated: the mock model)" for the mock) on the picture check's findings; null for findings checked in code. */
    checkedBy: string | null;
    acceptedBy: string | null;
    acceptedAt: string | null;
    note: string | null;
  }[];
};

/** A file's findings as the manifests record them. Only files that pass or are accepted reach the pack. */
export function packCompliance(findings: Judged[]): PackCompliance {
  return {
    outcome: findings.some((f) => f.outcome === "accepted") ? "accepted" : "passes",
    rules: findings.map((f) => ({
      rule: f.rule === "dont" ? f.key : f.rule,
      name: f.rule === "dont" ? `${f.name}: ${f.fix ?? ""}` : f.name,
      scope: f.rule === "face" || f.rule === "picture" ? "picture" : f.size === null ? "ad" : "file",
      status: f.status === "na" ? "not applied" : noIssuesFoundByAi(f) ? "no issues found by AI" : f.status,
      reason: f.reason,
      checkedBy: f.checkedBy ?? null,
      acceptedBy: f.outcome === "accepted" ? (f.decision?.decidedByName ?? null) : null,
      acceptedAt: f.outcome === "accepted" ? (f.decision?.decidedAt.toISOString() ?? null) : null,
      note: f.outcome === "accepted" ? (f.decision?.note ?? null) : null,
    })),
  };
}

/** Who accepted a file's review items, each once ("" when none needed a person). */
export function reviewedBy(c: PackCompliance): string {
  return [...new Set(c.rules.flatMap((r) => (r.acceptedBy ? [r.acceptedBy] : [])))].join("; ");
}

export type PackLeftOut = {
  adId: string;
  adNumber: number;
  channel: AdChannel;
  audience: string;
  headline: string;
  /** Null when a whole language is left out for the ad. */
  size: SizeId | null;
  sizeName: string | null;
  lang: PackLang;
  langName: string;
  reason: string;
};

export type PackPlan = {
  campaign: {
    id: string;
    objective: string;
    brandName: string;
    /** The brand's data is simulated (brands.is_simulated). */
    brandSimulated: boolean;
    /** D-2 (decision 0029): the brand is invented (brands.is_fictional, the demo brands): the README says it is fictional only then. */
    brandFictional: boolean;
    briefTitle: string | null;
    briefVersion: number;
    signedOffAt: Date | null;
  };
  /** The picked ads, in gallery order, with their gallery numbers. */
  ads: { id: string; number: number; channel: AdChannel; audience: string; headline: string; layout: LayoutId }[];
  items: PackItem[];
  leftOut: PackLeftOut[];
  /** The ad's English parts each item is drawn from (not in the manifest). */
  sources: Map<string, { imageAssetId: string; kit: KitSnapshot; layout: LayoutId; etagParts: EtagParts }>;
  /** C8-4: the synthetic panel's scores for each picked ad, by ad id (none when an ad was never pre-tested). */
  pretest?: Map<string, PretestView>;
};

export type PackRefusal = { refused: string };

/** Forgets the planned fits (tests); the cache is shared with the gallery's thumbnails (fit-cache.ts). */
export function clearPackFitCache() {
  clearFitCache();
}

const sameLines = (x: string[], y: readonly string[]) => x.length === y.length && x.every((l, i) => l === y[i]);

function altText(idea: string | null, w: PackWords): string {
  const picture = idea?.trim() ? `${idea.trim().replace(/[.\s]+$/, "")}. ` : "";
  return `${picture}Headline: ${w.headline}. ${w.body ? `${w.body.replace(/[.\s]+$/, "")}. ` : ""}Button: ${w.cta}.`;
}

/**
 * What the pack for a campaign will hold, worked out without drawing: null
 * when the campaign isn't the user's (a 404), a refusal with the reason when
 * the brief isn't signed off or nothing is picked, or the plan. Pass the
 * gallery's view when it is already loaded.
 */
export async function planPack(userId: string, campaignId: string, given?: CreativeView | null, inTx?: Tx): Promise<PackPlan | PackRefusal | null> {
  const view = given ?? (await getCreative(userId, campaignId, inTx));
  if (!view) return null;
  if (!view.signedOff || view.version === null) return { refused: NOT_SIGNED_OFF_PACK };
  const numbers = new Map(view.variants.map((v, i) => [v.id, i + 1]));
  const picked: VariantView[] = view.variants.filter((v) => v.picked && v.briefVersion === view.version);
  if (picked.length === 0) return { refused: NOTHING_PICKED_PACK };
  const ids = picked.map((v) => v.id);
  // C8-1: the same findings the Compliance view shows (the fits are shared through the fit cache).
  const compliance = inTx ? await complianceForTx(inTx, ids) : await complianceFor(userId, ids);

  return asUserIn(inTx, userId, async (tx) => {
    const [c] = await tx`
      select c.objective, c.approved_at, c.brand_id, b.name as brand_name, b.slug as brand_slug, b.is_simulated as brand_simulated, b.is_fictional as brand_fictional,
        bv.brief ->> 'title' as brief_title
      from public.campaigns c join public.brands b on b.id = c.brand_id
      left join public.brief_versions bv on bv.campaign_id = c.id and bv.version = c.approved_version
      where c.id = ${campaignId}`;
    if (!c) return null;
    const rows = await tx`
      select v.id, v.layout, v.kit, v.image_asset_id, v.copy_set_id, a.sha256, a.simulated as picture_simulated,
        a.meta ->> 'model' as picture_model, a.meta ->> 'idea' as idea,
        s.channel, s.set, s.legal_lines, s.source, s.run_id,
        (select st.provider from public.agent_steps st where st.run_id = s.run_id and st.kind = 'model' order by st.seq desc limit 1) as words_provider,
        (select st.model from public.agent_steps st where st.run_id = s.run_id and st.kind = 'model' order by st.seq desc limit 1) as words_model
      from public.ad_variants v
      join public.assets a on a.id = v.image_asset_id
      join public.copy_sets s on s.id = v.copy_set_id
      where v.id = any(${ids}::uuid[])`;
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    const setIds = [...new Set(rows.map((r) => r.copy_set_id as string))];
    const translations = await tx`
      select id, translated_from, lang, set, legal_lines, simulated, run_id from public.copy_sets
      where translated_from = any(${setIds}::uuid[]) and discarded_at is null
      order by created_at`;
    const { options } = await languageOptions(tx, c.brand_id as string);
    const brandLanguages = await brandLanguagesIn(tx, c.brand_id as string);
    const brandSlug = c.brand_slug as string;
    const brandSimulated = c.brand_simulated === true;
    const brandFictional = c.brand_fictional === true;
    // Q4 and rule 1: a translation's legal lines are a snapshot. They are marked as written for the demo when the
    // language's lines are still the ones written for the demo, or when they are the demo brand's own demo lines
    // (a language edited or removed since keeps its old translations, still marked).
    const demoLegal = (lang: Lang, lines: string[]) => {
      const now = brandLanguages.find((l) => l.lang === lang);
      if (now?.writtenForDemo && sameLines(lines, now.legalLines)) return true;
      return brandFictional && isDemoSlug(brandSlug) && lines.length > 0 && sameLines(lines, DEMO_LANGUAGES[brandSlug][lang].legalLines);
    };
    const logos = new Map<string, Buffer | null>();

    const items: PackItem[] = [];
    const leftOut: PackLeftOut[] = [];
    const ads: PackPlan["ads"] = [];
    const sources: PackPlan["sources"] = new Map();
    for (const v of picked) {
      const r = byId.get(v.id);
      if (!r) continue;
      const number = numbers.get(v.id) ?? 0;
      const channel = r.channel as AdChannel;
      const kit = r.kit as KitSnapshot;
      const layout = r.layout as LayoutId;
      const audience = v.words.audience.title;
      const english = r.set as AdWords;
      ads.push({ id: v.id, number, channel, audience, headline: shown(english.headline), layout });
      sources.set(v.id, {
        imageAssetId: r.image_asset_id as string,
        kit,
        layout,
        etagParts: { imageSha256: r.sha256 as string, copySetId: r.copy_set_id as string, layout, kit, simulated: r.picture_simulated === true },
      });
      const logo = await logoFor(tx, kit, logos);
      const picture = { assetId: r.image_asset_id as string, simulated: r.picture_simulated === true, model: (r.picture_model as string | null) ?? null, idea: (r.idea as string | null) ?? null };
      const englishFrom = {
        setId: r.copy_set_id as string,
        source: r.source as "agent" | "person",
        runId: (r.run_id as string | null) ?? null,
        model: r.words_model ? `${r.words_provider}/${r.words_model}` : null,
        simulated: r.words_provider === "mock",
      };
      const mine = translations.filter((t) => t.translated_from === r.copy_set_id);
      const langs: PackLang[] = [ENGLISH, ...SUPPORTED_LANGS.filter((l) => options.some((o) => o.lang === l) || mine.some((t) => t.lang === l))];
      for (const lang of langs) {
        const t = lang === ENGLISH ? null : mine.filter((x) => x.lang === lang).at(-1);
        const langName = LANG_NAMES[lang];
        if (lang !== ENGLISH && !t) {
          const option = options.find((o) => o.lang === lang);
          leftOut.push({
            adId: v.id,
            adNumber: number,
            channel,
            audience,
            headline: shown(english.headline),
            size: null,
            sizeName: null,
            lang,
            langName,
            reason: option?.reason
              ? sentence(option.reason)
              : `There are no ${langName} words for this ad: Translate the picked ads writes them, or its Translate run says why a translation was left out.`,
          });
          continue;
        }
        const setId = t ? (t.id as string) : (r.copy_set_id as string);
        const raw = (t ? t.set : r.set) as AdWords;
        const legalLines = (t ? t.legal_lines : r.legal_lines) as string[];
        const words = { headline: shown(raw.headline), body: shown(raw.body), cta: shown(raw.cta) };
        const fits = await fitsFor(setId, fitBase(raw, legalLines, logo, kit), layout, channel, kit);
        const badge = t ? translationBadge(t.simulated === true) : null;
        const legalLinesWrittenForDemo = lang !== ENGLISH && demoLegal(lang, legalLines);
        // C8-1: files that fail a rule or await review, by reason; one reason for every size of the language is listed once.
        const held: { size: SizeId; reason: string }[] = [];
        const ad = compliance.get(v.id);
        for (const f of fits) {
          const size = SIZES[f.size];
          if (!f.ok) {
            leftOut.push({ adId: v.id, adNumber: number, channel, audience, headline: words.headline, size: f.size, sizeName: size.name, lang, langName, reason: sentence(f.refused) });
            continue;
          }
          const fc = ad ? fileCompliance(ad, lang, f.size, { setId, layout: f.layout }) : null;
          if (!fc || fc.leftOut) {
            held.push({ size: f.size, reason: fc?.leftOut ?? "Its compliance checks couldn't be worked out; open the ad's Compliance view." });
            continue;
          }
          items.push({
            path: packPath(channel, lang, number, f.size, words.headline),
            adId: v.id,
            adNumber: number,
            channel,
            audience,
            size: f.size,
            sizeName: size.name,
            width: size.width,
            height: size.height,
            lang,
            langName,
            layout: f.layout,
            setId,
            words,
            legalLines,
            legalLinesWrittenForDemo,
            altText: altText(picture.idea, words),
            picture,
            wordsFrom: t
              ? { setId, source: "agent", runId: (t.run_id as string | null) ?? null, model: null, simulated: t.simulated === true }
              : englishFrom,
            translation: t && badge ? { label: badge.label, detail: badge.detail, simulated: t.simulated === true, runId: (t.run_id as string | null) ?? null, fromSetId: r.copy_set_id as string } : null,
            compliance: packCompliance(fc.findings),
          });
        }
        const fitted = fits.filter((f) => f.ok).length;
        const reasons = [...new Set(held.map((h) => h.reason))];
        if (held.length > 1 && held.length === fitted && reasons.length === 1) {
          leftOut.push({ adId: v.id, adNumber: number, channel, audience, headline: words.headline, size: null, sizeName: null, lang, langName, reason: reasons[0] });
        } else {
          for (const h of held) leftOut.push({ adId: v.id, adNumber: number, channel, audience, headline: words.headline, size: h.size, sizeName: SIZES[h.size].name, lang, langName, reason: h.reason });
        }
      }
    }
    return {
      campaign: {
        id: campaignId,
        objective: c.objective as string,
        brandName: c.brand_name as string,
        brandSimulated,
        brandFictional,
        briefTitle: (c.brief_title as string | null) ?? null,
        briefVersion: view.version!,
        signedOffAt: (c.approved_at as Date | null) ?? null,
      },
      ads,
      items,
      leftOut,
      sources,
      pretest: await pretestViews(tx, ids),
    };
  });
}

export type PackSummary =
  | { allowed: false; reason: string; /** C8-1: when every file is held back, what and why. */ leftOut?: PackLeftOut[] }
  | {
      allowed: true;
      href: string;
      ads: number;
      /** Drawn ads in the zip (PNG files). */
      files: number;
      /** Every file in the zip: the ads plus manifest.json, manifest.csv and README.txt. */
      zipEntries: number;
      byLanguage: { lang: PackLang; name: string; files: number }[];
      byChannel: { channel: AdChannel; files: number; sizes: string[] }[];
      leftOut: PackLeftOut[];
      simulatedPictures: boolean;
      machineTranslations: boolean;
      /** A rough time to draw it, for the button's note (about half a second a file, measured). */
      seconds: number;
    };

export const PACK_EXTRAS = ["manifest.json", "manifest.csv", "README.txt"] as const;

/**
 * The most drawings one download may hold (review fix 2). Drawing takes about
 * half a second a file and the route has 300 s (maxDuration), so a pack of
 * about 250 files or more would be cut off and leave a zip that won't open;
 * 200 keeps a margin for a slow instance.
 */
export const PACK_MAX_FILES = 200;

export function packTooLarge(files: number, max = PACK_MAX_FILES): string {
  return `This pack would have ${files} files; the most one download can draw is ${max}. Pick fewer ads.`;
}

/** What the gallery shows before download: the counts, what's left out, or why there's no pack. */
export function packSummary(plan: PackPlan | PackRefusal, maxFiles = PACK_MAX_FILES): PackSummary {
  if ("refused" in plan) return { allowed: false, reason: plan.refused };
  if (plan.items.length === 0) return { allowed: false, reason: NOTHING_PASSES_PACK, leftOut: plan.leftOut };
  if (plan.items.length > maxFiles) return { allowed: false, reason: packTooLarge(plan.items.length, maxFiles) };
  const langs = [ENGLISH, ...SUPPORTED_LANGS] as PackLang[];
  return {
    allowed: true,
    href: `/campaigns/${plan.campaign.id}/pack.zip`,
    ads: plan.ads.length,
    files: plan.items.length,
    zipEntries: plan.items.length + PACK_EXTRAS.length,
    byLanguage: langs.map((l) => ({ lang: l, name: LANG_NAMES[l], files: plan.items.filter((i) => i.lang === l).length })).filter((x) => x.files > 0),
    byChannel: (["paid social", "display"] as AdChannel[])
      .map((ch) => ({ channel: ch, files: plan.items.filter((i) => i.channel === ch).length, sizes: sizesFor(ch).map((s) => s.name) }))
      .filter((x) => x.files > 0),
    leftOut: plan.leftOut,
    simulatedPictures: plan.items.some((i) => i.picture.simulated),
    machineTranslations: plan.items.some((i) => i.translation),
    seconds: Math.max(5, Math.ceil(plan.items.length * 0.5)),
  };
}

// ---------------------------------------------------------------- manifests

export type DrawnItem = PackItem & { checks: RenderChecks<DrawLayoutId> };

/** The picture's own size and how much it is enlarged in this file (from the renderer's checks), with the Sizes view's note. */
export function pictureScale(i: DrawnItem): { source: { width: number; height: number }; upscale: number; note: string | null } | null {
  const pic = i.checks.picture;
  if (!pic) return null;
  return { source: { width: pic.source.width, height: pic.source.height }, upscale: Math.round(pic.upscale * 100) / 100, note: upscaleNote(pic)?.label ?? null };
}

/** The labels a file carries (rule 1): simulated picture, simulated words, machine translation. */
export function labelsFor(i: PackItem): string[] {
  const labels: string[] = [];
  if (i.picture.simulated) labels.push("Simulated image");
  if (i.translation) labels.push(i.translation.label);
  else if (i.wordsFrom.simulated) labels.push("Simulated words");
  return labels;
}

function pictureProvenance(i: PackItem): string {
  return i.picture.simulated ? "simulated (mock image model)" : (i.picture.model ?? "image model (not recorded)");
}

function wordsProvenance(i: PackItem): string {
  if (i.translation) return i.translation.simulated ? "machine translation (simulated: the mock model's fixed words)" : "machine translation (Localise agent)";
  if (i.wordsFrom.source === "person") return "written by a person";
  return i.wordsFrom.simulated ? "simulated (mock Copy agent)" : `Copy agent${i.wordsFrom.model ? ` (${i.wordsFrom.model})` : ""}`;
}

export function manifestJson(plan: PackPlan, drawn: DrawnItem[], leftOut: PackLeftOut[], madeAt: Date): string {
  const simulatedPictures = drawn.some((i) => i.picture.simulated);
  const simulatedWords = drawn.some((i) => (i.translation ? i.translation.simulated : i.wordsFrom.simulated));
  const translations = drawn.some((i) => i.translation);
  const demoLegal = drawn.some((i) => i.legalLinesWrittenForDemo);
  const manifest = {
    pack: {
      madeBy: "Studio (working title)",
      packVersion: PACK_VERSION,
      madeAt: madeAt.toISOString(),
      campaign: { id: plan.campaign.id, objective: plan.campaign.objective, brand: plan.campaign.brandName },
      brief: { title: plan.campaign.briefTitle, version: plan.campaign.briefVersion, signedOffAt: plan.campaign.signedOffAt?.toISOString() ?? null },
      counts: { pickedAds: plan.ads.length, files: drawn.length, leftOut: leftOut.length },
      labels: {
        simulatedImages: simulatedPictures ? "Some pictures were drawn by the mock image model, not a real one; each such file is labelled \"Simulated image\" here and on the ad itself." : null,
        simulatedWords: simulatedWords ? "Some words were written by the mock model, not a real one; each such file is labelled here." : null,
        machineTranslation: translations ? { label: MACHINE_TRANSLATION.label, detail: MACHINE_TRANSLATION.detail } : null,
        legalLinesWrittenForDemo: demoLegal ? WRITTEN_FOR_DEMO : null,
        syntheticPanel: SYNTHETIC_PANEL,
      },
      pretest: panelScores(plan),
    },
    files: drawn.map((i) => ({
      file: i.path,
      ad: { id: i.adId, number: i.adNumber },
      channel: i.channel,
      audience: i.audience,
      size: { id: i.size, name: i.sizeName, width: i.width, height: i.height },
      language: { tag: i.lang, name: i.langName },
      layout: i.checks.layout,
      headline: i.words.headline,
      body: i.words.body,
      button: i.words.cta,
      legalLines: i.legalLines,
      legalLinesWrittenForDemo: i.legalLinesWrittenForDemo,
      altText: i.altText,
      /** The picture's own size and the factor it is enlarged by to fill this size (above 1.1: "Upscaled"). */
      picture: pictureScale(i),
      checks: {
        contrast: { headline: i.checks.contrast.headline, body: i.checks.contrast.body, legal: i.checks.contrast.legal, button: i.checks.contrast.cta, aa: "4.5:1" },
        fit: { passed: true, headlinePx: i.checks.fit.headline.size, bodyPx: i.checks.fit.body.size, legalPx: i.checks.fit.legal.size },
        legalLinesPresent: i.checks.legalLinePresent,
        legalNote: i.checks.legalNote ?? null,
        logo: i.checks.logo,
        simulatedLabelDrawn: i.checks.simulatedLabel === true,
      },
      /** C8-1: each compliance rule's status for this file, as the ad's Compliance view shows it, and who accepted any review item. */
      compliance: i.compliance,
      provenance: {
        picture: pictureProvenance(i),
        pictureAssetId: i.picture.assetId,
        words: wordsProvenance(i),
        copySetId: i.setId,
        /** The run that wrote these words: the Copy agent's for English, the Localise agent's for a translation. */
        wordsRunId: i.wordsFrom.runId,
        machineTranslation: i.translation ? i.translation.label : null,
        translatedFrom: i.translation?.fromSetId ?? null,
      },
      labels: labelsFor(i),
      pretest: panelAverageFor(plan, i.adId),
    })),
    leftOut: leftOut.map((l) => ({
      ad: { id: l.adId, number: l.adNumber },
      channel: l.channel,
      audience: l.audience,
      headline: l.headline,
      size: l.size ? { id: l.size, name: l.sizeName } : "every size",
      language: { tag: l.lang, name: l.langName },
      reason: l.reason,
    })),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * C8-4: the synthetic panel's scores for each picked ad, labelled (rule 1).
 * Only scores for the ad as it is now are given; scores for an earlier version
 * of an ad (a redraw, new words, a new picture or another layout) say "Out of
 * date: pre-test again" instead. Scores, never results or predictions.
 */
export function panelScores(plan: PackPlan) {
  return {
    label: SYNTHETIC_PANEL,
    note: "Each picked ad's scores from 1 to 5 by the brief's synthetic personas, each with a reason quoting the ad. They are not results or predictions.",
    ads: plan.ads.map((a) => {
      const p = plan.pretest?.get(a.id);
      const ad = { id: a.id, number: a.number, headline: a.headline };
      if (!p) return { ad, status: "not pre-tested", average: null, personas: [] };
      if (p.state !== "current") return { ad, status: OUT_OF_DATE, average: null, personas: [] };
      return {
        ad,
        status: "current",
        label: SYNTHETIC_PANEL,
        simulated: p.simulated,
        simulatedScores: p.simulated ? "Simulated scores: written by the mock model for the demo, not a real one." : null,
        average: p.average,
        scoredAt: p.createdAt.toISOString(),
        runId: p.runId,
        personas: p.personas.map((x) => ({ name: x.name, segment: x.segment, average: x.average, scores: x.scores })),
      };
    }),
  };
}

/** C8-4: a file's ad's panel average, with the label; null when the ad has no current scores. */
function panelAverageFor(plan: PackPlan, adId: string): { label: string; average: number; simulated: boolean } | null {
  const p = plan.pretest?.get(adId);
  return p && p.state === "current" ? { label: SYNTHETIC_PANEL, average: p.average, simulated: p.simulated } : null;
}

/** One CSV field: quoted, quotes doubled, and a leading = + - @ (or tab or return) defused so a spreadsheet reads it as text. */
export function csvField(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS = [
  "status",
  "file",
  "ad",
  "channel",
  "audience",
  "size",
  "size_name",
  "language",
  "language_name",
  "headline",
  "body",
  "button",
  "legal_lines",
  "legal_lines_written_for_demo",
  "alt_text",
  "contrast_text",
  "contrast_button",
  "fit",
  "legal_lines_present",
  "picture",
  "picture_source_size",
  "picture_upscale",
  "words",
  "machine_translation",
  "labels",
  "compliance",
  "reviewed_by",
  "reason_left_out",
] as const;

/** The CSV's compliance cell: "Passes", or "Passes, 3 review items accepted". */
export function complianceCell(c: PackCompliance): string {
  const accepted = c.rules.filter((r) => r.acceptedBy).length;
  return accepted ? `Passes, ${accepted} review ${accepted === 1 ? "item" : "items"} accepted` : "Passes";
}

export function manifestCsv(drawn: DrawnItem[], leftOut: PackLeftOut[]): string {
  const rows: (string | number | boolean | null)[][] = [];
  for (const i of drawn) {
    const scale = pictureScale(i);
    rows.push([
      "included",
      i.path,
      i.adNumber,
      i.channel,
      i.audience,
      i.size,
      i.sizeName,
      i.lang,
      i.langName,
      i.words.headline,
      i.words.body,
      i.words.cta,
      i.legalLines.join(" | "),
      i.legalLinesWrittenForDemo ? "yes" : "no",
      i.altText,
      Math.min(i.checks.contrast.headline, i.checks.contrast.body, i.checks.contrast.legal).toFixed(1),
      i.checks.contrast.cta.toFixed(1),
      "passed",
      i.checks.legalLinePresent ? "yes" : "no legal lines in the kit",
      pictureProvenance(i),
      scale ? `${scale.source.width}x${scale.source.height}` : "",
      scale ? scale.upscale.toFixed(2) : "",
      wordsProvenance(i),
      i.translation ? i.translation.label : "",
      labelsFor(i).join("; "),
      complianceCell(i.compliance),
      reviewedBy(i.compliance),
      "",
    ]);
  }
  for (const l of leftOut) {
    const row: (string | number | null)[] = CSV_COLUMNS.map(() => "");
    const put = (col: (typeof CSV_COLUMNS)[number], value: string | number) => (row[CSV_COLUMNS.indexOf(col)] = value);
    put("status", "left out");
    put("ad", l.adNumber);
    put("channel", l.channel);
    put("audience", l.audience);
    put("size", l.size ?? "every size");
    put("size_name", l.sizeName ?? "");
    put("language", l.lang);
    put("language_name", l.langName);
    put("headline", l.headline);
    put("reason_left_out", l.reason);
    rows.push(row);
  }
  // CRLF, as RFC 4180 and spreadsheets expect; a byte-order mark so Excel reads the accents as UTF-8.
  return `﻿${[CSV_COLUMNS.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\r\n")}\r\n`;
}

const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(d);

export function readme(plan: PackPlan, drawn: DrawnItem[], leftOut: PackLeftOut[], madeAt: Date): string {
  const c = plan.campaign;
  const simulatedPictures = drawn.filter((i) => i.picture.simulated).length;
  const translated = drawn.filter((i) => i.translation);
  const simulatedTranslations = translated.filter((i) => i.translation?.simulated).length;
  const simulatedWords = drawn.filter((i) => !i.translation && i.wordsFrom.simulated).length;
  const langs = [...new Set(drawn.map((i) => i.langName))];
  const demoLegal = drawn.filter((i) => i.legalLinesWrittenForDemo);
  const upscaled = drawn.filter((i) => pictureScale(i)?.note);
  const lines = [
    `LAUNCH PACK: ${c.brandName}`,
    "",
    `Campaign: ${c.objective}`,
    `Brief: ${c.briefTitle ? `${c.briefTitle}, ` : ""}version ${c.briefVersion}, signed off${c.signedOffAt ? ` on ${day(c.signedOffAt)}` : ""}.`,
    `Made by Studio on ${day(madeAt)} (UK time).`,
    "",
    "WHAT THIS IS",
    `The ${plan.ads.length === 1 ? "picked ad" : `${plan.ads.length} picked ads`} of this campaign, in every size its channel needs and in ${langs.join(", ").replace(/, ([^,]*)$/, " and $1")}: ${drawn.length} ${drawn.length === 1 ? "ad" : "ads"} as PNG files, each of which passed its checks (contrast, fit, and the legal lines where the brand has them) when this pack was made.`,
    "Folders: one per channel (paid-social, display), then one per language (en-GB, fr-FR, de-DE, es-ES).",
    "Every file is listed in manifest.json and manifest.csv with its words, alt text, checks and where the picture and words came from.",
    "Compliance: every file passed Studio's compliance rules (text contrast, legal lines, banned terms, logo clear space, text density, the 9:16 platform zones and the simulated label), or a person accepted each item that needed review, including the brand's don't rules, which no code can check; the manifests say who. The thresholds are Studio's own, not any platform's policy. A file that fails a rule or awaits review is left out, with the reason.",
    leftOut.length
      ? `Left out: ${leftOut.length} ${leftOut.length === 1 ? "size or language" : "sizes or languages"}, each listed with the reason in both manifests ("leftOut" in manifest.json; status "left out" in manifest.csv).`
      : "Left out: nothing. Every size and language of every picked ad is here.",
    "Nothing in this pack has been published or uploaded anywhere, and no ad money has been spent.",
    "",
    "HONESTY LABELS",
  ];
  if (simulatedPictures) lines.push(`- Simulated images: ${simulatedPictures} ${simulatedPictures === 1 ? "file uses a picture" : "files use pictures"} drawn by the mock image model, not a real one. Each says "Simulated image" on the ad and in the manifests.`);
  if (simulatedWords) lines.push(`- Simulated words: ${simulatedWords} English ${simulatedWords === 1 ? "file has" : "files have"} words from the mock Copy agent, not a real model.`);
  if (translated.length) {
    lines.push(`- Machine translation: ${translated.length} ${translated.length === 1 ? "file is" : "files are"} in a language other than English. ${MACHINE_TRANSLATION.detail}`);
    if (simulatedTranslations) lines.push(`  ${simulatedTranslations} of them ${simulatedTranslations === 1 ? "is" : "are"} "${MACHINE_TRANSLATION.simulatedLabel}": ${MACHINE_TRANSLATION.simulatedDetail}`);
  }
  if (demoLegal.length) {
    const names = [...new Set(demoLegal.map((i) => i.langName))];
    lines.push(`- Legal lines written for the demo: ${demoLegal.length} ${demoLegal.length === 1 ? "file has" : "files have"} ${names.join(", ").replace(/, ([^,]*)$/, " and $1")} legal lines that say so in the manifests. ${WRITTEN_FOR_DEMO}`);
  }
  if (!simulatedPictures && !simulatedWords && !translated.length && !demoLegal.length) lines.push("- None: every picture and every word here came from a real model or a person, in English.");
  lines.push("", "PICTURE SIZES");
  if (upscaled.length) {
    const notes = [...new Set(upscaled.map((i) => pictureScale(i)!.note))];
    lines.push(
      `- ${notes.join("; ")}: ${upscaled.length} ${upscaled.length === 1 ? "file enlarges its picture" : "files enlarge their pictures"} more than 1.1 times to fill the size, so ${upscaled.length === 1 ? "it" : "they"} may look soft. The manifests give each file's picture size and upscale factor. New pictures are drawn at 2K.`,
    );
  } else lines.push("- No picture is enlarged more than 1.1 times. The manifests give each file's picture size and upscale factor.");
  lines.push("", plan.campaign.brandFictional ? "Studio is a working title. The brand in this pack is fictional." : "Studio is a working title.", "");
  return lines.join("\r\n");
}

// ---------------------------------------------------------------- the stream

type Entry = { name: string; data: Uint8Array; compress: boolean };

/**
 * The zip as a stream: each ad is drawn when the reader asks for more
 * (backpressure), one size at a time, then the manifests and README. The
 * picture is read once per ad. A drawing that fails here (it fitted when
 * planned) is moved to Left out with the reason, never dropped.
 */
export function packStream(
  userId: string,
  plan: PackPlan,
  madeAt: Date = new Date(),
  onDone?: (stats: { files: number; leftOut: number; bytes: number; ms: number }) => void,
  /** Called once when the stream closes, errors or is cancelled (the one-pack-at-a-time slot is released here). */
  onEnd?: () => void,
): ReadableStream<Uint8Array> {
  const started = Date.now();
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };
  let bytes = 0;
  const drawn: DrawnItem[] = [];
  const leftOut: PackLeftOut[] = [...plan.leftOut];
  let cancelled = false;

  async function* entries(): AsyncGenerator<Entry> {
    let currentAd: string | null = null;
    let pictures: PictureCache = new Map();
    // Items are planned ad by ad, language by language; the parts (words, legal lines, logo) are loaded once per group.
    let group = "";
    let parts: Awaited<ReturnType<typeof loadParts>> = null;
    for (const item of plan.items) {
      if (cancelled) return;
      const src = plan.sources.get(item.adId)!;
      if (currentAd !== item.adId) {
        currentAd = item.adId;
        pictures = new Map(); // one ad's picture in memory at a time
      }
      const v: DrawableVariant = {
        id: item.adId,
        layout: src.layout,
        imageAssetId: src.imageAssetId,
        copySetId: item.setId,
        kit: src.kit,
        channel: item.channel,
        etagParts: { ...src.etagParts, copySetId: item.setId },
        etag: adEtag({ ...src.etagParts, copySetId: item.setId }),
      };
      const key = `${item.adId}|${item.setId}`;
      let reason: string | null = null;
      try {
        if (key !== group) {
          group = key;
          parts = await asUser(userId, (tx) => loadParts(tx, src.imageAssetId, item.setId, src.kit, undefined, pictures));
        }
        const d = parts ? await drawInSize(userId, v, item.size, parts, { remember: false }) : { ok: false as const, refused: "the picture or the words could not be read" };
        if (d.ok) {
          drawn.push({ ...item, layout: d.layout, checks: d.checks });
          yield { name: item.path, data: new Uint8Array(d.png.buffer, d.png.byteOffset, d.png.byteLength), compress: false };
          continue;
        }
        reason = d.refused;
      } catch (err) {
        console.error("[pack] a size could not be drawn", { adId: item.adId, size: item.size, lang: item.lang, error: err instanceof Error ? err.message : String(err) });
        reason = "it could not be drawn when the pack was made; try the download again";
      }
      leftOut.push({ adId: item.adId, adNumber: item.adNumber, channel: item.channel, audience: item.audience, headline: item.words.headline, size: item.size, sizeName: item.sizeName, lang: item.lang, langName: item.langName, reason: sentence(reason) });
    }
    const order = (l: PackLeftOut) => [l.adNumber, ["en-GB", ...SUPPORTED_LANGS].indexOf(l.lang), l.size ? Object.keys(SIZES).indexOf(l.size) : -1];
    leftOut.sort((x, y) => {
      const a = order(x);
      const b = order(y);
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    });
    yield { name: "manifest.json", data: strToU8(manifestJson(plan, drawn, leftOut, madeAt)), compress: true };
    yield { name: "manifest.csv", data: strToU8(manifestCsv(drawn, leftOut)), compress: true };
    yield { name: "README.txt", data: strToU8(readme(plan, drawn, leftOut, madeAt)), compress: true };
  }

  const it = entries();
  let zip: Zip;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) {
          end();
          controller.error(err);
          return;
        }
        bytes += chunk.length;
        controller.enqueue(chunk);
        if (final) {
          end();
          controller.close();
          onDone?.({ files: drawn.length, leftOut: leftOut.length, bytes, ms: Date.now() - started });
        }
      });
    },
    async pull(controller) {
      try {
        const next = await it.next();
        if (next.done) {
          zip.end();
          return;
        }
        const { name, data, compress } = next.value;
        const file = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
        file.mtime = madeAt;
        zip.add(file);
        file.push(data, true);
      } catch (err) {
        console.error("[pack] the zip stopped", err instanceof Error ? err.message : String(err));
        end();
        controller.error(err);
      }
    },
    async cancel() {
      cancelled = true;
      end();
      await it.return(undefined);
    },
  });
}

// ---------------------------------------------------------------- the response

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const NOT_FOUND = () => new Response("Not found", { status: 404, headers: TEXT_HEADERS });

export const PACK_BUSY = "A launch pack is already being drawn; try again in a minute.";

// One pack is drawn at a time per server instance (review fix 2): drawing is
// CPU and memory bound (about 600 MB while drawing), so two at once would
// slow both towards the time limit. The slot is a module-level flag, released
// when the stream ends, errors or is cancelled. A slot older than the route's
// time limit is stale (the function was stopped mid-stream) and is taken over.
const PACK_SLOT_STALE_MS = 330_000;
declare global {
  var __csPackSlot: { takenAt: number } | null | undefined;
}

/** Takes the instance's pack slot: its release function, or null while another pack is being drawn. */
export function takePackSlot(now: number = Date.now()): (() => void) | null {
  const held = globalThis.__csPackSlot;
  if (held && now - held.takenAt < PACK_SLOT_STALE_MS) return null;
  const mine = { takenAt: now };
  globalThis.__csPackSlot = mine;
  return () => {
    if (globalThis.__csPackSlot === mine) globalThis.__csPackSlot = null;
  };
}

/** The zip's own name: quillmoor-money-launch-pack-2026-11-02.zip. */
export function packFileName(brandName: string, madeAt: Date): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(madeAt);
  return `${slugify(brandName, 40) || "studio"}-launch-pack-${date}.zip`;
}

/**
 * What /campaigns/<id>/pack.zip answers: the same 404 for no session, a
 * malformed id and another workspace's campaign (rule 7); a 409 with the
 * reason when the brief isn't signed off, nothing is picked or the pack is
 * larger than PACK_MAX_FILES (never an empty or cut-off zip); a 429 while
 * another pack is being drawn on this instance; otherwise the zip, streamed.
 */
export async function packResponse(userId: string | null, campaignId: string, madeAt: Date = new Date(), opts: { maxFiles?: number } = {}): Promise<Response> {
  if (!userId || !UUID.test(campaignId)) return NOT_FOUND();
  const plan = await planPack(userId, campaignId);
  if (!plan) return NOT_FOUND();
  if ("refused" in plan) return new Response(plan.refused, { status: 409, headers: TEXT_HEADERS });
  if (plan.items.length === 0) return new Response(NOTHING_PASSES_PACK, { status: 409, headers: TEXT_HEADERS });
  const maxFiles = opts.maxFiles ?? PACK_MAX_FILES;
  if (plan.items.length > maxFiles) return new Response(packTooLarge(plan.items.length, maxFiles), { status: 409, headers: TEXT_HEADERS });
  const release = takePackSlot();
  if (!release) return new Response(PACK_BUSY, { status: 429, headers: { ...TEXT_HEADERS, "retry-after": "60" } });
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = packStream(
      userId,
      plan,
      madeAt,
      (s) => console.info("[pack] made", { campaignId, files: s.files, leftOut: s.leftOut, bytes: s.bytes, ms: s.ms }),
      release,
    );
  } catch (err) {
    release();
    throw err;
  }
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${packFileName(plan.campaign.brandName, madeAt)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
