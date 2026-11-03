// C8-1 Compliance checks in the database: findings worked out from real ads
// (src/lib/compliance/compute.ts, through asUser) and people's decisions in
// compliance_decisions (migration 20261103000001). Test cases 1 (a Fernhollow
// Card ad meets every rule in every size and language; once its don't rules
// are accepted it passes), 3 (a banned term added to the kit after the ad, in
// English and German), 4 (a missing legal line in a language fails, and the
// pack leaves that language out), 8 (a decision names who and when; a layout
// switch or a redraw makes the item Review again), 10 (another workspace
// can't read or write a decision: the same refusal as a missing ad, and row-
// level security) and 11 (a decision's note is cut and kept as text; a stale
// item is refused). The rules themselves are tests/lib/compliance-rules.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertImage, toWebp } from "@/lib/assets/store";
import { clearSizeCache } from "@/lib/creative/ad-sizes";
import { acceptDontRuleForPicked, adCompliance, ComplianceError, complianceFor, decideFinding, galleryCompliance, type AdCompliance } from "@/lib/compliance/compute";
import { clearFitCache } from "@/lib/creative/fit-cache";
import { getCreative, redrawVariant, setLayout } from "@/lib/creative/gallery";
import { DEMO_LANGUAGES, insertDemoLanguages } from "@/lib/creative/languages";
import { planPack } from "@/lib/creative/pack";
import { renderAd } from "@/lib/creative/render/render";
import { loadParts, renderInputFor, type KitSnapshot, type LayoutId } from "@/lib/creative/variants";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

const kit: KitSnapshot = { brandName: FERNHOLLOW.kit.name, palette: FERNHOLLOW.kit.palette, fontPrimary: FERNHOLLOW.kit.fontPrimary, fontSecondary: FERNHOLLOW.kit.fontSecondary, logo: { svg: FERNHOLLOW.kit.logoSvg } };
const EN = { headline: "Made for the long way round", body: "A three-layer shell for wet days on high ground, built to be mended rather than replaced.", cta: "Shop jackets" };
const DE = { headline: "Für den langen Weg gemacht", body: "Eine Jacke für nasse Tage am Berg, gemacht zum Flicken statt zum Ersetzen.", cta: "Jacken ansehen" };
const brief = {
  title: "Long way round",
  summary: "Bring walkers back for autumn.",
  story: "Walkers come back when the kit lasts.",
  insights: [1, 2, 3].map((n) => ({ text: `Walkers say reason ${n} matters.`, cites: [`note-${n}`] })),
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach walkers." }],
  kpi: { metric: "reach" },
  mustInclude: [],
  avoid: [],
};

let a: Member;
let b: Member;
let aEmail: string;
let ids: { brand: string; campaign: string; card: string; fullBleed: string; theirs: string };

async function setup(m: Member, slug: string) {
  const webp = await toWebp(await drawMockImage({ prompt: `compliance ${slug}`, palette: FERNHOLLOW.kit.palette.map((p) => p.hex), size: "2K" }));
  return asUser(m.userId, async (tx) => {
    const [br] = await tx`insert into public.brands (workspace_id, name, slug, legal_lines, banned_terms, dont_rules, palette, font_primary, font_secondary, logo_svg, created_by, is_simulated)
      values (${m.workspaceId}, ${FERNHOLLOW.kit.name}, ${slug}, ${FERNHOLLOW.kit.legalLines}, ${FERNHOLLOW.kit.bannedTerms}, ${FERNHOLLOW.kit.dontRules},
              ${tx.json(FERNHOLLOW.kit.palette)}, ${FERNHOLLOW.kit.fontPrimary}, ${FERNHOLLOW.kit.fontSecondary}, ${FERNHOLLOW.kit.logoSvg}, ${m.userId}, true) returning id`;
    await insertDemoLanguages(tx, m, br.id as string, "fernhollow");
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${br.id}, 'Bring walkers back for autumn', ${m.userId}, 1) returning id`;
    await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by) values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief)}, 'agent', ${m.userId})`;
    await tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
    const image = await insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId: br.id as string, campaignId: c.id as string, runId: null, webp, simulated: true, createdByKind: "agent", meta: { picture: 1, briefVersion: 1, idea: "A walker on a ridge" } });
    const [s] = await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by)
      values (${m.workspaceId}, ${c.id}, 1, 'paid social', 'Walkers', ${tx.json(EN)}, ${FERNHOLLOW.kit.legalLines}, 'agent', ${m.userId}) returning id`;
    const [s2] = await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by)
      values (${m.workspaceId}, ${c.id}, 1, 'paid social', 'Walkers', ${tx.json({ ...EN, headline: "Kit for the long way round" })}, ${FERNHOLLOW.kit.legalLines}, 'agent', ${m.userId}) returning id`;
    await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by, lang, translated_from, simulated)
      values (${m.workspaceId}, ${c.id}, 1, 'paid social', 'Walkers', ${tx.json(DE)}, ${DEMO_LANGUAGES.fernhollow["de-DE"].legalLines}, 'agent', ${m.userId}, 'de-DE', ${s.id}, true)`;
    const ad = async (setId: string, layout: LayoutId) => {
      const parts = await loadParts(tx, image, setId, kit);
      const drawn = await renderAd(renderInputFor(parts!, layout));
      if ("refused" in drawn) throw new Error(drawn.refused);
      const [v] = await tx`insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by, picked_at)
        values (${m.workspaceId}, ${c.id}, 1, ${image}, ${setId}, ${layout}, ${tx.json(drawn.checks as never)}, ${tx.json(kit as never)}, 'composed', ${m.userId}, now()) returning id`;
      return v.id as string;
    };
    return { brand: br.id as string, campaign: c.id as string, card: await ad(s.id as string, "card"), fullBleed: await ad(s2.id as string, "full-bleed") };
  });
}

const of =(ad: AdCompliance, lang: string) => ad.items.filter((i) => i.lang === lang).flatMap((i) => i.findings);
const must = async (userId: string, id: string) => (await adCompliance(userId, id))!;

async function acceptAll(m: Member, id: string, what: (ad: AdCompliance) => { key: string; lang: string | null; size: string | null; hash: string; status: string; outcome: string }[]) {
  for (const f of what(await must(m.userId, id))) {
    if (f.status !== "review" || f.outcome !== "review") continue;
    await decideFinding(m, id, { lang: f.lang, size: f.size, rule: f.key, hash: f.hash, decision: "accept", note: null });
  }
}

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  [{ email: aEmail }] = await getSql()`select email from auth.users where id = ${a.userId}`;
  const mine = await setup(a, "fernhollow");
  const theirs = await setup(b, "fernhollow-b");
  ids = { ...mine, theirs: theirs.card };
}, 120_000);
beforeEach(() => {
  clearSizeCache();
  clearFitCache();
});
afterAll(closeSql);

describe("C8-1 compliance in the database", () => {
  it("#1 a Fernhollow social ad in Card meets every rule in all four sizes and every language: only its don't rules wait, and accepted it Passes", async () => {
    const ad = await must(a.userId, ids.card);
    expect([...new Set(ad.items.map((i) => i.lang))]).toEqual(["en-GB", "de-DE"]);
    expect(ad.items.map((i) => i.size)).toEqual(["1080x1080", "1080x1350", "1080x1920", "1200x628", "1080x1080", "1080x1350", "1080x1920", "1200x628"]);
    for (const i of ad.items) {
      expect(i.refused, `${i.lang} ${i.size}`).toBeNull();
      expect(i.layout, `${i.lang} ${i.size}`).toBe("card");
      const rules = i.findings.map((f) => f.rule);
      expect(rules, `${i.lang} ${i.size}`).toEqual(["contrast", "legal", "banned", "logo", "density", ...(i.size === "1080x1920" ? ["platform"] : []), "simulated"]);
      for (const f of i.findings) expect(f.status, `${i.lang} ${i.size} ${f.rule}: ${f.reason}`).toBe("pass");
    }
    // The don't rules: each once, for the whole ad, as Review.
    expect(ad.perAd.map((f) => [f.fix, f.status, f.size, f.lang])).toEqual(FERNHOLLOW.kit.dontRules.map((r) => [r, "review", null, null]));
    expect(ad.pill).toEqual({ tone: "review", label: "3 to review" });
    expect(ad.files).toEqual({ pass: 0, review: 8, fail: 0 });

    await acceptAll(a, ids.card, (x) => x.perAd);
    const after = await must(a.userId, ids.card);
    expect(after.pill).toEqual({ tone: "pass", label: "Passes" });
    expect(after.files).toEqual({ pass: 8, review: 0, fail: 0 });
    for (const f of after.perAd) expect(f).toMatchObject({ outcome: "accepted", decision: { decision: "accept", decidedBy: a.userId, decidedByName: aEmail } });

    // The gallery: a pill per ad and the picked ads' summary line, counted over drawn files.
    const view = await getCreative(a.userId, ids.campaign);
    const g = await galleryCompliance(a.userId, view!);
    expect(g.pills[ids.card]).toEqual({ tone: "pass", label: "Passes" });
    // The Full bleed ad keeps clear of a story's bands too (every layout does), so only its don't rules wait.
    expect(g.pills[ids.fullBleed]).toEqual({ tone: "review", label: "3 to review" });
    expect(g.summary!.text).toBe("8 ads pass, 4 to review, 0 fail");
    expect(g.dontRules.map((r) => [r.rule, r.open, r.picked])).toEqual(FERNHOLLOW.kit.dontRules.map((r) => [r, 1, 2]));
  });

  it("#3 a banned term added to the kit after the ad was made fails with the term quoted, in English and in German", async () => {
    const sql = getSql();
    try {
      await sql`update public.brands set banned_terms = array_append(banned_terms, 'mended') where id = ${ids.brand}`;
      await sql`update public.brand_languages set banned_terms = array_append(banned_terms, 'Flicken') where brand_id = ${ids.brand} and lang = 'de-DE'`;
      const ad = await must(a.userId, ids.card);
      for (const f of of(ad, "en-GB").filter((x) => x.rule === "banned")) {
        expect(f).toMatchObject({ status: "fail", reason: 'The banned term "mended" is in the English body.', fix: 'Remove "mended"' });
      }
      // German: its own term, and the English one doesn't reach the German words ("gemacht zum Flicken").
      for (const f of of(ad, "de-DE").filter((x) => x.rule === "banned")) {
        expect(f).toMatchObject({ status: "fail", reason: 'The banned term "Flicken" is in the German body.', short: "banned term 'Flicken' in German" });
      }
      expect(ad.pill.label).toBe("Fails");
      expect(ad.files.fail).toBe(8);
    } finally {
      await sql`update public.brands set banned_terms = ${FERNHOLLOW.kit.bannedTerms} where id = ${ids.brand}`;
      await sql`update public.brand_languages set banned_terms = ${DEMO_LANGUAGES.fernhollow["de-DE"].bannedTerms} where brand_id = ${ids.brand} and lang = 'de-DE'`;
    }
    expect((await must(a.userId, ids.card)).pill.label).toBe("Passes");
  });

  it("#4 a missing legal line in a language fails, and the pack leaves that language out with the reason", async () => {
    const sql = getSql();
    const added = "Kostenlose Reparatur im ersten Jahr.";
    try {
      await sql`update public.brand_languages set legal_lines = array_append(legal_lines, ${added}) where brand_id = ${ids.brand} and lang = 'de-DE'`;
      const ad = await must(a.userId, ids.card);
      for (const f of of(ad, "de-DE").filter((x) => x.rule === "legal")) {
        expect(f).toMatchObject({ status: "fail", reason: `A legal line is missing in German: "${added}".`, fix: "Add the legal lines in German on the Languages page, then translate this ad again" });
      }
      for (const f of of(ad, "en-GB").filter((x) => x.rule === "legal")) expect(f.status).toBe("pass");

      const plan = await planPack(a.userId, ids.campaign);
      if (!plan || "refused" in plan) throw new Error("no plan");
      expect(plan.items.filter((i) => i.adId === ids.card).map((i) => `${i.lang} ${i.size}`)).toEqual(["en-GB 1080x1080", "en-GB 1080x1350", "en-GB 1080x1920", "en-GB 1200x628"]);
      // German, every size, once (French and Spanish are left out as before: the ad has no words in them).
      expect(plan.leftOut.filter((l) => l.adId === ids.card && l.lang === "de-DE")).toEqual([expect.objectContaining({ lang: "de-DE", size: null, reason: "Fails: a legal line missing in German." })]);
    } finally {
      await sql`update public.brand_languages set legal_lines = ${DEMO_LANGUAGES.fernhollow["de-DE"].legalLines} where brand_id = ${ids.brand} and lang = 'de-DE'`;
    }
    // English with no line while the kit has one: added to the kit after the words were written.
    try {
      await sql`update public.brands set legal_lines = array_append(legal_lines, 'Delivery takes 3 to 5 days.') where id = ${ids.brand}`;
      const ad = await must(a.userId, ids.card);
      expect(of(ad, "en-GB").find((x) => x.rule === "legal")).toMatchObject({ status: "fail", short: "a legal line missing in English" });
    } finally {
      await sql`update public.brands set legal_lines = ${FERNHOLLOW.kit.legalLines} where id = ${ids.brand}`;
    }
  });

  it("#8 a decision names who and when; a layout switch or a redraw with the current kit makes the don't rules Review again", async () => {
    const before = await must(a.userId, ids.card);
    expect(before.perAd.every((f) => f.outcome === "accepted")).toBe(true);
    const at = before.perAd[0].decision!.decidedAt;
    expect(Date.now() - at.getTime()).toBeLessThan(120_000);
    const rows = await asUser(a.userId, (tx) => tx`select decided_by, decided_by_name, rule, lang, size from public.compliance_decisions where variant_id = ${ids.card}`);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatchObject({ decided_by: a.userId, decided_by_name: aEmail, lang: null, size: null });

    // A layout switch redraws the ad: the same rules are new findings.
    await setLayout(a, ids.card, "split");
    const split = await must(a.userId, ids.card);
    expect(split.perAd.map((f) => f.outcome)).toEqual(["review", "review", "review"]);
    await setLayout(a, ids.card, "card");
    // Back in Card it is the drawing that was accepted, so the decisions apply again.
    expect((await must(a.userId, ids.card)).perAd.map((f) => f.outcome)).toEqual(["accepted", "accepted", "accepted"]);

    // F-26: a redraw with the current kit (a palette change) is a new ad: Review again.
    const sql = getSql();
    try {
      await sql`update public.brands set palette = ${sql.json([...FERNHOLLOW.kit.palette].reverse())} where id = ${ids.brand}`;
      const { variantId } = await redrawVariant(a, ids.card);
      const redrawn = await must(a.userId, variantId);
      expect(redrawn.perAd.map((f) => f.outcome)).toEqual(["review", "review", "review"]);
      ids.card = variantId;
      await acceptAll(a, ids.card, (x) => x.perAd);
    } finally {
      await sql`update public.brands set palette = ${sql.json(FERNHOLLOW.kit.palette)} where id = ${ids.brand}`;
    }
  });

  it("#8 Accept for every picked ad records one decision per picked ad, each with name, time and its own hash; decided ads are left as they are", async () => {
    const [key, other] = (await must(a.userId, ids.fullBleed)).perAd.map((f) => f.key);
    // A person marks the second rule not acceptable on the Full bleed ad first; the bulk accept leaves that alone.
    const theirs = (await must(a.userId, ids.fullBleed)).perAd.find((f) => f.key === other)!;
    await decideFinding(a, ids.fullBleed, { lang: null, size: null, rule: other, hash: theirs.hash, decision: "reject", note: "Not on this one" });

    const before = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.compliance_decisions where rule = ${key}`);
    // The Card ad already accepted it (test case 1): only the Full bleed ad gets a new decision.
    expect(await acceptDontRuleForPicked(a, ids.campaign, key)).toEqual({ accepted: 1, alreadyDecided: 1, rejected: 0 });
    const rows = await asUser(a.userId, (tx) => tx`select variant_id, finding_hash, decision, decided_by, decided_by_name, decided_at from public.compliance_decisions where rule = ${key} order by decided_at`);
    expect(rows).toHaveLength(before[0].n + 1);
    const mine = (await must(a.userId, ids.fullBleed)).perAd.find((f) => f.key === key)!;
    expect(rows.at(-1)).toMatchObject({ variant_id: ids.fullBleed, finding_hash: mine.hash, decision: "accept", decided_by: a.userId, decided_by_name: aEmail });
    expect(mine).toMatchObject({ outcome: "accepted", decision: { decidedByName: aEmail } });
    // Each ad's decision is tied to its own finding: the two ads' hashes differ.
    const card = (await must(a.userId, ids.card)).perAd.find((f) => f.key === key)!;
    expect(card.hash).not.toBe(mine.hash);
    expect(card.outcome).toBe("accepted");

    // Again: nothing is left to accept. The rejected rule stays not acceptable.
    expect(await acceptDontRuleForPicked(a, ids.campaign, key)).toEqual({ accepted: 0, alreadyDecided: 2, rejected: 0 });
    expect(await acceptDontRuleForPicked(a, ids.campaign, other)).toEqual({ accepted: 0, alreadyDecided: 1, rejected: 1 });
    expect((await must(a.userId, ids.fullBleed)).perAd.find((f) => f.key === other)!.outcome).toBe("fail");
    // The gallery's counts follow.
    const g = await galleryCompliance(a.userId, (await getCreative(a.userId, ids.campaign))!);
    expect(g.dontRules.find((r) => r.key === key)).toMatchObject({ open: 0, picked: 2, rejected: 0 });
    expect(g.dontRules.find((r) => r.key === other)).toMatchObject({ open: 0, picked: 2, rejected: 1 });

    // Another workspace sees nothing picked in A's campaign; a key that isn't a rule, or a malformed one, is refused.
    await expect(acceptDontRuleForPicked(b, ids.campaign, key)).rejects.toThrow("Nothing is picked in this campaign, so there is nothing to accept.");
    await expect(acceptDontRuleForPicked(a, ids.campaign, "dont:0000000000000000")).rejects.toThrow(/isn't one of the brand's don't rules/);
    for (const bad of ["logo", "dont:'; drop", ""]) await expect(acceptDontRuleForPicked(a, ids.campaign, bad)).rejects.toThrow("That rule couldn't be read.");
  });

  it("#10 another workspace can't read or write a decision: the same refusal as a missing ad, and RLS in the database", async () => {
    // Through the app: B can't see A's ad or decide on it; it reads as a missing ad would.
    expect(await adCompliance(b.userId, ids.card)).toBeNull();
    expect((await complianceFor(b.userId, [ids.card, ids.theirs])).has(ids.card)).toBe(false);
    const theirs = await must(a.userId, ids.card);
    const f = theirs.perAd[0];
    const missing = await decideFinding(b, "00000000-0000-4000-8000-000000000000", { lang: null, size: null, rule: f.key, hash: f.hash, decision: "accept" }).catch((e: Error) => e);
    const other = await decideFinding(b, ids.card, { lang: null, size: null, rule: f.key, hash: f.hash, decision: "reject" }).catch((e: Error) => e);
    expect(other).toBeInstanceOf(ComplianceError);
    expect((other as Error).message).toBe("That ad isn't in your workspace.");
    expect((missing as Error).message).toBe((other as Error).message);

    // In the database: B reads none of A's decisions and can't add one to A's workspace or A's ad.
    expect(await asUser(b.userId, (tx) => tx`select id from public.compliance_decisions where variant_id = ${ids.card}`)).toHaveLength(0);
    const row = (ws: string) => asUser(b.userId, (tx) => tx`
      insert into public.compliance_decisions (workspace_id, variant_id, rule, finding_hash, decision, decided_by, decided_by_name)
      values (${ws}, ${ids.card}, 'contrast', ${"a".repeat(64)}, 'accept', ${b.userId}, 'x')`);
    await expect(row(a.workspaceId)).rejects.toThrow(/row-level security/);
    await expect(row(b.workspaceId)).rejects.toMatchObject({ code: "23503" });
    // A's own decisions are append-only: no update or delete, even by A.
    await expect(asUser(a.userId, (tx) => tx`update public.compliance_decisions set decision = 'reject' where variant_id = ${ids.card}`)).rejects.toThrow(/permission denied/);
    await expect(asUser(a.userId, (tx) => tx`delete from public.compliance_decisions where variant_id = ${ids.card}`)).rejects.toThrow(/permission denied/);
    expect(await asAnon((tx) => tx`select has_table_privilege('anon', 'public.compliance_decisions', 'select') as ok`)).toEqual([{ ok: false }]);
    // B's own ad is B's to decide.
    const mine = await must(b.userId, ids.theirs);
    const g = mine.perAd[0];
    await expect(decideFinding(b, ids.theirs, { lang: null, size: null, rule: g.key, hash: g.hash, decision: "accept" })).resolves.toMatchObject({ outcome: "accepted" });
  });

  it("#11 hostile: a decision's note is cut to 500 characters and stored as plain text, and a stale finding is refused", async () => {
    const ad = await must(a.userId, ids.fullBleed);
    const f = ad.perAd[0];
    const note = `<script>alert("x")</script>${"n".repeat(600)}`;
    const done = await decideFinding(a, ids.fullBleed, { lang: null, size: null, rule: f.key, hash: f.hash, decision: "reject", note });
    expect(done.decision!.note).toHaveLength(500);
    expect(done.decision!.note!.startsWith('<script>alert("x")</script>n')).toBe(true);
    expect(done.outcome).toBe("fail");
    // The database caps it too.
    await expect(asUser(a.userId, (tx) => tx`
      insert into public.compliance_decisions (workspace_id, variant_id, rule, finding_hash, decision, note, decided_by, decided_by_name)
      values (${a.workspaceId}, ${ids.fullBleed}, ${f.key}, ${f.hash}, 'accept', ${"n".repeat(501)}, ${a.userId}, 'x')`)).rejects.toThrow(/check constraint/);
    // Who and when are the session's, whatever the insert says.
    await asUser(a.userId, (tx) => tx`
      insert into public.compliance_decisions (workspace_id, variant_id, rule, finding_hash, decision, decided_by, decided_by_name, decided_at)
      values (${a.workspaceId}, ${ids.fullBleed}, ${f.key}, ${f.hash}, 'accept', ${a.userId}, 'Someone else', '2001-01-01')`);
    const [last] = await asUser(a.userId, (tx) => tx`select decided_by_name, decided_at from public.compliance_decisions where variant_id = ${ids.fullBleed} order by decided_at desc limit 1`);
    expect(last.decided_by_name).toBe(aEmail);
    expect((last.decided_at as Date).getFullYear()).toBeGreaterThan(2025);

    // A stale hash, a rule that isn't there, a passing rule and a malformed decision are refused.
    const stale = await decideFinding(a, ids.fullBleed, { lang: null, size: null, rule: f.key, hash: "0".repeat(64), decision: "accept" }).catch((e: Error) => e);
    expect((stale as Error).message).toMatch(/^That item has changed since the page was drawn/);
    const pass = ad.items[0].findings.find((x) => x.rule === "contrast")!;
    const passing = await decideFinding(a, ids.fullBleed, { lang: pass.lang, size: pass.size, rule: pass.key, hash: pass.hash, decision: "accept" }).catch((e: Error) => e);
    expect((passing as Error).message).toBe("Only an item that needs review can be accepted or marked not acceptable.");
    for (const bad of [{ lang: null, size: null, rule: "dont:'; drop table x", hash: f.hash, decision: "accept" }, { lang: "en-GB", size: null, rule: "logo", hash: f.hash, decision: "accept" }, { lang: null, size: null, rule: f.key, hash: f.hash, decision: "maybe" }, null]) {
      await expect(decideFinding(a, ids.fullBleed, bad)).rejects.toThrow("That decision couldn't be read. Reload the page and try again.");
    }
  });
});
