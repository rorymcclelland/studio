import { realNamesFor } from "@/lib/brief/gather";
import { storedBrief, type StoredBrief } from "@/lib/brief/schema";
import type { Tx } from "@/lib/db/scoped";
import { evidencePool, type CopyRules } from "./copy-rules";

// S5-2: what the Copy agent and the copy checks read about a campaign: its
// signed-off brief version, the items that brief cites, and the brand's kit.

export const NOT_SIGNED_OFF = "Sign off the brief before making copy: creative starts only from a signed-off brief.";

const EVIDENCE_CHARS = 600;

export type CopyContext = {
  campaignId: string;
  brandId: string;
  brandName: string;
  voice: string;
  doRules: string[];
  kit: { legalLines: string[]; bannedTerms: string[]; dontRules: string[]; evidenceClaims: string[]; realNames: string[] };
  products: string[];
  places: string[];
  /** The campaign's sign-off state: creative starts only when it is 'approved'. */
  status: string;
  approvedVersion: number | null;
  /** The brief version loaded (the approved one unless asked otherwise). */
  version: number;
  brief: StoredBrief;
  /** The brief's cited items and audience segments, by id. */
  items: Record<string, { kind: string; title: string; body: string }>;
};

/** A brief's audiences as the Copy agent sees them, tagged A1..An; one "all" audience when the brief names none. */
export type TaggedAudience = { tag: string; segmentRef: string | null; segment: string; why: string; facts: string };

/** Loads a campaign's brief version (default: the approved one) and kit, or null if there is none. */
export async function loadCopyContext(tx: Tx, campaignId: string, version?: number): Promise<CopyContext | null> {
  const [c] = await tx`
    select c.id, c.brand_id, c.status, c.approved_version, b.name, b.tone_words, b.voice_notes, b.do_rules, b.dont_rules,
      b.legal_lines, b.banned_terms, b.evidence_claims
    from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
  const v = version ?? (c?.approved_version as number | null);
  if (!c || !v) return null;
  const [row] = await tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${v}`;
  if (!row) return null;
  const brief = storedBrief.parse(row.brief);
  const cited = [...new Set([...brief.insights.flatMap((i) => i.cites), ...brief.audiences.map((a) => a.segmentRef)])];
  const items = await tx`select id, kind, title, body from public.context_items where brand_id = ${c.brand_id} and id::text = any(${cited})`;
  const products = await tx`select name from public.products where brand_id = ${c.brand_id} and active order by name limit 40`;
  const places = await tx`select distinct region from public.customers where brand_id = ${c.brand_id} and region <> '' order by region limit 30`;
  return {
    campaignId: c.id,
    brandId: c.brand_id,
    brandName: c.name,
    voice: [(c.tone_words as string[]).join(", "), c.voice_notes as string].filter(Boolean).join(". ").slice(0, 2500),
    doRules: c.do_rules,
    kit: {
      legalLines: c.legal_lines,
      bannedTerms: c.banned_terms,
      dontRules: c.dont_rules,
      evidenceClaims: c.evidence_claims,
      realNames: await realNamesFor(tx, c.brand_id),
    },
    products: products.map((p) => p.name as string),
    places: places.map((p) => p.region as string),
    status: c.status,
    approvedVersion: c.approved_version,
    version: v,
    brief,
    items: Object.fromEntries(items.map((i) => [i.id as string, { kind: i.kind as string, title: i.title as string, body: i.body as string }])),
  };
}

export function taggedAudiences(ctx: CopyContext): TaggedAudience[] {
  const tagged = ctx.brief.audiences.map((a, n) => ({
    tag: `A${n + 1}`,
    segmentRef: a.segmentRef,
    segment: ctx.items[a.segmentRef]?.title ?? "A segment",
    why: a.why,
    facts: (ctx.items[a.segmentRef]?.body ?? "").slice(0, 800),
  }));
  return tagged.length ? tagged : [{ tag: "all", segmentRef: null, segment: "Everyone the brief is for", why: "The brief names no audience.", facts: "" }];
}

/** Each insight with its cited items' text, for the prompt and the evidence pool. */
export function insightsWithEvidence(ctx: CopyContext): { text: string; evidence: { title: string; text: string }[] }[] {
  return ctx.brief.insights.map((i) => ({
    text: i.text,
    evidence: i.cites.flatMap((id) => {
      const item = ctx.items[id];
      if (!item) return [];
      return [{ title: item.title, text: item.body.length > EVIDENCE_CHARS ? `${item.body.slice(0, EVIDENCE_CHARS - 3)}...` : item.body }];
    }),
  }));
}

/** The check rules for a context: today's kit, and the brief's cited items as the evidence pool. */
export function rulesFor(ctx: CopyContext): CopyRules {
  const audiences = taggedAudiences(ctx);
  return {
    brandName: ctx.brandName,
    products: ctx.products,
    places: ctx.places,
    bannedTerms: ctx.kit.bannedTerms,
    evidenceClaims: ctx.kit.evidenceClaims,
    realNames: ctx.kit.realNames,
    legalLines: ctx.kit.legalLines,
    pool: evidencePool([...insightsWithEvidence(ctx).flatMap((i) => i.evidence), ...audiences.map((a) => ({ title: a.segment, text: a.facts }))]),
  };
}
