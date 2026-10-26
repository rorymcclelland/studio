// S4-3 test cases 1 to 5, 7 and 9: the Market agent (mock model with fixed sample pages).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getRun } from "@/lib/agents/runs";
import { executeRun } from "@/lib/agents/workflows";
import type { StepTools } from "@/lib/agents/workflow";
import { listBrands } from "@/lib/brands/repo";
import { createCampaign, getCampaign, saveBriefEdit } from "@/lib/brief/repo";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { loadDemoBrands } from "@/lib/demo/load";
import { mockBehaviour } from "@/lib/models/mock";
import { listMarketNotes, RecentlyRefreshedError, startMarketRun } from "@/lib/strategy/market";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
const inline: StepTools = { run: async (_id, fn) => fn(), waitForEvent: async () => null };
const noSend = async () => {};
let a: Member;
let fern: string;

async function research(confirm = true) {
  const runId = await startMarketRun(a, fern, noSend, { confirm });
  await executeRun("market", { runId, ...a }, inline);
  return (await getRun(a.userId, runId))!;
}
const ledger = (runId: string) =>
  asUser(a.userId, (tx) => tx`select coalesce(sum(search_requests), 0)::int as s, coalesce(sum(cost_pence), 0)::float as p from public.usage_ledger where run_id = ${runId}`).then((r) => r[0]);

const PAGES = [
  { url: "https://outdoor-trends.example.test/winter-2026", title: "Winter walking trends 2026 (sample page)", citedText: "Sales of insulated jackets rose 12% in the autumn, with recycled fill the most asked-for feature." },
  { url: "https://retail-notes.example.test/repair", title: "Repair services in outdoor retail (sample page)", citedText: "Several outdoor chains now offer in-store repair, and Cairnwick Outdoor (a fictional chain) launched a mail-in repair service in September." },
];
const note = (over: Record<string, unknown> = {}) => ({ kind: "trend", title: "Recycled fill is asked for", text: "Sales of insulated jackets rose 12% in the autumn.", sources: [PAGES[0].url], names: [], ...over });
const reply = (notes: unknown[]) => ({ text: JSON.stringify({ notes }), inputTokens: 100, outputTokens: 100 });

describe("S4-3 Market agent", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    await loadDemoBrands(a, { refDate: new Date("2026-03-15T10:30:00Z") });
    fern = (await listBrands(a.userId)).find((x) => x.slug === "fernhollow")!.id;
  }, 120_000);
  beforeEach(() => mockBehaviour.reset());
  afterAll(closeSql);

  it("#1 saves sourced, dated notes whose every source came from the search; the searches are charged", async () => {
    const run = await research();
    expect(run.status).toBe("completed");
    const notes = await listMarketNotes(a.userId, fern);
    expect(notes.length).toBe(4);
    const returned = mockBehaviour.searchPages.map((p) => p.url);
    for (const n of notes) {
      expect(n.sources.length).toBeGreaterThan(0);
      for (const s of n.sources) expect(returned).toContain(s.url);
      expect(Date.now() - n.checkedAt.getTime()).toBeLessThan(60_000);
    }
    expect(notes.find((n) => n.kind === "rival_move")!.names).toEqual(["Cairnwick Outdoor"]);
    const l = await ledger(run.id);
    expect(l.s).toBe(2);
    expect(l.p).toBeGreaterThan(1.5); // two searches at 1 cent are about 1.6p before tokens
    expect(run.steps[1].attempt_log).toHaveLength(1);
  });

  it("#2 a source the search didn't return, or a figure not in the cited passage, is repaired, then fails; the repair doesn't search again", async () => {
    mockBehaviour.searchPages = PAGES;
    mockBehaviour.next(reply([note({ sources: ["https://made-up.example.test/x"] }), note({ text: "Sales of insulated jackets rose 40% in the autumn." })]));
    mockBehaviour.next(reply([note()]));
    const ok = await research();
    expect(ok.status).toBe("completed");
    const problems = ok.steps[1].attempt_log[0].problems.join(" ");
    expect(problems).toContain("which the search did not return");
    expect(problems).toContain("says 40%, which none of its sources' cited passages contain");
    expect((await ledger(ok.id)).s).toBe(2);

    mockBehaviour.searchPages = PAGES;
    mockBehaviour.next(reply([note({ text: "Most walkers want recycled fill this winter." })]));
    mockBehaviour.next(reply([note({ names: ["Cairnwick Outdoor"] })]));
    const failed = await research();
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain('declares "Cairnwick Outdoor", which it does not name');
  });

  it("#3 the cap refuses a run that could cost more than is left, before it starts", async () => {
    const before = process.env.DAILY_CAP_PENCE;
    const [{ p }] = await asUser(a.userId, (tx) => tx`select public.spend_today_pence('Europe/London')::float as p`);
    process.env.DAILY_CAP_PENCE = String(p + 3);
    try {
      const run = await research();
      expect(run.status).toBe("stopped_cap");
      expect((await ledger(run.id)).s).toBe(0);
    } finally {
      process.env.DAILY_CAP_PENCE = before;
    }
  });

  it("#4 a refresh replaces the old market notes and leaves other items alone", async () => {
    const [{ n: others }] = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.context_items where brand_id = ${fern} and kind <> 'result'`);
    mockBehaviour.searchPages = PAGES;
    mockBehaviour.next(reply([note(), note({ kind: "gap", title: "Repair as a reason to return", text: "Repair is a reason to come back.", sources: [PAGES[1].url] })]));
    await research();
    const notes = await listMarketNotes(a.userId, fern);
    expect(notes.map((n) => n.title)).toEqual(["Recycled fill is asked for", "Repair as a reason to return"]);
    const [{ n: after }] = await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.context_items where brand_id = ${fern} and kind <> 'result'`);
    expect(after).toBe(others);
  });

  it("#5 and #9 a brief can cite a market note, but never name a real company from one", async () => {
    await research(); // the default notes, one naming Cairnwick Outdoor
    const id = await createCampaign(a, fern, "Launch the winter range to lapsed customers", noSend);
    const c0 = (await getCampaign(a.userId, id))!;
    await executeRun("brief", { runId: c0.run!.id, ...a }, inline);
    const c = (await getCampaign(a.userId, id))!;
    expect(c.brief).not.toBeNull();
    const market = (await listMarketNotes(a.userId, fern))[0];
    const { title, summary, story, insights, audiences, channels, kpi } = c.brief!;
    await saveBriefEdit(a, id, 1, { title, summary, story, audiences, channels, kpi, insights: [{ text: "Sales of insulated jackets rose 12% in the autumn.", cites: [market.id] }, ...insights.slice(1)] });
    expect((await getCampaign(a.userId, id))!.sources[market.id].kind).toBe("result");
    await expect(saveBriefEdit(a, id, 2, { title, summary: `${summary} Unlike Cairnwick Outdoor, we repair.`, story, audiences, channels, kpi, insights })).rejects.toThrow(/names Cairnwick Outdoor, a real company/);
    // The agent is told, and a reply naming it is sent back.
    const raw = JSON.parse((await getRun(a.userId, c0.run!.id))!.steps[1].raw_output!);
    mockBehaviour.next({ text: JSON.stringify({ ...raw, story: `${raw.story} Cairnwick Outdoor does repairs too.` }), inputTokens: 1, outputTokens: 1 });
    mockBehaviour.next({ text: JSON.stringify(raw), inputTokens: 1, outputTokens: 1 });
    const id2 = await createCampaign(a, fern, "Launch the winter range to lapsed customers", noSend);
    const run2 = (await getCampaign(a.userId, id2))!.run!.id;
    await executeRun("brief", { runId: run2, ...a }, inline);
    const r2 = (await getRun(a.userId, run2))!;
    expect(r2.steps[1].attempt_log[0].problems.join(" ")).toContain("names Cairnwick Outdoor");
    expect(mockBehaviour.lastPlainPrompt).toContain("Real companies never to name");
  });

  it("#7 a search that returns nothing ends with no notes found and saves nothing", async () => {
    const before = (await listMarketNotes(a.userId, fern)).map((n) => n.id);
    mockBehaviour.searchPages = [];
    mockBehaviour.searchCount = 1;
    const run = await research();
    expect(run.status).toBe("failed");
    expect(run.error).toContain("No market notes found");
    expect((await listMarketNotes(a.userId, fern)).map((n) => n.id)).toEqual(before);
  });

  it("the 24-hour guard asks for confirmation, and two runs can't overlap", async () => {
    await expect(startMarketRun(a, fern, noSend)).rejects.toThrow(RecentlyRefreshedError);
    await startMarketRun(a, fern, noSend, { confirm: true });
    await expect(startMarketRun(a, fern, noSend, { confirm: true })).rejects.toThrow(/already researching/);
  });
});
