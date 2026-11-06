// S4-1 test cases 1 to 7: the approvals inbox and brief sign-off.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decideSignoff, getSignoffState, inboxCount, listInbox, requestSignoff, SignoffError, withdrawSignoff } from "@/lib/approvals/repo";
import { ApprovalError, createRun, decideApproval, getRun } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import type { StepTools } from "@/lib/agents/workflow";
import { getBrand, listBrands, updateBrand } from "@/lib/brands/repo";
import { createCampaign, getCampaign, saveBriefEdit } from "@/lib/brief/repo";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { mockBehaviour } from "@/lib/models/mock";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
const inline: StepTools = { run: async (_id, fn) => fn(), waitForEvent: async () => null };
const noSend = async () => {};

let a: Member;
let b: Member;
let fern: string;

async function newBrief(m: Member = a): Promise<string> {
  const id = await createCampaign(m, fern, "Launch the winter range to lapsed customers", noSend);
  const c = (await getCampaign(m.userId, id))!;
  await executeRun("brief", { runId: c.run!.id, ...m }, inline);
  return id;
}

const core = (id: string) =>
  getCampaign(a.userId, id).then((c) => {
    const { title, summary, story, insights, audiences, channels, kpi } = c!.brief!;
    return { title, summary, story, insights, audiences, channels, kpi };
  });

describe("S4-1 approvals and brief sign-off", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
    await loadDemoBrands(a, { refDate: new Date("2026-03-15T10:30:00Z") });
    fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!.id;
  }, 120_000);
  beforeEach(() => mockBehaviour.reset());
  afterAll(closeSql);

  it("#1 sending a version for sign-off puts it in the inbox; approving signs that version off", async () => {
    const id = await newBrief();
    await saveBriefEdit(a, id, 1, { ...(await core(id)), title: "Back to the hills this winter" });
    const before = await inboxCount(a.userId);
    const approvalId = await requestSignoff(a, id, 2, noSend);
    expect(await inboxCount(a.userId)).toBe(before + 1);
    const item = (await listInbox(a.userId)).find((i) => i.id === approvalId)!;
    expect(item).toMatchObject({ kind: "brief_signoff", campaignId: id, version: 2, brand: { name: "Fernhollow Outfitters" } });
    expect(item.question).toBe("Sign off version 2: Back to the hills this winter");
    expect((item.expiresAt.getTime() - item.createdAt.getTime()) / 86_400_000).toBeCloseTo(14, 0);
    expect((await getSignoffState(a.userId, id))!.status).toBe("awaiting_signoff");

    expect(await decideSignoff(a, approvalId, "approved")).toEqual({ campaignId: id, version: 2 });
    const s = (await getSignoffState(a.userId, id))!;
    expect(s).toMatchObject({ status: "approved", approvedVersion: 2, open: null });
    expect(await inboxCount(a.userId)).toBe(before);
    await expect(requestSignoff(a, id, 2, noSend)).rejects.toThrow(/already signed off/);
  });

  it("#2 rejecting needs a reason, returns the brief to draft and shows why; it can be sent again", async () => {
    const id = await newBrief();
    const approvalId = await requestSignoff(a, id, 1, noSend);
    await expect(decideSignoff(a, approvalId, "rejected", "  ")).rejects.toThrow(/Say why/);
    await decideSignoff(a, approvalId, "rejected", "The story needs a clearer offer");
    const s = (await getSignoffState(a.userId, id))!;
    expect(s.status).toBe("draft");
    expect(s.note).toBe("Not signed off: The story needs a clearer offer");
    expect(s.history[0]).toMatchObject({ status: "rejected", reason: "The story needs a clearer offer" });
    const again = await requestSignoff(a, id, 1, noSend);
    expect(again).not.toBe(approvalId);
  });

  it("#3 editing after approval makes a draft; the approved version stays approved; an open request for an older version lapses", async () => {
    const id = await newBrief();
    await decideSignoff(a, await requestSignoff(a, id, 1, noSend), "approved");
    await saveBriefEdit(a, id, 1, { ...(await core(id)), title: "A newer title for the hills" });
    let s = (await getSignoffState(a.userId, id))!;
    expect(s).toMatchObject({ status: "draft", approvedVersion: 1 });

    const open = await requestSignoff(a, id, 2, noSend);
    await saveBriefEdit(a, id, 2, { ...(await core(id)), title: "Newer still" });
    s = (await getSignoffState(a.userId, id))!;
    expect(s.open).toBeNull();
    expect(s.history.find((h) => h.id === open)).toMatchObject({ status: "expired", reason: "A newer version was saved before it was signed off" });
    expect(s.note).toContain("sign-off request for version 2 lapsed");
    await expect(decideSignoff(a, open, "approved")).rejects.toThrow(/no longer open/);
  });

  it("#4 a version that fails today's checks can't be sent, and the reasons are given", async () => {
    const id = await newBrief();
    const kit = (await getBrand(a.userId, fern))!;
    const brief = (await getCampaign(a.userId, id))!.brief!;
    const word = brief.story.split(/\s+/).find((w) => /^[a-z]{5,}$/i.test(w))!.toLowerCase();
    await updateBrand(a, fern, { ...kit, bannedTerms: [...kit.bannedTerms, word] });
    try {
      await expect(requestSignoff(a, id, 1, noSend)).rejects.toThrow(/banned term/);
      expect((await getSignoffState(a.userId, id))!.status).toBe("draft");
    } finally {
      await updateBrand(a, fern, kit);
    }
  });

  it("#5 a decided or stale sign-off changes nothing; a decided approval can't be rewritten", async () => {
    const id = await newBrief();
    const approvalId = await requestSignoff(a, id, 1, noSend);
    await decideSignoff(a, approvalId, "approved");
    await expect(decideSignoff(a, approvalId, "rejected", "too late")).rejects.toThrow(SignoffError);
    await expect(asUser(a.userId, (tx) => tx`update public.approvals set status = 'rejected' where id = ${approvalId}`)).rejects.toThrow(/cannot be changed/);
    expect((await getSignoffState(a.userId, id))!.approvedVersion).toBe(1);
    await expect(requestSignoff(a, id, 0, noSend)).rejects.toThrow(/changed since/);
    const id2 = await newBrief();
    await requestSignoff(a, id2, 1, noSend);
    await withdrawSignoff(a, id2);
    expect((await getSignoffState(a.userId, id2))!).toMatchObject({ status: "draft", open: null });
  });

  it("#6 another workspace can't read, create or decide sign-offs", async () => {
    const id = await newBrief();
    const approvalId = await requestSignoff(a, id, 1, noSend);
    expect(await listInbox(b.userId)).toEqual([]);
    expect(await getSignoffState(b.userId, id)).toBeNull();
    await expect(requestSignoff(b, id, 1, noSend)).rejects.toThrow();
    await expect(decideSignoff(b, approvalId, "approved")).rejects.toThrow(/no longer open/);
    await expect(asUser(b.userId, (tx) => tx`
      insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
      values (${b.workspaceId}, 'brief_signoff', ${id}, 1, 'x', '[]', now() + interval '1 day')`)).rejects.toThrow();
    // A run choice can only name a run in its own workspace, too.
    const runId = await createRun(a, "tagline", { brandName: "x" }, noSend);
    await expect(asUser(b.userId, (tx) => tx`
      insert into public.approvals (workspace_id, run_id, question, options, expires_at)
      values (${b.workspaceId}, ${runId}, 'x', '[]', now() + interval '1 day')`)).rejects.toThrow();
    expect((await getSignoffState(a.userId, id))!.status).toBe("awaiting_signoff");
  });

  it("#7 the tagline approval still works and shows in the inbox", async () => {
    mockBehaviour.next({ text: JSON.stringify({ taglines: ["One line", "Two line", "Three line"] }), inputTokens: 1, outputTokens: 1 });
    const runId = await createRun(a, "tagline", { brandName: "Fernhollow" }, noSend);
    let seen = false;
    await executeRun("tagline", { runId, ...a }, {
      run: async (_id, fn) => fn(),
      waitForEvent: async (_id, opts) => {
        const approvalId = /approvalId == "([^"]+)"/.exec(opts.if)![1];
        seen = (await listInbox(a.userId)).some((i) => i.kind === "run_choice" && i.id === approvalId && i.runId === runId);
        await decideApproval(a.userId, approvalId, { decision: "approved", choice: 1 }, noSend);
        return { data: { approvalId } };
      },
    });
    expect(seen).toBe(true);
    expect((await getRun(a.userId, runId))!.status).toBe("completed");
    // A run choice whose run has ended is not offered.
    expect((await listInbox(a.userId)).some((i) => i.kind === "run_choice" && i.runId === runId)).toBe(false);
  });

  it("review fix: the tagline's approve and reject can't decide a brief sign-off; it stays open for the sign-off's own decision", async () => {
    const id = await newBrief();
    const approvalId = await requestSignoff(a, id, 1, noSend);
    let sent = 0;
    const send = async () => {
      sent++;
    };
    await expect(decideApproval(a.userId, approvalId, { decision: "rejected", reason: "Wrong door" }, send)).rejects.toBeInstanceOf(ApprovalError);
    await expect(decideApproval(a.userId, approvalId, { decision: "approved", choice: 0 }, send)).rejects.toBeInstanceOf(ApprovalError);
    expect(sent).toBe(0);
    const [row] = await getSql()`select status, choice, reason, decided_by from public.approvals where id = ${approvalId}`;
    expect(row).toEqual({ status: "pending", choice: null, reason: null, decided_by: null });
    expect((await getSignoffState(a.userId, id))!.status).toBe("awaiting_signoff");
  });

  it("expiry: a sign-off left past its date expires and the campaign goes back to draft with a note", async () => {
    const id = await newBrief();
    const approvalId = await requestSignoff(a, id, 1, noSend);
    await asUser(a.userId, (tx) => tx`update public.approvals set expires_at = now() - interval '1 minute' where id = ${approvalId}`);
    const s = (await getSignoffState(a.userId, id))!;
    expect(s.status).toBe("draft");
    expect(s.note).toContain("expired after 14 days");
    expect(s.history[0].status).toBe("expired");
  });
});
