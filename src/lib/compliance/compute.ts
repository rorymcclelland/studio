import { z } from "zod";
import { COMPLIANCE } from "@/config/compliance";
import type { Member } from "@/lib/agents/runs";
import { asUser, type Tx } from "@/lib/db/scoped";
import { sentence } from "@/lib/creative/ad-sizes";
import { fitBase, fitsFor, logoFor, type FitBase } from "@/lib/creative/fit-cache";
import { ENGLISH, LANG_NAMES, SUPPORTED_LANGS, type Lang } from "@/lib/creative/languages";
import { fitAd } from "@/lib/creative/render/render";
import { isSizeId, SIZES, type DrawLayoutId, type SizeId } from "@/lib/creative/render/sizes";
import { adEtag, type AdChannel, type AdWords, type EtagParts, type KitSnapshot, type LayoutId } from "@/lib/creative/variants";
import {
  bannedRule,
  contrastRule,
  densityRule,
  dontRules,
  findingHash,
  judge,
  leftOutReason,
  legalRule,
  logoRule,
  logoStatus,
  pictureFindings,
  pillOf,
  platformRule,
  RULE_ORDER,
  simulatedRule,
  tally,
  type Decision,
  type Finding,
  type Judged,
  type Tally,
} from "./rules";
import { readVision, type VisionRecord } from "./vision";
import { isFinanceCategory } from "@/lib/agents/imagery";

// C8-1: compliance for ads, worked out on request. For each ad, in each
// language it has words in (English and its current translations) and each
// size of its channel, the ad is laid out as drawInSize would draw it
// (fitsFor: the renderer's plan without drawing, cached in-process by words,
// layout, kit and renderer version, so the gallery, the Compliance view and
// the launch pack share one fit each) and the rules (rules.ts) run over it with
// the brand's kit as it is now: a banned term added since, or a legal line,
// shows at once. Findings are not stored, since they can be worked out again
// from the ad; only people's decisions on review items are
// (compliance_decisions), each tied to its finding's hash. Every read goes
// through asUser (rule 7).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ComplianceError extends Error {}

export type AdLang = Lang | typeof ENGLISH;

export type ItemCompliance = {
  lang: AdLang;
  langName: string;
  size: SizeId;
  sizeName: string;
  /** The words this file was checked with: the English copy set or the language's latest translation. */
  setId: string;
  /** The layout this size is drawn in (the ad's own, or the size's fallback); null when it can't be drawn. */
  layout: DrawLayoutId | null;
  /** Why the size can't be drawn in this language (not a compliance finding: the pack leaves it out for that). */
  refused: string | null;
  findings: Judged[];
  /** This file's own findings and the ad's (the don't rules) together. */
  outcome: "pass" | "review" | "fail";
};

export type AdCompliance = {
  variantId: string;
  campaignId: string;
  channel: AdChannel;
  layout: LayoutId;
  headline: string;
  /** Findings about the whole ad (each don't rule), once each. */
  perAd: Judged[];
  /** C8-2: findings from the picture check (the face rule for finance brands, the don't rules), once each for the whole ad. */
  picture: Judged[];
  items: ItemCompliance[];
  /** Every finding counted once: the ad's and each drawn file's. */
  tally: Tally;
  pill: ReturnType<typeof pillOf>;
  /** Drawn files by outcome. */
  files: { pass: number; review: number; fail: number };
};

type CurrentKit = {
  legalLines: string[];
  bannedTerms: string[];
  dontRules: string[];
  palette: KitSnapshot["palette"];
  languages: Map<string, { legalLines: string[]; bannedTerms: string[] }>;
  /** C8-2: a finance brand (no close-up faces, F-24). */
  finance: boolean;
};

type AdSource = {
  id: string;
  campaignId: string;
  brandId: string;
  layout: LayoutId;
  channel: AdChannel;
  kit: KitSnapshot;
  etagParts: EtagParts;
  simulated: boolean;
  logo: FitBase["logo"];
  langs: { lang: AdLang; setId: string; words: AdWords; legalLines: string[] }[];
  /** C8-2: the picture check's result, as stored in the picture's meta.vision (null when it has none). */
  vision: VisionRecord | null;
};

const shown = (s: string) => s.split("­").join("");

/** The ads and everything their findings need, read in one transaction. Ads whose picture or words were discarded can't be drawn, and are left out. */
async function loadSources(tx: Tx, ids: string[]): Promise<{ sources: AdSource[]; kits: Map<string, CurrentKit>; decisions: Map<string, Decision> }> {
  // Each ad with its words' translations (oldest first), in one query: the clock works compliance out on
  // every simulated step (P9-4), so this read is kept to a fixed few queries.
  const rows = await tx`
    select v.id, v.campaign_id, v.layout, v.kit, v.copy_set_id, a.sha256, a.simulated, a.discarded_at as image_discarded, a.meta -> 'vision' as vision,
      s.channel, s.set, s.legal_lines, s.discarded_at as words_discarded, c.brand_id,
      (select coalesce(json_agg(json_build_object('id', t.id, 'lang', t.lang, 'set', t.set, 'legal_lines', t.legal_lines) order by t.created_at), '[]'::json)
        from public.copy_sets t where t.translated_from = v.copy_set_id and t.discarded_at is null) as translations
    from public.ad_variants v
    join public.assets a on a.id = v.image_asset_id
    join public.copy_sets s on s.id = v.copy_set_id
    join public.campaigns c on c.id = v.campaign_id
    where v.id = any(${ids}::uuid[])`;
  const live = rows.filter((r) => !r.image_discarded && !r.words_discarded);
  const brandIds = [...new Set(live.map((r) => r.brand_id as string))];
  const kits = new Map<string, CurrentKit>();
  for (const brandId of brandIds) {
    const [b] = await tx`
      select legal_lines, banned_terms, dont_rules, palette, category,
        (select coalesce(json_agg(json_build_object('lang', l.lang, 'legal_lines', l.legal_lines, 'banned_terms', l.banned_terms)), '[]'::json)
          from public.brand_languages l where l.brand_id = ${brandId}) as langs
      from public.brands where id = ${brandId}`;
    const langs = (b?.langs as { lang: string; legal_lines: string[]; banned_terms: string[] }[] | undefined) ?? [];
    kits.set(brandId, {
      legalLines: (b?.legal_lines as string[]) ?? [],
      bannedTerms: (b?.banned_terms as string[]) ?? [],
      dontRules: (b?.dont_rules as string[]) ?? [],
      palette: (b?.palette as KitSnapshot["palette"]) ?? [],
      languages: new Map(langs.map((l) => [l.lang as string, { legalLines: l.legal_lines as string[], bannedTerms: l.banned_terms as string[] }])),
      finance: isFinanceCategory((b?.category as string | undefined) ?? ""),
    });
  }
  const logos = new Map<string, Buffer | null>();
  const sources: AdSource[] = [];
  for (const r of live) {
    const kit = r.kit as KitSnapshot;
    const mine = r.translations as { id: string; lang: string; set: AdWords; legal_lines: string[] }[];
    const latest = new Map<string, (typeof mine)[number]>();
    for (const t of mine) latest.set(t.lang as string, t);
    sources.push({
      id: r.id as string,
      campaignId: r.campaign_id as string,
      brandId: r.brand_id as string,
      layout: r.layout as LayoutId,
      channel: r.channel as AdChannel,
      kit,
      etagParts: { imageSha256: r.sha256 as string, copySetId: r.copy_set_id as string, layout: r.layout as string, kit, simulated: r.simulated === true },
      simulated: r.simulated === true,
      logo: await logoFor(tx, kit, logos),
      vision: readVision(r.vision),
      langs: [
        { lang: ENGLISH, setId: r.copy_set_id as string, words: r.set as AdWords, legalLines: r.legal_lines as string[] },
        ...SUPPORTED_LANGS.filter((l) => latest.has(l)).map((l) => {
          const t = latest.get(l)!;
          return { lang: l as AdLang, setId: t.id as string, words: t.set as AdWords, legalLines: t.legal_lines as string[] };
        }),
      ],
    });
  }
  const decided = ids.length
    ? await tx`
        select variant_id, lang, size, rule, finding_hash, decision, note, decided_by, decided_by_name, decided_at
        from public.compliance_decisions where variant_id = any(${ids}::uuid[])
        order by decided_at, id`
    : [];
  const decisions = new Map<string, Decision>();
  for (const d of decided) {
    decisions.set(decisionKey(d.variant_id as string, d.lang as string | null, d.size as string | null, d.rule as string, d.finding_hash as string), {
      decision: d.decision as Decision["decision"],
      note: (d.note as string | null) ?? null,
      decidedBy: d.decided_by as string,
      decidedByName: d.decided_by_name as string,
      decidedAt: d.decided_at as Date,
    });
  }
  return { sources, kits, decisions };
}

const decisionKey = (variantId: string, lang: string | null, size: string | null, rule: string, hash: string) => [variantId, lang ?? "", size ?? "", rule, hash].join("|");

const LAYOUT_NAME: Record<DrawLayoutId, string> = { "full-bleed": "Full bleed", split: "Split", card: "Card", banner: "Banner" };

/** Layouts of a size whose logo has its clear space, for the logo rule's fix. */
async function betterLogoLayouts(base: FitBase, size: SizeId, drawn: DrawLayoutId): Promise<string[]> {
  const out: string[] = [];
  for (const layout of SIZES[size].layouts) {
    if (layout === drawn) continue;
    const r = await fitAd({ ...base, layout, size });
    if (r.ok && logoStatus(r.plan.boxes) === "pass") out.push(LAYOUT_NAME[layout]);
  }
  return out;
}

const order = (f: Finding) => RULE_ORDER.indexOf(f.rule);

function outcomeOf(list: Judged[]): ItemCompliance["outcome"] {
  if (list.some((f) => f.outcome === "fail")) return "fail";
  if (list.some((f) => f.outcome === "review")) return "review";
  return "pass";
}

/** The ad's current translations, as part of its don't rules' hash: each language and its copy set, in a fixed order. */
export function wholeAdTranslations(langs: { lang: AdLang; setId: string }[]): string {
  return langs
    .filter((l) => l.lang !== ENGLISH)
    .map((l) => `${l.lang}:${l.setId}`)
    .sort()
    .join(",");
}

/** The findings for one ad, judged with its decisions. */
async function complianceOf(src: AdSource, kit: CurrentKit, decisions: Map<string, Decision>): Promise<AdCompliance> {
  const judged = (f: Finding, about: string) => {
    const hash = findingHash(f, about);
    return judge(f, hash, decisions.get(decisionKey(src.id, f.lang, f.size, f.key, hash)) ?? null);
  };
  // The don't rules are about the whole ad: tied to the English ad as drawn (its picture, words, layout and kit) and
  // to the translations it has now (review fix 5), so a translation added after a person accepted a rule makes the
  // rule Review again: the person accepted the ad in the languages it had then. Accept for every picked ad covers it.
  // The picture's findings are about the picture alone, which a translation doesn't change.
  const about = adEtag(src.etagParts);
  const aboutWords = `${about}|${wholeAdTranslations(src.langs)}`;
  const perAd = dontRules(kit.dontRules).map((f) => judged(f, aboutWords));
  const picture = pictureFindings(src.vision, kit.finance, kit.dontRules).map((f) => judged(f, about));
  const wholeAd = [...perAd, ...picture];
  const items: ItemCompliance[] = [];
  for (const l of src.langs) {
    const langName = LANG_NAMES[l.lang];
    const isEnglish = l.lang === ENGLISH;
    const base = fitBase(l.words, l.legalLines, src.logo, src.kit);
    const fits = await fitsFor(l.setId, base, src.layout, src.channel, src.kit);
    const language = isEnglish ? null : kit.languages.get(l.lang);
    const kitLines = isEnglish ? kit.legalLines : (language?.legalLines ?? null);
    // A translation is checked against its language's banned terms and the English ones (a phrase left in English is still banned).
    const terms = isEnglish ? kit.bannedTerms : [...(language?.bannedTerms ?? []), ...kit.bannedTerms];
    const words = { headline: shown(l.words.headline), body: shown(l.words.body), cta: shown(l.words.cta) };
    for (const f of fits) {
      const size = SIZES[f.size];
      if (!f.ok) {
        items.push({ lang: l.lang, langName, size: f.size, sizeName: size.name, setId: l.setId, layout: null, refused: sentence(f.refused), findings: [], outcome: "pass" });
        continue;
      }
      const where = { size: f.size, lang: l.lang as string };
      const plan = f.plan;
      const logoFirst = logoStatus(plan.boxes);
      const list: Finding[] = [
        contrastRule(plan.contrast, src.kit.palette, where),
        legalRule(plan.legalLines, kitLines, kit.legalLines, langName, isEnglish, where),
        bannedRule(words, terms, langName, where),
        logoRule(plan.boxes, logoFirst === "pass" || logoFirst === "na" ? [] : await betterLogoLayouts(base, f.size, f.layout), where),
        densityRule(plan.boxes, src.channel, where),
        ...[platformRule(plan.boxes, f.size, { drawn: f.layout, ownIsCard: src.layout === "card" }, where)].filter((x): x is Finding => x !== null),
        simulatedRule(src.simulated, where),
      ].sort((a, b) => order(a) - order(b));
      const sized = adEtag({ ...src.etagParts, copySetId: l.setId, layout: f.layout, size: f.size });
      const findings = list.map((x) => judged(x, sized));
      items.push({ lang: l.lang, langName, size: f.size, sizeName: size.name, setId: l.setId, layout: f.layout, refused: null, findings, outcome: outcomeOf([...wholeAd, ...findings]) });
    }
  }
  const drawn = items.filter((i) => !i.refused);
  const t = tally([...wholeAd, ...drawn.flatMap((i) => i.findings)]);
  return {
    variantId: src.id,
    campaignId: src.campaignId,
    channel: src.channel,
    layout: src.layout,
    headline: shown(src.langs[0].words.headline),
    perAd,
    picture,
    items,
    tally: t,
    pill: pillOf(t),
    files: {
      pass: drawn.filter((i) => i.outcome === "pass").length,
      review: drawn.filter((i) => i.outcome === "review").length,
      fail: drawn.filter((i) => i.outcome === "fail").length,
    },
  };
}

/** Compliance for ads the user can see, by id (others, and ads that can't be drawn, are left out). */
export async function complianceFor(userId: string, variantIds: string[]): Promise<Map<string, AdCompliance>> {
  return complianceIn(null, userId, variantIds);
}

/**
 * complianceFor inside a transaction the caller already holds as the user
 * (P9-4: the clock works compliance out on every step, in its own
 * transaction, so a step costs a fixed few queries more, not a second
 * transaction).
 */
export async function complianceForTx(tx: Tx, variantIds: string[]): Promise<Map<string, AdCompliance>> {
  return complianceIn(tx, null, variantIds);
}

async function complianceIn(tx: Tx | null, userId: string | null, variantIds: string[]): Promise<Map<string, AdCompliance>> {
  const ids = [...new Set(variantIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, AdCompliance>();
  if (ids.length === 0) return out;
  const { sources, kits, decisions } = tx ? await loadSources(tx, ids) : await asUser(userId!, (t) => loadSources(t, ids));
  for (const src of sources) out.set(src.id, await complianceOf(src, kits.get(src.brandId)!, decisions));
  return out;
}

/** One ad's compliance, or null when the user can't see it (a 404). */
export async function adCompliance(userId: string, variantId: string): Promise<AdCompliance | null> {
  if (!UUID.test(variantId)) return null;
  return (await complianceFor(userId, [variantId])).get(variantId) ?? null;
}

export const CHANGED_WHILE_PLANNED =
  "The ad's words or layout changed while the pack was being planned, so its compliance checks are for another drawing. Build the pack again.";

/**
 * The judged findings of one drawn file (its own and the ad's), and why it
 * would be left out of a pack (null when it can go in). With `drawn`, the
 * words and layout the caller will draw: the findings were worked out in an
 * earlier transaction, so a file whose checks were for other words (a new
 * translation since) or another layout is held back with the reason, never
 * packed under another drawing's checks (review fix 3).
 */
export function fileCompliance(
  ad: AdCompliance,
  lang: string,
  size: SizeId,
  drawn?: { setId: string; layout: DrawLayoutId },
): { findings: Judged[]; leftOut: string | null } | null {
  const item = ad.items.find((i) => i.lang === lang && i.size === size && !i.refused);
  if (!item) return null;
  const findings = [...ad.perAd, ...ad.picture, ...item.findings];
  if (drawn && (drawn.setId !== item.setId || drawn.layout !== item.layout)) return { findings, leftOut: CHANGED_WHILE_PLANNED };
  return { findings, leftOut: leftOutReason(findings) };
}

/** The campaign's summary line, over the picked ads' drawn files: "40 ads pass, 6 to review, 2 fail". */
export function complianceSummary(ads: AdCompliance[]): { pass: number; review: number; fail: number; text: string } {
  const pass = ads.reduce((n, a) => n + a.files.pass, 0);
  const review = ads.reduce((n, a) => n + a.files.review, 0);
  const fail = ads.reduce((n, a) => n + a.files.fail, 0);
  const ad = (n: number, verb: string) => `${n} ${n === 1 ? "ad" : "ads"} ${verb}`;
  return { pass, review, fail, text: `${ad(pass, pass === 1 ? "passes" : "pass")}, ${review} to review, ${fail} ${fail === 1 ? "fails" : "fail"}` };
}

export type GalleryCompliance = {
  /** Each current ad's pill, by id. */
  pills: Record<string, AdCompliance["pill"]>;
  /** Over the picked ads' drawn files (null when nothing is picked). */
  summary: ReturnType<typeof complianceSummary> | null;
  /** Each don't rule on the picked ads, with how many still wait for a person (for "Accept for every picked ad"). */
  dontRules: PickedDontRule[];
};

/** What the gallery shows: a pill per current ad, and the picked ads' summary line. */
export async function galleryCompliance(userId: string, view: { variants: { id: string; picked: boolean; briefVersion: number }[]; version: number | null }): Promise<GalleryCompliance> {
  const all = await complianceFor(userId, view.variants.map((v) => v.id));
  const picked = view.variants.filter((v) => v.picked && v.briefVersion === view.version).flatMap((v) => (all.has(v.id) ? [all.get(v.id)!] : []));
  return {
    pills: Object.fromEntries([...all.entries()].map(([id, a]) => [id, a.pill])),
    summary: picked.length ? complianceSummary(picked) : null,
    dontRules: pickedDontRules(picked),
  };
}

// ---------------------------------------------------------------- accept a don't rule for every picked ad

export type PickedDontRule = {
  key: string;
  rule: string;
  /** Picked ads where it still waits for a person. */
  open: number;
  /** Picked ads a person marked not acceptable on it (left as they are by the bulk accept). */
  rejected: number;
  picked: number;
};

/** The don't rules on the picked ads, in the kit's order, each with how many ads still wait on it. */
export function pickedDontRules(picked: AdCompliance[]): PickedDontRule[] {
  const out = new Map<string, PickedDontRule>();
  for (const ad of picked) {
    for (const f of ad.perAd) {
      const r = out.get(f.key) ?? { key: f.key, rule: f.fix ?? "", open: 0, rejected: 0, picked: 0 };
      r.picked++;
      if (f.outcome === "review") r.open++;
      if (f.outcome === "fail") r.rejected++;
      out.set(f.key, r);
    }
  }
  return [...out.values()];
}

/**
 * Rory, while building: accepts one don't rule for every picked ad of the
 * campaign's signed-off version at once. Each ad still gets its own decision,
 * with the person's name and the time and tied to that ad's own finding hash,
 * exactly as if it were accepted on the ad's Compliance view. Ads already
 * decided on the rule (accepted, or marked not acceptable by a person) are
 * left as they are.
 */
export async function acceptDontRuleForPicked(member: Member, campaignId: string, key: string): Promise<{ accepted: number; alreadyDecided: number; rejected: number }> {
  if (!UUID.test(campaignId) || !/^dont:[0-9a-f]{16}$/.test(key)) throw new ComplianceError("That rule couldn't be read. Reload the page and try again.");
  const ids = await asUser(member.userId, (tx) => tx`
    select v.id from public.ad_variants v join public.campaigns c on c.id = v.campaign_id
    where v.campaign_id = ${campaignId} and c.approved_version is not null and v.brief_version = c.approved_version
      and v.picked_at is not null and v.discarded_at is null`);
  if (ids.length === 0) throw new ComplianceError("Nothing is picked in this campaign, so there is nothing to accept.");
  const ads = [...(await complianceFor(member.userId, ids.map((r) => r.id as string))).values()];
  const found = ads.flatMap((ad) => ad.perAd.filter((f) => f.key === key).map((f) => ({ ad, f })));
  if (found.length === 0) throw new ComplianceError("That rule isn't one of the brand's don't rules any more. Reload the page.");
  const open = found.filter((x) => x.f.outcome === "review");
  if (open.length > 0) {
    await asUser(member.userId, async (tx) => {
      for (const { ad, f } of open) {
        await tx`
          insert into public.compliance_decisions (workspace_id, variant_id, lang, size, rule, finding_hash, decision, note, decided_by, decided_by_name)
          select v.workspace_id, v.id, null, null, ${f.key}, ${f.hash}, 'accept', null, ${member.userId}, 'set by the database'
          from public.ad_variants v where v.id = ${ad.variantId}`;
      }
    });
  }
  const rejected = found.filter((x) => x.f.outcome === "fail").length;
  return { accepted: open.length, alreadyDecided: found.length - open.length - rejected, rejected };
}

// ---------------------------------------------------------------- decisions

const decisionInput = z.object({
  lang: z.string().max(10).nullable(),
  size: z.string().max(12).nullable(),
  rule: z.string().regex(/^[a-z]+(:[0-9a-f]{16})?$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(["accept", "reject"]),
  note: z.string().max(20_000).optional().nullable(),
});

/** A note as stored: control characters dropped (new lines kept), trimmed, and cut to COMPLIANCE.noteMax characters. */
export function cleanNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const clean = note.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return null;
  return Array.from(clean).slice(0, COMPLIANCE.noteMax).join("").trim();
}

/**
 * Records a person's decision on a review item: Accept, or Not acceptable,
 * with an optional note. Only a finding that is still Review, with the hash
 * the person saw, can be decided: a redraw, an edit or a changed rule since
 * makes it a new finding, and the person is asked to look again.
 */
export async function decideFinding(member: Member, variantId: string, raw: unknown): Promise<Judged> {
  const parsed = decisionInput.safeParse(raw);
  if (!parsed.success || !UUID.test(variantId)) throw new ComplianceError("That decision couldn't be read. Reload the page and try again.");
  const input = parsed.data;
  if ((input.lang === null) !== (input.size === null) || (input.size !== null && !isSizeId(input.size))) {
    throw new ComplianceError("That decision couldn't be read. Reload the page and try again.");
  }
  const ad = await adCompliance(member.userId, variantId);
  if (!ad) throw new ComplianceError("That ad isn't in your workspace.");
  const pool = input.size === null ? [...ad.perAd, ...ad.picture] : (ad.items.find((i) => i.lang === input.lang && i.size === input.size)?.findings ?? []);
  const f = pool.find((x) => x.key === input.rule);
  if (!f) throw new ComplianceError("That item isn't on this ad any more. Reload the page to see the ad as it is now.");
  if (f.hash !== input.hash) throw new ComplianceError("That item has changed since the page was drawn (the ad, its words or the rule changed). Reload the page and look again.");
  if (f.status !== "review") throw new ComplianceError("Only an item that needs review can be accepted or marked not acceptable.");
  const note = cleanNote(input.note);
  await asUser(member.userId, (tx) => tx`
    insert into public.compliance_decisions (workspace_id, variant_id, lang, size, rule, finding_hash, decision, note, decided_by, decided_by_name)
    select v.workspace_id, v.id, ${input.lang}, ${input.size}, ${input.rule}, ${input.hash}, ${input.decision}, ${note}, ${member.userId}, 'set by the database'
    from public.ad_variants v where v.id = ${variantId}`);
  const after = await adCompliance(member.userId, variantId);
  const again = (input.size === null ? [...(after?.perAd ?? []), ...(after?.picture ?? [])] : after?.items.find((i) => i.lang === input.lang && i.size === input.size)?.findings)?.find((x) => x.key === input.rule);
  if (!again?.decision) throw new ComplianceError("The decision wasn't saved. Try again.");
  return again;
}
