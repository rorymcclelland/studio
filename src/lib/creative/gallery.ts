import { CREATIVE_KEY, CREATIVE_VERSION, MAKE_BUSY, makeCreativeRefusal } from "@/lib/agents/creative-workflow";
import { createWorkflowRun, type Member, type SendEvent } from "@/lib/agents/runs";
import { asUser, asUserIn, type Tx } from "@/lib/db/scoped";
import { loadCopyContext, rulesFor } from "./copy-context";
import { CopyEditError, CopyError, listCopySets, saveCopyEditIn, startNewWords, type CopySetView } from "./copy";
import { EDIT_COPY, setProblems, type AnyCopy } from "./copy-rules";
import { makeCreativeEstimate, newPictureEstimate, newWordsEstimate, type Estimate } from "./costs";
import { NOT_SIGNED_OFF } from "./imagery";
import type { RenderChecks } from "./render/render";
import {
  AD_CHANNELS,
  audienceOrder,
  firstLayoutThatRenders,
  insertVariant,
  kitSnapshot,
  LAYOUT_IDS,
  LAYOUT_NAMES,
  loadParts,
  refusalText,
  renderInputFor,
  sameKit,
  type AdChannel,
  type AdWords,
  type KitSnapshot,
  type LayoutId,
  type PictureCache,
  type Rendered,
  type VariantOrigin,
} from "./variants";
import { renderAd } from "./render/render";
import { sentence, translationBadge } from "./ad-sizes";
import { fitBase, fitsFor, logoFor } from "./fit-cache";
import { LANG_NAMES, SUPPORTED_LANGS, type Lang } from "./languages";
import { SIZES, type SizeId } from "./render/sizes";
import { languageOptions, translateCost, type LanguageOption } from "./translate";
import { pictureCheckBar, PICTURE_CHECK_KEY, type PictureCheckBar } from "./picture-check";
import { pretestBar, pretestViews, type PretestBar, type PretestView } from "./pretest";
import { lockRefusal, RUNNING_IN_LAUNCH, WAITING_FOR_LAUNCH } from "./gallery-filter";
import { launchHolds, type LaunchHoldView } from "./launch-holds";

// S5-4: what the Creative section of a campaign shows and does. The gallery
// reads through getCreative(); every action is a mark (pick, discard), a
// layout switch checked by the renderer, or a costed run that goes through
// the cap (Make creative, New picture, New words). Nothing here spends ad
// money or publishes (rule 3). Words follow their copy set: a set is shared
// by the ads for each picture, so new or edited words move every current ad on
// that set, and only when a person chooses them. F-26: an ad made with an
// older kit can be redrawn with the brand's kit as it is now, in code (no AI
// cost); F-27: every audience has its own ads, grouped by audience. U10-3:
// an ad in a live launch, or in one waiting for approval, is locked: nothing
// that changes what it shows (its layout, picture, words, or a discard or
// redraw) is allowed until the launch ends or is decided (rule 3).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refusal the gallery shows as it is (the message says what to do). */
export class CreativeError extends Error {}

export { CopyEditError, NOT_SIGNED_OFF, RUNNING_IN_LAUNCH, WAITING_FOR_LAUNCH, type LaunchHoldView };

/**
 * Refuses (CreativeError) a change to an ad in a live or waiting launch. With
 * `words`, also when another current ad on the same words is in one: new or
 * edited words would re-word it.
 */
async function refuseIfLaunched(userId: string, v: { id: string; campaign_id: string; copy_set_id: string }, { words = false } = {}, inTx?: Tx): Promise<void> {
  const refusal = await asUserIn(inTx, userId, async (tx) => {
    const ids = [v.id];
    if (words) {
      const onWords = await tx`select id from public.ad_variants where copy_set_id = ${v.copy_set_id} and discarded_at is null and id <> ${v.id}`;
      ids.push(...onWords.map((r) => r.id as string));
    }
    const holds = await launchHolds(tx, v.campaign_id, ids);
    const own = holds.get(v.id);
    if (own) return lockRefusal(own.status);
    const others = [...holds.values()];
    const shared = others.find((h) => h.status === "live") ?? others[0];
    return shared ? lockRefusal(shared.status, true) : null;
  });
  if (refusal) throw new CreativeError(refusal);
}

export type Badge = {
  key: "contrast" | "fit" | "legal" | "logo" | "simulated" | "kit";
  label: string;
  /** good: passed; warn: worth a look (no legal line in the kit, no logo); info: a label (simulated). */
  tone: "good" | "warn" | "info";
  detail: string;
};

export type VariantView = {
  id: string;
  /** The drawn ad (PNG, 1080 × 1080). */
  src: string;
  campaignId: string;
  briefVersion: number;
  channel: AdChannel;
  layout: LayoutId;
  layoutName: string;
  image: { assetId: string; src: string; simulated: boolean; idea: string | null; runId: string | null; discarded: boolean };
  words: {
    setId: string;
    audience: { segmentRef: string | null; title: string };
    headline: string;
    body: string;
    cta: string;
    legalLines: string[];
    source: "agent" | "person";
    runId: string | null;
    discarded: boolean;
  };
  badges: Badge[];
  checks: RenderChecks;
  /** The picture came from the mock image model (rule 1: labelled "Simulated image"). */
  simulated: boolean;
  picked: boolean;
  pickedAt: Date | null;
  discardedAt: Date | null;
  origin: VariantOrigin;
  basedOn: string | null;
  /** F-26: a current ad whose kit (palette, fonts, logo, brand name) differs from the brand's now: it can be redrawn. */
  olderKit: boolean;
  /** F-26: for an ad discarded by a redraw, the current ad that redrew it (restoring this one undoes the redraw). */
  redrawnBy: string | null;
  createdAt: Date;
  /** The creative run that composed it or drew its new picture (null for a person's choice of words). */
  runId: string | null;
  /** New words waiting beside this ad's words: a person keeps them (keepWords) or the old ones. */
  pendingWords: { setId: string; headline: string; body: string; cta: string; runId: string | null } | null;
  /** Runs in progress on this ad: a new picture, or new words for its set. */
  busy: { picture: string | null; words: string | null };
  /** For discarded ads: whether Restore works, and why not. */
  restore: { allowed: boolean; reason: string | null };
  /**
   * C7-2: the ad in the brand's other languages: its words' current
   * translations, each drawn on request from this ad and badged "Machine
   * translation" (rule 1). The thumbnail is the first size of the channel the
   * translation fits, at that size's own width and height (review fix 8).
   */
  translations: {
    lang: Lang;
    name: string;
    setId: string;
    /** Null when no size of the channel holds these words; thumbReason says why. */
    thumb: { src: string; size: SizeId; width: number; height: number } | null;
    thumbReason: string | null;
    sizesHref: string;
    headline: string;
    body: string;
    cta: string;
    legalLines: string[];
    simulated: boolean;
    badge: { label: string; detail: string };
    runId: string | null;
  }[];
  /** C7-2: Translate on this ad: the translations still to write (allowed languages without one), its cost, or why not. */
  translate: { todo: number; estimate: string; reason: string | null };
  /** C8-4: the synthetic panel's scores for this ad (current, or out of date after a change), null if never pre-tested. */
  pretest: PretestView | null;
  /** U10-3: the live or waiting launch holding this ad (it is locked while it does); null for none. */
  launch: LaunchHoldView | null;
};

export type CreativeRunView = {
  runId: string;
  href: string;
  kind: "make" | "picture" | "words" | "imagery" | "copy" | "translate" | "pretest" | "pictures";
  label: string | null;
  status: string;
  error: string | null;
  /** This run's cost plus its child runs' (Make creative runs the Imagery and Copy agents). */
  costPence: number;
  createdAt: Date;
  children: { runId: string; href: string; agent: string; status: string; costPence: number }[];
};

export type CreativeView = {
  campaignId: string;
  brandId: string;
  /** The signed-off version the creative is for; null until the brief is signed off. */
  version: number | null;
  signedOff: boolean;
  makeCreative: { allowed: boolean; reason: string | null; estimate: Estimate; runningRunId: string | null };
  estimates: { newPicture: Estimate; newWords: Estimate };
  layouts: { id: LayoutId; name: string }[];
  /** Current ads, in gallery order (by audience, then picture, then words). */
  variants: VariantView[];
  /** F-27: the current ads grouped by audience, in the brief's order (one group when the brief names none). */
  audiences: { segmentRef: string | null; title: string; variants: VariantView[] }[];
  /** F-26: how many current ads were made with an older kit. */
  olderKitCount: number;
  /** Discarded ads, newest first, and ads whose words or picture were discarded elsewhere. */
  discarded: VariantView[];
  /** Current copy for the text-only channels (search, email, app push), shown as lists beside the gallery. */
  textSets: CopySetView[];
  /**
   * Current ad words that have no ad in the gallery (every ad on them discarded, or ads made before every
   * audience got its own), with any new words waiting to replace them, for the lists.
   */
  setsWithoutAds: CopySetView[];
  /** Discarded copy sets for undo (from the Copy agent's list). */
  discardedSets: CopySetView[];
  /** Copy sets with new words being written, by set id (the run id), so the lists can say so. */
  busySets: Record<string, string>;
  /** Creative, picture and copy runs for this campaign, newest first, with their costs. */
  runs: CreativeRunView[];
  totalCostPence: number;
  /** Any ad's picture is simulated (mock model): the section says so. */
  simulated: boolean;
  /**
   * C7-2: Translate. The brand's languages (each allowed, or refused with the
   * reason), the languages it hasn't chosen, the picked ads' translations still
   * to write with their cost, and a translation in progress.
   */
  translate: {
    languages: LanguageOption[];
    unchosen: Lang[];
    picked: { todo: number; estimate: string; reason: string | null };
    runningRunId: string | null;
    /** Any translation on the page was written by the mock model. */
    simulated: boolean;
    /**
     * When some of the brand's languages are refused and others allowed, why
     * the refused ones are left out (test case 5), shown as text beside the
     * button. Null when none is refused, or when all are (the button's own
     * reason says it then).
     */
    refusedNote: string | null;
  };
  /** C8-4: Pre-test picked ads: the picked ads still to score, the cost, a run in progress, or why not. */
  pretest: PretestBar;
  /** C8-2: Check pictures: the pictures still without a picture-check result, the cost, a run in progress, or why not. */
  pictureCheck: PictureCheckBar;
};

const TEXT_CHANNELS = ["search", "email", "app push"];

const OLDER_KIT: Badge = {
  key: "kit",
  label: "Made with an older kit",
  tone: "warn",
  detail: "The brand's palette, fonts or logo have changed since this ad was made. Redraw it with the current kit: same picture, words and layout, no AI cost.",
};

function badgesFor(checks: RenderChecks, simulated: boolean, olderKit = false): Badge[] {
  const c = checks.contrast;
  const lowest = Math.min(c.body, c.legal, c.cta);
  const badges: Badge[] = [
    {
      key: "contrast",
      label: `Contrast ${lowest.toFixed(1)}:1`,
      tone: "good",
      detail: `Text ${c.body.toFixed(1)}:1, button ${c.cta.toFixed(1)}:1 (AA needs 4.5:1).${c.source === "fallback" ? ` ${c.note}` : ""}`,
    },
    {
      key: "fit",
      label: `Fits ${LAYOUT_NAMES[checks.layout]}`,
      tone: "good",
      detail: `Headline ${checks.fit.headline.size} px on ${checks.fit.headline.lines.length} line${checks.fit.headline.lines.length === 1 ? "" : "s"}, body ${checks.fit.body.size} px.`,
    },
    checks.legalLinePresent
      ? { key: "legal", label: "Legal line", tone: "good", detail: `${checks.fit.legal.paragraphs} legal line${checks.fit.legal.paragraphs === 1 ? "" : "s"} at ${checks.fit.legal.size} px.` }
      : { key: "legal", label: "No legal line in the kit", tone: "warn", detail: checks.legalNote ?? "no legal line in the kit" },
  ];
  if (checks.logo === "none") badges.push({ key: "logo", label: "No logo", tone: "warn", detail: "The brand has no logo yet. Upload one on the brand page." });
  if (simulated) badges.push({ key: "simulated", label: "Simulated image", tone: "info", detail: "Drawn by the mock image model, not a real one." });
  if (olderKit) badges.push(OLDER_KIT);
  return badges;
}

const kindOf = (agent: string, input: Record<string, unknown>): CreativeRunView["kind"] =>
  agent === "creative"
    ? input.mode === "picture"
      ? "picture"
      : "make"
    : agent === "copy"
      ? input.mode === "replace"
        ? "words"
        : "copy"
      : agent === "localise"
        ? "translate"
        : agent === "pretest"
          ? "pretest"
          : agent === PICTURE_CHECK_KEY
            ? "pictures"
            : "imagery";

/** Everything the Creative section needs for a campaign, or null if it isn't in the user's workspace. */
export async function getCreative(userId: string, campaignId: string, inTx?: Tx): Promise<CreativeView | null> {
  if (!UUID.test(campaignId)) return null;
  const copy = await listCopySets(userId, campaignId, inTx);
  return asUserIn(inTx, userId, async (tx) => {
    const [c] = await tx`select id, brand_id, status, approved_version from public.campaigns where id = ${campaignId}`;
    if (!c) return null;
    const version = (c.approved_version as number | null) ?? null;
    const signedOff = c.status === "approved" && version !== null;

    const rows = version
      ? await tx`
          select v.*, a.simulated, a.meta as image_meta, a.run_id as image_run_id, a.discarded_at as image_discarded,
            s.channel, s.set, s.segment_ref, s.segment_title, s.legal_lines, s.source as words_source, s.run_id as words_run_id,
            s.discarded_at as words_discarded
          from public.ad_variants v
          join public.assets a on a.id = v.image_asset_id
          join public.copy_sets s on s.id = v.copy_set_id
          where v.campaign_id = ${campaignId} and v.brief_version = ${version}
          order by coalesce((a.meta ->> 'picture')::int, 0), v.created_at, v.id`
      : [];

    const busyRuns = await tx`
      select id, agent, input from public.agent_runs
      where status in ('queued', 'running') and input ->> 'campaignId' = ${campaignId} and agent in ('creative', 'copy', 'localise')`;
    const pictureBusy = new Map<string, string>();
    const wordsBusy = new Map<string, string>();
    let makeRunning: string | null = null;
    let translating: string | null = null;
    for (const r of busyRuns) {
      if (r.agent === "creative" && r.input.mode === "picture") pictureBusy.set(r.input.variantId, r.id);
      else if (r.agent === "creative") makeRunning = r.id;
      else if (r.agent === "copy" && r.input.mode === "replace") wordsBusy.set(r.input.setId, r.id);
      else if (r.agent === "localise") translating = r.id;
    }
    // C7-2: the current translations of this version's words, and the brand's languages.
    const translatedRows = version
      ? await tx`
          select id, translated_from, lang, set, legal_lines, simulated, run_id from public.copy_sets
          where campaign_id = ${campaignId} and brief_version = ${version} and translated_from is not null and discarded_at is null
          order by created_at`
      : [];
    const { options: languages, unchosen } = await languageOptions(tx, c.brand_id);
    const allowedLangs = languages.filter((l) => l.allowed).map((l) => l.lang);
    const languageRefusalText =
      languages.length === 0
        ? "The brand has no languages yet. Choose them, with their legal lines, on the brand's Languages page."
        : allowedLangs.length === 0
          ? languages.map((l) => l.reason).join(" ")
          : null;
    const pending = new Map(copy.sets.filter((s) => s.replaces).map((s) => [s.replaces as string, s]));
    // The current ad on each picture and words pair (one at most: ad_variants_current_once).
    const currentPairs = new Map(rows.filter((r) => !r.discarded_at).map((r) => [`${r.image_asset_id}:${r.copy_set_id}`, r]));
    const kit = await kitSnapshot(tx, c.brand_id);

    const logos = new Map<string, Buffer | null>();
    const translationsOf = async (r: (typeof rows)[number]): Promise<Pick<VariantView, "translations" | "translate">> => {
      const variantId = r.id as string;
      const kit = r.kit as KitSnapshot;
      const mine = translatedRows
        .filter((t) => t.translated_from === r.copy_set_id)
        .sort((x, y) => SUPPORTED_LANGS.indexOf(x.lang as Lang) - SUPPORTED_LANGS.indexOf(y.lang as Lang));
      const translations: VariantView["translations"] = [];
      for (const t of mine) {
        const w = t.set as AdWords;
        const shown = (x: string) => x.split("\u00AD").join("");
        const badge = translationBadge(t.simulated === true);
        const name = LANG_NAMES[t.lang as Lang] ?? (t.lang as string);
        // Review fix 8: the first size these words fit, as drawInSize would draw it (the launch pack's fits, cached).
        const fits = await fitsFor(t.id as string, fitBase(w, t.legal_lines as string[], await logoFor(tx, kit, logos), kit), r.layout as LayoutId, r.channel as AdChannel, kit);
        const fit = fits.find((f) => f.ok);
        const refusals = [...new Set(fits.flatMap((f) => (f.ok ? [] : [sentence(f.refused)])))];
        translations.push({
          lang: t.lang as Lang,
          name,
          setId: t.id as string,
          thumb: fit ? { src: `/ads/${variantId}/${fit.size}.png?lang=${t.lang}`, size: fit.size, width: SIZES[fit.size].width, height: SIZES[fit.size].height } : null,
          thumbReason: fit ? null : `No size of this ad can hold the ${name} words. ${refusals.join(" ")}`.trim(),
          sizesHref: `/campaigns/${campaignId}/ads/${variantId}/sizes?lang=${t.lang}`,
          headline: shown(w.headline),
          body: shown(w.body),
          cta: shown(w.cta),
          legalLines: t.legal_lines as string[],
          simulated: t.simulated === true,
          badge: { label: badge.label, detail: badge.detail },
          runId: (t.run_id as string | null) ?? null,
        });
      }
      const todo = allowedLangs.filter((l) => !mine.some((t) => t.lang === l)).length;
      const reason = languageRefusalText ?? (todo === 0 ? `Already in ${allowedLangs.map((l) => LANG_NAMES[l]).join(", ").replace(/, ([^,]*)$/, " and $1")}.` : null);
      return { translations, translate: { todo, estimate: translateCost(todo).label, reason } };
    };

    const translated = new Map<string, Pick<VariantView, "translations" | "translate">>();
    for (const r of rows) translated.set(r.id as string, await translationsOf(r));

    const views: VariantView[] = rows.map((r) => {
      const words = r.set as AdWords;
      const waiting = pending.get(r.copy_set_id);
      const partsGone = Boolean(r.image_discarded || r.words_discarded);
      const holder = currentPairs.get(`${r.image_asset_id}:${r.copy_set_id}`);
      // Restoring an ad that a redraw replaced undoes the redraw (F-26), so its redraw doesn't block it.
      const redrawnBy = r.discarded_at && holder?.origin === "redrawn" && holder.based_on === r.id ? (holder.id as string) : null;
      const restore = !r.discarded_at
        ? { allowed: false, reason: partsGone ? (r.words_discarded ? "Its words were discarded. Restore them in the copy list to bring the ad back." : "Its picture was discarded.") : null }
        : partsGone
          ? { allowed: false, reason: r.words_discarded ? "Its words were replaced or discarded, so it can't come back. Its replacement is in the gallery." : "Its picture was replaced, so it can't come back." }
          : holder && !redrawnBy
            ? { allowed: false, reason: "The same picture and words are already in the gallery." }
            : { allowed: true, reason: null };
      const olderKit = !r.discarded_at && !partsGone && kit !== null && !sameKit(r.kit as KitSnapshot, kit);
      return {
        id: r.id,
        src: `/ads/${r.id}.png`,
        campaignId,
        briefVersion: r.brief_version,
        channel: r.channel,
        layout: r.layout,
        layoutName: LAYOUT_NAMES[r.layout as LayoutId],
        image: {
          assetId: r.image_asset_id,
          src: `/assets/${r.image_asset_id}`,
          simulated: r.simulated,
          idea: (r.image_meta?.idea as string | undefined) ?? null,
          runId: r.image_run_id,
          discarded: Boolean(r.image_discarded),
        },
        words: {
          setId: r.copy_set_id,
          audience: { segmentRef: r.segment_ref, title: r.segment_title },
          headline: words.headline,
          body: words.body,
          cta: words.cta,
          legalLines: r.legal_lines,
          source: r.words_source,
          runId: r.words_run_id,
          discarded: Boolean(r.words_discarded),
        },
        badges: badgesFor(r.checks as RenderChecks, r.simulated, olderKit),
        checks: r.checks as RenderChecks,
        simulated: r.simulated,
        picked: Boolean(r.picked_at),
        pickedAt: r.picked_at,
        discardedAt: r.discarded_at,
        origin: r.origin,
        basedOn: r.based_on,
        olderKit,
        redrawnBy,
        createdAt: r.created_at,
        runId: r.run_id,
        pendingWords: waiting
          ? { setId: waiting.id, ...(waiting.copy as AdWords), runId: waiting.runId }
          : null,
        busy: { picture: pictureBusy.get(r.id) ?? null, words: wordsBusy.get(r.copy_set_id) ?? null },
        restore,
        ...translated.get(r.id as string)!,
        pretest: null,
        launch: null,
      };
    });
    const unordered = views.filter((v) => !v.discardedAt && !v.image.discarded && !v.words.discarded);
    const discarded = views
      .filter((v) => !unordered.includes(v))
      .sort((x, y) => (y.discardedAt?.getTime() ?? y.createdAt.getTime()) - (x.discardedAt?.getTime() ?? x.createdAt.getTime()));

    // F-27: the ads grouped by audience, in the brief's order; within a group, by picture, then words (the query's order).
    const [bv] = version ? await tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${version}` : [];
    const briefRefs = (((bv?.brief?.audiences ?? []) as { segmentRef?: string }[]).map((x) => x.segmentRef ?? null));
    const order = audienceOrder(briefRefs, unordered.map((v) => v.words.audience.segmentRef));
    const audiences = order.map((ref) => {
      const mine = unordered.filter((v) => v.words.audience.segmentRef === ref);
      return { segmentRef: ref, title: mine[0].words.audience.title, variants: mine };
    });
    const live = audiences.flatMap((g) => g.variants);
    // C8-4: the panel's scores for the current ads (picked or not: a picked ad's scores stay if it is unpicked).
    const scores = await pretestViews(tx, live.map((v) => v.id));
    for (const v of live) v.pretest = scores.get(v.id) ?? null;
    // U10-3: which ads a live or waiting launch holds.
    const holds = await launchHolds(tx, campaignId, live.map((v) => v.id));
    for (const v of live) v.launch = holds.get(v.id) ?? null;

    // Ad words with no ad in the gallery, and new words waiting to replace them.
    const withAds = new Set(live.map((v) => v.words.setId));
    const adSets = copy.sets.filter((s) => (AD_CHANNELS as readonly string[]).includes(s.channel) && !s.replaces && !withAds.has(s.id));
    const without = new Set(adSets.map((s) => s.id));
    const setsWithoutAds = [...adSets, ...copy.sets.filter((s) => s.replaces && without.has(s.replaces))];

    const runRows = await tx`
      select r.id, r.agent, r.label, r.status, r.error, r.input, r.created_at,
        coalesce((select sum(l.cost_pence) from public.usage_ledger l where l.run_id = r.id), 0)::float8 as cost
      from public.agent_runs r
      where r.agent in ('creative', 'imagery', 'copy', 'localise', 'pretest', 'pictureCheck') and r.input ->> 'campaignId' = ${campaignId}
      order by r.created_at desc limit 60`;
    const byParent = new Map<string, typeof runRows>();
    for (const r of runRows) {
      const parent = r.input.parentRunId as string | undefined;
      if (parent) byParent.set(parent, [...(byParent.get(parent) ?? []), r] as unknown as typeof runRows);
    }
    const runs: CreativeRunView[] = runRows
      .filter((r) => !r.input.parentRunId)
      .map((r) => {
        const kids = (byParent.get(r.id) ?? []) as unknown as typeof runRows;
        return {
          runId: r.id,
          href: `/runs/${r.id}`,
          kind: kindOf(r.agent, r.input),
          label: r.label,
          status: r.status,
          error: r.error,
          costPence: Number(r.cost) + kids.reduce((sum, k) => sum + Number(k.cost), 0),
          createdAt: r.created_at,
          children: kids.map((k) => ({ runId: k.id, href: `/runs/${k.id}`, agent: k.agent, status: k.status, costPence: Number(k.cost) })),
        };
      });

    const refusal = await makeCreativeRefusal(tx, campaignId);
    const writesCopy = !copy.sets.length;
    return {
      campaignId,
      brandId: c.brand_id,
      version,
      signedOff,
      makeCreative: { allowed: refusal === null, reason: refusal, estimate: makeCreativeEstimate({ writesCopy }), runningRunId: makeRunning },
      estimates: { newPicture: newPictureEstimate(), newWords: newWordsEstimate() },
      layouts: LAYOUT_IDS.map((id) => ({ id, name: LAYOUT_NAMES[id] })),
      variants: live,
      audiences,
      olderKitCount: live.filter((v) => v.olderKit).length,
      discarded,
      textSets: copy.sets.filter((s) => TEXT_CHANNELS.includes(s.channel)),
      setsWithoutAds,
      discardedSets: copy.discarded,
      busySets: Object.fromEntries(wordsBusy),
      runs,
      totalCostPence: runs.reduce((sum, r) => sum + r.costPence, 0),
      simulated: live.some((v) => v.simulated),
      pretest: await pretestBar(tx, campaignId),
      pictureCheck: await pictureCheckBar(tx, campaignId),
      translate: {
        languages,
        unchosen,
        picked: pickedTranslate(live, allowedLangs, languageRefusalText),
        runningRunId: translating,
        simulated: live.some((v) => v.translations.some((t) => t.simulated)),
        refusedNote:
          languageRefusalText === null && languages.some((l) => !l.allowed)
            ? languages
                .filter((l) => !l.allowed)
                .map((l) => `${l.name} is left out: ${l.reason}`)
                .join(" ")
            : null,
      },
    };
  });
}

/** C7-2: Translate on the whole pick: each picked ad's words (shared words counted once) into each allowed language not yet written. */
function pickedTranslate(live: VariantView[], allowed: Lang[], refusal: string | null): CreativeView["translate"]["picked"] {
  const picked = live.filter((v) => v.picked);
  const sets = new Map(picked.map((v) => [v.words.setId, v]));
  const todo = [...sets.values()].reduce((n, v) => n + allowed.filter((l) => !v.translations.some((t) => t.lang === l)).length, 0);
  const reason =
    picked.length === 0 ? "Pick ads first: Translate works on the picked ads." : refusal ?? (todo === 0 ? "Every picked ad is already translated into the brand's languages." : null);
  return { todo, estimate: translateCost(todo).label, reason };
}

/** Starts Make creative for a campaign's signed-off brief. Refused (CreativeError, with the reason) for a draft, while it runs, or while the version has ads. */
export async function startMakeCreative(member: Member, campaignId: string, send: SendEvent): Promise<string> {
  if (!UUID.test(campaignId)) throw new CreativeError("That campaign isn't in your workspace.");
  const { refusal, c } = await asUser(member.userId, async (tx) => {
    const [c] = await tx`
      select c.brand_id, c.approved_version, b.name from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
    return { c, refusal: c ? await makeCreativeRefusal(tx, campaignId) : "That campaign isn't in your workspace." };
  });
  if (refusal) throw new CreativeError(refusal);
  const version = c.approved_version as number;
  try {
    return await createWorkflowRun(member, CREATIVE_KEY, CREATIVE_VERSION, { mode: "make", campaignId, version }, send, {
      label: `${c.name}: make creative (v${version})`,
      brandId: c.brand_id,
    });
  } catch (err) {
    // Another tab started one between the check and the insert (review finding 5).
    if (isActiveRunConflict(err, "agent_runs_one_active_make")) throw new CreativeError(MAKE_BUSY);
    throw err;
  }
}

/** The database refused a second active creative run (the partial unique indexes in 20261028000005). */
function isActiveRunConflict(err: unknown, index: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" && e.constraint_name === index;
}

type VariantRow = Record<string, unknown> & {
  id: string;
  workspace_id: string;
  campaign_id: string;
  brief_version: number;
  image_asset_id: string;
  copy_set_id: string;
  layout: LayoutId;
  kit: KitSnapshot;
  discarded_at: Date | null;
  image_discarded: Date | null;
  words_discarded: Date | null;
  status: string;
  approved_version: number | null;
  brand_id: string;
  brand_name: string;
};

async function variantFor(userId: string, variantId: string): Promise<VariantRow> {
  if (!UUID.test(variantId)) throw new CreativeError("That ad isn't in your workspace.");
  const [v] = await asUser(userId, (tx) => tx`
    select v.*, a.discarded_at as image_discarded, s.discarded_at as words_discarded,
      c.status, c.approved_version, c.brand_id, b.name as brand_name
    from public.ad_variants v
    join public.assets a on a.id = v.image_asset_id
    join public.copy_sets s on s.id = v.copy_set_id
    join public.campaigns c on c.id = v.campaign_id
    join public.brands b on b.id = c.brand_id
    where v.id = ${variantId}`);
  if (!v) throw new CreativeError("That ad isn't in your workspace.");
  return v as VariantRow;
}

function current(v: VariantRow) {
  if (v.discarded_at) throw new CreativeError("That ad was discarded. Restore it first.");
  if (v.image_discarded || v.words_discarded) throw new CreativeError("That ad's picture or words were replaced. Use the ad that replaced it.");
}

function signedOffFor(v: VariantRow) {
  if (v.status !== "approved" || !v.approved_version) throw new CreativeError(NOT_SIGNED_OFF);
  if (v.approved_version !== v.brief_version) {
    throw new CreativeError(`That ad was made for version ${v.brief_version}; the signed-off brief is now version ${v.approved_version}.`);
  }
}

async function mark(member: Member, variantId: string, sql: "pick" | "unpick" | "discard", refusal: string) {
  const v = await variantFor(member.userId, variantId);
  const res = await asUser(member.userId, async (tx) => {
    // U10-3: a running ad isn't discarded (its shortlist mark can still change).
    if (sql === "discard") await refuseIfLaunched(member.userId, v, {}, tx);
    return sql === "pick"
      ? tx`update public.ad_variants set picked_at = now() where id = ${v.id} and picked_at is null and discarded_at is null`
      : sql === "unpick"
        ? tx`update public.ad_variants set picked_at = null where id = ${v.id} and picked_at is not null`
        : tx`update public.ad_variants set discarded_at = now() where id = ${v.id} and discarded_at is null`;
  });
  if (res.count !== 1) throw new CreativeError(refusal);
}

/** Shortlists an ad (a mark only: nothing is published or spent). */
export async function pickVariant(member: Member, variantId: string): Promise<void> {
  await mark(member, variantId, "pick", "That ad is already picked, or was discarded.");
}

export async function unpickVariant(member: Member, variantId: string): Promise<void> {
  await mark(member, variantId, "unpick", "That ad isn't picked.");
}

/** Moves an ad to Discarded (undo with restoreVariant). Its picture and words stay. */
export async function discardVariant(member: Member, variantId: string): Promise<void> {
  await mark(member, variantId, "discard", "That ad is already discarded.");
}

/**
 * Undoes a discard, when its picture and words are still current and the pair
 * isn't in the gallery again. F-26: restoring an ad that a redraw replaced
 * undoes the redraw: the redrawn ad is discarded and its pick comes back with
 * the old one.
 */
export async function restoreVariant(member: Member, variantId: string): Promise<void> {
  const v = await variantFor(member.userId, variantId);
  if (!v.discarded_at) throw new CreativeError("That ad isn't discarded.");
  if (v.words_discarded) throw new CreativeError("Its words were replaced or discarded, so it can't come back. Its replacement is in the gallery.");
  if (v.image_discarded) throw new CreativeError("Its picture was replaced, so it can't come back.");
  try {
    await asUser(member.userId, async (tx) => {
      const [redraw] = await tx`
        select id, picked_at from public.ad_variants
        where based_on = ${v.id} and origin = 'redrawn' and discarded_at is null
          and image_asset_id = ${v.image_asset_id} and copy_set_id = ${v.copy_set_id}
        for update`;
      if (redraw) {
        // U10-3: undoing a redraw discards the redrawn ad, so not while a launch holds it.
        await refuseIfLaunched(member.userId, { id: redraw.id as string, campaign_id: v.campaign_id, copy_set_id: v.copy_set_id }, {}, tx);
        await tx`update public.ad_variants set discarded_at = now() where id = ${redraw.id}`;
        await tx`update public.ad_variants set discarded_at = null, picked_at = ${redraw.picked_at as Date | null} where id = ${v.id}`;
      } else {
        await tx`update public.ad_variants set discarded_at = null where id = ${v.id}`;
      }
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new CreativeError("The same picture and words are already in the gallery.");
    throw err;
  }
}

/** Switches an ad's layout after drawing it in that layout; refused with the renderer's reason ("headline too long for Split"). */
export async function setLayout(member: Member, variantId: string, layout: string): Promise<{ layout: LayoutId; checks: RenderChecks }> {
  if (!(LAYOUT_IDS as readonly string[]).includes(layout)) throw new CreativeError("Choose Full bleed, Split or Card.");
  const v = await variantFor(member.userId, variantId);
  await refuseIfLaunched(member.userId, v);
  current(v);
  const parts = await asUser(member.userId, (tx) => loadParts(tx, v.image_asset_id, v.copy_set_id, v.kit));
  if (!parts) throw new CreativeError("That ad's picture or words couldn't be read.");
  const r = await renderAd(renderInputFor(parts, layout as LayoutId));
  if ("refused" in r) throw new CreativeError(`${LAYOUT_NAMES[layout as LayoutId]} can't be used for this ad: ${r.refused}.`);
  await asUser(member.userId, (tx) => tx`
    update public.ad_variants set layout = ${layout}, checks = ${tx.json(r.checks as never)} where id = ${v.id}`);
  return { layout: layout as LayoutId, checks: r.checks };
}

/** New picture: a costed run (one image call and its check) that, when it passes, replaces this ad with one on the new picture. */
export async function newPicture(member: Member, variantId: string, send: SendEvent): Promise<string> {
  const v = await variantFor(member.userId, variantId);
  await refuseIfLaunched(member.userId, v);
  current(v);
  signedOffFor(v);
  const [busy] = await asUser(member.userId, (tx) => tx`
    select count(*)::int as n from public.agent_runs
    where agent = 'creative' and status in ('queued', 'running', 'awaiting_approval') and input ->> 'variantId' = ${v.id}`);
  if (busy.n > 0) throw new CreativeError(PICTURE_BUSY);
  try {
    return await createWorkflowRun(member, CREATIVE_KEY, CREATIVE_VERSION, { mode: "picture", campaignId: v.campaign_id, variantId: v.id }, send, {
      label: `${v.brand_name}: new picture`,
      brandId: v.brand_id,
    });
  } catch (err) {
    // Another tab asked between the check and the insert: one picture is drawn and paid for, not two (review finding 5).
    if (isActiveRunConflict(err, "agent_runs_one_active_picture")) throw new CreativeError(PICTURE_BUSY);
    throw err;
  }
}

const PICTURE_BUSY = "A new picture is already being drawn for this ad.";

/** New words for this ad's set: a Copy run whose replacement waits beside it until a person keeps one (keepWords). */
export async function newWords(member: Member, variantId: string, send: SendEvent): Promise<string> {
  const v = await variantFor(member.userId, variantId);
  await refuseIfLaunched(member.userId, v, { words: true });
  current(v);
  signedOffFor(v);
  try {
    return await startNewWords(member, v.copy_set_id, send);
  } catch (err) {
    if (err instanceof CopyError) throw new CreativeError(err.message);
    throw err;
  }
}

/** Every current ad on a set, drawn with other words (the picture and preferred layout kept). Throws if any can't be drawn in any layout. */
type MovedAd = { id: string; imageAssetId: string; rendered: Extract<Rendered, { ok: true }>; kit: KitSnapshot; pickedAt: Date | null };

async function redrawWithWords(userId: string, setId: string, override: { words: AdWords; legalLines: string[] } | null, newSetId: string | null) {
  const ads = await asUser(userId, (tx) => tx`
    select id, image_asset_id, layout, kit, picked_at from public.ad_variants where copy_set_id = ${setId} and discarded_at is null order by created_at`);
  const out: MovedAd[] = [];
  for (const ad of ads) {
    const parts = await asUser(userId, (tx) => loadParts(tx, ad.image_asset_id, newSetId ?? setId, ad.kit as KitSnapshot, override ?? undefined));
    if (!parts) throw new CreativeError("The ad's picture or words couldn't be read.");
    const rendered = await firstLayoutThatRenders(parts, ad.layout as LayoutId);
    if (!rendered.ok) return { ok: false as const, reason: refusalText(rendered.tried) };
    out.push({ id: ad.id, imageAssetId: ad.image_asset_id, rendered, kit: ad.kit as KitSnapshot, pickedAt: ad.picked_at as Date | null });
  }
  return { ok: true as const, ads: out };
}

function fitErrors(reason: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (/headline too long/.test(reason)) errors.headline = "Too long to fit the ad. Shorten it a little.";
  if (/body too long|copy too long/.test(reason)) errors.body = "Too long to fit the ad. Shorten it a little.";
  if (/call to action too long/.test(reason)) errors.cta = "Too long to fit the button. Shorten it.";
  return errors;
}

/**
 * Keeps one of an ad's two sets of words after New words: "new" discards the
 * old set and moves every current ad on it to the new words (new ads, the old
 * ones discarded); "old" discards the new words. Returns the ads now showing
 * the kept words.
 */
export async function keepWords(member: Member, variantId: string, keep: "new" | "old"): Promise<{ variantIds: string[] }> {
  const v = await variantFor(member.userId, variantId);
  // Keeping the new words re-words every ad on them; keeping the old ones only discards the waiting words.
  if (keep === "new") await refuseIfLaunched(member.userId, v, { words: true });
  current(v);
  signedOffFor(v);
  const [waiting] = await asUser(member.userId, (tx) => tx`
    select id, set from public.copy_sets
    where based_on = ${v.copy_set_id} and source = 'agent' and discarded_at is null
    order by created_at desc limit 1`);
  if (!waiting) throw new CreativeError("There are no new words waiting for this ad.");
  if (keep === "old") {
    await asUser(member.userId, (tx) => tx`update public.copy_sets set discarded_at = now() where id = ${waiting.id} and discarded_at is null`);
    const ads = await asUser(member.userId, (tx) => tx`select id from public.ad_variants where copy_set_id = ${v.copy_set_id} and discarded_at is null`);
    return { variantIds: ads.map((a) => a.id as string) };
  }
  const redrawn = await redrawWithWords(member.userId, v.copy_set_id, null, waiting.id as string);
  if (!redrawn.ok) throw new CreativeError(`The new words don't fit any layout (${redrawn.reason}). Keep the old words, or edit them.`);
  return moveAds(member, v, redrawn.ads, waiting.id as string, "new words", null);
}

async function moveAds(
  member: Member,
  v: VariantRow,
  ads: MovedAd[],
  newSetId: string,
  origin: "new words" | "edited words",
  alreadyDiscarded: "old set discarded" | null,
): Promise<{ variantIds: string[] }> {
  return asUser(member.userId, (tx) => moveAdsIn(tx, member, v, ads, newSetId, origin, alreadyDiscarded));
}

/** moveAds inside a transaction the caller holds. */
async function moveAdsIn(
  tx: Tx,
  member: Member,
  v: VariantRow,
  ads: MovedAd[],
  newSetId: string,
  origin: "new words" | "edited words",
  alreadyDiscarded: "old set discarded" | null,
): Promise<{ variantIds: string[] }> {
  if (!alreadyDiscarded) {
    const res = await tx`update public.copy_sets set discarded_at = now() where id = ${v.copy_set_id} and discarded_at is null`;
    if (res.count !== 1) throw new CreativeError("Those words were changed meanwhile. Reload the gallery.");
  }
  const ids: string[] = [];
  for (const ad of ads) {
    const res = await tx`update public.ad_variants set discarded_at = now() where id = ${ad.id} and discarded_at is null`;
    if (res.count !== 1) continue; // discarded meanwhile by the person: not brought back
    const id = await insertVariant(tx, {
      workspaceId: v.workspace_id,
      userId: member.userId,
      campaignId: v.campaign_id,
      briefVersion: v.brief_version,
      imageAssetId: ad.imageAssetId,
      copySetId: newSetId,
      layout: ad.rendered.layout,
      checks: ad.rendered.checks,
      kit: ad.kit,
      origin,
      runId: null,
      basedOn: ad.id,
      pickedAt: ad.pickedAt,
    });
    if (id) ids.push(id);
  }
  return { variantIds: ids };
}

/**
 * Edit words: a person's hand edit of this ad's set (S5-2's saveCopyEdit, the
 * same checks), then every current ad on the old set moves to the edited
 * words. Nothing is saved if the words break a rule (CopyEditError, with field
 * errors for the editor) or don't fit any layout.
 */
export async function editWords(member: Member, variantId: string, fields: unknown): Promise<{ setId: string; variantId: string | null; variantIds: string[] }> {
  const v = await variantFor(member.userId, variantId);
  await refuseIfLaunched(member.userId, v, { words: true });
  current(v);
  signedOffFor(v);
  const [s] = await asUser(member.userId, (tx) => tx`select channel from public.copy_sets where id = ${v.copy_set_id}`);
  const channel = s.channel as AdChannel;
  const parsed = EDIT_COPY[channel].safeParse(fields);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
    throw new CopyEditError(Object.entries(fieldErrors).map(([f, m]) => `${f}: ${m}`), fieldErrors);
  }
  const words = parsed.data as AdWords;
  // The rules first (banned terms, claims, names), as saveCopyEdit will check them, so a refusal names the rule rather than the fit.
  const { problems, legalLines } = await asUser(member.userId, async (tx) => {
    const ctx = await loadCopyContext(tx, v.campaign_id, v.brief_version);
    if (!ctx) throw new CreativeError("The signed-off brief version no longer exists.");
    // saveCopyEdit attaches the kit's legal lines as they are now, so the ads are checked with those.
    return { problems: setProblems(channel, words as AnyCopy, rulesFor(ctx), { where: "the", allowFigures: true }), legalLines: ctx.kit.legalLines };
  });
  if (problems.length) throw new CopyEditError(problems);
  const redrawn = await redrawWithWords(member.userId, v.copy_set_id, { words, legalLines }, null);
  if (!redrawn.ok) throw new CopyEditError([`The words don't fit any layout: ${redrawn.reason}.`], fitErrors(redrawn.reason));

  // The person's set and the ads' move are one transaction (review finding 6): if the move fails, nothing is saved.
  return asUser(member.userId, async (tx) => {
    const setId = await saveCopyEditIn(tx, member, v.copy_set_id, words);
    const { variantIds } = await moveAdsIn(tx, member, v, redrawn.ads, setId, "edited words", "old set discarded");
    const [mine] = variantIds.length ? await tx`select id from public.ad_variants where based_on = ${v.id} and discarded_at is null limit 1` : [];
    return { setId, variantId: (mine?.id as string | undefined) ?? null, variantIds };
  });
}

// F-26: Redraw with the current kit --------------------------------------------

type OlderAd = { id: string; image_asset_id: string; copy_set_id: string; layout: LayoutId };
type Redraw = { ok: true; id: string; layout: LayoutId; checks: RenderChecks } | { ok: false; id: string; reason: string };

const PICTURE_BEING_DRAWN = "a new picture is being drawn for it";
const IN_LIVE_LAUNCH = "it is running in a launch (simulated)";
const IN_WAITING_LAUNCH = "it is in a launch waiting for approval (simulated)";

/** Draws an ad with the brand's kit as it is now, in its own layout (the same picture and words). Nothing is saved; no model is called. */
async function drawWithKit(userId: string, ad: OlderAd, kit: KitSnapshot, pictures?: PictureCache): Promise<Redraw> {
  const parts = await asUser(userId, (tx) => loadParts(tx, ad.image_asset_id, ad.copy_set_id, kit, undefined, pictures));
  if (!parts) return { ok: false, id: ad.id, reason: "its picture or words couldn't be read" };
  const r = await renderAd(renderInputFor(parts, ad.layout));
  if ("refused" in r) return { ok: false, id: ad.id, reason: r.refused };
  return { ok: true, id: ad.id, layout: ad.layout, checks: r.checks };
}

/**
 * Saves redraws in one transaction: each old ad (still current, in the layout
 * it was drawn in) is discarded, and a new variant takes its place: origin
 * `redrawn`, based on it, the current kit, its pick carried over. The old
 * variant's kit is never changed (ad_variants_guard). An ad discarded or
 * switched meanwhile is left as it is.
 */
async function saveRedraws(member: Member, at: { workspaceId: string; campaignId: string; briefVersion: number }, kit: KitSnapshot, redraws: Extract<Redraw, { ok: true }>[]) {
  return asUser(member.userId, async (tx) => {
    const ids: string[] = [];
    for (const r of redraws) {
      const [old] = await tx`
        update public.ad_variants set discarded_at = now()
        where id = ${r.id} and discarded_at is null and layout = ${r.layout}
        returning image_asset_id, copy_set_id, picked_at`;
      if (!old) continue;
      const id = await insertVariant(tx, {
        workspaceId: at.workspaceId,
        userId: member.userId,
        campaignId: at.campaignId,
        briefVersion: at.briefVersion,
        imageAssetId: old.image_asset_id as string,
        copySetId: old.copy_set_id as string,
        layout: r.layout,
        checks: r.checks,
        kit,
        origin: "redrawn",
        runId: null,
        basedOn: r.id,
        pickedAt: old.picked_at as Date | null,
      });
      // The old ad held this picture and words until a moment ago, so nothing else can: roll everything back if it did.
      if (!id) throw new CreativeError("The ads changed meanwhile. Reload the gallery.");
      ids.push(id);
    }
    return ids;
  });
}

const pictureRunsFor = (tx: Tx, campaignId: string) => tx`
  select input ->> 'variantId' as variant_id from public.agent_runs
  where agent = 'creative' and status in ('queued', 'running', 'awaiting_approval')
    and input ->> 'mode' = 'picture' and input ->> 'campaignId' = ${campaignId}`;

/**
 * Redraws one ad made with an older kit with the brand's kit as it is now:
 * the same picture, words and layout, drawn in code (no AI cost). The old ad
 * is discarded; restoring it undoes the redraw. Refused, with the reason and
 * the old ad kept, when the renderer can't draw it with the new kit.
 */
export async function redrawVariant(member: Member, variantId: string): Promise<{ variantId: string }> {
  const v = await variantFor(member.userId, variantId);
  await refuseIfLaunched(member.userId, v);
  current(v);
  signedOffFor(v);
  const { kit, busy } = await asUser(member.userId, async (tx) => ({
    kit: await kitSnapshot(tx, v.brand_id),
    busy: (await pictureRunsFor(tx, v.campaign_id)).some((r) => r.variant_id === v.id),
  }));
  if (!kit) throw new CreativeError("The brand no longer exists.");
  if (sameKit(v.kit, kit)) throw new CreativeError("That ad already uses the brand's current kit.");
  if (busy) throw new CreativeError("A new picture is being drawn for that ad. Redraw it once the picture is done.");
  const r = await drawWithKit(member.userId, v, kit);
  if (!r.ok) throw new CreativeError(`That ad can't be redrawn with the current kit: ${r.reason}. It keeps the older kit.`);
  const [id] = await saveRedraws(member, { workspaceId: v.workspace_id, campaignId: v.campaign_id, briefVersion: v.brief_version }, kit, [r]);
  if (!id) throw new CreativeError("That ad was changed meanwhile. Reload the gallery.");
  return { variantId: id };
}

/**
 * Redraw all older ads: every current ad of the signed-off version whose kit
 * differs from the brand's, each as redrawVariant would. Ads the renderer
 * refuses, or with a new picture being drawn, are kept on the older kit and
 * listed with the reason; if none can be redrawn, the refusal says why.
 */
export async function redrawOlderAds(member: Member, campaignId: string): Promise<{ redrawn: string[]; kept: { id: string; reason: string }[] }> {
  if (!UUID.test(campaignId)) throw new CreativeError("That campaign isn't in your workspace.");
  const loaded = await asUser(member.userId, async (tx) => {
    const [c] = await tx`select id, workspace_id, brand_id, status, approved_version from public.campaigns where id = ${campaignId}`;
    if (!c) return null;
    const ads = c.approved_version
      ? await tx`
          select v.id, v.image_asset_id, v.copy_set_id, v.layout, v.kit
          from public.ad_variants v
          join public.assets a on a.id = v.image_asset_id
          join public.copy_sets s on s.id = v.copy_set_id
          where v.campaign_id = ${campaignId} and v.brief_version = ${c.approved_version}
            and v.discarded_at is null and a.discarded_at is null and s.discarded_at is null
          order by v.created_at, v.id`
      : [];
    const busy = new Set((await pictureRunsFor(tx, campaignId)).map((r) => r.variant_id as string));
    const held = await launchHolds(tx, campaignId, ads.map((a) => a.id as string));
    return { c, ads, busy, held, kit: await kitSnapshot(tx, c.brand_id as string) };
  });
  if (!loaded) throw new CreativeError("That campaign isn't in your workspace.");
  const { c, kit } = loaded;
  if (c.status !== "approved" || !c.approved_version) throw new CreativeError(NOT_SIGNED_OFF);
  if (!kit) throw new CreativeError("The brand no longer exists.");
  const older = loaded.ads.filter((ad) => !sameKit(ad.kit as KitSnapshot, kit)) as unknown as OlderAd[];
  if (older.length === 0) throw new CreativeError("Every ad already uses the brand's current kit.");

  const results: Redraw[] = [];
  const pictures: PictureCache = new Map(); // each picture is shared by its ads' words: converted once
  for (const ad of older) {
    const hold = loaded.held.get(ad.id);
    results.push(
      hold
        ? { ok: false, id: ad.id, reason: hold.status === "live" ? IN_LIVE_LAUNCH : IN_WAITING_LAUNCH }
        : loaded.busy.has(ad.id)
          ? { ok: false, id: ad.id, reason: PICTURE_BEING_DRAWN }
          : await drawWithKit(member.userId, ad, kit, pictures),
    );
  }
  const kept = results.flatMap((r) => (r.ok ? [] : [{ id: r.id, reason: r.reason }]));
  const ok = results.filter((r): r is Extract<Redraw, { ok: true }> => r.ok);
  if (ok.length === 0) {
    const reasons = [...new Set(kept.map((k) => k.reason))].join("; ");
    throw new CreativeError(
      kept.length === 1
        ? `That ad can't be redrawn with the current kit: ${reasons}. It keeps the older kit.`
        : `None of the ${kept.length} older ads could be redrawn with the current kit: ${reasons}. They keep the older kit.`,
    );
  }
  const redrawn = await saveRedraws(member, { workspaceId: c.workspace_id as string, campaignId, briefVersion: c.approved_version as number }, kit, ok);
  return { redrawn, kept };
}
