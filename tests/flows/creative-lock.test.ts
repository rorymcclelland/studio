// U10-3 against the database: an ad in a live launch, or in one waiting for
// approval, can't be discarded, given a new picture, redrawn, given new words
// or have its words edited, through the gallery's functions
// (src/lib/creative/gallery.ts) or the server actions the cards call
// (src/app/(app)/campaigns/creative-actions.ts); each is refused with the
// agreed sentence (a live launch) or its own (a launch waiting for approval)
// and nothing changes. Rory's decisions on the open points (9 November 2026):
// a layout switch and keeping new words are refused too, as they change what
// the running ad shows; keeping the old words only discards the waiting ones,
// so it still works. Once the launch ends (or if it was refused) every one
// works again. The gallery reads which launch holds each
// ad, and the Needs a decision count is the one U10-2's overview shows. Rule 7:
// another workspace gets the same refusal as a missing ad, never the launch's
// state, and its own launch can't lock this workspace's ads.
//
// The pure parts (the filter, the card's state and tools, the sentence) are
// tests/lib/gallery-filter.test.ts; the cards are the browser tests,
// tests/e2e/creative-gallery.spec.ts, whose top comment is the interface.
//
// Outside tests/db on purpose, as U10-2's flows are: building ads draws them
// (the renderer), and CI's Neon job is for the database's own rules. U10-3 adds
// no table. The database is real; nothing is mocked but the session, Next's
// cache and the workflow service's send.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ member: null as null | { id: string; email: string; userId: string; workspaceId: string } }));
vi.mock("@/lib/auth/session", () => ({
  requireMember: async () => {
    if (!session.member) throw new Error("No one is signed in for this test");
    return session.member;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));
// The workflow service: what the server actions send is recorded, never sent.
const sent = vi.hoisted(() => ({ events: [] as { name: string; data: Record<string, unknown> }[] }));
vi.mock("@/inngest/client", () => ({
  inngest: {},
  sendEvent: async (e: { name: string; data: Record<string, unknown> }) => {
    sent.events.push(e);
  },
}));

import type { BriefActionState } from "@/app/(app)/campaigns/actions";
import { discardAd, editAdWords, keepAdWords, newAdPicture, newAdWords, redrawAd, switchLayout } from "@/app/(app)/campaigns/creative-actions";
import { campaignFacts } from "@/lib/campaigns/facts";
import { galleryCompliance } from "@/lib/compliance/compute";
import {
  CreativeError,
  discardVariant,
  editWords,
  getCreative,
  keepWords,
  newPicture,
  newWords,
  pickVariant,
  redrawVariant,
  RUNNING_IN_LAUNCH,
  setLayout,
  WAITING_FOR_LAUNCH,
} from "@/lib/creative/gallery";
import { factsFor, RUNNING_IN_LAUNCH as SENTENCE_PURE, showCounts, WAITING_FOR_LAUNCH as WAITING_PURE } from "@/lib/creative/gallery-filter";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { endLaunch } from "@/lib/performance/launch";
import { discardTranslation } from "@/lib/creative/translate";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, builder, campaignFor, EN, rawLaunch, type Member } from "../helpers/launch";

/** Case 2's sentence, word for word. */
const SENTENCE = "That ad is running in a launch (simulated), so it can't change until the launch ends.";
/** Rory's decision 2: a launch waiting for approval has its own refusal. */
const WAITING = "That ad is in a launch waiting for approval (simulated), so it can't change until the launch is decided.";
/** The refusal for each launch status. */
const REFUSAL = { live: SENTENCE, awaiting_approval: WAITING } as const;
const NOT_YOURS = "That ad isn't in your workspace.";
/** A palette other than Fernhollow's (F-26's test's), so every ad here is on an older kit and Redraw can run. */
const NEW_PALETTE = [
  { name: "Moss", hex: "#2F5D50" },
  { name: "Chalk", hex: "#F4F1EA" },
];
/** Words the Fernhollow rules allow, that fit every layout. */
const EDITED = { headline: "Built for the longer way round", body: EN.body, cta: EN.cta };
const noSend = async () => {};

let a: Member;
let b: Member;
let n = 0;

type LaunchStatus = "live" | "awaiting_approval" | "ended" | "refused";
type Scene = {
  brandId: string;
  campaignId: string;
  /** The ads in the launch, each on its own words. */
  launched: string[];
  /** Not in the launch, but on the same words as launched[0]: new or edited words would re-word the running ad. */
  sibling: string;
  /** Not in the launch, on words of its own. */
  free: string;
  launchId: string | null;
};

/**
 * A signed-off Fernhollow campaign of `m`'s with `count` ads in a launch of the
 * given status (none when null), one more ad on launched[0]'s words and one on
 * words of its own; then the brand's palette changes, so every ad is on an
 * older kit (F-26) and Redraw is otherwise allowed.
 */
async function scene(m: Member, status: LaunchStatus | null, count = 1): Promise<Scene> {
  const tag = `u10-3-${++n}`;
  const brandId = await brandFor(m, tag);
  const campaignId = await campaignFor(m, brandId, "signed off", `Bring walkers back for autumn (${tag})`);
  const mk = builder(m, brandId, campaignId);
  const pictures = [await mk.image(`${tag} a ridge`), await mk.image(`${tag} a tarn`)];
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(await mk.words(`Made for the long way round ${i + 1}`));
  const launched: string[] = [];
  for (let i = 0; i < count; i++) launched.push(await mk.ad(pictures[i % 2], words[i], "card", true));
  const sibling = await mk.ad(pictures[1], words[0], "card", false);
  const free = await mk.ad(pictures[1], await mk.words("Mended, not replaced"), "split", false);
  const launchId = status ? (await rawLaunch(m, campaignId, launched, { status })).launchId : null;
  await asUser(m.userId, (tx) => tx`update public.brands set palette = ${tx.json(NEW_PALETTE as never)} where id = ${brandId}`);
  return { brandId, campaignId, launched, sibling, free, launchId };
}

/** New words waiting beside a set, as a Copy run's replacement leaves them (keepWords keeps one of the two). */
async function waitingWords(m: Member, campaignId: string, setId: string): Promise<string> {
  return asUser(m.userId, async (tx) => {
    const [s] = await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, based_on, created_by)
      select workspace_id, campaign_id, brief_version, channel, segment_title, ${tx.json({ ...EN, headline: "Made to be mended" })}, legal_lines, 'agent', id, ${m.userId}
      from public.copy_sets where id = ${setId} returning id`;
    return s.id as string;
  });
}

/** A French translation of a set of words, as the Localise agent leaves one. */
async function translation(m: Member, setId: string): Promise<string> {
  return asUser(m.userId, async (tx) => {
    const [s] = await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by, translated_from, lang)
      select workspace_id, campaign_id, brief_version, channel, segment_title, ${tx.json({ ...EN, headline: "Fait pour le long chemin" })}, legal_lines, 'agent', ${m.userId}, id, 'fr-FR'
      from public.copy_sets where id = ${setId} returning id`;
    return s.id as string;
  });
}

/** Everything the actions could change in a campaign: its ads, its words and the workspace's runs. */
async function snapshot(m: Member, campaignId: string) {
  return asUser(m.userId, async (tx) => ({
    ads: await tx`select id, image_asset_id, copy_set_id, layout, kit, checks, picked_at, discarded_at, based_on from public.ad_variants where campaign_id = ${campaignId} order by id`,
    sets: await tx`select id, set, discarded_at, based_on from public.copy_sets where campaign_id = ${campaignId} order by id`,
    runs: await tx`select id, status from public.agent_runs order by id`,
  }));
}

/** The error a call was refused with (fails the test if it wasn't refused). */
async function refusal(p: Promise<unknown>): Promise<Error> {
  const out = await p.then(
    () => null,
    (e: unknown) => e as Error,
  );
  expect(out, "expected a refusal").not.toBeNull();
  return out!;
}

/**
 * The five actions case 2 names, through the gallery's functions, on one ad;
 * then Rory's decision 1: a layout switch and keeping new words (the scene
 * leaves new words waiting beside the launched ad's).
 */
const LIB_ACTIONS: [string, (m: Member, id: string) => Promise<unknown>][] = [
  ["discard", (m, id) => discardVariant(m, id)],
  ["new picture", (m, id) => newPicture(m, id, noSend)],
  ["redraw with the current kit", (m, id) => redrawVariant(m, id)],
  ["new words", (m, id) => newWords(m, id, noSend)],
  ["edit words", (m, id) => editWords(m, id, EDITED)],
  ["switch the layout", (m, id) => setLayout(m, id, "split")],
  ["keep the new words", (m, id) => keepWords(m, id, "new")],
];

/** The same through the server actions the card's tools call. */
const SERVER_ACTIONS: [string, (campaignId: string, id: string) => Promise<BriefActionState>][] = [
  ["discardAd", (c, id) => discardAd(c, id)],
  ["newAdPicture", (c, id) => newAdPicture(c, id)],
  ["redrawAd", (c, id) => redrawAd(c, id)],
  ["newAdWords", (c, id) => newAdWords(c, id)],
  ["editAdWords", (c, id) => editAdWords(c, id, EDITED)],
  ["switchLayout", (c, id) => switchLayout(c, id, "split")],
  ["keepAdWords (new)", (c, id) => keepAdWords(c, id, "new")],
];

function signedInAs(m: Member) {
  session.member = { id: m.userId, email: `${m.userId}@example.test`, userId: m.userId, workspaceId: m.workspaceId };
}

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
}, 60_000);

afterAll(closeSql);

describe("U10-3 #2 the server refuses to change an ad in a live or waiting launch", () => {
  it("the sentence is case 2's, the waiting launch's is Rory's, and the gallery's are the pure module's", () => {
    expect(RUNNING_IN_LAUNCH).toBe(SENTENCE);
    expect(SENTENCE_PURE).toBe(SENTENCE);
    expect(WAITING_FOR_LAUNCH).toBe(WAITING);
    expect(WAITING_PURE).toBe(WAITING);
  });

  for (const status of ["live", "awaiting_approval"] as const) {
    const label = status === "live" ? "a live launch" : "a launch waiting for approval";
    const which = status === "live" ? "case 2's sentence" : "the waiting launch's sentence";

    it(`#2 ${label}: discard, new picture, redraw, new words, edit words, a layout switch and keeping new words are each refused with ${which}, and nothing changes`, async () => {
      const s = await scene(a, status);
      await waitingWords(a, s.campaignId, (await snapshot(a, s.campaignId)).ads.find((x) => x.id === s.launched[0])!.copy_set_id as string);
      const before = await snapshot(a, s.campaignId);
      for (const [what, act] of LIB_ACTIONS) {
        const err = await refusal(act(a, s.launched[0]));
        expect(err, what).toBeInstanceOf(CreativeError);
        expect(err.message, what).toBe(REFUSAL[status]);
      }
      expect(await snapshot(a, s.campaignId)).toEqual(before);
    }, 60_000);

    it(`#2 ${label}: through the server actions, each is refused with ${which}, nothing is sent and nothing changes`, async () => {
      const s = await scene(a, status);
      await waitingWords(a, s.campaignId, (await snapshot(a, s.campaignId)).ads.find((x) => x.id === s.launched[0])!.copy_set_id as string);
      const before = await snapshot(a, s.campaignId);
      const sentBefore = sent.events.length;
      signedInAs(a);
      for (const [what, act] of SERVER_ACTIONS) expect(await act(s.campaignId, s.launched[0]), what).toEqual({ error: REFUSAL[status] });
      expect(sent.events.length).toBe(sentBefore);
      expect(await snapshot(a, s.campaignId)).toEqual(before);
    }, 60_000);
  }

  it("#2 keeping the old words still works on a launched ad: it only discards the waiting words, and the running ad is unchanged", async () => {
    const s = await scene(a, "live");
    const setId = (await snapshot(a, s.campaignId)).ads.find((x) => x.id === s.launched[0])!.copy_set_id as string;
    const waiting = await waitingWords(a, s.campaignId, setId);
    const before = (await snapshot(a, s.campaignId)).ads;
    await expect(keepWords(a, s.launched[0], "old")).resolves.toEqual({ variantIds: expect.arrayContaining([s.launched[0]]) });
    expect((await snapshot(a, s.campaignId)).ads).toEqual(before);
    const [w] = await asUser(a.userId, (tx) => tx`select discarded_at from public.copy_sets where id = ${waiting}`);
    expect(w.discarded_at).not.toBeNull();
  }, 60_000);

  it("#2 new, edited or kept new words for another ad on the launched ad's words are refused too: they would re-word the running ad", async () => {
    const s = await scene(a, "live");
    await waitingWords(a, s.campaignId, (await snapshot(a, s.campaignId)).ads.find((x) => x.id === s.launched[0])!.copy_set_id as string);
    const before = await snapshot(a, s.campaignId);
    for (const [what, act] of [LIB_ACTIONS[3], LIB_ACTIONS[4], LIB_ACTIONS[6]]) {
      const err = await refusal(act(a, s.sibling));
      expect(err, what).toBeInstanceOf(CreativeError);
      expect(err.message, what).toMatch(/running in a launch \(simulated\)/);
    }
    signedInAs(a);
    expect(await newAdWords(s.campaignId, s.sibling)).toEqual({ error: expect.stringMatching(/running in a launch \(simulated\)/) });
    expect(await editAdWords(s.campaignId, s.sibling, EDITED)).toEqual({ error: expect.stringMatching(/running in a launch \(simulated\)/) });
    expect(await keepAdWords(s.campaignId, s.sibling, "new")).toEqual({ error: expect.stringMatching(/running in a launch \(simulated\)/) });
    expect(await snapshot(a, s.campaignId)).toEqual(before);
  }, 60_000);

  it("#2 the same for a launch waiting for approval: the sibling's new words are refused with the waiting launch's words", async () => {
    const s = await scene(a, "awaiting_approval");
    const err = await refusal(newWords(a, s.sibling, noSend));
    expect(err.message).toMatch(/in a launch waiting for approval \(simulated\)/);
    expect(err.message).toMatch(/until the launch is decided\.$/);
  }, 60_000);

  it("#2 the lock is the launched ad's own: the campaign's other ads keep every tool while it runs", async () => {
    const s = await scene(a, "live");
    // The sibling's picture is its own: a new picture or a redraw replaces only the sibling.
    await expect(newPicture(a, s.sibling, noSend)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await expect(redrawVariant(a, s.free)).resolves.toMatchObject({ variantId: expect.any(String) });
    const s2 = await scene(a, "live");
    await expect(newWords(a, s2.free, noSend)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    const s3 = await scene(a, "live");
    await expect(editWords(a, s3.free, EDITED)).resolves.toMatchObject({ variantIds: [expect.any(String)] });
    await expect(discardVariant(a, s3.sibling)).resolves.toBeUndefined();
    // A layout switch is the ad's own too: the sibling's works while the ad on the same words runs.
    await expect(setLayout(a, s2.sibling, "full-bleed")).resolves.toMatchObject({ layout: "full-bleed" });
    // And the launched ad is still exactly as it was launched.
    const [row] = await asUser(a.userId, (tx) => tx`select discarded_at from public.ad_variants where id = ${s3.launched[0]}`);
    expect(row.discarded_at).toBeNull();
  }, 120_000);
});

describe("U10-3 a translation a running ad shows", () => {
  it("#2 discarding a translation of a launched ad's words is refused while the launch is live or waiting, and works once it ends", async () => {
    for (const status of ["live", "awaiting_approval"] as const) {
      const s = await scene(a, status);
      const setId = (await snapshot(a, s.campaignId)).ads.find((x) => x.id === s.launched[0])!.copy_set_id as string;
      const fr = await translation(a, setId);
      const err = await refusal(discardTranslation(a, fr));
      expect(err.message, status).toMatch(status === "live" ? /running in a launch \(simulated\)/ : /in a launch waiting for approval \(simulated\)/);
      const [row] = await asUser(a.userId, (tx) => tx`select discarded_at from public.copy_sets where id = ${fr}`);
      expect(row.discarded_at, status).toBeNull();
      if (status === "live") {
        await endLaunch(a, s.launchId!);
        await expect(discardTranslation(a, fr)).resolves.toEqual({ lang: "fr-FR" });
      }
    }
    // Words no launched ad shows: their translation is discarded as before.
    const s = await scene(a, "live");
    const freeSet = (await snapshot(a, s.campaignId)).ads.find((x) => x.id === s.free)!.copy_set_id as string;
    await expect(discardTranslation(a, await translation(a, freeSet))).resolves.toEqual({ lang: "fr-FR" });
  }, 60_000);
});

describe("U10-3 #3 once the launch ends, the tools come back", () => {
  it("#3 End the launch: each action refused while it was live now works on its ads", async () => {
    const s = await scene(a, "live", 5);
    const [toDiscard, toPicture, toRedraw, toWords, toEdit] = s.launched;
    for (const id of s.launched) expect((await refusal(discardVariant(a, id))).message).toBe(SENTENCE);

    await endLaunch(a, s.launchId!);

    await expect(discardVariant(a, toDiscard)).resolves.toBeUndefined();
    await expect(newPicture(a, toPicture, noSend)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await expect(redrawVariant(a, toRedraw)).resolves.toMatchObject({ variantId: expect.any(String) });
    await expect(newWords(a, toWords, noSend)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await expect(editWords(a, toEdit, EDITED)).resolves.toMatchObject({ variantIds: [expect.any(String)] });
    const [row] = await asUser(a.userId, (tx) => tx`select discarded_at from public.ad_variants where id = ${toDiscard}`);
    expect(row.discarded_at).not.toBeNull();
  }, 120_000);

  it("#3 a layout switch and keeping new words work again once the launch ends", async () => {
    const s = await scene(a, "live", 2);
    const setId = (await snapshot(a, s.campaignId)).ads.find((x) => x.id === s.launched[1])!.copy_set_id as string;
    await waitingWords(a, s.campaignId, setId);
    expect((await refusal(setLayout(a, s.launched[0], "split"))).message).toBe(SENTENCE);
    expect((await refusal(keepWords(a, s.launched[1], "new"))).message).toBe(SENTENCE);
    await endLaunch(a, s.launchId!);
    await expect(setLayout(a, s.launched[0], "full-bleed")).resolves.toMatchObject({ layout: "full-bleed" });
    await expect(keepWords(a, s.launched[1], "new")).resolves.toMatchObject({ variantIds: [expect.any(String)] });
  }, 60_000);

  it("#3 through the server actions, after the launch ends", async () => {
    const s = await scene(a, "live", 2);
    signedInAs(a);
    expect(await discardAd(s.campaignId, s.launched[0])).toEqual({ error: SENTENCE });
    await endLaunch(a, s.launchId!);
    expect(await discardAd(s.campaignId, s.launched[0])).toEqual({ done: expect.stringMatching(/^Ad discarded\./) });
    expect(await newAdWords(s.campaignId, s.launched[1])).toEqual({ done: expect.stringMatching(/^Writing new words\./) });
  }, 60_000);

  it("#3 an ended or refused launch holds nothing: its ads keep every tool", async () => {
    for (const status of ["ended", "refused"] as const) {
      const s = await scene(a, status);
      await expect(newPicture(a, s.launched[0], noSend), status).resolves.toMatch(/^[0-9a-f-]{36}$/);
      await expect(discardVariant(a, s.launched[0]), status).resolves.toBeUndefined();
    }
  }, 60_000);
});

describe("U10-3 the gallery reads which launch holds each ad", () => {
  it("#1 #3 each ad's launch: live or waiting for the ads in it, null for the others, and null once it ends", async () => {
    const live = await scene(a, "live");
    const view = (await getCreative(a.userId, live.campaignId))!;
    const of = (v: typeof view, id: string) => v.variants.find((x) => x.id === id)!.launch;
    expect(of(view, live.launched[0])).toEqual({ launchId: live.launchId, status: "live" });
    expect(of(view, live.sibling)).toBeNull();
    expect(of(view, live.free)).toBeNull();

    const waiting = await scene(a, "awaiting_approval");
    const w = (await getCreative(a.userId, waiting.campaignId))!;
    expect(of(w, waiting.launched[0])).toEqual({ launchId: waiting.launchId, status: "awaiting_approval" });

    for (const status of ["ended", "refused"] as const) {
      const s = await scene(a, status);
      expect(of((await getCreative(a.userId, s.campaignId))!, s.launched[0]), status).toBeNull();
    }

    await endLaunch(a, live.launchId!);
    expect(of((await getCreative(a.userId, live.campaignId))!, live.launched[0])).toBeNull();
  }, 120_000);

  it("#4 the filter's counts from the gallery and its compliance; Needs a decision is the count U10-2's overview shows", async () => {
    const s = await scene(a, "live", 2);
    await pickVariant(a, s.sibling);
    const view = (await getCreative(a.userId, s.campaignId))!;
    const compliance = await galleryCompliance(a.userId, view);
    const counts = showCounts(factsFor(view.variants, view.version, compliance.pills));
    expect(counts.all).toBe(4);
    expect(counts.picked).toBe(3);
    expect(counts.launched).toBe(2);
    // Fernhollow's don't rules wait for a person on every picked ad nobody has decided.
    expect(counts.decide).toBeGreaterThan(0);
    expect(counts.decide).toBe((await campaignFacts(a.userId, s.campaignId))!.toDecide);
  }, 60_000);
});

describe("U10-3 rule 7: another workspace", () => {
  it("#2 another workspace gets the refusal for a missing ad, never the launch's state, and changes nothing", async () => {
    const s = await scene(a, "live");
    const before = await snapshot(a, s.campaignId);
    for (const [what, act] of LIB_ACTIONS) {
      const err = await refusal(act(b, s.launched[0]));
      expect(err.message, what).toBe(NOT_YOURS);
    }
    signedInAs(b);
    for (const [what, act] of SERVER_ACTIONS) expect(await act(s.campaignId, s.launched[0]), what).toEqual({ error: NOT_YOURS });
    expect(await getCreative(b.userId, s.campaignId)).toBeNull();
    expect(await snapshot(a, s.campaignId)).toEqual(before);
  }, 60_000);

  it("a launch in another workspace that names this workspace's ad doesn't lock it", async () => {
    const s = await scene(a, null);
    const theirs = await scene(b, null);
    // A tampered launch row of b's, listing a's ad: b can write its own launches, never a's ads.
    await rawLaunch(b, theirs.campaignId, [s.free], { status: "live" });
    const view = (await getCreative(a.userId, s.campaignId))!;
    expect(view.variants.find((v) => v.id === s.free)!.launch).toBeNull();
    await expect(newPicture(a, s.free, noSend)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    await expect(discardVariant(a, s.free)).resolves.toBeUndefined();
  }, 60_000);
});
