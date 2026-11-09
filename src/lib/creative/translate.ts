import { localiseAgent } from "@/lib/agents/localise";
import { createRun, type Member, type SendEvent } from "@/lib/agents/runs";
import { asUser, type Tx } from "@/lib/db/scoped";
import { NOT_SIGNED_OFF } from "./copy-context";
import { translateEstimate, type Estimate } from "./costs";
import { brandLanguagesIn, langList, languageRefusal, SUPPORTED_LANGS, type Lang } from "./languages";
import { lockRefusal } from "./gallery-filter";
import { holdOnWords } from "./launch-holds";

// C7-2: Translate, on a picked ad or on the whole pick. The click is the
// person's choice, with the cost shown on the button first (rule 3, as New
// words and Make creative); the run goes through generate() and the daily cap
// (rule 5) and is traced like every agent run (rule 4). It writes new copy
// sets beside the English ones and changes no ad: nothing is published or
// replaced.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TranslateError extends Error {}

export const TRANSLATE_BUSY = "A translation is already running for this campaign. It takes a few seconds per language.";

export type LanguageOption = { lang: Lang; name: string; allowed: boolean; reason: string | null; writtenForDemo: boolean };

/** The brand's languages for its ads: each allowed, or refused with the reason (no legal lines for it). Unchosen languages aren't listed. */
export async function languageOptions(tx: Tx, brandId: string): Promise<{ options: LanguageOption[]; unchosen: Lang[] }> {
  const [b] = await tx`select legal_lines from public.brands where id = ${brandId}`;
  const english = (b?.legal_lines as string[]) ?? [];
  const languages = await brandLanguagesIn(tx, brandId);
  const options = languages.map((l) => {
    const reason = languageRefusal(english, l, l.lang);
    return { lang: l.lang, name: l.name, allowed: reason === null, reason, writtenForDemo: l.writtenForDemo };
  });
  return { options, unchosen: SUPPORTED_LANGS.filter((l) => !languages.some((x) => x.lang === l)) };
}

/** What Translate would do for some ads: the English sets, the languages allowed and the translations still to write. */
export async function translationPlan(
  tx: Tx,
  campaignId: string,
  variantIds: string[] | "picked",
): Promise<{ brandId: string; brandName: string; setIds: string[]; langs: Lang[]; todo: number; refusal: string | null; options: LanguageOption[] }> {
  const [c] = await tx`
    select c.brand_id, c.status, c.approved_version, b.name from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
  if (!c) throw new TranslateError("That campaign isn't in your workspace.");
  const { options } = await languageOptions(tx, c.brand_id as string);
  const base = { brandId: c.brand_id as string, brandName: c.name as string, options };
  if (c.status !== "approved" || !c.approved_version) return { ...base, setIds: [], langs: [], todo: 0, refusal: NOT_SIGNED_OFF };
  const ads = await tx`
    select distinct v.copy_set_id from public.ad_variants v
    join public.assets a on a.id = v.image_asset_id
    join public.copy_sets s on s.id = v.copy_set_id
    where v.campaign_id = ${campaignId} and v.brief_version = ${c.approved_version} and v.discarded_at is null
      and a.discarded_at is null and s.discarded_at is null
      and ${variantIds === "picked" ? tx`v.picked_at is not null` : tx`v.id = any(${variantIds}::uuid[])`}`;
  const setIds = ads.map((a) => a.copy_set_id as string);
  const langs = options.filter((o) => o.allowed).map((o) => o.lang);
  const done = setIds.length
    ? await tx`select translated_from, lang from public.copy_sets where translated_from = any(${setIds}::uuid[]) and discarded_at is null`
    : [];
  const have = new Set(done.map((d) => `${d.translated_from}:${d.lang}`));
  const todo = setIds.reduce((n, id) => n + langs.filter((l) => !have.has(`${id}:${l}`)).length, 0);
  const refusal =
    setIds.length === 0
      ? variantIds === "picked"
        ? "Pick ads first: Translate works on the picked ads."
        : "That ad isn't current, or isn't in this campaign's signed-off version."
      : options.length === 0
        ? "The brand has no languages yet. Choose them, with their legal lines, on the brand's Languages page."
        : langs.length === 0
          ? options.map((o) => o.reason).join(" ")
          : todo === 0
            ? `Already translated into ${langList(langs)}.`
            : null;
  return { ...base, setIds, langs, todo, refusal };
}

/** The estimate for Translate on these ads (the translations still to write). */
export function translateCost(todo: number): Estimate {
  return translateEstimate(todo);
}

/**
 * Starts Translate for some ads ("picked": every picked ad). Refused with the
 * reason (TranslateError) for a draft, with nothing to translate, when no
 * language is allowed, or while a translation runs for the campaign.
 */
export async function startTranslate(member: Member, campaignId: string, variantIds: string[] | "picked", send: SendEvent): Promise<string> {
  if (!UUID.test(campaignId)) throw new TranslateError("That campaign isn't in your workspace.");
  if (variantIds !== "picked" && (variantIds.length === 0 || !variantIds.every((v) => UUID.test(v)))) throw new TranslateError("That ad isn't in your workspace.");
  const { plan, busy } = await asUser(member.userId, async (tx) => {
    const plan = await translationPlan(tx, campaignId, variantIds);
    const [b] = await tx`
      select count(*)::int as n from public.agent_runs
      where agent = 'localise' and status in ('queued', 'running') and input ->> 'campaignId' = ${campaignId}`;
    return { plan, busy: b.n > 0 };
  });
  if (plan.refusal) throw new TranslateError(plan.refusal);
  if (busy) throw new TranslateError(TRANSLATE_BUSY);
  return createRun(member, localiseAgent.key, { campaignId, setIds: plan.setIds, langs: plan.langs }, send, {
    brandId: plan.brandId,
    label: `${plan.brandName}: translate into ${langList(plan.langs)}`,
  });
}

/**
 * Discards one translation (a mark, as for any copy set), so its language can
 * be translated again. Only translations: English words are discarded through
 * the copy lists and the gallery.
 */
export async function discardTranslation(member: Member, setId: string): Promise<{ lang: string }> {
  if (!UUID.test(setId)) throw new TranslateError("That translation isn't in your workspace.");
  const [row] = await asUser(member.userId, async (tx) => {
    // U10-3: a translation an ad in a live or waiting launch shows stays until the launch ends or is decided.
    const [t] = await tx`select campaign_id, translated_from from public.copy_sets where id = ${setId} and translated_from is not null and discarded_at is null`;
    const hold = t ? await holdOnWords(tx, t.campaign_id as string, t.translated_from as string) : null;
    if (hold) throw new TranslateError(lockRefusal(hold.status, true));
    return tx`
      update public.copy_sets set discarded_at = now()
      where id = ${setId} and translated_from is not null and discarded_at is null
      returning lang`;
  });
  if (!row) throw new TranslateError("That translation isn't in your workspace, or is already discarded.");
  return { lang: row.lang as string };
}
