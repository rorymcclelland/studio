// P9-1's fixtures (tests/db/launch.test.ts), shared so later Performance
// stories (P9-2 onwards) build their brands, campaigns, ads and launches the
// same way: a Fernhollow brand, a campaign signed off at version 1, ads as
// Make creative records them (simulated pictures), and a launch written
// straight to the database with its approval. The database is real; nothing
// here is mocked.
import { insertImage, toWebp } from "@/lib/assets/store";
import { insertDemoLanguages } from "@/lib/creative/languages";
import { renderAd } from "@/lib/creative/render/render";
import { loadParts, renderInputFor, type KitSnapshot, type LayoutId } from "@/lib/creative/variants";
import { asUser } from "@/lib/db/scoped";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";
import { checkedVision } from "./vision";

export type Member = { userId: string; workspaceId: string };

export const KIT: KitSnapshot = {
  brandName: FERNHOLLOW.kit.name,
  palette: FERNHOLLOW.kit.palette,
  fontPrimary: FERNHOLLOW.kit.fontPrimary,
  fontSecondary: FERNHOLLOW.kit.fontSecondary,
  logo: { svg: FERNHOLLOW.kit.logoSvg },
};
export const EN = { headline: "Made for the long way round", body: "A three-layer shell for wet days on high ground, built to be mended rather than replaced.", cta: "Shop jackets" };
export const SOCIAL = ["1080x1080", "1080x1350", "1080x1920", "1200x628"];

/** The mock Brief agent's brief, as P9-1's: its KPI is the reactivation rate. */
export const brief = (title: string) => ({
  title,
  summary: "Bring walkers back for autumn.",
  story: "Walkers come back when the kit lasts.",
  insights: [1, 2, 3].map((n) => ({ text: `Walkers say reason ${n} matters.`, cites: [`note-${n}`] })),
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach walkers." }],
  kpi: { metric: "reactivation rate" },
  mustInclude: [],
  avoid: [],
});

/** A simulated Fernhollow brand in the member's workspace, with its demo languages; returns its id. */
export async function brandFor(m: Member, slug: string): Promise<string> {
  return asUser(m.userId, async (tx) => {
    const [br] = await tx`insert into public.brands (workspace_id, name, slug, legal_lines, banned_terms, dont_rules, palette, font_primary, font_secondary, logo_svg, created_by, is_simulated)
      values (${m.workspaceId}, ${FERNHOLLOW.kit.name}, ${slug}, ${FERNHOLLOW.kit.legalLines}, ${FERNHOLLOW.kit.bannedTerms}, ${FERNHOLLOW.kit.dontRules},
              ${tx.json(FERNHOLLOW.kit.palette)}, ${FERNHOLLOW.kit.fontPrimary}, ${FERNHOLLOW.kit.fontSecondary}, ${FERNHOLLOW.kit.logoSvg}, ${m.userId}, true) returning id`;
    await insertDemoLanguages(tx, m, br.id as string, "fernhollow");
    return br.id as string;
  });
}

/** Adds simulated products to a brand (the Business Context store's catalogue), as the demo seed does. */
export async function productsFor(m: Member, brandId: string, products: { name: string; pricePence: number; active?: boolean }[]): Promise<void> {
  await asUser(m.userId, async (tx) => {
    for (const p of products) {
      await tx`insert into public.products (workspace_id, brand_id, name, price_pence, active) values (${m.workspaceId}, ${brandId}, ${p.name}, ${p.pricePence}, ${p.active ?? true})`;
    }
  });
}

/** A campaign signed off at version 1, never signed off, or signed off and then edited to version 2. */
export async function campaignFor(m: Member, brandId: string, state: "signed off" | "draft" | "edited", objective: string): Promise<string> {
  return asUser(m.userId, async (tx) => {
    const versions = state === "edited" ? 2 : 1;
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${brandId}, ${objective}, ${m.userId}, 1) returning id`;
    for (let v = 1; v <= versions; v++) {
      await tx`update public.campaigns set current_version = ${v} where id = ${c.id}`;
      await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
        values (${m.workspaceId}, ${c.id}, ${v}, ${tx.json(brief(`Long way round ${v}`))}, 'agent', ${m.userId})`;
    }
    if (state === "signed off") await tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
    if (state === "edited") await tx`update public.campaigns set status = 'draft', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
    return c.id as string;
  });
}

/** Builds a campaign's picture, words and ads, as Make creative records them. */
export function builder(m: Member, brandId: string, campaignId: string) {
  return {
    image: async (prompt: string) => {
      const webp = await toWebp(await drawMockImage({ prompt, palette: FERNHOLLOW.kit.palette.map((p) => p.hex), size: "2K" }));
      return asUser(m.userId, (tx) =>
        insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId, campaignId, runId: null, webp, simulated: true, createdByKind: "agent", meta: { picture: 1, briefVersion: 1, idea: "A walker on a ridge", vision: checkedVision(FERNHOLLOW.kit.dontRules) } }),
      );
    },
    words: (headline: string) =>
      asUser(m.userId, async (tx) => {
        const [s] = await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by)
          values (${m.workspaceId}, ${campaignId}, 1, 'paid social', 'Walkers', ${tx.json({ ...EN, headline })}, ${FERNHOLLOW.kit.legalLines}, 'agent', ${m.userId}) returning id`;
        return s.id as string;
      }),
    ad: (image: string, setId: string, layout: LayoutId, picked: boolean) =>
      asUser(m.userId, async (tx) => {
        const parts = await loadParts(tx, image, setId, KIT);
        const drawn = await renderAd(renderInputFor(parts!, layout));
        if ("refused" in drawn) throw new Error(drawn.refused);
        const [v] = await tx`insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by, picked_at)
          values (${m.workspaceId}, ${campaignId}, 1, ${image}, ${setId}, ${layout}, ${tx.json(drawn.checks as never)}, ${tx.json(KIT as never)}, 'composed', ${m.userId}, ${picked ? new Date() : null}) returning id`;
        return v.id as string;
      }),
  };
}

/**
 * A launch written straight to the database as a member, with its approval
 * decided as the status needs (P9-1's rawLaunch): by default live, £50 a day
 * for 30 days from 6 November 2026, cost per acquisition at or below £20, seed 42,
 * with the given ads in the four social sizes, in English.
 */
export async function rawLaunch(m: Member, campaignId: string, variantIds: string[], over: Record<string, unknown> = {}) {
  const status = (over.status as string | undefined) ?? "live";
  return asUser(m.userId, async (tx) => {
    const decided = status === "awaiting_approval" ? null : status === "refused" ? "rejected" : "approved";
    const [ap] = await tx`
      insert into public.approvals (workspace_id, kind, campaign_id, question, options, expires_at, status, decided_by, decided_at)
      values (${m.workspaceId}, 'launch', ${campaignId}, 'Launch (simulated)', '[]'::jsonb, now() + interval '14 days',
              ${decided ?? "pending"}, ${decided ? m.userId : null}, ${decided ? new Date() : null})
      returning id`;
    const row: Record<string, unknown> = {
      workspace_id: m.workspaceId,
      campaign_id: campaignId,
      ads: tx.json(variantIds.map((variantId) => ({ variantId, sizes: SOCIAL, langs: ["en-GB"] }))),
      daily_budget_pence: 5000,
      days: 30,
      starts_on: "2026-11-06",
      kpi_measure: "cpa",
      kpi_value: 20,
      seed: "42",
      status,
      approval_id: ap.id,
      created_by: m.userId,
      approved_at: status === "awaiting_approval" || status === "refused" ? null : new Date(),
      ended_by: status === "ended" ? m.userId : null,
      ended_at: status === "ended" ? new Date() : null,
      ...over,
    };
    const [l] = await tx`insert into public.launches ${tx(row as never)} returning id`;
    return { launchId: l.id as string, approvalId: ap.id as string };
  });
}
