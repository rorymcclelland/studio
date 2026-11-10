// U10-5 Home leads with work, as pure code: what home's "Needs you" lists and
// in what order, each item's words and where it links (src/lib/home/needs.ts),
// the live campaigns' share line, a run's campaign name, and (answer B1) the
// one line a sign-off card in the inbox gives for its personas and test plan
// (src/lib/approvals/inbox-view.ts), with the order the inbox and home list
// what waits (Rory's decision, 9 November 2026). No database, no model. The loader that
// reads these facts, and refuses another workspace's (rule 7), is
// tests/flows/home-work.test.ts; the pages are tests/e2e/home-work.spec.ts,
// whose header holds the interface.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasApprove, inboxOrder, REVIEWS_SUMMARY_LABEL, reviewsSummary, RUN_CHOICES_HEADING } from "@/lib/approvals/inbox-view";
import { NOTHING_NEEDS_YOU as OVERVIEW_NOTHING } from "@/lib/campaigns/stages";
import {
  campaignName,
  HOME_TITLE,
  homeNeeds,
  LIVE_HEADING,
  liveShareLine,
  NO_CAMPAIGN,
  NOTHING_NEEDS_YOU,
  type CampaignAlerts,
  type HomeApproval,
} from "@/lib/home/needs";

const C1 = { id: "c1111111-1111-4111-8111-111111111111", name: "Autumn walkers come back" };
const C2 = { id: "c2222222-2222-4222-8222-222222222222", name: "Winter range for lapsed customers" };
const C3 = { id: "c3333333-3333-4333-8333-333333333333", name: "Spring repairs" };
const A1 = "a1111111-1111-4111-8111-111111111111";
const A2 = "a2222222-2222-4222-8222-222222222222";
const A3 = "a3333333-3333-4333-8333-333333333333";
const RUN = "r1111111-1111-4111-8111-111111111111";

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 10, 9, 12, 0) - minutesAgo * 60_000);

// In the inbox's order (inboxOrder): the launch and the sign-off, newest first, then the run's choice.
const APPROVALS: HomeApproval[] = [
  { kind: "launch", approvalId: A2, campaign: C2 },
  { kind: "brief_signoff", approvalId: A1, campaign: C1, version: 2 },
  { kind: "run_choice", approvalId: A3, runId: RUN, runLabel: "Larkspur Mill", question: "Which tagline should we use?" },
];

describe("U10-5 #1 what needs you on home: the approvals in the inbox's order, then unseen alerts per campaign, newest first", () => {
  it("lists every approval as given, then one item per campaign with unseen alerts, by its newest alert", () => {
    const alerts: CampaignAlerts[] = [
      { campaign: C1, unseen: 3, newestAt: at(10) },
      { campaign: C3, unseen: 1, newestAt: at(5) },
    ];
    expect(homeNeeds(APPROVALS, alerts).map((n) => n.key)).toEqual([`approve-launch:${A2}`, `decide-signoff:${A1}`, `run-choice:${A3}`, `alerts:${C3.id}`, `alerts:${C1.id}`]);
  });

  it("a campaign with no unseen alerts has no item, and two with the same newest alert go by campaign id", () => {
    const alerts: CampaignAlerts[] = [
      { campaign: C2, unseen: 2, newestAt: at(5) },
      { campaign: C1, unseen: 2, newestAt: at(5) },
      { campaign: C3, unseen: 0, newestAt: at(1) },
    ];
    expect(homeNeeds([], alerts).map((n) => n.key)).toEqual([`alerts:${C1.id}`, `alerts:${C2.id}`]);
  });

  it("doesn't change what it is given", () => {
    const alerts: CampaignAlerts[] = [
      { campaign: C1, unseen: 1, newestAt: at(10) },
      { campaign: C2, unseen: 1, newestAt: at(5) },
    ];
    const before = JSON.stringify([APPROVALS, alerts]);
    homeNeeds(APPROVALS, alerts);
    expect(JSON.stringify([APPROVALS, alerts])).toBe(before);
  });
});

describe("#1 each item's words and where it links", () => {
  it("a sign-off goes to the campaign's Brief stage, where Approve is; a launch to its card in the inbox; a run's choice to the run", () => {
    expect(homeNeeds(APPROVALS, [])).toEqual([
      { key: `approve-launch:${A2}`, kind: "approve-launch", text: `Approve or refuse the launch (simulated): ${C2.name}`, href: `/approvals#approval-${A2}`, campaignId: C2.id },
      { key: `decide-signoff:${A1}`, kind: "decide-signoff", text: `Decide the sign-off of version 2: ${C1.name}`, href: `/campaigns/${C1.id}/brief`, campaignId: C1.id },
      { key: `run-choice:${A3}`, kind: "run-choice", text: "Choose on the run: Larkspur Mill", href: `/runs/${RUN}`, campaignId: null },
    ]);
  });

  it("a run's choice with no label (or a blank one) names its question", () => {
    for (const runLabel of [null, "", "   "]) {
      const [n] = homeNeeds([{ kind: "run_choice", approvalId: A3, runId: RUN, runLabel, question: "Which tagline should we use?" }], []);
      expect(n.text, JSON.stringify(runLabel)).toBe("Choose on the run: Which tagline should we use?");
    }
  });

  it("an alerts item counts its campaign's unseen alerts, with the simulated label (rule 1)", () => {
    const [three, one] = homeNeeds([], [
      { campaign: C1, unseen: 3, newestAt: at(5) },
      { campaign: C2, unseen: 1, newestAt: at(10) },
    ]);
    expect(three).toEqual({ key: `alerts:${C1.id}`, kind: "alerts", text: `3 unseen alerts (simulated): ${C1.name}`, href: `/campaigns/${C1.id}/performance`, campaignId: C1.id });
    expect(one.text).toBe(`1 unseen alert (simulated): ${C2.name}`);
  });

  it("names are shown as they are: a name with markup or quotes is kept as text, for the page to escape", () => {
    const odd = { id: C1.id, name: `<b>"Bold"</b> & co` };
    expect(homeNeeds([{ kind: "brief_signoff", approvalId: A1, campaign: odd, version: 1 }], [])[0].text).toBe(`Decide the sign-off of version 1: ${odd.name}`);
  });
});

describe("U10-5 #2 nothing waiting: an empty list, and the words home shows instead", () => {
  it("no approvals and no unseen alerts is an empty list", () => {
    expect(homeNeeds([], [])).toEqual([]);
    expect(homeNeeds([], [{ campaign: C1, unseen: 0, newestAt: at(1) }])).toEqual([]);
  });

  it("home says what the overview says, and its title and live heading are the agreed words", () => {
    expect(NOTHING_NEEDS_YOU).toBe("Nothing needs you right now.");
    expect(NOTHING_NEEDS_YOU).toBe(OVERVIEW_NOTHING);
    expect(HOME_TITLE).toBe("Home");
    expect(LIVE_HEADING).toBe("Live campaigns");
  });
});

describe("U10-5 #3 an alerts item links to its campaign's Performance page, never the campaigns list", () => {
  it("every alerts item goes to /campaigns/<its id>/performance", () => {
    const alerts = [C1, C2, C3].map((campaign, i): CampaignAlerts => ({ campaign, unseen: i + 1, newestAt: at(i) }));
    for (const n of homeNeeds([], alerts)) {
      expect(n.kind).toBe("alerts");
      expect(n.href).toBe(`/campaigns/${n.campaignId}/performance`);
      expect(n.href).not.toBe("/campaigns");
    }
  });
});

describe("U10-5 #4 a run's campaign, or No campaign", () => {
  it("a campaign is named by its brief's title, else its objective, as the campaigns list names it", () => {
    expect(campaignName({ title: "Long way round", objective: "Bring walkers back for autumn" })).toBe("Long way round");
    expect(campaignName({ title: "  Long way round  ", objective: "Bring walkers back for autumn" })).toBe("Long way round");
    expect(campaignName({ title: null, objective: "Bring walkers back for autumn" })).toBe("Bring walkers back for autumn");
    expect(campaignName({ title: "   ", objective: "Bring walkers back for autumn" })).toBe("Bring walkers back for autumn");
  });

  it("a run with no campaign says so, in the words U10-8's runs list uses too", () => {
    expect(NO_CAMPAIGN).toBe("No campaign");
  });
});

describe("U10-5 live campaigns: each with its own share, labelled simulated (rule 1)", () => {
  it("the share line uses the Performance page's words for the share", () => {
    expect(liveShareLine(0.84)).toBe("Healthy spend share: 84% (simulated)");
    expect(liveShareLine(1)).toBe("Healthy spend share: 100% (simulated)");
    expect(liveShareLine(0)).toBe("Healthy spend share: 0% (simulated)");
    expect(liveShareLine(null)).toBe("Healthy spend share: Not enough data yet (simulated)");
  });
});

describe("U10-5 #5 the sign-off card's one line for its personas and test plan", () => {
  it("says how many synthetic personas there are and whether there is a test plan", () => {
    expect(reviewsSummary({ personas: 3, plan: true, preparing: false })).toBe("3 synthetic personas and a test plan");
    expect(reviewsSummary({ personas: 1, plan: true, preparing: false })).toBe("1 synthetic persona and a test plan");
    expect(reviewsSummary({ personas: 4, plan: false, preparing: false })).toBe("4 synthetic personas; no test plan");
    expect(reviewsSummary({ personas: 0, plan: true, preparing: false })).toBe("A test plan; no persona review");
    expect(reviewsSummary({ personas: 0, plan: false, preparing: false })).toBe("No persona review or test plan");
  });

  it("while either is being written it says so, whatever is already there", () => {
    for (const personas of [0, 3]) for (const plan of [false, true]) expect(reviewsSummary({ personas, plan, preparing: true })).toBe("Being prepared");
  });

  it("the summary's label", () => {
    expect(REVIEWS_SUMMARY_LABEL).toBe("Personas and test plan");
  });
});

describe("U10-5 #7 the inbox's order: what has an Approve button first, newest first, then the run choices, newest first", () => {
  type Item = { kind: "brief_signoff" | "launch" | "run_choice"; id: string; createdAt: Date };
  const item = (kind: Item["kind"], id: string, minutesAgo: number): Item => ({ kind, id, createdAt: at(minutesAgo) });

  it("run choices newer than every sign-off and launch still come after them (Rory's decision, 9 November 2026)", () => {
    const items = [
      item("run_choice", "r1", 1),
      item("run_choice", "r2", 2),
      item("launch", "l1", 20),
      item("run_choice", "r3", 25),
      item("brief_signoff", "s1", 30),
      item("brief_signoff", "s2", 10),
    ];
    expect(inboxOrder(items).map((i) => i.id)).toEqual(["s2", "l1", "s1", "r1", "r2", "r3"]);
  });

  it("only sign-offs and launches have an Approve button", () => {
    expect(["brief_signoff", "launch", "run_choice", "anything"].map(hasApprove)).toEqual([true, true, false, false]);
  });

  it("two asked for at the same moment go by id, so the order holds between reads", () => {
    const items = [item("run_choice", "rb", 5), item("launch", "lb", 5), item("run_choice", "ra", 5), item("brief_signoff", "la", 5)];
    expect(inboxOrder(items).map((i) => i.id)).toEqual(["la", "lb", "ra", "rb"]);
    expect(inboxOrder([...items].reverse()).map((i) => i.id)).toEqual(["la", "lb", "ra", "rb"]);
  });

  it("only one group, or none, keeps newest first; it returns a new array and leaves what it is given as it was", () => {
    const choices = [item("run_choice", "r1", 9), item("run_choice", "r2", 3)];
    expect(inboxOrder(choices).map((i) => i.id)).toEqual(["r2", "r1"]);
    expect(inboxOrder([])).toEqual([]);
    const before = JSON.stringify(choices);
    expect(inboxOrder(choices)).not.toBe(choices);
    expect(JSON.stringify(choices)).toBe(before);
  });

  it("keeps the rest of each item, and the run choices' heading is the agreed words", () => {
    const [first] = inboxOrder([{ ...item("launch", "l1", 1), question: "Launch (simulated)" }]);
    expect(first.question).toBe("Launch (simulated)");
    expect(RUN_CHOICES_HEADING).toBe("Runs waiting for your choice");
  });
});

describe("U10-5 the pure modules stay pure", () => {
  it("needs.ts imports only the stage and health modules and types; inbox-view.ts imports nothing but types", () => {
    const imports = (p: string) =>
      [...readFileSync(join(process.cwd(), p), "utf8").matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm)].filter((m) => !m[1]).map((m) => m[2]);
    expect(imports("src/lib/home/needs.ts").every((m) => ["@/lib/campaigns/stages", "@/lib/performance/health"].includes(m))).toBe(true);
    expect(imports("src/lib/approvals/inbox-view.ts")).toEqual([]);
  });
});
