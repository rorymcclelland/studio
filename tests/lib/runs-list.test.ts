// U10-8 in CI, the pure parts: the runs list's filters and their address, the
// "Older runs" link's address, the plain note for a filter Studio doesn't
// recognise, the simulated label once in the cost column's heading, and the
// run trail's step numbers; and (answer B1) the campaigns list's filters,
// address and status keys. The queries behind both lists are
// tests/flows/runs-list.test.ts; the pages are tests/e2e/runs-list.spec.ts,
// whose header has the whole interface.
//
// src/lib/agents/run-list.ts (NEW, PURE: imports only @/lib/format):
//   RUNS_PAGE_SIZE = 50; RUN_FILTER_KEYS = ["campaign", "agent", "status"]; RUN_STATUSES (the eight run statuses);
//   parseRunFilters(params, agents), runsHref(filters, before?), filterNote(ignored), costHeading(runs),
//   runCostText(run, heading), numberTrailSteps(steps).
// src/lib/campaigns/list-filters.ts (NEW, PURE: imports only ./status and @/lib/agents/run-list):
//   CAMPAIGNS_PAGE_SIZE = 20; CAMPAIGN_FILTER_KEYS = ["brand", "status"]; CAMPAIGN_STATUS_FILTERS;
//   campaignStatusKey(facts), parseCampaignFilters(params), campaignsHref(filters, before?), campaignFilterNote(ignored).
import { describe, expect, it } from "vitest";
import {
  costHeading,
  filterNote,
  numberTrailSteps,
  parseRunFilters,
  RUN_FILTER_KEYS,
  RUN_STATUSES,
  RUNS_PAGE_SIZE,
  runCostText,
  runsHref,
} from "@/lib/agents/run-list";
import {
  CAMPAIGN_FILTER_KEYS,
  CAMPAIGN_STATUS_FILTERS,
  campaignFilterNote,
  campaignsHref,
  campaignStatusKey,
  CAMPAIGNS_PAGE_SIZE,
  parseCampaignFilters,
} from "@/lib/campaigns/list-filters";
import { CAMPAIGN_STATUS_LABELS, campaignStatusLabel, type CampaignStatusFacts } from "@/lib/campaigns/status";
import { formatCost, formatPence } from "@/lib/format";

const CAMPAIGN = "c0000000-0000-4000-8000-000000000001";
/** A campaigns-list cursor: a position (updated_at in microseconds, then the campaign id). */
const CURSOR = `1762740000123456_${CAMPAIGN}`;
const RUN = "a0000000-0000-4000-8000-000000000060";
const BRAND = "b0000000-0000-4000-8000-000000000002";
const AGENTS = ["tagline", "brief", "copy", "imagery", "persona", "testPlan", "creative", "pictureCheck"] as const;
const NONE = { campaign: null, agent: null, status: null };

/** Malformed values a person (or a hostile link) might put in the address. */
const GARBAGE = [
  " ",
  "nope",
  "not-a-uuid",
  "c0000000-0000-4000-8000-00000000000",
  "c0000000-0000-4000-8000-0000000000011",
  "c0000000000040008000000000000001",
  `${CAMPAIGN} `,
  ` ${CAMPAIGN}`,
  "<script>alert(1)</script>",
  "' or 1=1 --",
  "__proto__",
  "constructor",
  "toString",
  "%00",
];

describe("U10-8 #1 the runs list's filters and their address", () => {
  it("has the agreed page size, filter keys and run statuses", () => {
    expect(RUNS_PAGE_SIZE).toBe(50);
    expect([...RUN_FILTER_KEYS]).toEqual(["campaign", "agent", "status"]);
    expect([...RUN_STATUSES]).toEqual(["queued", "running", "awaiting_approval", "completed", "failed", "rejected", "expired", "stopped_cap"]);
  });

  it("no filters: all runs, from the first page, with nothing to note", () => {
    expect(parseRunFilters({}, AGENTS)).toEqual({ filters: NONE, before: null, ignored: [] });
  });

  it("a known campaign id, agent and status are applied as written (the id in lower case)", () => {
    expect(parseRunFilters({ campaign: CAMPAIGN.toUpperCase(), agent: "copy", status: "failed" }, AGENTS)).toEqual({
      filters: { campaign: CAMPAIGN, agent: "copy", status: "failed" },
      before: null,
      ignored: [],
    });
    for (const agent of AGENTS) expect(parseRunFilters({ agent }, AGENTS).filters.agent, agent).toBe(agent);
    for (const status of RUN_STATUSES) expect(parseRunFilters({ status }, AGENTS).filters.status, status).toBe(status);
  });

  it("the form's All options send an empty value: that is no filter, and nothing to note", () => {
    expect(parseRunFilters({ campaign: "", agent: "", status: "", before: "" }, AGENTS)).toEqual({ filters: NONE, before: null, ignored: [] });
  });

  it("hostile: an unknown or garbage campaign, agent or status is not applied, and is noted, in the order campaign, agent, status", () => {
    for (const value of GARBAGE) {
      const parsed = parseRunFilters({ campaign: value, agent: value, status: value }, AGENTS);
      expect(parsed.filters, JSON.stringify(value)).toEqual(NONE);
      expect(parsed.ignored, JSON.stringify(value)).toEqual(["campaign", "agent", "status"]);
    }
    // An agent or status in another case, or one Studio doesn't have, is unknown too.
    for (const agent of ["Copy", "COPY", "copy agent", "Copy agent", "market"]) expect(parseRunFilters({ agent }, AGENTS).ignored, agent).toEqual(["agent"]);
    for (const status of ["Failed", "FAILED", "done", "pending", "succeeded"]) expect(parseRunFilters({ status }, AGENTS).ignored, status).toEqual(["status"]);
    // One bad filter leaves the good ones applied.
    expect(parseRunFilters({ campaign: CAMPAIGN, agent: "nope", status: "completed" }, AGENTS)).toEqual({
      filters: { campaign: CAMPAIGN, agent: null, status: "completed" },
      before: null,
      ignored: ["agent"],
    });
  });

  it("a repeated filter (?agent=copy&agent=brief) is read by its first value; other parameters are left alone", () => {
    expect(parseRunFilters({ agent: ["copy", "brief"] }, AGENTS).filters.agent).toBe("copy");
    expect(parseRunFilters({ agent: ["nope", "brief"] }, AGENTS)).toMatchObject({ filters: NONE, ignored: ["agent"] });
    expect(parseRunFilters({ agent: [] }, AGENTS)).toEqual({ filters: NONE, before: null, ignored: [] });
    expect(parseRunFilters({ q: "walkers", tab: "audience", page: "2" }, AGENTS)).toEqual({ filters: NONE, before: null, ignored: [] });
  });

  it("never throws, whatever the address holds", () => {
    const weird = [{ campaign: undefined }, { agent: ["", ""] }, { status: [undefined as unknown as string] }, Object.create(null) as Record<string, string>];
    for (const params of weird) expect(() => parseRunFilters(params, AGENTS)).not.toThrow();
    expect(() => parseRunFilters({ agent: "copy" }, [])).not.toThrow();
    expect(parseRunFilters({ agent: "copy" }, []).ignored).toEqual(["agent"]);
  });

  it("the address of a filtered list: /runs, then campaign, agent, status and before, in that order, encoded", () => {
    expect(runsHref({})).toBe("/runs");
    expect(runsHref(NONE)).toBe("/runs");
    expect(runsHref(NONE, null)).toBe("/runs");
    expect(runsHref({ agent: "copy" })).toBe("/runs?agent=copy");
    expect(runsHref({ status: "awaiting_approval", campaign: CAMPAIGN })).toBe(`/runs?campaign=${CAMPAIGN}&status=awaiting_approval`);
    expect(runsHref({ campaign: CAMPAIGN, agent: "testPlan", status: "failed" }, RUN)).toBe(`/runs?campaign=${CAMPAIGN}&agent=testPlan&status=failed&before=${RUN}`);
    expect(runsHref(NONE, RUN)).toBe(`/runs?before=${RUN}`);
    expect(runsHref({ agent: "a b&c" })).toBe("/runs?agent=a+b%26c");
  });

  it("an address round-trips: what runsHref writes, parseRunFilters reads back", () => {
    const cases = [
      { filters: NONE, before: null },
      { filters: { campaign: CAMPAIGN, agent: null, status: null }, before: null },
      { filters: { campaign: null, agent: "imagery", status: "completed" }, before: RUN },
      { filters: { campaign: CAMPAIGN, agent: "pictureCheck", status: "stopped_cap" }, before: RUN },
    ];
    for (const c of cases) {
      const url = new URL(runsHref(c.filters, c.before), "http://studio.test");
      expect(url.pathname).toBe("/runs");
      const params = Object.fromEntries(url.searchParams);
      expect(parseRunFilters(params, AGENTS), url.search).toEqual({ ...c, ignored: [] });
    }
  });

  it("the plain note: none for nothing ignored; one filter, or several, named in the order given", () => {
    expect(filterNote([])).toBeNull();
    expect(filterNote(["agent"])).toBe("Filter not recognised, so not applied: agent.");
    expect(filterNote(["campaign", "status"])).toBe("Filters not recognised, so not applied: campaign and status.");
    expect(filterNote(["campaign", "agent", "status"])).toBe("Filters not recognised, so not applied: campaign, agent and status.");
  });
});

describe("U10-8 #2 a bad cursor shows the first page", () => {
  it("before is a run id (any case, read in lower case); anything else is dropped quietly, with no note", () => {
    expect(parseRunFilters({ before: RUN }, AGENTS)).toEqual({ filters: NONE, before: RUN, ignored: [] });
    expect(parseRunFilters({ before: RUN.toUpperCase() }, AGENTS).before).toBe(RUN);
    for (const value of GARBAGE) expect(parseRunFilters({ before: value }, AGENTS), JSON.stringify(value)).toEqual({ filters: NONE, before: null, ignored: [] });
    // An offset-style cursor is not a cursor.
    for (const value of ["50", "2", "-1", "2026-11-09T10:00:00.000Z"]) expect(parseRunFilters({ before: value }, AGENTS).before, value).toBeNull();
  });

  it("the Older runs link keeps the filters", () => {
    const parsed = parseRunFilters({ agent: "copy", status: "failed" }, AGENTS);
    expect(runsHref(parsed.filters, RUN)).toBe(`/runs?agent=copy&status=failed&before=${RUN}`);
  });
});

describe("U10-8 the simulated cost label, once, in the cost column's heading", () => {
  const sim = (pence: number) => ({ cost_pence: String(pence), simulated_pence: String(pence) });
  const real = (pence: number) => ({ cost_pence: String(pence), simulated_pence: "0" });
  const mixed = { cost_pence: "14", simulated_pence: "10.6" };
  const free = { cost_pence: "0", simulated_pence: "0" };

  it("every cost wholly simulated: the heading says so, and each row shows the amount alone", () => {
    const runs = [sim(11.5), sim(0.0032), free, sim(250)];
    expect(costHeading(runs)).toBe("Cost (simulated)");
    expect(runs.map((r) => runCostText(r, "Cost (simulated)"))).toEqual(["11.50p", "under 0.01p", "0p", "£2.50"]);
    for (const r of runs) expect(runCostText(r, "Cost (simulated)")).not.toMatch(/simulated/);
    // Sums from the database can differ in the last places (formatCost's rule).
    expect(costHeading([{ cost_pence: "11.50005", simulated_pence: "11.5" }])).toBe("Cost (simulated)");
  });

  it("rule 1: with a real cost among them, the heading is plain and each row keeps formatCost's own words", () => {
    for (const runs of [[sim(11.5), real(3)], [sim(11.5), mixed], [real(3)], [free], []]) {
      expect(costHeading(runs), JSON.stringify(runs)).toBe("Cost");
      for (const r of runs) expect(runCostText(r, "Cost"), JSON.stringify(r)).toBe(formatCost(r.cost_pence, r.simulated_pence));
    }
    expect(runCostText(mixed, "Cost")).toBe("14.00p (10.60p simulated)");
    expect(runCostText(sim(11.5), "Cost")).toBe("11.50p (simulated)");
    expect(runCostText(real(3), "Cost")).toBe(formatPence(3));
  });
});

describe("U10-8 #5 the run trail's steps are numbered without gaps", () => {
  it("steps whose seq skips (Imagery's slots: 1, 2, 3, 5, 7) are numbered 1 to 5, in seq order", () => {
    const steps = [7, 1, 3, 2, 5].map((seq) => ({ seq, name: `seq ${seq}` }));
    const numbered = numberTrailSteps(steps);
    expect(numbered.map((s) => [s.number, s.seq, s.name])).toEqual([
      [1, 1, "seq 1"],
      [2, 2, "seq 2"],
      [3, 3, "seq 3"],
      [4, 5, "seq 5"],
      [5, 7, "seq 7"],
    ]);
  });

  it("nothing is left out or shown twice, and the input is not changed", () => {
    const steps = Object.freeze([{ seq: 12 }, { seq: 4 }, { seq: 9 }].map((s) => Object.freeze(s)));
    const numbered = numberTrailSteps(steps);
    expect(numbered).toHaveLength(3);
    expect(numbered.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(numbered.map((s) => s.seq)).toEqual([4, 9, 12]);
    expect(steps.map((s) => s.seq)).toEqual([12, 4, 9]);
  });

  it("steps already numbered 1 to n keep their numbers; no steps, none", () => {
    expect(numberTrailSteps([1, 2, 3].map((seq) => ({ seq }))).map((s) => s.number)).toEqual([1, 2, 3]);
    expect(numberTrailSteps([])).toEqual([]);
  });
});

describe("U10-8 #6 the campaigns list's filters and their address", () => {
  const facts = (over: Partial<CampaignStatusFacts>): CampaignStatusFacts => ({ status: "draft", currentVersion: 1, launches: [], ...over });

  it("(B1) has its page size, filter keys and the status filters in U10-1's words", () => {
    expect(CAMPAIGNS_PAGE_SIZE).toBe(20);
    expect([...CAMPAIGN_FILTER_KEYS]).toEqual(["brand", "status"]);
    expect(CAMPAIGN_STATUS_FILTERS.map((s) => [s.id, s.label])).toEqual([
      ["writing", CAMPAIGN_STATUS_LABELS.writing],
      ["draft", CAMPAIGN_STATUS_LABELS.draft],
      ["waiting", CAMPAIGN_STATUS_LABELS.waiting],
      ["signedOff", CAMPAIGN_STATUS_LABELS.signedOff],
      ["launchWaiting", CAMPAIGN_STATUS_LABELS.launchWaiting],
      ["live", "Live"],
      ["ended", CAMPAIGN_STATUS_LABELS.ended],
    ]);
  });

  it("a campaign's status key agrees with the label the list shows (campaignStatusLabel), whatever its launches", () => {
    const all: [CampaignStatusFacts, string][] = [
      [facts({ status: "drafting", currentVersion: 0 }), "writing"],
      [facts({ status: "draft", currentVersion: 0 }), "writing"],
      [facts({ status: "draft" }), "draft"],
      [facts({ status: "something new" }), "draft"],
      [facts({ status: "awaiting_signoff" }), "waiting"],
      [facts({ status: "approved" }), "signedOff"],
      [facts({ status: "approved", launches: [{ status: "refused", simDay: 0 }] }), "signedOff"],
      [facts({ status: "approved", launches: [{ status: "awaiting_approval", simDay: 0 }] }), "launchWaiting"],
      [facts({ status: "approved", launches: [{ status: "live", simDay: 0 }] }), "live"],
      [facts({ status: "approved", launches: [{ status: "ended", simDay: 12 }, { status: "live", simDay: 14 }] }), "live"],
      [facts({ status: "approved", launches: [{ status: "ended", simDay: 12 }, { status: "awaiting_approval", simDay: 0 }] }), "launchWaiting"],
      [facts({ status: "draft", currentVersion: 2, launches: [{ status: "ended", simDay: 30 }] }), "ended"],
    ];
    for (const [f, key] of all) {
      expect(campaignStatusKey(f), JSON.stringify(f)).toBe(key);
      const label = campaignStatusLabel(f);
      const filter = CAMPAIGN_STATUS_FILTERS.find((s) => s.id === key)!;
      if (key === "live") expect(label.startsWith("Live"), label).toBe(true);
      else expect(label, JSON.stringify(f)).toBe(filter.label);
    }
  });

  it("a known brand id and status are applied; empty is no filter; garbage is noted and not applied", () => {
    expect(parseCampaignFilters({})).toEqual({ filters: { brand: null, status: null }, before: null, ignored: [] });
    expect(parseCampaignFilters({ brand: BRAND.toUpperCase(), status: "signedOff" })).toEqual({ filters: { brand: BRAND, status: "signedOff" }, before: null, ignored: [] });
    expect(parseCampaignFilters({ brand: "", status: "", before: "" })).toEqual({ filters: { brand: null, status: null }, before: null, ignored: [] });
    for (const s of CAMPAIGN_STATUS_FILTERS) expect(parseCampaignFilters({ status: s.id }).filters.status, s.id).toBe(s.id);
    for (const value of [...GARBAGE, "Draft", "Signed off", "signedoff", "approved", "awaiting_signoff"]) {
      const parsed = parseCampaignFilters({ brand: value, status: value });
      expect(parsed.filters, JSON.stringify(value)).toEqual({ brand: null, status: null });
      expect(parsed.ignored, JSON.stringify(value)).toEqual(["brand", "status"]);
    }
    expect(parseCampaignFilters({ status: ["live", "draft"] }).filters.status).toBe("live");
  });

  it("a bad cursor is dropped quietly, and the first page shows", () => {
    // Review fix: the cursor is a position, `<updated_at in microseconds>_<campaign id>`; a bare id is not one.
    expect(parseCampaignFilters({ before: CURSOR }).before).toBe(CURSOR);
    expect(parseCampaignFilters({ before: CURSOR.toUpperCase() }).before).toBe(CURSOR);
    for (const value of [...GARBAGE, "20", "2", CAMPAIGN, `_${CAMPAIGN}`, `1.5_${CAMPAIGN}`, `-1_${CAMPAIGN}`, `1_${CAMPAIGN}_1`]) expect(parseCampaignFilters({ before: value }), JSON.stringify(value)).toEqual({ filters: { brand: null, status: null }, before: null, ignored: [] });
  });

  it("the address: /campaigns, then brand, status and before, in that order, and it round-trips", () => {
    expect(campaignsHref({})).toBe("/campaigns");
    expect(campaignsHref({ brand: null, status: null }, null)).toBe("/campaigns");
    expect(campaignsHref({ status: "waiting" })).toBe("/campaigns?status=waiting");
    expect(campaignsHref({ status: "live", brand: BRAND }, CURSOR)).toBe(`/campaigns?brand=${BRAND}&status=live&before=${CURSOR}`);
    const url = new URL(campaignsHref({ brand: BRAND, status: "launchWaiting" }, CURSOR), "http://studio.test");
    expect(parseCampaignFilters(Object.fromEntries(url.searchParams))).toEqual({ filters: { brand: BRAND, status: "launchWaiting" }, before: CURSOR, ignored: [] });
  });

  it("the plain note, in the runs list's words", () => {
    expect(campaignFilterNote([])).toBeNull();
    expect(campaignFilterNote(["brand"])).toBe("Filter not recognised, so not applied: brand.");
    expect(campaignFilterNote(["brand", "status"])).toBe("Filters not recognised, so not applied: brand and status.");
  });
});
