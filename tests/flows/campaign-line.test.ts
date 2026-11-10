// Sprint 10b, D-4 The campaign's line, end to end against the real database
// with the mock models: a line saved with the brief (a new version, signed off
// with it) becomes the headline of every paid-social and display ad Make
// creative makes, while search keeps its own (#1); a brief with no line works as
// today (#4); and a translated campaign uses one translation of the line for
// every ad in that language, repairing a reply that strays from it (#6). Every
// read and write goes through asUser() (rule 7); the models go through
// generate() (rule 5). The interface is in the header of
// tests/e2e/campaign-line.spec.ts.
//
// Outside tests/db, as the Sprint 10 flows are: it makes creative and
// translations, far too many statements for CI's Neon job.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRun, getRun, type Member } from "@/lib/agents/runs";
import type { StepTools } from "@/lib/agents/workflow";
import { executeRun } from "@/lib/agents/workflows";
import { decideSignoff, requestSignoff } from "@/lib/approvals/repo";
import { listBrands } from "@/lib/brands/repo";
import { createCampaign, getCampaign, getVersion, saveBriefEdit } from "@/lib/brief/repo";
import type { BriefCore, StoredBrief } from "@/lib/brief/schema";
import { getCreative, pickVariant, startMakeCreative } from "@/lib/creative/gallery";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { mockBehaviour } from "@/lib/models/mock";
import { QUILLMOOR_LINE } from "../fixtures/new-brand";
import { createMember, truncateAll } from "../helpers/db";

const inline: StepTools = { run: async (_id, fn) => fn(), waitForEvent: async () => null };
const noSend = async () => {};
const SHY = "­";
const visible = (s: string) => s.split(SHY).join("");
const OBJECTIVE = "Bring lapsed savers back to the Plus plan in January";
const reply = (copy: { headline: string; body: string; cta: string }) => ({ text: JSON.stringify({ copy }), inputTokens: 900, outputTokens: 120 });

let a: Member;
let quill: string;
/** The campaign with a line, and the one without. */
let withLine: string;
let noLine: string;

const coreOf = (s: StoredBrief): BriefCore => {
  const { title, summary, story, insights, audiences, channels, kpi } = s;
  return { title, summary, story, insights, audiences, channels, kpi };
};

async function execute(m: Member, runId: string) {
  const agent = (await getRun(m.userId, runId))!.agent;
  await executeRun(agent, { runId, ...m }, inline);
  return (await getRun(m.userId, runId))!;
}

/** A Quillmoor campaign, edited to one audience and the given channels (and line), signed off, with its creative made by the mock models. */
async function campaignWithCreative(channels: BriefCore["channels"], line: string | null): Promise<string> {
  const id = await createCampaign(a, quill, OBJECTIVE, noSend);
  await execute(a, (await getCampaign(a.userId, id))!.run!.id);
  const c = (await getCampaign(a.userId, id))!;
  const edit = { ...coreOf(c.brief!), audiences: [c.brief!.audiences[0]], channels, ...(line ? { line } : {}) };
  const version = await saveBriefEdit(a, id, c.currentVersion, edit);
  await decideSignoff(a, await requestSignoff(a, id, version, noSend), "approved");
  const made = await execute(a, await startMakeCreative(a, id, noSend));
  expect(made.status, made.error ?? "").toBe("completed");
  return id;
}

/** The campaign's signed-off version. */
const approvedVersion = async (campaignId: string) =>
  Number((await asUser(a.userId, (tx) => tx`select approved_version from public.campaigns where id = ${campaignId}`))[0].approved_version);

/** The campaign's current English sets of words, by channel. */
const englishSets = (campaignId: string) =>
  asUser(a.userId, (tx) => tx`
    select id, channel, set from public.copy_sets
    where campaign_id = ${campaignId} and lang = 'en-GB' and discarded_at is null order by created_at, id`);

/** Each ad's channel and the headline of the words it is drawn with. */
const adHeadlines = (campaignId: string) =>
  asUser(a.userId, (tx) => tx`
    select v.id, s.channel, s.set ->> 'headline' as headline, s.id as set_id from public.ad_variants v
    join public.copy_sets s on s.id = v.copy_set_id
    where v.campaign_id = ${campaignId} and v.discarded_at is null order by v.created_at, v.id`);

/** The current translations of some English sets, by language. */
const translationsOf = (setIds: string[]) =>
  asUser(a.userId, (tx) => tx`
    select translated_from, lang, set from public.copy_sets
    where translated_from = any(${setIds}::uuid[]) and discarded_at is null order by lang, translated_from`);

/** A Localise run for some sets and languages, as the Translate button starts one, run inline. */
async function translate(setIds: string[], langs: string[]) {
  const runId = await createRun(a, "localise", { campaignId: withLine, setIds, langs }, noSend, { brandId: quill });
  return execute(a, runId);
}

describe("D-4 the campaign's line through Make creative and translation", () => {
  beforeAll(async () => {
    await truncateAll();
    process.env.DAILY_CAP_PENCE = "5000";
    process.env.WORKSPACE_DAILY_CAP_PENCE = "5000";
    a = await createMember();
    await loadDemoBrands(a, { refDate: new Date("2026-03-15T10:30:00Z") });
    quill = (await listBrands(a.userId)).find((x) => x.slug === "quillmoor")!.id;
    mockBehaviour.reset();
    await execute(a, await createRun(a, "audience", { brandId: quill }, noSend, { brandId: quill }));
    withLine = await campaignWithCreative(
      [
        { channel: "paid social", role: "Reach lapsed savers where they scroll." },
        { channel: "display", role: "Remind them on sites they read." },
        { channel: "search", role: "Catch people looking for a savings app." },
      ],
      QUILLMOOR_LINE,
    );
  }, 300_000);
  beforeEach(() => mockBehaviour.reset());
  afterAll(closeSql);

  it("D-4 #1 the line is signed off with the brief, and every paid-social and display headline is the line exactly; search keeps its own", async () => {
    const c = (await getCampaign(a.userId, withLine))!;
    const approved = await approvedVersion(withLine);
    expect(approved).toBe(c.currentVersion);
    expect((await getVersion(a.userId, withLine, approved))!.line).toBe(QUILLMOOR_LINE);

    const sets = await englishSets(withLine);
    const byChannel = (ch: string) => sets.filter((s) => s.channel === ch);
    expect(byChannel("paid social")).toHaveLength(3);
    expect(byChannel("display")).toHaveLength(3);
    for (const s of [...byChannel("paid social"), ...byChannel("display")]) expect(s.set.headline, `${s.channel} ${s.id}`).toBe(QUILLMOOR_LINE);
    // Alternatives still differ, in their bodies.
    expect(new Set(byChannel("paid social").map((s) => s.set.body)).size).toBe(3);
    const search = byChannel("search");
    expect(search).toHaveLength(1);
    expect((search[0].set.headlines as string[]).some((h) => h !== QUILLMOOR_LINE)).toBe(true);

    const ads = await adHeadlines(withLine);
    expect(ads.filter((x) => x.channel === "paid social").length).toBeGreaterThanOrEqual(3);
    expect(ads.filter((x) => x.channel === "display").length).toBeGreaterThan(0);
    for (const ad of ads) expect(ad.headline, `${ad.channel} ad ${ad.id}`).toBe(QUILLMOOR_LINE);
    // The gallery shows the same words.
    const view = (await getCreative(a.userId, withLine))!;
    expect(view.variants.length).toBe(ads.length);
  });

  it("D-4 #6 a translated campaign uses the same translated line in every ad of that language", async () => {
    const ads = await adHeadlines(withLine);
    const social = ads.find((x) => x.channel === "paid social")!;
    const display = ads.find((x) => x.channel === "display")!;
    await pickVariant(a, social.id);
    await pickVariant(a, display.id);
    const run = await translate([social.set_id, display.set_id], ["fr-FR", "de-DE"]);
    expect(run.status, run.error ?? "").toBe("completed");
    const rows = await translationsOf([social.set_id, display.set_id]);
    expect(rows).toHaveLength(4);
    const lineIn: Record<string, string> = {};
    for (const lang of ["fr-FR", "de-DE"]) {
      const heads = rows.filter((r) => r.lang === lang).map((r) => visible(r.set.headline as string));
      expect(heads, lang).toHaveLength(2);
      expect(new Set(heads).size, `${lang}: one translation of the line for paid social and display`).toBe(1);
      expect(heads[0], lang).not.toBe(QUILLMOOR_LINE);
      lineIn[lang] = heads[0];
    }
    expect(lineIn["fr-FR"]).not.toBe(lineIn["de-DE"]);

    // A later translation into French is given the line already translated, and a reply that strays is repaired to it.
    const sets = (await englishSets(withLine)).filter((s) => s.channel === "paid social" && s.id !== social.set_id);
    const second = ads.find((x) => x.set_id === sets[0].id)!;
    await pickVariant(a, second.id);
    mockBehaviour.next(reply({ headline: "Revenez à votre épargne", body: "Un petit pas, en janvier.", cta: "Commencer" }));
    mockBehaviour.next(reply({ headline: lineIn["fr-FR"], body: "Un petit pas, en janvier.", cta: "Commencer" }));
    const repaired = await translate([second.set_id], ["fr-FR"]);
    expect(repaired.status, repaired.error ?? "").toBe("completed");
    const step = repaired.steps.find((s) => s.kind === "model")!;
    expect(step.attempts).toBe(2);
    expect(mockBehaviour.lastPlainPrompt).toContain(`headline is "Revenez à votre épargne"; the campaign line in French is "${lineIn["fr-FR"]}", so use it exactly`);
    const [fr] = (await translationsOf([second.set_id])).filter((r) => r.lang === "fr-FR");
    expect(visible(fr.set.headline as string)).toBe(lineIn["fr-FR"]);

    // A reply off the line twice leaves that set untranslated, with the reason; nothing else changes.
    const third = ads.find((x) => x.set_id === sets[1].id)!;
    await pickVariant(a, third.id);
    mockBehaviour.next(reply({ headline: "Revenez à votre épargne", body: "Un petit pas, en janvier.", cta: "Commencer" }));
    mockBehaviour.next(reply({ headline: "Revenez à votre épargne", body: "Un petit pas, en janvier.", cta: "Commencer" }));
    const refused = await translate([third.set_id], ["fr-FR"]);
    expect(refused.status).toBe("failed");
    expect(JSON.stringify((await getRun(a.userId, refused.id))!.output ?? {})).toContain("campaign line in French");
    expect(await translationsOf([third.set_id])).toHaveLength(0);
    // Every French ad of the campaign shows the one French line.
    const french = (await translationsOf((await englishSets(withLine)).map((s) => s.id as string))).filter((r) => r.lang === "fr-FR");
    expect(new Set(french.map((r) => visible(r.set.headline as string)))).toEqual(new Set([lineIn["fr-FR"]]));
  }, 120_000);

  it("D-4 #4 a brief with no line works as today: Make creative writes the alternatives' own headlines", async () => {
    noLine = await campaignWithCreative(
      [
        { channel: "paid social", role: "Reach lapsed savers where they scroll." },
        { channel: "display", role: "Remind them on sites they read." },
      ],
      null,
    );
    expect((await getVersion(a.userId, noLine, await approvedVersion(noLine)))!.line).toBeUndefined();
    const sets = await englishSets(noLine);
    const social = sets.filter((s) => s.channel === "paid social").map((s) => s.set.headline as string);
    expect(social).toHaveLength(3);
    expect(new Set(social).size, "three different headlines, as today").toBe(3);
    expect(social).not.toContain(QUILLMOOR_LINE);
    expect((await adHeadlines(noLine)).length).toBeGreaterThan(0);
  }, 300_000);
});
