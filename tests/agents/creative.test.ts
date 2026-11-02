// S5-4 test cases 1 to 5 at the server level, and S5-3 test cases 4 and 5 for
// stored variants: Make creative (Imagery and Copy as child runs, then ads
// composed in code), the gallery's marks, layouts, New picture, New words and
// Edit words, the /ads route, and the failure and hostile cases.
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveAgentModel } from "@/config/agents";
import { makeCreativeRefusal } from "@/lib/agents/creative-workflow";
import { IMAGE_COUNT } from "@/lib/agents/imagery";
import { createRun, getRun, listChildRuns, type Member } from "@/lib/agents/runs";
import { executeRun, WORKFLOWS } from "@/lib/agents/workflows";
import type { StepTools } from "@/lib/agents/workflow";
import { decideSignoff, requestSignoff } from "@/lib/approvals/repo";
import { listBrands } from "@/lib/brands/repo";
import { createCampaign, getCampaign, saveBriefEdit } from "@/lib/brief/repo";
import type { BriefCore, StoredBrief } from "@/lib/brief/schema";
import { adResponse, clearAdCache } from "@/lib/creative/ad-serve";
import { discardCopySet, listCopySets, restoreCopySet } from "@/lib/creative/copy";
import { aboutPence, makeCreativeEstimate, newPictureEstimate, newWordsEstimate, REPAIR_OVERHEAD_TOKENS, TYPICAL_TOKENS } from "@/lib/creative/costs";
import {
  CopyEditError,
  CreativeError,
  discardVariant,
  editWords,
  getCreative,
  keepWords,
  newPicture,
  newWords,
  NOT_SIGNED_OFF,
  pickVariant,
  restoreVariant,
  setLayout,
  startMakeCreative,
  unpickVariant,
  type CreativeView,
} from "@/lib/creative/gallery";
import { composeVariants } from "@/lib/creative/variants";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { costPence, imageCostPence } from "@/lib/models/cost";
import { spendPosition } from "@/lib/models/generate";
import { mockBehaviour } from "@/lib/models/mock";
import { createMember, truncateAll } from "../helpers/db";

const inline: StepTools = { run: async (_id, fn) => fn(), waitForEvent: async () => null };
const noSend = async () => {};
const OBJECTIVE = "Bring lapsed savers back to the Plus plan in January";

let a: Member;
let b: Member;
let quill: string;

const coreOf = (s: StoredBrief): BriefCore => {
  const { title, summary, story, insights, audiences, channels, kpi } = s;
  return { title, summary, story, insights, audiences, channels, kpi };
};

async function execute(m: Member, runId: string) {
  const agent = (await getRun(m.userId, runId))!.agent;
  const status = await executeRun(agent, { runId, ...m }, inline);
  return { status, run: (await getRun(m.userId, runId))! };
}

/** A Quillmoor campaign with a mock brief (one audience; email and paid social), optionally edited, then signed off. */
async function signedOff(change?: (x: BriefCore, segments: string[]) => BriefCore, m: Member = a, brandId = quill): Promise<string> {
  const id = await createCampaign(m, brandId, OBJECTIVE, noSend);
  await execute(m, (await getCampaign(m.userId, id))!.run!.id);
  let c = (await getCampaign(m.userId, id))!;
  if (change) {
    const segments = await asUser(m.userId, (tx) => tx`select id from public.context_items where brand_id = ${brandId} and kind = 'segment' order by title`);
    await saveBriefEdit(m, id, c.currentVersion, change(coreOf(c.brief!), segments.map((s) => s.id as string)));
    c = (await getCampaign(m.userId, id))!;
  }
  const approval = await requestSignoff(m, id, c.currentVersion, noSend);
  await decideSignoff(m, approval, "approved");
  return id;
}

async function make(id: string, m: Member = a) {
  const runId = await startMakeCreative(m, id, noSend);
  return { runId, ...(await execute(m, runId)) };
}

const view = async (id: string, m: Member = a) => (await getCreative(m.userId, id))!;

async function png(res: Response) {
  const body = Buffer.from(await res.arrayBuffer());
  return { body, meta: await sharp(body).metadata() };
}

describe("S5-4 Make creative and the gallery", () => {
  beforeAll(async () => {
    await truncateAll();
    process.env.DAILY_CAP_PENCE = "5000";
    process.env.WORKSPACE_DAILY_CAP_PENCE = "5000";
    a = await createMember();
    b = await createMember();
    await loadDemoBrands(a, { refDate: new Date("2026-03-15T10:30:00Z") });
    quill = (await listBrands(a.userId)).find((x) => x.slug === "quillmoor")!.id;
    mockBehaviour.reset();
    await execute(a, await createRun(a, "audience", { brandId: quill }, noSend, { brandId: quill }));
  }, 120_000);
  beforeEach(() => {
    mockBehaviour.reset();
    clearAdCache();
  });
  afterEach(() => {
    process.env.DAILY_CAP_PENCE = "5000";
    process.env.WORKSPACE_DAILY_CAP_PENCE = "5000";
  });
  afterAll(async () => {
    process.env.DAILY_CAP_PENCE = "100";
    delete process.env.WORKSPACE_DAILY_CAP_PENCE;
    await closeSql();
  });

  describe("#1 Make creative on a signed-off Quillmoor brief", () => {
    let id: string;
    let runId: string;
    let g: CreativeView;

    beforeAll(async () => {
      id = await signedOff();
      const before = await view(id);
      expect(before.makeCreative).toMatchObject({ allowed: true, reason: null });
      const made = await make(id);
      runId = made.runId;
      expect(made.status, made.run.error ?? "").toBe("completed");
      g = await view(id);
    }, 120_000);

    it("gives 12 ads (four pictures × three paid-social sets) with contrast, fit, legal-line and simulated badges", () => {
      expect(g.variants).toHaveLength(12);
      expect(new Set(g.variants.map((v) => v.image.assetId)).size).toBe(4);
      expect(new Set(g.variants.map((v) => v.words.setId)).size).toBe(3);
      for (const v of g.variants) {
        expect(v).toMatchObject({ channel: "paid social", layout: "full-bleed", layoutName: "Full bleed", origin: "composed", picked: false, simulated: true, src: `/ads/${v.id}.png` });
        expect(v.badges.map((x) => x.key)).toEqual(["contrast", "fit", "legal", "simulated"]);
        expect(v.badges.find((x) => x.key === "simulated")!.label).toBe("Simulated image");
        expect(v.badges.find((x) => x.key === "legal")).toMatchObject({ label: "Legal line", tone: "good" });
        expect(v.checks.contrast.body).toBeGreaterThanOrEqual(4.5);
        expect(v.checks.legalLinePresent).toBe(true);
        expect(v.words.legalLines.length).toBeGreaterThan(0);
        expect(v.runId).toBe(runId);
      }
      expect(g.simulated).toBe(true);
      expect(g.audienceNote).toBeNull();
      // The brief's email copy is a text-only channel, listed beside the gallery.
      expect(g.textSets.map((s) => s.channel)).toEqual(["email"]);
      expect(g.makeCreative.allowed).toBe(false);
    });

    it("the trail: one Make creative run with the Imagery and Copy runs as its children, each costed from the ledger", async () => {
      const run = (await getRun(a.userId, runId))!;
      expect(run.steps.map((s) => [s.seq, s.name, s.status])).toEqual([
        [1, "Read the signed-off brief", "succeeded"],
        [2, "Make the pictures (Imagery agent)", "succeeded"],
        [3, "Write the copy (Copy agent)", "succeeded"],
        [4, "Compose the ads", "succeeded"],
      ]);
      expect(run.output).toMatchObject({ variants: 12, pictures: 4, sets: 3, href: `/campaigns/${id}#creative` });
      expect(String(run.output!.summary)).toMatch(/^12 ads from 4 pictures and 3 sets of words\./);

      expect(g.runs).toHaveLength(1);
      const r = g.runs[0];
      expect(r).toMatchObject({ runId, kind: "make", status: "completed", href: `/runs/${runId}` });
      expect(r.children.map((c) => [c.agent, c.status]).sort()).toEqual([["copy", "completed"], ["imagery", "completed"]]);
      const [ledger] = await asUser(a.userId, (tx) => tx`
        select coalesce(sum(cost_pence), 0)::float8 as total from public.usage_ledger
        where run_id = ${runId} or run_id in (select id from public.agent_runs where input ->> 'parentRunId' = ${runId})`);
      expect(r.costPence).toBeCloseTo(ledger.total, 4);
      expect(g.totalCostPence).toBeCloseTo(ledger.total, 4);

      // The run page's list of runs inside it (listChildRuns): the same two, and none for another workspace.
      const kids = await listChildRuns(a.userId, runId);
      expect(kids.map((k) => k.agent).sort()).toEqual(["copy", "imagery"]);
      expect(kids.reduce((sum, k) => sum + Number(k.cost_pence), 0)).toBeCloseTo(r.costPence, 4);
      expect(await listChildRuns(b.userId, runId)).toEqual([]);
      expect(await listChildRuns(a.userId, "not-a-uuid")).toEqual([]);
      // Four images at the image price, plus a few tokens' worth for prompts, checks and copy.
      expect(r.costPence).toBeGreaterThan(4 * imageCostPence("mock", "mock-image", "2K", 1));
      for (const c of r.children) expect((await getRun(a.userId, c.runId))!.input).toMatchObject({ parentRunId: runId, campaignId: id });
    });

    it("typically costs under 20p in real mode, and the button says the typical and the worst case (review finding 9)", () => {
      const real = { USD_TO_GBP: "0.79" };
      const estimate = makeCreativeEstimate({ writesCopy: true }, real);
      expect(estimate.pence).toBeLessThanOrEqual(20);

      // The worst case, worked out here from the prices and the configured limits: every picture redrawn
      // (eight images), and every model call repaired once at its full output allowance.
      const call = (agent: "imagery" | "imageCheck" | "copy", input: number) => {
        const m = resolveAgentModel(agent, real);
        const first = costPence(m.provider, m.model, input, m.maxOutputTokens);
        const repair = costPence(m.provider, m.model, input + m.maxOutputTokens + REPAIR_OVERHEAD_TOKENS, m.maxOutputTokens);
        return first + repair;
      };
      const image = imageCostPence("google", "gemini-nano-banana-2.1", "2K", 1);
      const worst =
        2 * IMAGE_COUNT * (image + call("imageCheck", TYPICAL_TOKENS.imageCheck.input)) +
        call("imagery", TYPICAL_TOKENS.imagery.input) +
        call("copy", TYPICAL_TOKENS.copyAll.input);
      expect(estimate.worstPence).toBeCloseTo(worst, 3);
      // Honestly above the refined 20p: the redraws alone are four more pictures (2K from C7-1, Q1: about 41p).
      expect(estimate.worstPence).toBeGreaterThan(20);
      expect(estimate.worstPence).toBeLessThan(45);
      expect(estimate.label).toBe(`about ${Math.ceil(estimate.pence)}p, at most ${Math.ceil(estimate.worstPence)}p`);
      // With the copy already written, the copy's share comes off both.
      const noCopy = makeCreativeEstimate({ writesCopy: false }, real);
      expect(noCopy.pence).toBeLessThan(estimate.pence);
      expect(noCopy.worstPence).toBeCloseTo(worst - call("copy", TYPICAL_TOKENS.copyAll.input), 3);
      expect(g.makeCreative.estimate.label).toMatch(/^about \d+p, at most \d+p$/);
      expect(newPictureEstimate(real).label).toBe("about 4p"); // one 2K picture (3.98p) and its check
      expect(newWordsEstimate(real).label).toMatch(/^(about \d+p|under 1p)$/);
      // The gallery's estimate uses the configured (mock) models, whose picture check costs a little more: 4.0p.
      expect(g.estimates.newPicture.label).toBe(newPictureEstimate().label);
      expect(aboutPence(0.4)).toBe("under 1p");
      expect(aboutPence(2.66)).toBe("about 3p");
    });

    it("S5-3 #1 and #4: each ad is served as a 1080 × 1080 PNG to its workspace only, with an ETag from its parts", async () => {
      const v = g.variants[0];
      const res = await adResponse(a.userId, `${v.id}.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("private, no-cache");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const { meta } = await png(res);
      expect([meta.format, meta.width, meta.height]).toEqual(["png", 1080, 1080]);
      const etag = res.headers.get("etag")!;
      expect(etag).toMatch(/^"ad-[0-9a-f]{40}"$/);
      // Without the suffix too; a matching If-None-Match gets a 304 with no drawing.
      expect((await adResponse(a.userId, v.id)).headers.get("etag")).toBe(etag);
      const again = await adResponse(a.userId, v.id, etag);
      expect(again.status).toBe(304);
      expect(await again.text()).toBe("");
      // Different parts, different ETag.
      expect((await adResponse(a.userId, g.variants[1].id)).headers.get("etag")).not.toBe(etag);

      for (const [who, asked] of [
        [b.userId, v.id],
        [null, v.id],
        [a.userId, "not-an-id"],
        [a.userId, `${v.id}x`],
        [a.userId, "00000000-0000-0000-0000-000000000000"],
        [a.userId, "..%2F..%2Fetc%2Fpasswd"],
        [a.userId, "1' or '1'='1"],
      ] as const) {
        const r = await adResponse(who, asked);
        expect(r.status, `${who} ${asked}`).toBe(404);
        expect(r.headers.get("cache-control")).toBe("private, no-store");
      }
      expect(await getCreative(b.userId, id)).toBeNull();
    });

    it("a second Make creative for the same signed-off version is refused while it has ads", async () => {
      await expect(startMakeCreative(a, id, noSend)).rejects.toThrow(CreativeError);
      await expect(startMakeCreative(a, id, noSend)).rejects.toThrow(/already has ads\. Use New picture or New words on an ad, or discard the ads first/);
      expect(g.makeCreative.reason).toMatch(/already has ads/);
      // A run made some other way is refused inside the workflow too, before any call.
      const calls = mockBehaviour.calls;
      const forged = await asUser(a.userId, async (tx) => {
        const [r] = await tx`insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
          values (${a.workspaceId}, 'creative', 1, ${tx.json({ mode: "make", campaignId: id, version: g.version })}, ${a.userId}) returning id`;
        return r.id as string;
      });
      const { status, run } = await execute(a, forged);
      expect(status).toBe("failed");
      expect(run.error).toMatch(/already has ads/);
      expect(mockBehaviour.calls).toBe(calls);
      expect(mockBehaviour.imageCalls).toBe(0);
    });

    it("composing again (a retried step) adds nothing", async () => {
      const again = await composeVariants(a, id, { runId });
      expect(again.made).toEqual([]);
      expect(again.existing).toBe(12);
      expect((await view(id)).variants).toHaveLength(12);
    });
  });

  it("#5 a campaign whose brief isn't signed off: no Make creative, with the reason; the start and the workflow refuse it", async () => {
    const id = await createCampaign(a, quill, OBJECTIVE, noSend);
    await execute(a, (await getCampaign(a.userId, id))!.run!.id);
    const g = await view(id);
    expect(g.signedOff).toBe(false);
    expect(g.makeCreative).toMatchObject({ allowed: false, reason: NOT_SIGNED_OFF });
    expect(NOT_SIGNED_OFF).toMatch(/^Sign off the brief to make creative/);
    expect(g.variants).toEqual([]);
    await expect(startMakeCreative(a, id, noSend)).rejects.toThrow(NOT_SIGNED_OFF);
    await expect(startMakeCreative(a, "not-an-id", noSend)).rejects.toThrow(/isn't in your workspace/);
    // Another workspace can't start it on this campaign.
    await expect(startMakeCreative(b, id, noSend)).rejects.toThrow(/isn't in your workspace/);
  });

  describe("on one set of ads", () => {
    let id: string;
    beforeAll(async () => {
      id = await signedOff();
      expect((await make(id)).status).toBe("completed");
    }, 120_000);

    it("#4 pick and discard are marks that survive a reload; a discarded ad leaves the grid for Discarded, with undo", async () => {
      const [first, second] = (await view(id)).variants;
      await pickVariant(a, first.id);
      await discardVariant(a, second.id);
      const g = await view(id); // a reload: read again from the database
      expect(g.variants.find((v) => v.id === first.id)!.picked).toBe(true);
      expect(g.variants.map((v) => v.id)).not.toContain(second.id);
      expect(g.discarded.map((v) => v.id)).toEqual([second.id]);
      expect(g.discarded[0].restore).toEqual({ allowed: true, reason: null });
      // Discarding an ad keeps its picture and words (other ads use them).
      expect(g.variants.filter((v) => v.image.assetId === second.image.assetId)).toHaveLength(2);
      await expect(pickVariant(a, first.id)).rejects.toThrow(/already picked/);
      await expect(discardVariant(a, second.id)).rejects.toThrow(/already discarded/);
      await restoreVariant(a, second.id);
      await unpickVariant(a, first.id);
      const back = await view(id);
      expect(back.variants).toHaveLength(12);
      expect(back.variants.every((v) => !v.picked)).toBe(true);
      await expect(restoreVariant(a, second.id)).rejects.toThrow(/isn't discarded/);
      // Another workspace can't mark them.
      await expect(pickVariant(b, first.id)).rejects.toThrow(/isn't in your workspace/);
      await expect(discardVariant(b, first.id)).rejects.toThrow(/isn't in your workspace/);
      await expect(pickVariant(a, "not-an-id")).rejects.toThrow(/isn't in your workspace/);
    });

    it("switching layout re-checks with the renderer; a layout that can't hold the words is refused with the reason", async () => {
      const v = (await view(id)).variants[0];
      const before = (await adResponse(a.userId, v.id)).headers.get("etag");
      const card = await setLayout(a, v.id, "card");
      expect(card.layout).toBe("card");
      expect(card.checks.layout).toBe("card");
      const after = (await view(id)).variants.find((x) => x.id === v.id)!;
      expect(after).toMatchObject({ layout: "card", layoutName: "Card" });
      expect(after.badges.find((x) => x.key === "fit")!.label).toBe("Fits Card");
      const res = await adResponse(a.userId, v.id);
      expect(res.headers.get("etag")).not.toBe(before);
      expect((await png(res)).meta.width).toBe(1080);
      await expect(setLayout(a, v.id, "poster")).rejects.toThrow(/Choose Full bleed, Split or Card/);
      await setLayout(a, v.id, "full-bleed");
    });

    it("#2 New picture replaces only that ad's picture; the old picture stays as an asset, discarded once no ad uses it; the cost is shown", async () => {
      const g = await view(id);
      const target = g.variants[0];
      await pickVariant(a, target.id);
      const siblings = g.variants.filter((v) => v.image.assetId === target.image.assetId);
      expect(siblings).toHaveLength(3);

      const runId = await newPicture(a, target.id, noSend);
      const { status, run } = await execute(a, runId);
      expect(status, run.error ?? "").toBe("completed");
      expect(run.steps.map((s) => s.name)).toEqual(["Read the ad", "Draw a new picture", "Check the new picture for text", "Save the new ad"]);
      expect(mockBehaviour.imageCalls).toBe(1);
      const draw = run.steps.find((s) => s.name === "Draw a new picture")!;
      expect(Number(draw.cost_pence)).toBeCloseTo(imageCostPence("mock", "mock-image", "2K", 1), 4);

      const after = await view(id);
      expect(after.variants).toHaveLength(12);
      const replacement = after.variants.find((v) => v.basedOn === target.id)!;
      expect(replacement).toMatchObject({ origin: "new picture", runId, picked: true });
      expect(replacement.words.setId).toBe(target.words.setId);
      expect(replacement.image.assetId).not.toBe(target.image.assetId);
      expect(after.discarded.find((v) => v.id === target.id)!.restore.allowed).toBe(true);
      // Only that ad changed: its two siblings keep the old picture, which is still current.
      for (const s of siblings.slice(1)) expect(after.variants.find((v) => v.id === s.id)!.image.assetId).toBe(target.image.assetId);
      const [old] = await asUser(a.userId, (tx) => tx`select discarded_at from public.assets where id = ${target.image.assetId}`);
      expect(old.discarded_at).toBeNull();
      // The run and its cost are listed.
      const listed = after.runs.find((r) => r.runId === runId)!;
      expect(listed).toMatchObject({ kind: "picture", status: "completed" });
      expect(listed.costPence).toBeCloseTo(Number(run.cost_pence), 4);
      expect(listed.costPence).toBeGreaterThan(0);

      // New pictures for the two siblings too: then no ad uses the old picture, and it is discarded (kept, not deleted).
      for (const s of siblings.slice(1)) expect((await execute(a, await newPicture(a, s.id, noSend))).status).toBe("completed");
      const [gone] = await asUser(a.userId, (tx) => tx`select discarded_at, octet_length(bytes) as n from public.assets where id = ${target.image.assetId}`);
      expect(gone.discarded_at).toBeInstanceOf(Date);
      expect(gone.n).toBeGreaterThan(0);
      // An ad whose picture was replaced and discarded can't come back, and can't be drawn.
      const finalView = await view(id);
      const oldAd = finalView.discarded.find((v) => v.id === target.id)!;
      expect(oldAd.restore).toEqual({ allowed: false, reason: "Its picture was replaced, so it can't come back." });
      await expect(restoreVariant(a, target.id)).rejects.toThrow(/picture was replaced/);
      expect((await adResponse(a.userId, target.id)).status).toBe(404);
      await expect(newPicture(a, target.id, noSend)).rejects.toThrow(/discarded/);
    });

    it("review finding 5: two New picture starts at once for one ad: one run is recorded, the other is refused", async () => {
      const target = (await view(id)).variants[2];
      const results = await Promise.allSettled([newPicture(a, target.id, noSend), newPicture(a, target.id, noSend)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      expect(refused.reason).toBeInstanceOf(CreativeError);
      expect(String(refused.reason.message)).toMatch(/already being drawn/);
      const runs = await getSql()`select id from public.agent_runs where agent = 'creative' and input ->> 'variantId' = ${target.id}`;
      expect(runs).toHaveLength(1);
      // A different ad can still get a new picture meanwhile.
      const other = (await view(id)).variants[3];
      await expect(newPicture(a, other.id, noSend)).resolves.toMatch(/^[0-9a-f-]{36}$/);
      // Leave nothing active for the tests after this one.
      await getSql()`update public.agent_runs set status = 'failed' where agent = 'creative' and status in ('queued', 'running') and input ->> 'mode' = 'picture'`;
    });

    it("a new picture the check finds text in is discarded, and the ad keeps its picture", async () => {
      const v = (await view(id)).variants[3];
      mockBehaviour.visionHasText = () => true;
      const { status, run } = await execute(a, await newPicture(a, v.id, noSend));
      expect(status).toBe("failed");
      expect(run.error).toMatch(/new picture was discarded because the check found text in it.*The ad keeps its picture/);
      const after = await view(id);
      expect(after.variants.find((x) => x.id === v.id)!.image.assetId).toBe(v.image.assetId);
      const drawn = await asUser(a.userId, (tx) => tx`select discarded_at from public.assets where run_id = ${run.id}`);
      expect(drawn).toHaveLength(1);
      expect(drawn[0].discarded_at).toBeInstanceOf(Date);
    });

    it("New picture at the daily cap stops before the image call, and the ad keeps its picture", async () => {
      const v = (await view(id)).variants[4];
      const before = await spendPosition(a.userId, a.workspaceId);
      process.env.WORKSPACE_DAILY_CAP_PENCE = String(before.workspace + 1);
      const { status, run } = await execute(a, await newPicture(a, v.id, noSend));
      expect(status).toBe("stopped_cap");
      expect(run.error).toMatch(/Daily AI cap reached.*The ad keeps its picture/);
      expect(mockBehaviour.imageCalls).toBe(0);
      expect((await view(id)).variants.find((x) => x.id === v.id)).toBeTruthy();
    });

    it("#3 Edit words with a banned term is refused inline, and nothing is saved", async () => {
      const v = (await view(id)).variants[5];
      const [{ n: setsBefore }] = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.copy_sets where campaign_id = ${id}`);
      const [{ n: adsBefore }] = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.ad_variants where campaign_id = ${id}`);
      const err = await editWords(a, v.id, { headline: "Guaranteed returns, every week", body: v.words.body, cta: v.words.cta }).catch((e) => e);
      expect(err).toBeInstanceOf(CopyEditError);
      expect((err as CopyEditError).problems.join(" ")).toMatch(/guaranteed returns/i);
      // Over the field limit: a field error for the editor.
      const long = await editWords(a, v.id, { headline: "x".repeat(41), body: v.words.body, cta: v.words.cta }).catch((e) => e);
      expect((long as CopyEditError).fieldErrors.headline).toMatch(/40 characters or fewer/);
      // Within the limits but too wide for every layout: refused with the fit, by field.
      const wide = await editWords(a, v.id, { headline: v.words.headline, body: v.words.body, cta: "Wwwwwwww wwwwwwww ww" }).catch((e) => e);
      expect(wide).toBeInstanceOf(CopyEditError);
      expect((wide as CopyEditError).problems[0]).toMatch(/don't fit any layout: call to action too long for Full bleed/);
      expect((wide as CopyEditError).fieldErrors.cta).toMatch(/Too long to fit the button/);
      const [{ n: setsAfter }] = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.copy_sets where campaign_id = ${id}`);
      const [{ n: adsAfter }] = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.ad_variants where campaign_id = ${id}`);
      expect([setsAfter, adsAfter]).toEqual([setsBefore, adsBefore]);
    });

    it("Edit words saves a person's set and moves every ad on the old set to it (the old ads discarded, because a person chose it)", async () => {
      const g = await view(id);
      const v = g.variants.find((x) => x.layout === "full-bleed")!;
      const onSet = g.variants.filter((x) => x.words.setId === v.words.setId);
      const words = { headline: "Put a little aside each week, and grow", body: "Round-ups move spare change into a pot you choose, and you can pause or withdraw at any time you like, with no fees.", cta: "Get the app" };
      const res = await editWords(a, v.id, words);
      expect(res.variantIds).toHaveLength(onSet.length);
      const after = await view(id);
      const moved = after.variants.filter((x) => x.words.setId === res.setId);
      expect(moved).toHaveLength(onSet.length);
      for (const m of moved) expect(m).toMatchObject({ origin: "edited words", words: { headline: words.headline, source: "person" } });
      expect(after.variants.map((x) => x.id)).not.toContain(v.id);
      expect(res.variantId).toBe(moved.find((m) => m.basedOn === v.id)!.id);
      // The old set is discarded (S5-2's hand-edit rule), so the old ads can't come back.
      const old = after.discarded.find((x) => x.id === v.id)!;
      expect(old.restore.allowed).toBe(false);
      expect(old.restore.reason).toMatch(/words were replaced/);
      expect((await adResponse(a.userId, v.id)).status).toBe(404);
      // This body is too long for Split: switching is refused with the renderer's reason.
      await expect(setLayout(a, res.variantId!, "split")).rejects.toThrow("Split can't be used for this ad: body too long for Split.");
    });

    it("New words wait beside the ad's words; keeping them moves every ad on the set, keeping the old discards them", async () => {
      const g = await view(id);
      const v = g.variants.find((x) => x.origin === "composed" && x.words.source === "agent")!;
      const onSet = g.variants.filter((x) => x.words.setId === v.words.setId).map((x) => x.id);
      const runId = await newWords(a, v.id, noSend);
      await expect(newWords(a, v.id, noSend)).rejects.toThrow(/already being written/);
      expect((await view(id)).variants.find((x) => x.id === v.id)!.busy.words).toBe(runId);
      expect((await execute(a, runId)).status).toBe("completed");

      // Waiting: shown on every ad of the set, and the ads are unchanged.
      const waiting = await view(id);
      for (const ad of waiting.variants.filter((x) => onSet.includes(x.id))) {
        expect(ad.pendingWords).toMatchObject({ runId, headline: expect.any(String) });
        expect(ad.words.setId).toBe(v.words.setId);
      }
      expect(waiting.variants).toHaveLength(12);

      const kept = await keepWords(a, v.id, "new");
      expect(kept.variantIds).toHaveLength(onSet.length);
      const after = await view(id);
      expect(after.variants).toHaveLength(12);
      const moved = after.variants.filter((x) => kept.variantIds.includes(x.id));
      for (const m of moved) {
        expect(m).toMatchObject({ origin: "new words", pendingWords: null });
        expect(m.words.setId).toBe(waiting.variants.find((x) => x.id === v.id)!.pendingWords!.setId);
      }
      await expect(keepWords(a, kept.variantIds[0], "new")).rejects.toThrow(/no new words waiting/);

      // Keeping the old words discards the new ones and leaves the ads.
      const other = after.variants.find((x) => x.origin === "composed" && x.words.setId !== v.words.setId)!;
      expect((await execute(a, await newWords(a, other.id, noSend))).status).toBe("completed");
      const { variantIds } = await keepWords(a, other.id, "old");
      expect(variantIds).toContain(other.id);
      const final = await view(id);
      expect(final.variants.find((x) => x.id === other.id)!.pendingWords).toBeNull();
      expect(final.discardedSets.some((s) => s.basedOn === other.words.setId)).toBe(true);
    });

    it("S5-3 #4: an ad whose words were discarded elsewhere can't be drawn; restoring the words brings it back", async () => {
      const g = await view(id);
      const v = g.variants.find((x) => x.words.source === "agent")!;
      await discardCopySet(a, v.words.setId);
      expect((await adResponse(a.userId, v.id)).status).toBe(404);
      const hidden = await view(id);
      expect(hidden.variants.map((x) => x.id)).not.toContain(v.id);
      expect(hidden.discarded.find((x) => x.id === v.id)!.restore.reason).toMatch(/Restore them in the copy list/);
      await expect(setLayout(a, v.id, "card")).rejects.toThrow(/picture or words were replaced/);
      await restoreCopySet(a, v.words.setId);
      expect((await adResponse(a.userId, v.id)).status).toBe(200);
      expect((await view(id)).variants.map((x) => x.id)).toContain(v.id);
    });

    it("hostile: words that look like markup are drawn as text and served as a sandboxed PNG; other workspaces can't act on the ads", async () => {
      const v = (await view(id)).variants.find((x) => x.words.source === "agent")!;
      const words = { headline: "<img src=x onerror=alert(1)>", body: v.words.body, cta: v.words.cta };
      const res = await editWords(a, v.id, words).catch((e: Error) => e);
      if (res instanceof Error) {
        // Refused by a rule is fine too; nothing was saved then.
        expect(res).toBeInstanceOf(CopyEditError);
      } else {
        const served = await adResponse(a.userId, res.variantId!);
        expect(served.headers.get("content-type")).toBe("image/png");
        expect(served.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
        expect((await png(served)).meta.format).toBe("png");
      }
      const target = (await view(id)).variants[0];
      await expect(editWords(b, target.id, words)).rejects.toThrow(/isn't in your workspace/);
      await expect(newPicture(b, target.id, noSend)).rejects.toThrow(/isn't in your workspace/);
      await expect(newWords(b, target.id, noSend)).rejects.toThrow(/isn't in your workspace/);
      await expect(setLayout(b, target.id, "card")).rejects.toThrow(/isn't in your workspace/);
      await expect(keepWords(b, target.id, "new")).rejects.toThrow(/isn't in your workspace/);
    });
  });

  it("with the cap nearly reached, Make creative stops at the cap, keeps what it made and composes from it, with a clear status", async () => {
    const id = await signedOff();
    const before = await spendPosition(a.userId, a.workspaceId);
    // Room for the prompts, the copy and two pictures with their checks, but not a third picture (2K pictures are 3.98p each).
    process.env.WORKSPACE_DAILY_CAP_PENCE = String(before.workspace + 10.6);
    const { status, run } = await make(id);
    expect(status).toBe("stopped_cap");
    expect(run.error).toMatch(/^Daily AI cap reached: 6 ads from 2 pictures and 3 sets of words\. What was made is kept\. Pictures: stopped at the daily AI cap\./);
    expect(mockBehaviour.imageCalls).toBe(2);
    const g = await view(id);
    expect(g.variants).toHaveLength(6);
    expect(g.runs[0]).toMatchObject({ kind: "make", status: "stopped_cap" });
    expect(g.runs[0].children.find((c) => c.agent === "imagery")!.status).toBe("stopped_cap");
    expect((await spendPosition(a.userId, a.workspaceId)).workspace).toBeLessThanOrEqual(before.workspace + 10.6);
    expect(await asUser(a.userId, (tx) => tx`select 1 from public.spend_reservations`)).toHaveLength(0);
  });

  it("when every picture fails, no ads are made, the copy is kept, and a second Make creative reuses the copy", async () => {
    const id = await signedOff();
    mockBehaviour.failImage("Internal error", 4);
    const first = await make(id);
    expect(first.status).toBe("failed");
    expect(first.run.error).toMatch(/^No ads were made\. Pictures: No picture was kept/);
    const copy = await listCopySets(a.userId, id);
    expect(copy.sets.length).toBeGreaterThan(0);
    const g = await view(id);
    expect(g.variants).toEqual([]);
    expect(g.makeCreative).toMatchObject({ allowed: true });

    mockBehaviour.reset();
    const second = await make(id);
    expect(second.status, second.run.error ?? "").toBe("completed");
    expect(second.run.steps.find((s) => s.seq === 3)).toMatchObject({ name: "Use the brief's copy", status: "succeeded" });
    expect((await view(id)).variants).toHaveLength(12);
    expect((await listCopySets(a.userId, id)).sets.map((s) => s.id).sort()).toEqual(copy.sets.map((s) => s.id).sort());
  });

  it("several audiences and a display channel: the first audience's words are composed for both ad channels, and the note says so", async () => {
    const id = await signedOff((x, segs) => ({
      ...x,
      audiences: [x.audiences[0], { segmentRef: segs.find((s) => s !== x.audiences[0].segmentRef)!, why: "They already trust the app and may move up a plan." }],
      channels: [
        { channel: "paid social", role: "Reach lapsed savers where they scroll." },
        { channel: "display", role: "Remind them on the sites they read." },
        { channel: "search", role: "Catch people looking for a budgeting app." },
      ],
    }));
    const { status, run } = await make(id);
    expect(status, run.error ?? "").toBe("completed");
    const g = await view(id);
    expect(g.variants).toHaveLength(24);
    expect(g.variants.filter((v) => v.channel === "display")).toHaveLength(12);
    const c = (await getCampaign(a.userId, id))!;
    const first = c.sources[c.brief!.audiences[0].segmentRef].title;
    expect(new Set(g.variants.map((v) => v.words.audience.title))).toEqual(new Set([first]));
    expect(g.audienceNote).toBe(`Ads use the words for ${first}, the brief's first audience; the words for the other audience are in the copy lists.`);
    expect(String(run.output!.summary)).toContain(g.audienceNote!);
    expect(g.otherAudienceSets).toHaveLength(6);
    expect(g.textSets.map((s) => s.channel)).toEqual(["search", "search"]);
  }, 60_000);

  it("S5-3 #5: a brand without legal lines draws none, and each ad is labelled \"No legal line in the kit\"", async () => {
    const [kit] = await asUser(a.userId, (tx) => tx`select legal_lines from public.brands where id = ${quill}`);
    await asUser(a.userId, (tx) => tx`update public.brands set legal_lines = '{}' where id = ${quill}`);
    try {
      const id = await signedOff();
      expect((await make(id)).status).toBe("completed");
      const g = await view(id);
      expect(g.variants).toHaveLength(12);
      for (const v of g.variants) {
        expect(v.checks.legalLinePresent).toBe(false);
        expect(v.badges.find((x) => x.key === "legal")).toMatchObject({ label: "No legal line in the kit", tone: "warn" });
      }
    } finally {
      await asUser(a.userId, (tx) => tx`update public.brands set legal_lines = ${kit.legal_lines} where id = ${quill}`);
    }
  });

  it("refuses a brief without an ad channel, and a brand without a palette, before anything is spent", async () => {
    const id = await signedOff((x) => ({ ...x, channels: [{ channel: "email", role: "Reach people who have agreed to marketing." }] }));
    await expect(startMakeCreative(a, id, noSend)).rejects.toThrow(/no paid-social or display channel/);
    const [p] = await asUser(a.userId, (tx) => tx`select palette from public.brands where id = ${quill}`);
    await getSql()`update public.brands set palette = '[]'::jsonb where id = ${quill}`;
    try {
      const other = await signedOff();
      expect((await view(other)).makeCreative.reason).toMatch(/no palette/);
      await expect(startMakeCreative(a, other, noSend)).rejects.toThrow(/no palette/);
    } finally {
      await getSql()`update public.brands set palette = ${getSql().json(p.palette)} where id = ${quill}`;
    }
  });

  describe("review findings 6 and 7: words that change while other words wait", () => {
    let id: string;
    beforeAll(async () => {
      id = await signedOff();
      expect((await make(id)).status).toBe("completed");
    }, 120_000);
    afterEach(async () => {
      await getSql()`drop trigger if exists test_fail_moves on public.ad_variants`;
      await getSql()`drop function if exists public.test_fail_moves()`;
    });

    const counts = async () => {
      const [r] = await asUser(a.userId, (tx) => tx`
        select (select count(*)::int from public.copy_sets where campaign_id = ${id}) as sets,
               (select count(*)::int from public.copy_sets where campaign_id = ${id} and discarded_at is null) as current_sets,
               (select count(*)::int from public.ad_variants where campaign_id = ${id}) as ads,
               (select count(*)::int from public.ad_variants where campaign_id = ${id} and discarded_at is null) as current_ads`);
      return r;
    };
    const words = { headline: "Put a little aside each week", body: "Round-ups move spare change into a pot you choose.", cta: "Get the app" };

    it("6: Edit words is one transaction: a failure while moving the ads leaves the words and the ads as they were", async () => {
      const v = (await view(id)).variants.find((x) => x.words.source === "agent")!;
      const before = await counts();
      // The new ads can't be written: the move fails after the edited set would have been saved.
      await getSql().unsafe(`
        create function public.test_fail_moves() returns trigger language plpgsql as $$
        begin
          if new.origin = 'edited words' then raise exception 'simulated failure moving the ads'; end if;
          return new;
        end $$`);
      await getSql()`create trigger test_fail_moves before insert on public.ad_variants for each row execute function public.test_fail_moves()`;
      await expect(editWords(a, v.id, words)).rejects.toThrow(/simulated failure moving the ads/);
      expect(await counts()).toEqual(before);
      const [old] = await asUser(a.userId, (tx) => tx`select discarded_at from public.copy_sets where id = ${v.words.setId}`);
      expect(old.discarded_at).toBeNull();
      expect((await view(id)).variants.find((x) => x.id === v.id)).toBeDefined();
    });

    it("7: new words finished after their set was edited are saved as discarded, and the run says so", async () => {
      const v = (await view(id)).variants.find((x) => x.words.source === "agent")!;
      const runId = await newWords(a, v.id, noSend);
      // The person edits the set while the new words are being written: after the run read it, before it saves.
      const editMidway: StepTools = {
        run: async (stepId, fn) => {
          if (stepId === "save") await editWords(a, v.id, words);
          return fn();
        },
        waitForEvent: async () => null,
      };
      const status = await executeRun("copy", { runId, ...a }, editMidway);
      const run = (await getRun(a.userId, runId))!;
      expect(status, run.error ?? "").toBe("completed");
      expect(String(run.output!.summary)).toMatch(/edited or discarded while they were written, so they are saved as discarded/);
      expect(run.output!.stale).toBe(true);
      const [written] = await asUser(a.userId, (tx) => tx`select discarded_at from public.copy_sets where run_id = ${runId}`);
      expect(written.discarded_at).not.toBeNull();
      // Nothing waits beside the edited words, and no current set is left without ads.
      const g = await view(id);
      for (const ad of g.variants) expect(ad.pendingWords).toBeNull();
      const stranded = await asUser(a.userId, (tx) => tx`
        select s.id from public.copy_sets s
        where s.campaign_id = ${id} and s.discarded_at is null and s.channel = 'paid social'
          and not exists (select 1 from public.ad_variants v where v.copy_set_id = s.id and v.discarded_at is null)`);
      expect(stranded).toHaveLength(0);
    });

    it("7: editing or discarding a set discards new words waiting to replace it", async () => {
      // Edit: the waiting replacement goes too.
      const v = (await view(id)).variants.find((x) => x.words.source === "agent")!;
      const first = await newWords(a, v.id, noSend);
      expect((await execute(a, first)).status).toBe("completed");
      expect((await view(id)).variants.find((x) => x.id === v.id)!.pendingWords).not.toBeNull();
      const [r1] = await asUser(a.userId, (tx) => tx`select id from public.copy_sets where run_id = ${first}`);
      await editWords(a, v.id, { ...words, headline: "A little aside, each week" });
      const [after1] = await asUser(a.userId, (tx) => tx`select discarded_at from public.copy_sets where id = ${r1.id}`);
      expect(after1.discarded_at).not.toBeNull();

      // Discard in the copy lists: the waiting replacement goes too.
      const w = (await view(id)).variants.find((x) => x.words.source === "agent" && x.words.setId !== v.words.setId)!;
      const second = await newWords(a, w.id, noSend);
      expect((await execute(a, second)).status).toBe("completed");
      const [r2] = await asUser(a.userId, (tx) => tx`select id from public.copy_sets where run_id = ${second}`);
      await discardCopySet(a, w.words.setId);
      const [after2] = await asUser(a.userId, (tx) => tx`select discarded_at from public.copy_sets where id = ${r2.id}`);
      expect(after2.discarded_at).not.toBeNull();
    });
  });

  it("review finding 5: two Make creative starts at once (two tabs): one run is recorded, the other is refused", async () => {
    const id = await signedOff();
    const results = await Promise.allSettled([startMakeCreative(a, id, noSend), startMakeCreative(a, id, noSend)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(refused.reason).toBeInstanceOf(CreativeError);
    expect(String(refused.reason.message)).toMatch(/already being made/);
    const [{ n }] = await getSql()`select count(*)::int as n from public.agent_runs where agent = 'creative' and input ->> 'campaignId' = ${id}`;
    expect(n).toBe(1);
  });

  it("review finding 5: inside the workflow, Make creative is refused only by an older active run, not a newer one", async () => {
    const id = await signedOff();
    const older = await startMakeCreative(a, id, noSend);
    // A newer run for the same version, recorded and then stopped (the database allows one active run at a time).
    const [newer] = await asUser(a.userId, (tx) => tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by, status, created_at)
      values (${a.workspaceId}, 'creative', 1, ${tx.json({ mode: "make", campaignId: id, version: 1 })}, ${a.userId}, 'failed', clock_timestamp())
      returning id`);
    // The newer run asks: the older one is active, so it is refused.
    expect(await asUser(a.userId, (tx) => makeCreativeRefusal(tx, id, newer.id as string))).toMatch(/already being made/);
    // The older run asks while the newer one is active: it may go ahead.
    await getSql()`update public.agent_runs set status = 'failed' where id = ${older}`;
    await getSql()`update public.agent_runs set status = 'running' where id = ${newer.id}`;
    expect(await asUser(a.userId, (tx) => makeCreativeRefusal(tx, id, older))).toBeNull();
    // And the database refuses a second active Make creative outright.
    await expect(getSql()`update public.agent_runs set status = 'queued' where id = ${older}`).rejects.toThrow(/agent_runs_one_active_make/);
  });

  it("while Make creative is running, a second one is refused, and creative is a registered workflow", async () => {
    const id = await signedOff();
    await startMakeCreative(a, id, noSend);
    await expect(startMakeCreative(a, id, noSend)).rejects.toThrow(/already being made/);
    expect(WORKFLOWS.creative).toBeTypeOf("function");
    // A failed hand-off leaves no queued run.
    const other = await signedOff();
    await expect(startMakeCreative(a, other, async () => { throw new Error("down"); })).rejects.toThrow(/Couldn't reach the workflow service/);
    expect((await view(other)).makeCreative.allowed).toBe(true);
  });
});
