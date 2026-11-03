// C8-2 at the server level, with the mock models: the picture check's results
// kept with each picture (assets.meta.vision, through set_asset_vision), the
// compliance findings sourced from them, and Check pictures on a campaign made
// before Sprint 8. Test cases 2 (a picture the AI says breaks a don't rule is
// Review on every ad that uses it, "Checked by AI"; Accept clears it in each
// ad), 4 (Check pictures shows its cost, checks each picture once and adds
// results; running it again checks nothing and costs nothing) and 5 (a check
// that errors or hits the cap leaves Review with "The picture check didn't
// run: <reason>", never Pass), plus the tenancy of set_asset_vision.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRun, createWorkflowRun, getRun, type Member } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import type { StepTools } from "@/lib/agents/workflow";
import { decideSignoff, requestSignoff } from "@/lib/approvals/repo";
import { listBrands } from "@/lib/brands/repo";
import { createCampaign, getCampaign } from "@/lib/brief/repo";
import { complianceFor, decideFinding, fileCompliance, type AdCompliance } from "@/lib/compliance/compute";
import { CHECKED_BY_AI, leftOutReason, NOT_CHECKED_YET } from "@/lib/compliance/rules";
import { readVision } from "@/lib/compliance/vision";
import { pictureCheckEstimate, smallPence } from "@/lib/creative/costs";
import { clearFitCache } from "@/lib/creative/fit-cache";
import { getCreative, startMakeCreative } from "@/lib/creative/gallery";
import { ALL_CHECKED, PICTURE_CHECK_KEY, PICTURE_CHECK_VERSION, PictureCheckError, startPictureCheck } from "@/lib/creative/picture-check";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { spendPosition } from "@/lib/models/generate";
import { mockBehaviour } from "@/lib/models/mock";
import { createMember, truncateAll } from "../helpers/db";

const inline: StepTools = { run: async (_id, fn) => fn(), waitForEvent: async () => null };
const noSend = async () => {};
const SHAPES_RULE = "Show soft abstract shapes instead of real scenes";

let a: Member;
let b: Member;
let quill: string;

async function execute(m: Member, runId: string) {
  const agent = (await getRun(m.userId, runId))!.agent;
  const status = await executeRun(agent, { runId, ...m }, inline);
  return { status, run: (await getRun(m.userId, runId))! };
}

/** A signed-off Quillmoor campaign (a finance brand) with Make creative's ads. */
async function campaignWithAds(m: Member = a): Promise<string> {
  const id = await createCampaign(m, quill, "Bring lapsed savers back to the Plus plan in January", noSend);
  await execute(m, (await getCampaign(m.userId, id))!.run!.id);
  const c = (await getCampaign(m.userId, id))!;
  await decideSignoff(m, await requestSignoff(m, id, c.currentVersion, noSend), "approved");
  const made = await execute(m, await startMakeCreative(m, id, noSend));
  expect(made.status, made.run.error ?? "").toBe("completed");
  return id;
}

/** "Made before Sprint 8": the campaign's pictures lose their picture-check results (as the test's own superuser). */
async function forgetChecks(campaignId: string) {
  await getSql()`update public.assets set meta = meta - 'vision' where campaign_id = ${campaignId}`;
}

const ads = async (campaignId: string) => (await getCreative(a.userId, campaignId))!.variants;
const compliance = async (campaignId: string): Promise<AdCompliance[]> => {
  const v = await ads(campaignId);
  const all = await complianceFor(a.userId, v.map((x) => x.id));
  return v.map((x) => all.get(x.id)!);
};
const pictures = async (campaignId: string) =>
  asUser(a.userId, (tx) => tx`select id, meta from public.assets where campaign_id = ${campaignId} and kind = 'image' and discarded_at is null order by created_at, id`);

describe("C8-2 picture checks and Check pictures", () => {
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
    clearFitCache();
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

  it("each picture Make creative keeps has its check stored with it: text, the face and every don't rule, with the model and the step", async () => {
    const id = await campaignWithAds();
    const [{ dont_rules: rules }] = await asUser(a.userId, (tx) => tx`select dont_rules from public.brands where id = ${quill}`);
    for (const p of await pictures(id)) {
      const v = readVision(p.meta.vision)!;
      expect(v).toMatchObject({ status: "checked", hasText: false, face: { present: false, closeUp: false }, provider: "mock", model: "mock-model" });
      if (v.status !== "checked") throw new Error("not checked");
      expect(v.rules).toHaveLength((rules as string[]).length);
      expect(v.rules.every((r) => !r.breaks)).toBe(true);
      // Rule 4: the step it came from is in the trail, with its cost.
      const [step] = await asUser(a.userId, (tx) => tx`select name, kind, cost_pence from public.agent_steps where id = ${v.stepId}`);
      expect(step).toMatchObject({ kind: "model" });
      expect(String(step.name)).toMatch(/^Check picture \d for text$/);
      expect(Number(step.cost_pence)).toBeGreaterThan(0);
    }
    // A finance brand: every ad shows the face rule (Pass, no face) and the don't rules ("No issues found by AI"), checked by AI.
    for (const ad of await compliance(id)) {
      expect(ad.picture.map((f) => [f.rule, f.status])).toEqual([
        ["face", "pass"],
        ["picture", "pass"],
      ]);
      for (const f of ad.picture) expect(f.checkedBy).toBe(`${CHECKED_BY_AI} (simulated: the mock model)`);
      expect(ad.picture[1].reason).toMatch(/^No issues found by AI for the brand's 3 don't rules\.$/);
    }
    // Nothing to check: the button says so.
    expect((await getCreative(a.userId, id))!.pictureCheck).toMatchObject({ todo: 0, reason: ALL_CHECKED });
  }, 120_000);

  it("#4 Check pictures on a campaign made before Sprint 8 shows its cost, checks each picture once and adds results; running it again checks nothing and costs nothing", async () => {
    const id = await campaignWithAds();
    await forgetChecks(id);
    const n = (await pictures(id)).length;
    expect(n).toBe(4);

    // Before: every ad's picture items are Review, "didn't run", never Pass.
    for (const ad of await compliance(id)) {
      expect(ad.picture.map((f) => [f.rule, f.status, f.reason])).toEqual([
        ["face", "review", NOT_CHECKED_YET],
        ["picture", "review", NOT_CHECKED_YET],
      ]);
      expect(ad.picture[0].fix).toBe("Use Check pictures on the campaign");
    }

    // The button: four pictures, with the cost, before the click.
    const bar = (await getCreative(a.userId, id))!.pictureCheck;
    expect(bar).toMatchObject({ todo: 4, total: 4, reason: null, runningRunId: null });
    expect(bar.estimate).toBe(pictureCheckEstimate(4).label);
    expect(bar.estimate).toMatch(/^about \d.*p a picture, .*p in all$/);
    // On the real model, about 0.03p a picture (Haiku with one picture).
    const real = pictureCheckEstimate(4, { USD_TO_GBP: "0.79" });
    expect(smallPence(real.perPicturePence)).toBe("0.03p");
    expect(real.label).toBe(`about 0.03p a picture, ${smallPence(real.pence)} in all`);

    const before = await spendPosition(a.userId, a.workspaceId);
    const runId = await startPictureCheck(a, id, noSend);
    const { status, run } = await execute(a, runId);
    expect(status, run.error ?? "").toBe("completed");
    const checks = run.steps.filter((s) => /^Check picture \d$/.test(s.name));
    expect(checks).toHaveLength(4);
    for (const s of checks) expect(Number(s.cost_pence), s.name).toBeGreaterThan(0);
    const ledger = await asUser(a.userId, (tx) => tx`select agent, cost_pence from public.usage_ledger where run_id = ${runId}`);
    expect(ledger.map((l) => l.agent)).toEqual(["imageCheck", "imageCheck", "imageCheck", "imageCheck"]);
    expect(String((run.output as { summary: string }).summary)).toMatch(/^Checked 4 of 4 pictures for text, faces and the brand's don't rules\./);
    // The charge is within the estimate shown (the mock model is priced as itself).
    const after = await spendPosition(a.userId, a.workspaceId);
    expect(after.workspace - before.workspace).toBeLessThanOrEqual(pictureCheckEstimate(4).worstPence + 1e-6);
    // Results on every picture, from this run; nothing was discarded (rule 3).
    for (const p of await pictures(id)) expect(readVision(p.meta.vision)).toMatchObject({ status: "checked", runId });
    expect(await pictures(id)).toHaveLength(4);
    for (const ad of await compliance(id)) expect(ad.picture.map((f) => f.status)).toEqual(["pass", "pass"]);

    // Again: refused before anything starts, and a run made some other way checks nothing and costs nothing.
    await expect(startPictureCheck(a, id, noSend)).rejects.toThrow(PictureCheckError);
    await expect(startPictureCheck(a, id, noSend)).rejects.toThrow(ALL_CHECKED);
    const assetIds = (await pictures(id)).map((p) => p.id as string);
    const callsBefore = mockBehaviour.calls;
    const again = await createWorkflowRun(a, PICTURE_CHECK_KEY, PICTURE_CHECK_VERSION, { campaignId: id, assetIds }, noSend, { label: "again" });
    const second = await execute(a, again);
    expect(second.status).toBe("completed");
    expect(mockBehaviour.calls).toBe(callsBefore);
    expect(String((second.run.output as { summary: string }).summary)).toMatch(/^Nothing to check: every picture already has a result/);
    expect(await asUser(a.userId, (tx) => tx`select 1 from public.usage_ledger where run_id = ${again}`)).toHaveLength(0);
    expect(Number(second.run.cost_pence)).toBe(0);
  }, 180_000);

  it("#2 a picture the AI says breaks a don't rule is Review on every ad that uses it, with the reason and \"Checked by AI\"; Accept clears it in each ad", async () => {
    const id = await campaignWithAds();
    const [{ dont_rules: kept }] = await asUser(a.userId, (tx) => tx`select dont_rules from public.brands where id = ${quill}`);
    await asUser(a.userId, (tx) => tx`update public.brands set dont_rules = array_append(dont_rules, ${SHAPES_RULE}) where id = ${quill}`);
    try {
      await forgetChecks(id);
      // The mock flags the rule about abstract shapes (its pictures are soft shapes) for picture 1 only.
      mockBehaviour.visionBreaks = (prompt, rule) => /^Picture: 1$/m.test(prompt) && rule === SHAPES_RULE;
      expect((await execute(a, await startPictureCheck(a, id, noSend))).status).toBe("completed");

      const first = (await pictures(id)).find((p) => p.meta.picture === 1)!;
      const all = await compliance(id);
      const v = await ads(id);
      const onFirst = v.filter((x) => x.image.assetId === first.id).map((x) => all.find((c) => c.variantId === x.id)!);
      const others = v.filter((x) => x.image.assetId !== first.id).map((x) => all.find((c) => c.variantId === x.id)!);
      expect(onFirst.length).toBeGreaterThan(1);
      expect(others.length).toBeGreaterThan(0);
      for (const ad of onFirst) {
        const f = ad.picture.find((x) => x.rule === "picture")!;
        expect(f).toMatchObject({ status: "review", outcome: "review", checkedBy: `${CHECKED_BY_AI} (simulated: the mock model)` });
        expect(f.reason).toBe(`The AI check says the picture may break "${SHAPES_RULE}": Simulated check: the picture is made of soft abstract shapes, which this rule rules out.`);
        expect(ad.tally.review).toBeGreaterThan(0);
        // Every file of the ad carries it, so the pack leaves the ad out until a person accepts it.
        const file = fileCompliance(ad, "en-GB", "1080x1080")!;
        expect(file.leftOut).not.toBeNull();
        expect(file.findings.filter((x) => x.rule === "picture")).toEqual([f]);
        expect(leftOutReason([f])).toBe("Awaiting review: picture: don't rules.");
      }
      for (const ad of others) expect(ad.picture.find((x) => x.rule === "picture")!.status).toBe("pass");

      // Accept, ad by ad: each records its own decision, and the item turns accepted in that ad only.
      for (const [i, ad] of onFirst.entries()) {
        const f = ad.picture.find((x) => x.rule === "picture")!;
        const decided = await decideFinding(a, ad.variantId, { lang: null, size: null, rule: f.key, hash: f.hash, decision: "accept", note: null });
        expect(decided).toMatchObject({ outcome: "accepted", decision: { decision: "accept", decidedBy: a.userId } });
        const now = await compliance(id);
        for (const [j, other] of onFirst.entries()) {
          const g = now.find((c) => c.variantId === other.variantId)!.picture.find((x) => x.rule === "picture")!;
          expect(g.outcome, `ad ${j} after accepting ad ${i}`).toBe(j <= i ? "accepted" : "review");
        }
      }
    } finally {
      await asUser(a.userId, (tx) => tx`update public.brands set dont_rules = ${kept} where id = ${quill}`);
    }
  }, 180_000);

  it("#5 a check that errors, or hits the cap, leaves Review with \"The picture check didn't run: <reason>\", never Pass; nothing is discarded", async () => {
    const id = await campaignWithAds();
    await forgetChecks(id);
    // A provider error on the first picture; the others are checked.
    mockBehaviour.fail("Overloaded: try again later", 2);
    const errored = await execute(a, await startPictureCheck(a, id, noSend));
    expect(errored.status).toBe("completed");
    expect(String((errored.run.output as { summary: string }).summary)).toMatch(/Checked 3 of 4 pictures.*1 check didn't run/);
    const [first, ...rest] = await pictures(id);
    expect(readVision(first.meta.vision)).toMatchObject({ status: "error", message: expect.stringMatching(/Overloaded/) });
    for (const p of rest) expect(readVision(p.meta.vision)).toMatchObject({ status: "checked" });
    expect(await pictures(id)).toHaveLength(4);
    const v = await ads(id);
    const all = await compliance(id);
    for (const ad of v.filter((x) => x.image.assetId === first.id).map((x) => all.find((c) => c.variantId === x.id)!)) {
      for (const f of ad.picture) {
        expect(f.status).toBe("review");
        expect(f.reason).toMatch(/^The picture check didn.t run: .*Overloaded/);
      }
    }

    // The errored picture is offered again; with the cap reached, nothing is charged and it stays Review with the reason.
    expect((await getCreative(a.userId, id))!.pictureCheck.todo).toBe(1);
    const spent = await spendPosition(a.userId, a.workspaceId);
    process.env.WORKSPACE_DAILY_CAP_PENCE = String(spent.workspace);
    const capped = await execute(a, await startPictureCheck(a, id, noSend));
    expect(capped.status).toBe("stopped_cap");
    expect(capped.run.error).toMatch(/Daily AI cap reached: 0 of 1 picture checked/);
    expect(await asUser(a.userId, (tx) => tx`select 1 from public.usage_ledger where run_id = ${capped.run.id}`)).toHaveLength(0);
    const [again] = await pictures(id);
    expect(readVision(again.meta.vision)).toMatchObject({ status: "cap" });
    const ad = (await compliance(id)).find((c) => v.find((x) => x.id === c.variantId)!.image.assetId === first.id)!;
    for (const f of ad.picture) {
      expect(f.status).toBe("review");
      expect(f.reason).toMatch(/^The picture check didn't run: .*cap/i);
    }
  }, 180_000);

  it("rule 7: set_asset_vision writes only to a picture in the caller's workspace, and the app's role can't write meta directly", async () => {
    const id = await campaignWithAds();
    const [p] = await pictures(id);
    const record = { status: "error", checkedAt: new Date().toISOString(), runId: "x", stepId: null, provider: null, model: null, message: "forged" };
    const [{ ok }] = await asUser(b.userId, (tx) => tx`select public.set_asset_vision(${p.id}, ${tx.json(record)}) as ok`);
    expect(ok).toBe(false);
    expect(readVision((await pictures(id))[0].meta.vision)).toMatchObject({ status: "checked" });
    await expect(asUser(a.userId, (tx) => tx`update public.assets set meta = jsonb_set(meta, '{vision}', '{}') where id = ${p.id}`)).rejects.toThrow(/permission denied/);
    // Even with full privileges, only the vision key may change, and only to an object.
    await expect(getSql()`update public.assets set meta = jsonb_set(meta, '{idea}', '"another"') where id = ${p.id}`).rejects.toThrow(/only marked discarded/);
    await expect(getSql()`update public.assets set meta = jsonb_set(meta, '{vision}', '"no"') where id = ${p.id}`).rejects.toThrow(/must be an object/);
    // The column's limit still holds.
    await expect(asUser(a.userId, (tx) => tx`select public.set_asset_vision(${p.id}, ${tx.json({ status: "error", message: "x".repeat(9000) })})`)).rejects.toThrow(/check constraint/);
  }, 120_000);
});
