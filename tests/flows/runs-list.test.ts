// U10-8 The runs list, against the real database: the page of runs the list
// shows (listRunsPage in src/lib/agents/runs.ts), filtered by campaign, agent
// and status, paged by a stable cursor (the last run shown: created_at, then
// id, never an offset), each run naming its campaign; and (answer B1) the
// campaigns list's page (listCampaignsPage in src/lib/brief/repo.ts), filtered
// by brand and status and paged the same way. Everything is read through
// asUser(): another workspace's runs and campaigns never appear, whatever the
// filters, including another workspace's campaign, brand or run id (rule 7).
// U10-8 adds no table.
//
// Rows are written straight to the database as the tables' owner, as the app
// leaves them, with times set so the order is known, and with ties on purpose
// at the page boundary: two runs (and two campaigns) share a time, so only the
// id can tell them apart.
//
// Outside tests/db, as every Sprint 10 flow is (CI's Neon job runs tests/db
// from a US runner). The pure parts are tests/lib/runs-list.test.ts; the pages
// are tests/e2e/runs-list.spec.ts, whose header holds the interface:
//
//   listRunsPage(userId: string, query: { filters: RunFilters; before: string | null }, pageSize = RUNS_PAGE_SIZE)
//     => Promise<RunsPage>, RunsPage = { runs: RunSummary[]; older: string | null; ignored: RunFilterKey[] }
//   listCampaignsPage(userId: string, query: { filters: CampaignFilters; before: string | null }, pageSize = CAMPAIGNS_PAGE_SIZE)
//     => Promise<CampaignsPage>, CampaignsPage = { campaigns: CampaignSummary[]; older: string | null; ignored: CampaignFilterKey[] }
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listRunsPage, listRuns, type RunsPage } from "@/lib/agents/runs";
import { RUNS_PAGE_SIZE, type RunFilters } from "@/lib/agents/run-list";
import { listCampaignsPage, type CampaignsPage, type CampaignSummary } from "@/lib/brief/repo";
import { CAMPAIGN_STATUS_FILTERS, CAMPAIGNS_PAGE_SIZE, campaignStatusKey, type CampaignFilters, type CampaignStatusKey } from "@/lib/campaigns/list-filters";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, brief, rawLaunch, type Member } from "../helpers/launch";

const FAKE_AD = "a1111111-1111-4111-8111-111111111111";
const NONE: RunFilters = { campaign: null, agent: null, status: null };
const NO_CAMPAIGN_FILTERS: CampaignFilters = { brand: null, status: null };
const RUNS = 60;
const CAMPAIGNS = 25;
/** Every state a campaign can show, cycled through A's campaigns. */
const STATES: CampaignStatusKey[] = ["writing", "draft", "waiting", "signedOff", "launchWaiting", "live", "ended"];
const pad = (n: number) => String(n).padStart(2, "0");
const BASE = Date.now() - 6 * 3_600_000;

let a: Member;
let b: Member;
let brandA = "";
let brandA2 = "";
let brandB = "";

type FixtureRun = { id: string; agent: string; status: string; campaign: string | null; at: Date };
type FixtureCampaign = { id: string; name: string; brand: string; state: CampaignStatusKey; at: Date };

/** A's 60 runs and B's, newest first by (created_at, id), as the list must order them. */
let aRuns: FixtureRun[] = [];
let bRuns: FixtureRun[] = [];
/** A's 25 campaigns and B's 3, newest first by (updated_at, id). */
let aCampaigns: FixtureCampaign[] = [];
let bCampaigns: FixtureCampaign[] = [];
/** The two campaigns A's runs name, and B's campaign one of A's runs names (it must name none). */
let cA1: FixtureCampaign;
let cA2: FixtureCampaign;
let cB: FixtureCampaign;
/** A's run whose input names B's campaign. */
let hostileRun = "";

const newestFirst = <T extends { id: string; at: Date }>(rows: T[]) =>
  [...rows].sort((x, y) => y.at.getTime() - x.at.getTime() || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0));

async function insertRun(m: Member, agent: string, input: Record<string, unknown>, status: string, at: Date, campaign: string | null): Promise<FixtureRun> {
  const [r] = await getSql()`
    insert into public.agent_runs (workspace_id, agent, agent_version, status, input, created_by, label, created_at, completed_at)
    values (${m.workspaceId}, ${agent}, 1, ${status}, ${getSql().json(input as never)}, ${m.userId}, ${`Runs list ${agent}`}, ${at}, ${at}) returning id`;
  return { id: r.id as string, agent, status, campaign, at };
}

/**
 * A campaign in `state`, written in one insert with its final updated_at (the touch trigger fires only on update),
 * then its brief version 1 titled `name` (none while the brief is being written) and, for a launch state, its launch.
 */
async function insertCampaign(m: Member, brandId: string, name: string, state: CampaignStatusKey, at: Date): Promise<FixtureCampaign> {
  const writing = state === "writing";
  const status = writing ? "drafting" : state === "draft" ? "draft" : state === "waiting" ? "awaiting_signoff" : "approved";
  const approved = status === "approved";
  const objective = `${name}: bring walkers back for the autumn range`;
  const [c] = await getSql()`
    insert into public.campaigns (workspace_id, brand_id, objective, status, current_version, approved_version, approved_at, approved_by, created_by, created_at, updated_at)
    values (${m.workspaceId}, ${brandId}, ${objective}, ${status}, ${writing ? 0 : 1}, ${approved ? 1 : null}, ${approved ? at : null},
            ${approved ? m.userId : null}, ${m.userId}, ${at}, ${at})
    returning id`;
  const id = c.id as string;
  if (!writing) {
    await getSql()`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${m.workspaceId}, ${id}, 1, ${getSql().json(brief(name))}, 'agent', ${m.userId})`;
  }
  if (state === "launchWaiting") await rawLaunch(m, id, [FAKE_AD], { status: "awaiting_approval" });
  if (state === "live") await rawLaunch(m, id, [FAKE_AD]);
  if (state === "ended") await rawLaunch(m, id, [FAKE_AD], { status: "ended" });
  // A launch's rows never touch the campaign; check it, so the order below is the one the list must show.
  const [row] = await getSql()`select updated_at from public.campaigns where id = ${id}`;
  expect((row.updated_at as Date).getTime(), `${name}'s updated_at`).toBe(at.getTime());
  return { id, name: writing ? objective : name, brand: brandId, state, at };
}

/** Every page of runs for `filters`, following "Older runs" until there is none. */
async function allPages(m: Member, filters: RunFilters, pageSize = RUNS_PAGE_SIZE): Promise<RunsPage[]> {
  const pages: RunsPage[] = [];
  let before: string | null = null;
  for (let i = 0; i < 100; i++) {
    const page: RunsPage = await listRunsPage(m.userId, { filters, before }, pageSize);
    pages.push(page);
    if (!page.older) return pages;
    before = page.older;
  }
  throw new Error("More than 100 pages: the cursor isn't moving");
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const matching = (f: Partial<RunFilters>) =>
  aRuns.filter((r) => (!f.campaign || r.campaign === f.campaign) && (!f.agent || r.agent === f.agent) && (!f.status || r.status === f.status));

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  brandA = await brandFor(a, "fernhollow-runs-list");
  brandA2 = await asUser(a.userId, async (tx) => {
    const [r] = await tx`insert into public.brands (workspace_id, created_by, name, slug, is_simulated)
      values (${a.workspaceId}, ${a.userId}, 'Quillmoor Money', 'quillmoor-runs-list', true) returning id`;
    return r.id as string;
  });
  brandB = await brandFor(b, "fernhollow-runs-list-b");

  // A's 25 campaigns, a minute apart, newest first, across both brands and every state; campaigns 20 and 21 share
  // a time, so the boundary of the first page (20) is a tie only the id breaks.
  const made: FixtureCampaign[] = [];
  for (let i = 0; i < CAMPAIGNS; i++) {
    const minutes = i === 20 ? 19 : i;
    made.push(await insertCampaign(a, i % 2 ? brandA2 : brandA, `Runs list campaign ${pad(i + 1)}`, STATES[i % STATES.length], new Date(BASE - minutes * 60_000)));
  }
  aCampaigns = newestFirst(made);
  cA1 = made[1];
  cA2 = made[2];
  // B's campaigns are newer than all of A's, so a leak would be at the top of A's first page.
  bCampaigns = newestFirst([
    await insertCampaign(b, brandB, "Theirs: B's draft", "draft", new Date(BASE + 3 * 60_000)),
    await insertCampaign(b, brandB, "Theirs: B's live campaign", "live", new Date(BASE + 2 * 60_000)),
    await insertCampaign(b, brandB, "Theirs: B's sign-off", "waiting", new Date(BASE + 60_000)),
  ]);
  cB = bCampaigns[0];

  // A's 60 runs, a second apart, newest first. Runs 50 and 51 share a time (the first page's boundary), and so do
  // runs 11 and 12. Every fifth is a tagline run (no campaign); one names B's campaign (it must name none); the rest
  // name A's two campaigns, by three agents, a quarter of them failed.
  const agents = ["brief", "copy", "imagery"];
  const runs: FixtureRun[] = [];
  for (let k = 0; k < RUNS; k++) {
    const seconds = k === 50 ? 49 : k === 11 ? 10 : k;
    const at = new Date(BASE - 3_600_000 - seconds * 1000);
    const status = k % 4 === 3 ? "failed" : "completed";
    if (k % 5 === 0) {
      runs.push(await insertRun(a, "tagline", { brandName: "Larkspur Mill" }, status, at, null));
    } else if (k === 7) {
      const r = await insertRun(a, "brief", { mode: "draft", campaignId: cB.id }, status, at, null);
      hostileRun = r.id;
      runs.push(r);
    } else {
      const campaign = k % 2 ? cA1 : cA2;
      runs.push(await insertRun(a, agents[k % 3], { campaignId: campaign.id, version: 1 }, status, at, campaign.id));
    }
  }
  aRuns = newestFirst(runs);
  // B's runs: newer than A's, failed briefs naming B's campaign, and one naming A's campaign by its id.
  bRuns = newestFirst([
    ...(await Promise.all([1, 2, 3, 4].map((n) => insertRun(b, "brief", { mode: "draft", campaignId: cB.id }, "failed", new Date(BASE + n * 1000), cB.id)))),
    await insertRun(b, "copy", { campaignId: cA1.id, version: 1 }, "failed", new Date(BASE + 5000), null),
  ]);
}, 300_000);

afterAll(closeSql);

describe("U10-8 #1 listRunsPage() filters by campaign, agent and status", () => {
  it("the fixture has what the cases need: fewer than a page of each filter's runs, and some of each", () => {
    for (const f of [{ campaign: cA1.id }, { campaign: cA2.id }, { agent: "copy" }, { status: "failed" }, { campaign: cA2.id, agent: "imagery", status: "completed" }]) {
      expect(matching(f).length, JSON.stringify(f)).toBeGreaterThan(0);
      expect(matching(f).length, JSON.stringify(f)).toBeLessThan(RUNS_PAGE_SIZE);
    }
  });

  it("by campaign: exactly the runs that name it, newest first, on one page", async () => {
    for (const c of [cA1, cA2]) {
      const page = await listRunsPage(a.userId, { filters: { ...NONE, campaign: c.id }, before: null });
      expect(ids(page.runs), c.name).toEqual(ids(matching({ campaign: c.id })));
      for (const r of page.runs) expect(r.campaign, r.id).toEqual({ id: c.id, name: c.name });
      expect(page.older).toBeNull();
      expect(page.ignored).toEqual([]);
    }
  });

  it("by agent and by status: exactly the matching runs", async () => {
    for (const filters of [{ ...NONE, agent: "copy" }, { ...NONE, agent: "tagline" }, { ...NONE, status: "failed" }, { ...NONE, status: "completed" }]) {
      const pages = await allPages(a, filters);
      const shown = pages.flatMap((p) => p.runs);
      expect(ids(shown), JSON.stringify(filters)).toEqual(ids(matching(filters)));
      for (const r of shown) {
        if (filters.agent) expect(r.agent).toBe(filters.agent);
        if (filters.status) expect(r.status).toBe(filters.status);
      }
    }
  });

  it("all three together", async () => {
    const filters = { campaign: cA2.id, agent: "imagery", status: "completed" };
    const page = await listRunsPage(a.userId, { filters, before: null });
    expect(ids(page.runs)).toEqual(ids(matching(filters)));
    expect(page.older).toBeNull();
  });

  it("an agent or status no run has: no runs, no Older, no error", async () => {
    for (const filters of [{ ...NONE, agent: "market" }, { ...NONE, status: "stopped_cap" }]) {
      expect(await listRunsPage(a.userId, { filters, before: null }), JSON.stringify(filters)).toEqual({ runs: [], older: null, ignored: [] });
    }
  });

  it("hostile: a malformed campaign id, or one that is no campaign of the reader's, is not applied and is reported, so the list shows all runs", async () => {
    const first = await listRunsPage(a.userId, { filters: NONE, before: null });
    for (const campaign of ["not-a-uuid", "' or 1=1 --", randomUUID(), cB.id]) {
      const page = await listRunsPage(a.userId, { filters: { ...NONE, campaign }, before: null });
      expect(page.ignored, campaign).toEqual(["campaign"]);
      expect(ids(page.runs), campaign).toEqual(ids(first.runs));
      expect(page.older, campaign).toBe(first.older);
    }
  });

  it("hostile: an agent or status that is SQL-shaped is matched as text, never run", async () => {
    for (const filters of [{ ...NONE, agent: "' or '1'='1" }, { ...NONE, status: "completed' or 'x'='x" }, { ...NONE, agent: "%" }, { ...NONE, status: "_" }]) {
      expect((await listRunsPage(a.userId, { filters, before: null })).runs, JSON.stringify(filters)).toEqual([]);
    }
  });
});

describe("U10-8 #2 with 60 runs, the second page is runs 51 to 60, none twice or missed, by created_at then id", () => {
  it("the first page is the 50 newest; Older is the 50th run's id", async () => {
    const page = await listRunsPage(a.userId, { filters: NONE, before: null });
    expect(page.runs).toHaveLength(RUNS_PAGE_SIZE);
    expect(ids(page.runs)).toEqual(ids(aRuns.slice(0, 50)));
    expect(page.older).toBe(aRuns[49].id);
    expect(page.ignored).toEqual([]);
  });

  it("the second page is runs 51 to 60, with no Older; together, all 60 once each, the tie at the boundary included", async () => {
    const first = await listRunsPage(a.userId, { filters: NONE, before: null });
    const second = await listRunsPage(a.userId, { filters: NONE, before: first.older });
    expect(ids(second.runs)).toEqual(ids(aRuns.slice(50)));
    expect(second.older).toBeNull();
    const all = [...ids(first.runs), ...ids(second.runs)];
    expect(new Set(all).size).toBe(RUNS);
    expect(all).toEqual(ids(aRuns));
    // Runs 50 and 51 share a time: they are on different pages, in id order.
    expect(aRuns[49].at.getTime()).toBe(aRuns[50].at.getTime());
  });

  it("a cursor, not an offset: a newer run started between the pages doesn't move the second page", async () => {
    const first = await listRunsPage(a.userId, { filters: NONE, before: null });
    const late = await insertRun(a, "copy", { campaignId: cA1.id, version: 1 }, "completed", new Date(), cA1.id);
    try {
      const second = await listRunsPage(a.userId, { filters: NONE, before: first.older });
      expect(ids(second.runs)).toEqual(ids(aRuns.slice(50)));
    } finally {
      await getSql()`delete from public.agent_runs where id = ${late.id}`;
    }
  });

  it("paging keeps the filters, page after page, with none twice or missed (seven a page)", async () => {
    for (const filters of [NONE, { ...NONE, status: "completed" }, { ...NONE, campaign: cA1.id }, { ...NONE, agent: "tagline", status: "failed" }]) {
      const pages = await allPages(a, filters, 7);
      const shown = ids(pages.flatMap((p) => p.runs));
      expect(shown, JSON.stringify(filters)).toEqual(ids(matching(filters)));
      expect(new Set(shown).size).toBe(shown.length);
      for (const p of pages.slice(0, -1)) expect(p.runs, JSON.stringify(filters)).toHaveLength(7);
    }
  });

  it("exactly a page of runs: no Older link to an empty page", async () => {
    const n = matching({ status: "completed" }).length;
    const page = await listRunsPage(a.userId, { filters: { ...NONE, status: "completed" }, before: null }, n);
    expect(page.runs).toHaveLength(n);
    expect(page.older).toBeNull();
  });

  it("a bad cursor shows the first page: malformed, unknown, or another workspace's run", async () => {
    const first = await listRunsPage(a.userId, { filters: NONE, before: null });
    for (const before of ["not-a-uuid", "50", randomUUID(), bRuns[0].id]) {
      const page = await listRunsPage(a.userId, { filters: NONE, before });
      expect(ids(page.runs), before).toEqual(ids(first.runs));
      expect(page.older, before).toBe(first.older);
    }
  });
});

describe("U10-8 #3 each run names its campaign, or none", () => {
  it("a run naming one of the reader's campaigns names it (campaignName); a tagline run and a run naming another workspace's campaign name none", async () => {
    const shown = (await allPages(a, NONE)).flatMap((p) => p.runs);
    for (const r of shown) {
      const want = aRuns.find((x) => x.id === r.id)!;
      const c = [cA1, cA2].find((x) => x.id === want.campaign);
      expect(r.campaign, r.id).toEqual(c ? { id: c.id, name: c.name } : null);
    }
    expect(shown.find((r) => r.id === hostileRun)!.campaign).toBeNull();
    expect(shown.filter((r) => r.agent === "tagline").every((r) => r.campaign === null)).toBe(true);
  });

  it("listRuns(), which home and the brand page read, is unchanged: newest first, at most its limit", async () => {
    const runs = await listRuns(a.userId, 10);
    expect(ids(runs)).toEqual(ids(aRuns.slice(0, 10)));
  });
});

describe("U10-8 #4 another workspace's runs never appear, whatever the filters", () => {
  const filterSets = (): RunFilters[] => [
    NONE,
    { ...NONE, campaign: cA1.id },
    { ...NONE, campaign: cB.id },
    { ...NONE, agent: "brief" },
    { ...NONE, agent: "copy", status: "failed" },
    { ...NONE, status: "failed" },
    { ...NONE, campaign: "garbage", agent: "' or 1=1 --", status: "failed" },
  ];

  it("A, through every page of every filter, sees none of B's runs", async () => {
    const theirs = new Set(ids(bRuns));
    for (const filters of filterSets()) {
      for (const before of [null, bRuns[0].id]) {
        let cursor: string | null = before;
        for (let i = 0; i < 20; i++) {
          const page: RunsPage = await listRunsPage(a.userId, { filters, before: cursor });
          for (const r of page.runs) expect(theirs.has(r.id), `${JSON.stringify(filters)}: ${r.id}`).toBe(false);
          if (!page.older) break;
          cursor = page.older;
        }
      }
    }
  });

  it("B filtering by A's campaign id: the filter is not applied (it is no campaign of B's), and B sees only B's own runs, its run naming A's campaign naming none", async () => {
    const page = await listRunsPage(b.userId, { filters: { ...NONE, campaign: cA1.id }, before: null });
    expect(page.ignored).toEqual(["campaign"]);
    expect(ids(page.runs)).toEqual(ids(bRuns));
    const naming = page.runs.find((r) => r.agent === "copy")!;
    expect(naming.campaign).toBeNull();
    expect(JSON.stringify(page)).not.toContain(cA1.name);
  });

  it("B paging from one of A's runs: the first page of B's own", async () => {
    const page = await listRunsPage(b.userId, { filters: NONE, before: aRuns[10].id });
    expect(ids(page.runs)).toEqual(ids(bRuns));
  });

  it("A filtering by B's campaign: all of A's runs, and B's campaign's name nowhere", async () => {
    const page = await listRunsPage(a.userId, { filters: { ...NONE, campaign: cB.id }, before: null });
    expect(page.ignored).toEqual(["campaign"]);
    expect(JSON.stringify(page)).not.toContain(cB.name);
    expect(JSON.stringify(page)).not.toContain("Theirs:");
  });

  it("listCampaignsPage(): A never sees B's campaigns, whatever the brand or status; B's brand id is not applied", async () => {
    const theirs = new Set(ids(bCampaigns));
    for (const filters of [NO_CAMPAIGN_FILTERS, { brand: brandB, status: null }, ...CAMPAIGN_STATUS_FILTERS.map((s) => ({ brand: null, status: s.id }))]) {
      const page = await listCampaignsPage(a.userId, { filters, before: null }, 100);
      for (const c of page.campaigns) expect(theirs.has(c.id), `${JSON.stringify(filters)}: ${c.id}`).toBe(false);
    }
    const page = await listCampaignsPage(a.userId, { filters: { brand: brandB, status: null }, before: null });
    expect(page.ignored).toEqual(["brand"]);
    expect(ids(page.campaigns)).toEqual(ids(aCampaigns.slice(0, CAMPAIGNS_PAGE_SIZE)));
    // B paging from one of A's campaigns: B's own first page.
    expect(ids((await listCampaignsPage(b.userId, { filters: NO_CAMPAIGN_FILTERS, before: aCampaigns[3].id })).campaigns)).toEqual(ids(bCampaigns));
  });
});

describe("U10-8 #6 listCampaignsPage() filters by brand and status and pages by a stable cursor", () => {
  const all = async (filters: CampaignFilters, pageSize = CAMPAIGNS_PAGE_SIZE): Promise<CampaignSummary[]> => {
    const out: CampaignSummary[] = [];
    let before: string | null = null;
    for (let i = 0; i < 50; i++) {
      const page: CampaignsPage = await listCampaignsPage(a.userId, { filters, before }, pageSize);
      out.push(...page.campaigns);
      if (!page.older) return out;
      before = page.older;
    }
    throw new Error("The cursor isn't moving");
  };

  it("the first page is the 20 most recently updated; Older is the 20th's id; the second is the other 5, the tie at the boundary included", async () => {
    const first = await listCampaignsPage(a.userId, { filters: NO_CAMPAIGN_FILTERS, before: null });
    expect(ids(first.campaigns)).toEqual(ids(aCampaigns.slice(0, 20)));
    expect(first.older).toBe(aCampaigns[19].id);
    expect(first.ignored).toEqual([]);
    const second = await listCampaignsPage(a.userId, { filters: NO_CAMPAIGN_FILTERS, before: first.older });
    expect(ids(second.campaigns)).toEqual(ids(aCampaigns.slice(20)));
    expect(second.older).toBeNull();
    expect(aCampaigns[19].at.getTime()).toBe(aCampaigns[20].at.getTime());
    expect(new Set([...ids(first.campaigns), ...ids(second.campaigns)]).size).toBe(CAMPAIGNS);
  });

  it("each campaign is the summary the list shows today: its name, brand and status facts", async () => {
    const first = await listCampaignsPage(a.userId, { filters: NO_CAMPAIGN_FILTERS, before: null });
    for (const c of first.campaigns) {
      const want = aCampaigns.find((x) => x.id === c.id)!;
      expect(c.title ?? c.objective, c.id).toBe(want.name);
      expect(c.brand.id).toBe(want.brand);
      expect(campaignStatusKey(c), c.id).toBe(want.state);
    }
  });

  it("by brand: exactly that brand's campaigns", async () => {
    for (const brand of [brandA, brandA2]) {
      expect(ids(await all({ brand, status: null })), brand).toEqual(ids(aCampaigns.filter((c) => c.brand === brand)));
    }
  });

  it("by status: exactly the campaigns whose list status is that one (campaignStatusKey), so every campaign is under one status", async () => {
    const seen: string[] = [];
    for (const s of CAMPAIGN_STATUS_FILTERS) {
      const shown = await all({ brand: null, status: s.id });
      expect(ids(shown), s.id).toEqual(ids(aCampaigns.filter((c) => c.state === s.id)));
      for (const c of shown) expect(campaignStatusKey(c), c.id).toBe(s.id);
      seen.push(...ids(shown));
    }
    expect(seen.sort()).toEqual(ids(aCampaigns).sort());
  });

  it("brand and status together, paged three at a time, with none twice or missed", async () => {
    const filters = { brand: brandA, status: "draft" as const };
    expect(ids(await all(filters, 3))).toEqual(ids(aCampaigns.filter((c) => c.brand === brandA && c.state === "draft")));
    const everything = await all(NO_CAMPAIGN_FILTERS, 3);
    expect(ids(everything)).toEqual(ids(aCampaigns));
  });

  it("a bad brand is reported and not applied; a bad cursor shows the first page", async () => {
    const first = await listCampaignsPage(a.userId, { filters: NO_CAMPAIGN_FILTERS, before: null });
    for (const brand of ["not-a-uuid", randomUUID(), brandB]) {
      const page = await listCampaignsPage(a.userId, { filters: { brand, status: null }, before: null });
      expect(page.ignored, brand).toEqual(["brand"]);
      expect(ids(page.campaigns), brand).toEqual(ids(first.campaigns));
    }
    for (const before of ["not-a-uuid", "20", randomUUID(), bCampaigns[0].id]) {
      const page = await listCampaignsPage(a.userId, { filters: NO_CAMPAIGN_FILTERS, before });
      expect(ids(page.campaigns), before).toEqual(ids(first.campaigns));
    }
  });
});
