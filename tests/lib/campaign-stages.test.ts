// U10-2 The campaign in stages, opening on what needs you: the pure part. Each
// stage's state in the stage bar, the locked stages' reasons, the "Needs you"
// list, old links' fragments and the below-threshold line, worked out from a
// campaign's facts by pure functions, so CI can check every combination. The
// interface is written at the top of tests/e2e/campaign-stages.spec.ts; the
// words are pinned here. The loader that reads the facts is
// tests/flows/campaign-stages.test.ts; the pages are the browser tests.
//
// src/lib/campaigns/stages.ts is pure (no server imports): it imports only
// ./status (U10-1's campaignStatusLabel and liveLabel), which it reuses for the
// brief's words and a live launch's label, so the lists, the overview and the
// stage bar say the same thing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NeedsYou } from "@/app/(app)/campaigns/[id]/needs-you";
import { StageBar } from "@/app/(app)/campaigns/[id]/stage-bar";
import {
  belowThresholdLine,
  campaignStages,
  needsYou,
  NOTHING_NEEDS_YOU,
  STAGES,
  stageForHash,
  stageHref,
  type CampaignFacts,
  type NeedView,
  type StageId,
  type StageView,
} from "@/lib/campaigns/stages";
import { campaignStatusLabel } from "@/lib/campaigns/status";

const ID = "11111111-1111-4111-8111-111111111111";
const at = (stage: StageId) => `/campaigns/${ID}/${stage}`;

/** A campaign signed off at version 1 with nothing made yet; `over` changes any fact. */
function facts(over: Partial<CampaignFacts> = {}): CampaignFacts {
  return {
    campaignId: ID,
    status: "approved",
    currentVersion: 1,
    approvedVersion: 1,
    briefRun: "completed",
    signoffOpen: null,
    versions: 1,
    audience: { personas: 0, testPlan: false, running: false },
    creative: { ads: 0, picked: 0, running: false, discarded: 0, runs: 0, costPence: 0 },
    toDecide: 0,
    launchable: 0,
    launches: [],
    performance: null,
    ...over,
  };
}

const launch = (status: string, simDay = 0, days = 30) => ({ status, simDay, days });
const writing = (briefRun: string | null = "running") => facts({ status: "drafting", currentVersion: 0, approvedVersion: null, briefRun, versions: 0 });
const draft = (over: Partial<CampaignFacts> = {}) => facts({ status: "draft", approvedVersion: null, ...over });
const waiting = (over: Partial<CampaignFacts> = {}) => facts({ status: "awaiting_signoff", approvedVersion: null, signoffOpen: 1, ...over });
const withAds = (over: Partial<CampaignFacts> = {}) => facts({ creative: { ads: 12, picked: 4, running: false, discarded: 0, runs: 1, costPence: 120 }, ...over });
const live = (simDay = 14, over: Partial<CampaignFacts> = {}) =>
  withAds({ launches: [launch("live", simDay)], performance: { unseenAlerts: 5, belowThreshold: [3] }, ...over });

const stage = (f: CampaignFacts, id: StageId): StageView => campaignStages(f).find((s) => s.id === id)!;
const labels = (f: CampaignFacts) => Object.fromEntries(campaignStages(f).map((s) => [s.id, s.label]));
const lockedIds = (f: CampaignFacts) => campaignStages(f).filter((s) => s.locked).map((s) => s.id);
const needIds = (f: CampaignFacts) => needsYou(f).map((n) => n.id);
const need = (f: CampaignFacts, id: NeedView["id"]) => needsYou(f).find((n) => n.id === id);

describe("U10-2 #4 the stage bar's stages and their states", () => {
  it("five stages in the refinement's order, each with its own address", () => {
    expect(STAGES).toEqual([
      { id: "brief", name: "Brief" },
      { id: "audience", name: "Audience" },
      { id: "creative", name: "Creative" },
      { id: "launch", name: "Launch" },
      { id: "performance", name: "Performance" },
    ]);
    for (const s of STAGES) expect(stageHref(ID, s.id)).toBe(at(s.id));
    const out = campaignStages(facts());
    expect(out.map((s) => [s.id, s.name, s.href])).toEqual(STAGES.map((s) => [s.id, s.name, at(s.id)]));
  });

  it("the brief: Writing the brief, Not written, Draft, Waiting for sign-off, Signed off (U10-1's words)", () => {
    for (const run of ["queued", "running", "completed"]) expect(stage(writing(run), "brief").label, run).toBe("Writing the brief");
    // The Brief agent didn't start, or stopped: the page offers Try again.
    for (const run of [null, "failed", "stopped_cap", "cancelled"]) expect(stage(writing(run), "brief").label, String(run)).toBe("Not written");
    expect(stage(draft(), "brief").label).toBe("Draft");
    expect(stage(waiting(), "brief").label).toBe("Waiting for sign-off");
    expect(stage(facts(), "brief").label).toBe("Signed off");
    // Edited after sign-off: a draft again, whatever was launched.
    expect(stage(draft({ approvedVersion: 1, currentVersion: 2, launches: [launch("live", 6)] }), "brief").label).toBe("Draft");
    // The brief is never locked.
    for (const f of [writing(), writing(null), draft(), waiting(), facts(), live()]) expect(stage(f, "brief").locked).toBeNull();
  });

  it("the audience: locked until the brief is written; then Being written, Not run yet, or what there is", () => {
    expect(stage(writing(), "audience")).toMatchObject({
      label: "After the brief",
      locked: { reason: "Personas and the test plan come once the brief is written.", href: at("brief"), link: "Go to the brief" },
    });
    expect(stage(draft(), "audience")).toMatchObject({ label: "Not run yet", locked: null });
    expect(stage(waiting({ audience: { personas: 0, testPlan: false, running: true } }), "audience").label).toBe("Being written");
    expect(stage(waiting({ audience: { personas: 5, testPlan: true, running: false } }), "audience").label).toBe("5 personas, test plan");
    expect(stage(waiting({ audience: { personas: 1, testPlan: false, running: false } }), "audience").label).toBe("1 persona");
    expect(stage(waiting({ audience: { personas: 0, testPlan: true, running: false } }), "audience").label).toBe("Test plan");
    // A run in progress wins: what is shown is about to change.
    expect(stage(waiting({ audience: { personas: 5, testPlan: true, running: true } }), "audience").label).toBe("Being written");
  });

  it("creative: locked before sign-off, with the reason and a link to the sign-off; then Making ads, No ads yet, or the count", () => {
    for (const f of [writing(), draft(), waiting(), draft({ approvedVersion: 1, currentVersion: 2 })]) {
      expect(stage(f, "creative"), f.status).toMatchObject({
        label: "After sign-off",
        locked: { reason: "Creative is made only from a signed-off brief.", href: at("brief"), link: "Sign off the brief" },
      });
    }
    expect(stage(facts(), "creative")).toMatchObject({ label: "No ads yet", locked: null });
    expect(stage(facts({ creative: { ads: 0, picked: 0, running: true, discarded: 0, runs: 1, costPence: 0 } }), "creative").label).toBe("Making ads");
    expect(stage(withAds(), "creative").label).toBe("12 ads, 4 picked");
    expect(stage(facts({ creative: { ads: 1, picked: 0, running: false, discarded: 0, runs: 1, costPence: 9 } }), "creative").label).toBe("1 ad, 0 picked");
    expect(stage(facts({ creative: { ads: 24, picked: 1, running: false, discarded: 3, runs: 2, costPence: 9 } }), "creative").label).toBe("24 ads, 1 picked");
  });

  it("launch: live (U10-1's label), Waiting for approval, Ended, the ads ready, Refused; locked with no ads ready", () => {
    expect(stage(live(14), "launch")).toMatchObject({ label: "Live (simulated day 14)", locked: null });
    expect(stage(live(0), "launch").label).toBe("Live (simulated, before day 1)");
    expect(stage(withAds({ launches: [launch("awaiting_approval")] }), "launch").label).toBe("Waiting for approval");
    expect(stage(withAds({ launches: [launch("ended", 30)] }), "launch").label).toBe("Ended");
    expect(stage(withAds({ launchable: 4 }), "launch")).toMatchObject({ label: "4 ads ready", locked: null });
    expect(stage(withAds({ launchable: 1 }), "launch").label).toBe("1 ad ready");
    // A refused launch keeps the stage open (its reason is on it); with ads ready again, those win.
    expect(stage(withAds({ launches: [launch("refused")] }), "launch")).toMatchObject({ label: "Refused", locked: null });
    expect(stage(withAds({ launches: [launch("refused")], launchable: 2 }), "launch").label).toBe("2 ads ready");
    // Precedence as U10-1's: live, then waiting, then ended, whatever order the launches come in.
    expect(stage(withAds({ launches: [launch("ended", 30), launch("awaiting_approval")] }), "launch").label).toBe("Waiting for approval");
    expect(stage(withAds({ launches: [launch("awaiting_approval"), launch("ended", 30), launch("live", 3)] }), "launch").label).toBe("Live (simulated day 3)");
    expect(stage(withAds({ launches: [launch("ended", 30)], launchable: 4 }), "launch").label).toBe("Ended");
  });

  it("launch is locked before sign-off, and when no picked ad passes; the link goes to what unlocks it", () => {
    for (const f of [writing(), draft(), waiting()]) {
      expect(stage(f, "launch"), f.status).toMatchObject({
        label: "No ads ready",
        locked: { reason: "A launch needs a signed-off brief and picked ads that pass compliance.", href: at("brief"), link: "Sign off the brief" },
      });
    }
    expect(stage(withAds({ launchable: 0, toDecide: 0 }), "launch")).toMatchObject({
      label: "No ads ready",
      locked: { reason: "A launch needs picked ads that pass compliance or were accepted.", href: at("creative"), link: "Pick ads in Creative" },
    });
    // With compliance decisions waiting, the link opens the gallery on them (U10-3's filter).
    expect(stage(withAds({ launchable: 0, toDecide: 3 }), "launch").locked).toEqual({
      reason: "A launch needs picked ads that pass compliance or were accepted.",
      href: `${at("creative")}?show=decide`,
      link: "Decide compliance",
    });
    // Ads ready but the brief edited since sign-off: not signed off, so still locked.
    expect(stage(draft({ approvedVersion: 1, currentVersion: 2, launchable: 4 }), "launch").locked).not.toBeNull();
  });

  it("performance: locked until a launch is live or ended; then the unseen alerts", () => {
    for (const f of [writing(), draft(), waiting(), facts(), withAds({ launchable: 4 }), withAds({ launches: [launch("awaiting_approval")] }), withAds({ launches: [launch("refused")] })]) {
      expect(stage(f, "performance")).toMatchObject({
        label: "After launch",
        locked: { reason: "Performance shows once a launch is live (simulated).", href: at("launch"), link: "Go to Launch" },
      });
    }
    expect(stage(live(14), "performance")).toMatchObject({ label: "5 new alerts", locked: null });
    expect(stage(live(14, { performance: { unseenAlerts: 1, belowThreshold: [] } }), "performance").label).toBe("1 new alert");
    expect(stage(live(14, { performance: { unseenAlerts: 0, belowThreshold: [] } }), "performance").label).toBe("No new alerts");
    expect(stage(withAds({ launches: [launch("ended", 30)], performance: { unseenAlerts: 0, belowThreshold: [] } }), "performance")).toMatchObject({ label: "No new alerts", locked: null });
  });

  it("a campaign in each state, from writing to ended: the whole bar, and which stages are locked", () => {
    const rows: [string, CampaignFacts, Record<StageId, string>, StageId[]][] = [
      ["writing", writing(), { brief: "Writing the brief", audience: "After the brief", creative: "After sign-off", launch: "No ads ready", performance: "After launch" }, ["audience", "creative", "launch", "performance"]],
      ["draft", draft(), { brief: "Draft", audience: "Not run yet", creative: "After sign-off", launch: "No ads ready", performance: "After launch" }, ["creative", "launch", "performance"]],
      [
        "waiting",
        waiting({ audience: { personas: 5, testPlan: true, running: false } }),
        { brief: "Waiting for sign-off", audience: "5 personas, test plan", creative: "After sign-off", launch: "No ads ready", performance: "After launch" },
        ["creative", "launch", "performance"],
      ],
      ["signed off", facts(), { brief: "Signed off", audience: "Not run yet", creative: "No ads yet", launch: "No ads ready", performance: "After launch" }, ["launch", "performance"]],
      ["ads picked, none passing", withAds({ toDecide: 4 }), { brief: "Signed off", audience: "Not run yet", creative: "12 ads, 4 picked", launch: "No ads ready", performance: "After launch" }, ["launch", "performance"]],
      ["ads ready", withAds({ launchable: 4 }), { brief: "Signed off", audience: "Not run yet", creative: "12 ads, 4 picked", launch: "4 ads ready", performance: "After launch" }, ["performance"]],
      ["launch waiting", withAds({ launches: [launch("awaiting_approval")] }), { brief: "Signed off", audience: "Not run yet", creative: "12 ads, 4 picked", launch: "Waiting for approval", performance: "After launch" }, ["performance"]],
      ["live, day 14", live(14), { brief: "Signed off", audience: "Not run yet", creative: "12 ads, 4 picked", launch: "Live (simulated day 14)", performance: "5 new alerts" }, []],
      [
        "ended",
        withAds({ launches: [launch("ended", 30)], performance: { unseenAlerts: 0, belowThreshold: [] } }),
        { brief: "Signed off", audience: "Not run yet", creative: "12 ads, 4 picked", launch: "Ended", performance: "No new alerts" },
        [],
      ],
    ];
    for (const [name, f, bar, locked] of rows) {
      expect(labels(f), name).toEqual(bar);
      expect(lockedIds(f), name).toEqual(locked);
    }
  });

  it("every combination: five stages in order, one short label each, locks exactly as the rules say, and never an error", () => {
    const statuses = ["drafting", "draft", "awaiting_signoff", "approved"];
    const versions = [0, 1, 3];
    const launchSets = [[], [launch("refused")], [launch("awaiting_approval")], [launch("live", 0)], [launch("live", 14)], [launch("live", 30)], [launch("ended", 30)], [launch("ended", 30), launch("awaiting_approval")]];
    const creatives = [
      { ads: 0, picked: 0, running: false, discarded: 0, runs: 0, costPence: 0 },
      { ads: 0, picked: 0, running: true, discarded: 0, runs: 1, costPence: 0 },
      { ads: 24, picked: 4, running: false, discarded: 2, runs: 3, costPence: 300 },
    ];
    const audiences = [{ personas: 0, testPlan: false, running: false }, { personas: 12, testPlan: true, running: false }, { personas: 5, testPlan: false, running: true }];
    let n = 0;
    for (const status of statuses)
      for (const v of versions)
        for (const launches of launchSets)
          for (const creative of creatives)
            for (const audience of audiences)
              for (const [toDecide, launchable] of [[0, 0], [3, 0], [0, 4]])
                for (const signoffOpen of [null, v || null]) {
                  const signedOff = status === "approved" && v > 0;
                  const known = launches.filter((l) => ["awaiting_approval", "live", "ended", "refused"].includes(l.status));
                  const shown = known.some((l) => l.status === "live" || l.status === "ended");
                  const f = facts({
                    status,
                    currentVersion: v,
                    approvedVersion: signedOff ? v : null,
                    briefRun: v === 0 ? "running" : "completed",
                    signoffOpen,
                    creative,
                    audience,
                    toDecide,
                    launchable,
                    launches,
                    performance: shown ? { unseenAlerts: 99, belowThreshold: [1, 2] } : null,
                  });
                  const what = JSON.stringify({ status, v, launches, creative, audience, toDecide, launchable, signoffOpen });
                  const out = campaignStages(f);
                  expect(out.map((s) => s.id), what).toEqual(["brief", "audience", "creative", "launch", "performance"]);
                  for (const s of out) {
                    expect(s.label.length, `${what}: ${s.id}`).toBeGreaterThan(0);
                    // The longest label is "Live (simulated, before day 1)": the bar is measured with it (case 9).
                    expect(s.label.length, `${what}: ${s.id} "${s.label}"`).toBeLessThanOrEqual(30);
                    if (s.locked) {
                      expect(s.locked.reason, what).toMatch(/^[A-Z].*\.$/);
                      expect(s.locked.href, what).toMatch(new RegExp(`^/campaigns/${ID}/(brief|creative|launch)(\\?show=decide)?$`));
                    }
                  }
                  const isLocked = (id: StageId) => !!out.find((s) => s.id === id)!.locked;
                  const writingBrief = status === "drafting" || v === 0;
                  expect(isLocked("brief"), what).toBe(false);
                  expect(isLocked("audience"), what).toBe(writingBrief);
                  expect(isLocked("creative"), what).toBe(!signedOff);
                  expect(isLocked("launch"), what).toBe(known.length === 0 && !(signedOff && launchable > 0));
                  expect(isLocked("performance"), what).toBe(!shown);
                  n++;
                }
    expect(n).toBe(4 * 3 * 8 * 3 * 3 * 3 * 2);
  });
});

describe("U10-2 #2 and #3 what needs you", () => {
  it("send for sign-off: a draft with a version and no open sign-off, linking to the brief stage", () => {
    expect(needsYou(draft())).toEqual([{ id: "send-signoff", text: "Send version 1 for sign-off", href: at("brief") }]);
    expect(need(draft({ currentVersion: 3 }), "send-signoff")?.text).toBe("Send version 3 for sign-off");
    // Sent: it goes, and the decision takes its place.
    expect(needIds(waiting())).toEqual(["decide-signoff"]);
    // Nothing to send while the brief is being written, or once signed off.
    expect(needIds(writing())).toEqual([]);
    expect(needIds(facts())).toEqual([]);
  });

  it("decide a sign-off: an open sign-off, linking to the brief stage (where Approve is; rule 3: the overview only links)", () => {
    expect(needsYou(waiting())).toEqual([{ id: "decide-signoff", text: "Decide the sign-off of version 1", href: at("brief") }]);
    expect(need(waiting({ currentVersion: 2, signoffOpen: 2 }), "decide-signoff")?.text).toBe("Decide the sign-off of version 2");
    // Decided (approved, or refused back to a draft): it goes.
    expect(need(facts({ signoffOpen: null }), "decide-signoff")).toBeUndefined();
    expect(needIds(draft({ signoffOpen: null }))).toEqual(["send-signoff"]);
  });

  it("compliance decisions: picked ads waiting for a person, linking to the gallery filtered to them", () => {
    expect(needsYou(withAds({ toDecide: 3 }))).toEqual([{ id: "compliance", text: "Decide compliance for 3 picked ads", href: `${at("creative")}?show=decide` }]);
    expect(need(withAds({ toDecide: 1 }), "compliance")?.text).toBe("Decide compliance for 1 picked ad");
    expect(need(withAds({ toDecide: 0, launchable: 4 }), "compliance")).toBeUndefined();
    // Not signed off: creative is locked, so nothing there is asked of anyone.
    expect(need(draft({ approvedVersion: 1, currentVersion: 2, toDecide: 3 }), "compliance")).toBeUndefined();
  });

  it("a launch waiting for approval: links to the approvals inbox, where it is decided (rule 3)", () => {
    expect(needsYou(withAds({ launches: [launch("awaiting_approval")] }))).toEqual([{ id: "approve-launch", text: "Approve or refuse the launch (simulated)", href: "/approvals" }]);
    for (const status of ["live", "ended", "refused"]) expect(need(withAds({ launches: [launch(status, 3)] }), "approve-launch"), status).toBeUndefined();
  });

  it("unseen alerts on a live launch: linking to Performance, labelled simulated; marking them seen removes the item", () => {
    expect(need(live(14), "alerts")).toEqual({ id: "alerts", text: "5 unseen alerts (simulated)", href: at("performance") });
    expect(need(live(14, { performance: { unseenAlerts: 1, belowThreshold: [] } }), "alerts")?.text).toBe("1 unseen alert (simulated)");
    expect(need(live(14, { performance: { unseenAlerts: 0, belowThreshold: [3] } }), "alerts")).toBeUndefined();
    // An ended launch's alerts are history, not work (as home counts live launches only).
    expect(need(withAds({ launches: [launch("ended", 30)], performance: { unseenAlerts: 4, belowThreshold: [] } }), "alerts")).toBeUndefined();
  });

  it("a clock to move: a live launch before its last day, linking to the Launch stage", () => {
    expect(need(live(14), "clock")).toEqual({ id: "clock", text: "Move the simulated clock on from day 14 of 30", href: at("launch") });
    expect(need(live(0), "clock")?.text).toBe("Run the first simulated day of 30");
    expect(need(live(29), "clock")?.text).toBe("Move the simulated clock on from day 29 of 30");
    // On its last day there is nothing left to move.
    expect(need(live(30), "clock")).toBeUndefined();
    expect(need(withAds({ launches: [launch("ended", 12)] }), "clock")).toBeUndefined();
  });

  it("in the refinement's order: sign-off, compliance, launch approval, alerts, clock", () => {
    // A brief edited after sign-off while a launch runs, with a new launch asked for too: every kind at once
    // except the ones that can't be together (a sign-off is either to send or to decide).
    const busy = facts({
      status: "awaiting_signoff",
      approvedVersion: 1,
      currentVersion: 2,
      signoffOpen: 2,
      launches: [launch("live", 9), launch("awaiting_approval")],
      performance: { unseenAlerts: 2, belowThreshold: [1] },
    });
    expect(needIds(busy)).toEqual(["decide-signoff", "approve-launch", "alerts", "clock"]);
    const signedOffBusy = live(14, { toDecide: 2, launches: [launch("live", 14), launch("awaiting_approval")] });
    expect(needIds(signedOffBusy)).toEqual(["compliance", "approve-launch", "alerts", "clock"]);
    expect(needIds(draft({ approvedVersion: 1, currentVersion: 2, launches: [launch("live", 5)], performance: { unseenAlerts: 1, belowThreshold: [] } }))).toEqual(["send-signoff", "alerts", "clock"]);
  });

  it("#3 nothing to do: an empty list, and the words the overview shows instead", () => {
    expect(NOTHING_NEEDS_YOU).toBe("Nothing needs you right now.");
    for (const f of [
      writing(),
      writing(null),
      facts(),
      withAds(),
      withAds({ launchable: 4 }),
      live(30, { performance: { unseenAlerts: 0, belowThreshold: [] } }),
      withAds({ launches: [launch("ended", 30)], performance: { unseenAlerts: 0, belowThreshold: [] } }),
      withAds({ launches: [launch("refused")] }),
    ]) {
      expect(needsYou(f), JSON.stringify(f.launches)).toEqual([]);
    }
  });

  it("every need appears with its fact and goes without it, alone", () => {
    const cases: [NeedView["id"], CampaignFacts, CampaignFacts][] = [
      ["send-signoff", draft(), facts()],
      ["decide-signoff", waiting(), facts()],
      ["compliance", withAds({ toDecide: 2 }), withAds({ toDecide: 0 })],
      ["approve-launch", withAds({ launches: [launch("awaiting_approval")] }), withAds({ launches: [launch("refused")] })],
      ["alerts", live(30), live(30, { performance: { unseenAlerts: 0, belowThreshold: [3] } })],
      ["clock", live(14, { performance: { unseenAlerts: 0, belowThreshold: [] } }), live(30, { performance: { unseenAlerts: 0, belowThreshold: [] } })],
    ];
    for (const [id, present, gone] of cases) {
      expect(needIds(present), id).toEqual([id]);
      expect(needIds(gone), id).toEqual([]);
    }
  });
});

describe("U10-2 unknown inputs", () => {
  it("a campaign status the code doesn't know reads as a draft with nothing to send, and never throws", () => {
    for (const status of ["archived", "paused", "", "APPROVED"]) {
      const f = facts({ status, approvedVersion: null });
      expect(() => campaignStages(f), status).not.toThrow();
      expect(stage(f, "brief").label, status).toBe("Draft");
      expect(stage(f, "creative").locked, status).not.toBeNull();
      expect(needsYou(f), status).toEqual([]);
    }
  });

  it("a launch status the code doesn't know counts for nothing", () => {
    const f = withAds({ launches: [launch("paused", 5), launch("scheduled")] });
    expect(stage(f, "launch")).toMatchObject({ label: "No ads ready" });
    expect(stage(f, "launch").locked).not.toBeNull();
    expect(stage(f, "performance").locked).not.toBeNull();
    expect(needsYou(f)).toEqual([]);
    // Beside a known one, the known one decides.
    expect(stage(withAds({ launches: [launch("paused", 5), launch("live", 7)], performance: { unseenAlerts: 0, belowThreshold: [] } }), "launch").label).toBe("Live (simulated day 7)");
  });

  it("a live launch whose results aren't read yet (performance null) shows no alerts and no error", () => {
    const f = withAds({ launches: [launch("live", 3)], performance: null });
    expect(stage(f, "performance")).toMatchObject({ label: "No new alerts", locked: null });
    expect(needIds(f)).toEqual(["clock"]);
  });

  it("the overview's state is U10-1's list label, from the same facts", () => {
    expect(campaignStatusLabel(live(14))).toBe("Live (simulated day 14)");
    expect(campaignStatusLabel(waiting())).toBe("Waiting for sign-off");
    expect(campaignStatusLabel(writing())).toBe("Writing the brief");
  });

  it("the facts are only read", () => {
    const f = live(14, { launches: [launch("ended", 30), launch("live", 14), launch("awaiting_approval")], toDecide: 2 });
    const copy = structuredClone(f);
    campaignStages(f);
    needsYou(f);
    expect(f).toEqual(copy);
  });
});

describe("U10-2 #5 old links land on the right stage", () => {
  it("each section's old fragment names its stage; anything else stays on the overview", () => {
    const expected: Record<string, StageId> = {
      "#brief": "brief",
      "#signoff": "brief",
      "#history": "brief",
      "#personas": "audience",
      "#test-plan": "audience",
      "#creative": "creative",
      "#discarded": "creative",
      "#creative-runs": "creative",
      "#launch": "launch",
      "#performance": "performance",
    };
    for (const [hash, id] of Object.entries(expected)) {
      expect(stageForHash(hash), hash).toBe(id);
      // Without the #, too (location.hash has it; a stored href's fragment may not).
      expect(stageForHash(hash.slice(1)), hash).toBe(id);
    }
    for (const hash of ["", "#", "#nothing", "#creative-x", "#../creative", "#CREATIVE-RUNS-NOT"]) expect(stageForHash(hash), hash).toBeNull();
  });
});

describe("U10-2 #1 the below-threshold line", () => {
  it("names each ad below the threshold, labelled simulated; none gives no line", () => {
    expect(belowThresholdLine([])).toBeNull();
    expect(belowThresholdLine([3])).toBe("Ad 3 is below the threshold (simulated).");
    expect(belowThresholdLine([2, 5])).toBe("Ads 2 and 5 are below the threshold (simulated).");
    expect(belowThresholdLine([1, 2, 4])).toBe("Ads 1, 2 and 4 are below the threshold (simulated).");
  });
});

describe("U10-2 #10 the stage bar and the Needs you list as rendered", () => {
  const html = (f: CampaignFacts, current: StageId | null) => renderToStaticMarkup(createElement(StageBar, { stages: campaignStages(f), current }));

  it("a nav named Campaign stages, with each stage a link holding its name and state, in order", () => {
    const out = html(live(14), null);
    expect(out).toMatch(/^<nav[^>]*aria-label="Campaign stages"/);
    expect(out).toContain("data-stage-bar");
    const links = [...out.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-stage="([a-z]+)"|<a [^>]*data-stage="([a-z]+)"[^>]*href="([^"]+)"/g)].map((m) => [m[2] ?? m[3], m[1] ?? m[4]]);
    expect(links).toEqual(STAGES.map((s) => [s.id, at(s.id)]));
    const states = [...out.matchAll(/data-stage-state="?"?[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(states).toEqual(["Signed off", "Not run yet", "12 ads, 4 picked", "Live (simulated day 14)", "5 new alerts"]);
    const names = [...out.matchAll(/data-stage-name="?"?[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(names).toEqual(["Brief", "Audience", "Creative", "Launch", "Performance"]);
    // On the overview no stage is current.
    expect(out).not.toContain("aria-current");
  });

  it("aria-current=page on the current stage only; locked stages are still links, marked data-stage-locked", () => {
    for (const s of STAGES) {
      const out = html(waiting(), s.id);
      expect(out.match(/aria-current="page"/g), s.id).toHaveLength(1);
      expect(out, s.id).toMatch(new RegExp(`<a [^>]*(aria-current="page"[^>]*data-stage="${s.id}"|data-stage="${s.id}"[^>]*aria-current="page")`));
    }
    const out = html(waiting(), "brief");
    const locked = [...out.matchAll(/<a [^>]*data-stage="([a-z]+)"[^>]*>/g)].filter((m) => m[0].includes("data-stage-locked")).map((m) => m[1]);
    expect(locked).toEqual(["creative", "launch", "performance"]);
  });

  it("Needs you: a section with its heading and one link per item, or the words for nothing", () => {
    const items = needsYou(live(14, { toDecide: 2 }));
    const out = renderToStaticMarkup(createElement(NeedsYou, { items }));
    expect(out).toContain("data-needs-you");
    expect(out).toMatch(/<h2[^>]*>Needs you<\/h2>/);
    const shown = [...out.matchAll(/<li[^>]*data-need="([a-z-]+)"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2].replace(/&amp;/g, "&"), m[3]]);
    expect(shown).toEqual(items.map((i) => [i.id, i.href, i.text]));
    expect(out).not.toContain(NOTHING_NEEDS_YOU);

    const empty = renderToStaticMarkup(createElement(NeedsYou, { items: [] }));
    expect(empty).toContain("data-needs-you");
    expect(empty).toMatch(/data-nothing-needs-you="?"?[^>]*>Nothing needs you right now\.</);
    expect(empty).not.toContain("<li");
  });
});
