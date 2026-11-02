// C7-2 Languages in the database (migration 20261102000002): brand_languages
// with workspace_id and row-level security (rule 7, cross-workspace), the
// demo brands' languages written for the demo (Q4), saving a brand's
// languages, and copy_sets' lang and translated_from: append-only, one current
// translation per set and language, only of English ad sets, and never the
// words of a stored ad. The non-superuser owner is tests/db/migrate.test.ts
// (every migration, this one included).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBrands } from "@/lib/brands/repo";
import { CopyError, restoreCopySet, saveCopyEdit, saveCopyEditIn, startNewWords, TRANSLATION_NOT_EDITABLE } from "@/lib/creative/copy";
import {
  addDemoLanguages,
  DEMO_LANGUAGES,
  languageRefusal,
  LanguageError,
  listBrandLanguages,
  saveBrandLanguages,
  SUPPORTED_LANGS,
} from "@/lib/creative/languages";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { QUILLMOOR } from "@/lib/demo/briefs";
import { loadDemoBrands } from "@/lib/demo/load";
import { insertImage, toWebp } from "@/lib/assets/store";
import { drawMockImage } from "@/lib/models/mock-image";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

let a: Member;
let b: Member;
let quill: string;
let fern: string;
let theirs: string;

const brief = { title: "T", summary: "s".repeat(20), story: "s".repeat(20), insights: [], audiences: [], channels: [], kpi: { metric: "reach" }, mustInclude: [], avoid: [] };

/** A campaign with one English paid-social set and one email set, as rows. */
async function campaignWithSets(m: Member, brandId: string) {
  return asUser(m.userId, async (tx) => {
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${brandId}, 'Win back lapsed savers', ${m.userId}, 1) returning id`;
    await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief)}, 'agent', ${m.userId})`;
    const set = async (channel: string, copy: unknown) => {
      const [s] = await tx`
        insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by)
        values (${m.workspaceId}, ${c.id}, 1, ${channel}, 'Everyone', ${tx.json(copy as never)}, ${QUILLMOOR.kit.legalLines}, 'agent', ${m.userId})
        returning id, lang, translated_from, simulated`;
      return s;
    };
    const social = await set("paid social", { headline: "See where your money goes", body: "Round up everyday spending.", cta: "Get the app" });
    const email = await set("email", { subject: "A fresh look", preview: "What is new, in plain words." });
    return { campaignId: c.id as string, social, email };
  });
}

const translation = (m: Member, campaignId: string, from: string | null, lang: string, extra: Record<string, unknown> = {}) =>
  asUser(m.userId, (tx) => tx`
    insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by, lang, translated_from, simulated)
    values (${m.workspaceId}, ${campaignId}, 1, ${(extra.channel as string) ?? "paid social"}, 'Everyone',
            ${tx.json({ headline: "Voir où va votre argent", body: "Arrondissez vos dépenses.", cta: "Obtenir l'appli" })},
            ${DEMO_LANGUAGES.quillmoor["fr-FR"].legalLines}, ${(extra.source as string) ?? "agent"}, ${m.userId}, ${lang}, ${from}, true)
    returning id`);

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  await loadDemoBrands(a, { refDate: new Date("2026-10-01T09:00:00Z") });
  await loadDemoBrands(b, { refDate: new Date("2026-10-01T09:00:00Z") });
  const brands = await listBrands(a.userId);
  quill = brands.find((x) => x.slug === "quillmoor")!.id;
  fern = brands.find((x) => x.slug === "fernhollow")!.id;
  theirs = (await listBrands(b.userId)).find((x) => x.slug === "quillmoor")!.id;
}, 120_000);
afterAll(closeSql);

describe("C7-2 brand languages", () => {
  it("Q3/Q4: the demo brands come with French, German and Spanish, marked as written for the demo, each list as long as the English one", async () => {
    for (const [id, slug] of [[quill, "quillmoor"], [fern, "fernhollow"]] as const) {
      const langs = await listBrandLanguages(a.userId, id);
      expect(langs.map((l) => l.lang)).toEqual([...SUPPORTED_LANGS]);
      const english = slug === "quillmoor" ? QUILLMOOR.kit : (await listBrands(a.userId)).find((x) => x.id === id)!;
      for (const l of langs) {
        expect(l.writtenForDemo).toBe(true);
        expect(l.legalLines).toEqual(DEMO_LANGUAGES[slug][l.lang].legalLines);
        expect(l.legalLines.length).toBe(english.legalLines.length);
        expect(l.bannedTerms.length).toBe(english.bannedTerms.length);
      }
    }
  });

  it("rule 7: another workspace's languages are invisible and can't be changed, added or deleted", async () => {
    expect(await listBrandLanguages(a.userId, theirs)).toEqual([]);
    await asUser(a.userId, async (tx) => {
      const rows = await tx`select id from public.brand_languages where brand_id = ${theirs}`;
      expect(rows).toHaveLength(0);
      const upd = await tx`update public.brand_languages set legal_lines = '{}' where brand_id = ${theirs}`;
      expect(upd.count).toBe(0);
      const del = await tx`delete from public.brand_languages where brand_id = ${theirs}`;
      expect(del.count).toBe(0);
    });
    await expect(
      asUser(a.userId, (tx) => tx`
        insert into public.brand_languages (workspace_id, brand_id, lang, created_by) values (${b.workspaceId}, ${theirs}, 'fr-FR', ${a.userId})`),
    ).rejects.toThrow();
    // A row in my workspace can't point at their brand (the brand is referenced by id and workspace).
    await expect(
      asUser(a.userId, (tx) => tx`
        insert into public.brand_languages (workspace_id, brand_id, lang, created_by) values (${a.workspaceId}, ${theirs}, 'it-IT', ${a.userId})`),
    ).rejects.toThrow();
    await expect(saveBrandLanguages(a, theirs, [])).rejects.toThrow(LanguageError);
    await expect(addDemoLanguages(a, theirs)).rejects.toThrow(LanguageError);
    expect((await listBrandLanguages(b.userId, theirs)).length).toBe(3);
  });

  it("anon can't read the table, English isn't a language row, and each language appears once per brand", async () => {
    const sql = getSql();
    const [{ ok }] = await sql`select has_table_privilege('anon', 'public.brand_languages', 'select') as ok`;
    expect(ok).toBe(false);
    await expect(
      asUser(a.userId, (tx) => tx`insert into public.brand_languages (workspace_id, brand_id, lang, created_by) values (${a.workspaceId}, ${quill}, 'en-GB', ${a.userId})`),
    ).rejects.toThrow(/check/);
    await expect(
      asUser(a.userId, (tx) => tx`insert into public.brand_languages (workspace_id, brand_id, lang, created_by) values (${a.workspaceId}, ${quill}, 'fr-FR', ${a.userId})`),
    ).rejects.toThrow(/duplicate|unique/);
  });

  it("saving: a person's edit clears 'written for the demo' where the lines changed; unchosen languages are removed; invalid input saves nothing", async () => {
    const before = await listBrandLanguages(a.userId, fern);
    const de = before.find((l) => l.lang === "de-DE")!;
    const saved = await saveBrandLanguages(a, fern, [
      { lang: "fr-FR", legalLines: before[0].legalLines, bannedTerms: before[0].bannedTerms },
      { lang: "de-DE", legalLines: [...de.legalLines, "Angebot gilt solange der Vorrat reicht."], bannedTerms: de.bannedTerms },
    ]);
    expect(saved.map((l) => [l.lang, l.writtenForDemo])).toEqual([["fr-FR", true], ["de-DE", false]]);
    await expect(saveBrandLanguages(a, fern, [{ lang: "es-ES", legalLines: ["x".repeat(501)], bannedTerms: [] }])).rejects.toThrow(LanguageError);
    await expect(saveBrandLanguages(a, fern, [{ lang: "pl-PL", legalLines: [], bannedTerms: [] }])).rejects.toThrow(LanguageError);
    await expect(saveBrandLanguages(a, fern, [{ lang: "fr-FR", legalLines: ["Same.", "same."], bannedTerms: [] }])).rejects.toThrow(/already in the list/);
    expect((await listBrandLanguages(a.userId, fern)).map((l) => l.lang)).toEqual(["fr-FR", "de-DE"]);
    // The demo languages come back with one click, for the one that was removed.
    expect(await addDemoLanguages(a, fern)).toBe(1);
    expect((await listBrandLanguages(a.userId, fern)).map((l) => [l.lang, l.writtenForDemo])).toEqual([["fr-FR", true], ["de-DE", false], ["es-ES", true]]);
  });

  it("review fix 4: authenticated has only the privileges it needs on brand_languages, and anon none", async () => {
    const sql = getSql();
    const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
    const held = async (role: string) => {
      const out: string[] = [];
      for (const p of privileges) {
        const [{ ok }] = await sql`select has_table_privilege(${role}, 'public.brand_languages', ${p}) as ok`;
        if (ok) out.push(p);
      }
      return out;
    };
    // Saving a brand's languages reads, adds, updates and removes rows; nothing else.
    expect(await held("authenticated")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    expect(await held("anon")).toEqual([]);
  });

  it("#5 a language without legal lines is refused while the English kit has some", () => {
    const de = { lang: "de-DE" as const, name: "German", legalLines: [], bannedTerms: [], writtenForDemo: false, updatedAt: new Date() };
    expect(languageRefusal(["Rates vary."], de, "de-DE")).toMatch(/no German legal lines/);
    expect(languageRefusal([], de, "de-DE")).toBeNull();
    expect(languageRefusal(["Rates vary."], undefined, "de-DE")).toMatch(/isn't one of the brand's languages/);
  });
});

describe("C7-2 copy sets in other languages", () => {
  let c: Awaited<ReturnType<typeof campaignWithSets>>;
  beforeAll(async () => {
    c = await campaignWithSets(a, quill);
  });

  it("every set made before C7-2 is British English, not a translation, not simulated", () => {
    expect(c.social).toMatchObject({ lang: "en-GB", translated_from: null, simulated: false });
  });

  it("a translation links to its English set; one current translation per set and language", async () => {
    const [t] = await translation(a, c.campaignId, c.social.id, "fr-FR");
    expect(t.id).toBeTruthy();
    await expect(translation(a, c.campaignId, c.social.id, "fr-FR")).rejects.toThrow(/duplicate|unique/);
    // Once discarded, another may be written.
    await asUser(a.userId, (tx) => tx`update public.copy_sets set discarded_at = now() where id = ${t.id}`);
    const [again] = await translation(a, c.campaignId, c.social.id, "fr-FR");
    expect(again.id).not.toBe(t.id);
  });

  it("refused: a translation without a source, an English set with one, a person's translation, a translation of a translation or of email words", async () => {
    await expect(translation(a, c.campaignId, null, "de-DE")).rejects.toThrow(/copy_sets_translation/);
    await expect(translation(a, c.campaignId, c.social.id, "en-GB")).rejects.toThrow(/copy_sets_translation/);
    await expect(translation(a, c.campaignId, c.social.id, "de-DE", { source: "person" })).rejects.toThrow();
    const [fr] = await asUser(a.userId, (tx) => tx`select id from public.copy_sets where translated_from = ${c.social.id} and discarded_at is null`);
    await expect(translation(a, c.campaignId, fr.id, "es-ES")).rejects.toThrow(/English paid-social or display set/);
    await expect(translation(a, c.campaignId, c.email.id, "es-ES", { channel: "email" })).rejects.toThrow(/English paid-social or display set/);
    await expect(translation(a, c.campaignId, c.social.id, "es-ES", { channel: "display" })).rejects.toThrow(/English paid-social or display set/);
  });

  it("rule 7: a translation can't point at another workspace's set", async () => {
    const mine = await campaignWithSets(b, theirs);
    await expect(translation(a, c.campaignId, mine.social.id, "de-DE")).rejects.toThrow();
  });

  it("append-only: a translation's language, source and words never change; only its discard mark does", async () => {
    const [t] = await asUser(a.userId, (tx) => tx`select id from public.copy_sets where translated_from = ${c.social.id} and discarded_at is null`);
    const sql = getSql();
    await expect(sql`update public.copy_sets set lang = 'de-DE' where id = ${t.id}`).rejects.toThrow(/discard mark/);
    await expect(sql`update public.copy_sets set translated_from = null, lang = 'en-GB' where id = ${t.id}`).rejects.toThrow(/discard mark/);
    await expect(sql`update public.copy_sets set simulated = false where id = ${t.id}`).rejects.toThrow(/discard mark/);
    await asUser(a.userId, (tx) => tx`update public.copy_sets set discarded_at = now() where id = ${t.id}`);
  });

  it("an ad's own words are English: a translated set can't be a variant's words", async () => {
    const [t] = await translation(a, c.campaignId, c.social.id, "es-ES");
    const webp = await toWebp(await drawMockImage({ prompt: "languages", palette: ["#14213D", "#F2C14E"] }));
    await expect(
      asUser(a.userId, async (tx) => {
        const img = await insertImage(tx, { workspaceId: a.workspaceId, userId: a.userId, brandId: quill, campaignId: c.campaignId, runId: null, webp, simulated: true, createdByKind: "agent", meta: { picture: 1, briefVersion: 1 } });
        await tx`
          insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by)
          values (${a.workspaceId}, ${c.campaignId}, 1, ${img}, ${t.id}, 'card', '{}', '{}', 'composed', ${a.userId})`;
      }),
    ).rejects.toThrow(/must be the English set/);
  });
});

describe("review fix 3: the copy-list actions are for English words only", () => {
  let c: Awaited<ReturnType<typeof campaignWithSets>>;
  const noSend = async () => {};
  beforeAll(async () => {
    c = await campaignWithSets(a, quill);
    // Signed off at version 1, so the English set could be edited: the refusal is about the language, not the sign-off.
    await asUser(a.userId, (tx) => tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${a.userId} where id = ${c.campaignId}`);
  });

  it("a translation's id can't be hand-edited or sent for new words", async () => {
    const [fr] = await translation(a, c.campaignId, c.social.id, "fr-FR");
    const words = { headline: "Voyez où va votre argent", body: "Arrondissez vos dépenses.", cta: "Obtenir l'appli" };
    await expect(saveCopyEdit(a, fr.id, words)).rejects.toThrow(TRANSLATION_NOT_EDITABLE);
    await expect(asUser(a.userId, (tx) => saveCopyEditIn(tx, a, fr.id, words))).rejects.toThrow(CopyError);
    await expect(startNewWords(a, fr.id, noSend)).rejects.toThrow(TRANSLATION_NOT_EDITABLE);
    expect(TRANSLATION_NOT_EDITABLE).toBe("Translations can't be edited or rewritten; discard it and translate again.");
    // Nothing was written: still one French translation, the same row, current.
    const rows = await asUser(a.userId, (tx) => tx`select id, discarded_at from public.copy_sets where translated_from = ${c.social.id}`);
    expect(rows.map((r) => [r.id, r.discarded_at])).toEqual([[fr.id, null]]);
    const runs = await asUser(a.userId, (tx) => tx`select id from public.agent_runs where input ->> 'setId' = ${fr.id}`);
    expect(runs).toHaveLength(0);
  });

  it("restoring a translation while its language has a current one is a plain refusal, not a database error", async () => {
    const [old] = await asUser(a.userId, (tx) => tx`select id from public.copy_sets where translated_from = ${c.social.id} and lang = 'fr-FR' and discarded_at is null`);
    await asUser(a.userId, (tx) => tx`update public.copy_sets set discarded_at = now() where id = ${old.id}`);
    const [current] = await translation(a, c.campaignId, c.social.id, "fr-FR");
    const err = await restoreCopySet(a, old.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopyError);
    expect((err as Error).message).toBe("There is already a current French translation of these words. Discard it first to restore this one.");
    // With the current one discarded, the old one comes back.
    await asUser(a.userId, (tx) => tx`update public.copy_sets set discarded_at = now() where id = ${current.id}`);
    await restoreCopySet(a, old.id);
    const [now] = await asUser(a.userId, (tx) => tx`select id from public.copy_sets where translated_from = ${c.social.id} and lang = 'fr-FR' and discarded_at is null`);
    expect(now.id).toBe(old.id);
  });
});
