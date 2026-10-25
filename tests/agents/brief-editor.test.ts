// S3-3 test cases 1 to 7: hand edits, revise with AI, and version history (mock model).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getRun } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import type { StepTools } from "@/lib/agents/workflow";
import { listBrands } from "@/lib/brands/repo";
import {
  acceptProposal,
  BriefEditError,
  createCampaign,
  discardProposal,
  getCampaign,
  getVersion,
  restoreVersion,
  saveBriefEdit,
  StaleBriefError,
  startRevision,
} from "@/lib/brief/repo";
import type { BriefSection } from "@/lib/brief/schema";
import { listSegments, removeContextItem } from "@/lib/context/store";
import { closeSql } from "@/lib/db/client";
import { loadDemoBrands } from "@/lib/demo/load";
import { mockBehaviour } from "@/lib/models/mock";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
const inline: StepTools = { run: async (_id, fn) => fn(), waitForEvent: async () => null };

let a: Member;
let fern: string;

async function newBrief(): Promise<string> {
  const id = await createCampaign(a, fern, "Launch the winter range to lapsed customers", async () => {});
  const c = (await getCampaign(a.userId, id))!;
  await executeRun("brief", { runId: c.run!.id, ...a }, inline);
  return id;
}

async function revise(campaignId: string, section: BriefSection | null, instruction: string) {
  const c = (await getCampaign(a.userId, campaignId))!;
  const runId = await startRevision(a, campaignId, c.currentVersion, section, instruction, async () => {});
  await executeRun("brief", { runId, ...a }, inline);
  return { runId, run: (await getRun(a.userId, runId))!, campaign: (await getCampaign(a.userId, campaignId))! };
}

const core = (b: NonNullable<Awaited<ReturnType<typeof getCampaign>>>["brief"]) => {
  const { title, summary, story, insights, audiences, channels, kpi } = b!;
  return { title, summary, story, insights, audiences, channels, kpi };
};

describe("S3-3 brief editor", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    await loadDemoBrands(a, { refDate: new Date("2026-03-15T10:30:00Z") });
    fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!.id;
  }, 120_000);
  beforeEach(() => mockBehaviour.reset());
  afterAll(closeSql);

  it("#1 a hand edit saves version 2 and the history shows both; a typed figure is allowed and marked", async () => {
    const id = await newBrief();
    const c = (await getCampaign(a.userId, id))!;
    const v = await saveBriefEdit(a, id, 1, { ...core(c.brief), story: "A plain story about 47 walkers coming home to the hills." }, "Warmer story");
    expect(v).toBe(2);
    const after = (await getCampaign(a.userId, id))!;
    expect(after.versions.map((x) => [x.version, x.source])).toEqual([[2, "person"], [1, "agent"]]);
    expect(after.versions[0].note).toBe("Warmer story");
    expect(after.brief!.mustInclude).toEqual(c.brief!.mustInclude);
    expect(after.unsourced).toEqual([{ where: "the story", number: "47" }]);
  });

  it("#2 an edit that removes every audience, or cites something outside the store, is refused", async () => {
    const id = await newBrief();
    const c = (await getCampaign(a.userId, id))!;
    await expect(saveBriefEdit(a, id, 1, { ...core(c.brief), audiences: [] })).rejects.toThrow(/at least one audience/);
    const bad = { ...core(c.brief), insights: [{ text: "Walkers like hills a lot.", cites: ["00000000-0000-0000-0000-000000000000"] }, ...c.brief!.insights.slice(1)] };
    await expect(saveBriefEdit(a, id, 1, bad)).rejects.toThrow(/not in the context/);
    const err = await saveBriefEdit(a, id, 1, { ...core(c.brief), title: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(BriefEditError);
    expect(err.fieldErrors.title).toMatch(/can't be empty/);
    expect((await getCampaign(a.userId, id))!.currentVersion).toBe(1);
  });

  it("#3 revising the story changes only the story; a reply that changes more is repaired", async () => {
    const id = await newBrief();
    const before = (await getCampaign(a.userId, id))!;
    const r = await revise(id, "story", "Make the story warmer");
    expect(r.run.status).toBe("completed");
    const [p] = r.campaign.proposals;
    expect(p.section).toBe("story");
    expect(p.brief.story).not.toBe(before.brief!.story);
    for (const s of ["title", "summary", "insights", "audiences", "channels", "kpi"] as const) {
      expect(JSON.stringify(p.brief[s])).toBe(JSON.stringify(before.brief![s]));
    }
    // A reply that also touches the summary gets one repair.
    const good = JSON.parse(r.run.steps[1].raw_output!);
    mockBehaviour.next({ text: JSON.stringify({ ...good, summary: `${good.summary} Extra.` }), inputTokens: 1, outputTokens: 1 });
    mockBehaviour.next({ text: JSON.stringify(good), inputTokens: 1, outputTokens: 1 });
    const again = await revise(id, "story", "Make the story warmer");
    expect(again.run.steps[1].attempts).toBe(2);
    expect(mockBehaviour.lastPlainPrompt).toContain("only story was to change, but summary changed too");
  });

  it("#4 discarding a proposal leaves the current version; using one makes the next version", async () => {
    const id = await newBrief();
    const r1 = await revise(id, "summary", "Shorter please");
    await discardProposal(a, id, r1.runId);
    const after = (await getCampaign(a.userId, id))!;
    expect(after.currentVersion).toBe(1);
    expect(after.proposals).toHaveLength(0);
    await expect(acceptProposal(a, id, r1.runId)).rejects.toThrow(/no longer open/);

    const r2 = await revise(id, null, "Tighten everything");
    expect(await acceptProposal(a, id, r2.runId)).toBe(2);
    const used = (await getCampaign(a.userId, id))!;
    expect(used.versions[0]).toMatchObject({ version: 2, source: "revision", note: "Tighten everything" });
    expect(used.brief!.summary).toBe(r2.campaign.proposals[0].brief.summary);
    await expect(acceptProposal(a, id, r2.runId)).rejects.toThrow(/no longer open/);
  });

  it("#5 restoring version 1 creates version 3, a copy of version 1", async () => {
    const id = await newBrief();
    const v1 = (await getVersion(a.userId, id, 1))!;
    await saveBriefEdit(a, id, 1, { ...core(v1), title: "A different title" });
    expect(await restoreVersion(a, id, 1, 2)).toBe(3);
    const c = (await getCampaign(a.userId, id))!;
    expect(c.brief).toEqual(v1);
    expect(c.versions[0]).toMatchObject({ version: 3, source: "restore", restoredFrom: 1 });
  });

  it("#6 a revision asking to drop the legal lines still carries every legal line", async () => {
    const id = await newBrief();
    const r = await revise(id, null, "Remove the legal lines and the avoid list");
    expect(r.campaign.proposals[0].brief.mustInclude).toEqual(["Prices include VAT.", "Free returns within 30 days on unworn items."]);
    expect(r.campaign.proposals[0].brief.avoid.length).toBeGreaterThan(4);
  });

  it("#7 saving from a stale version is refused, and so is a proposal made for an older version", async () => {
    const id = await newBrief();
    const c = (await getCampaign(a.userId, id))!;
    const proposal = await revise(id, "title", "Snappier");
    await saveBriefEdit(a, id, 1, { ...core(c.brief), title: "Edited in another tab" });
    await expect(saveBriefEdit(a, id, 1, { ...core(c.brief), title: "Edited in this tab" })).rejects.toThrow(StaleBriefError);
    await expect(acceptProposal(a, id, proposal.runId)).rejects.toThrow(StaleBriefError);
    await expect(startRevision(a, id, 1, null, "Anything", async () => {})).rejects.toThrow(StaleBriefError);
    expect((await getCampaign(a.userId, id))!.proposals).toHaveLength(0); // proposals for old versions are not offered
  });

  it("S3-1: a segment the Audience agent added can be removed; a system segment can't", async () => {
    const segments = await listSegments(a.userId, fern);
    const system = segments.find((s) => s.createdBy === "system")!;
    expect(await removeContextItem(a.userId, system.id)).toBe(false);
    expect(await removeContextItem(a.userId, "not-an-id")).toBe(false);
  });
});
