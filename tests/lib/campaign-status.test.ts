// U10-1 #3 and #4 (BUG-13): the status a campaign shows in lists, worked out
// from its facts by a pure function, so /campaigns, the brand page and (in
// U10-2) the stage bar agree. The interface the builder provides is written at
// the top of tests/e2e/quick-fixes.spec.ts; the words are pinned here.
//
// The facts, as listCampaigns() reads them (tests/flows/campaign-status.test.ts):
// - campaigns.status: 'drafting' | 'draft' | 'awaiting_signoff' | 'approved',
//   or a value a later migration adds that this code doesn't know;
// - campaigns.current_version (0 before the first brief);
// - every launch of the campaign: its status ('awaiting_approval' | 'live' |
//   'ended' | 'refused', or a later one) and its simulated day (sim_day).
//
// Precedence, from the refinement's list: a live launch, then a launch waiting
// for approval, then an ended launch, then the brief's own state. A refused
// launch never ran and counts for nothing, nor does a launch status the code
// doesn't know. An unknown campaign status shows "Draft" (case 4).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignList } from "@/app/(app)/campaigns/campaign-list";
import { CAMPAIGN_STATUS_LABELS, campaignStatusLabel, liveLabel, type CampaignStatusFacts } from "@/lib/campaigns/status";
import type { CampaignSummary } from "@/lib/brief/repo";

const L = {
  writing: "Writing the brief",
  draft: "Draft",
  waiting: "Waiting for sign-off",
  signedOff: "Signed off",
  launchWaiting: "Launch waiting",
  ended: "Ended",
} as const;

const facts = (status: string, currentVersion: number, launches: CampaignStatusFacts["launches"] = []): CampaignStatusFacts => ({ status, currentVersion, launches });
const launch = (status: string, simDay = 0) => ({ status, simDay });

describe("U10-1 #3 the status a campaign shows in lists", () => {
  it("the words are the refinement's", () => {
    expect(CAMPAIGN_STATUS_LABELS).toEqual(L);
    expect(liveLabel(14)).toBe("Live (simulated day 14)");
    expect(liveLabel(1)).toBe("Live (simulated day 1)");
    // Live but before the clock has moved: no day has been simulated yet.
    expect(liveLabel(0)).toBe("Live (simulated, before day 1)");
  });

  it("one campaign per state: writing, draft, waiting for sign-off, signed off, launch waiting, live on day 14, ended", () => {
    expect(campaignStatusLabel(facts("drafting", 0))).toBe(L.writing);
    expect(campaignStatusLabel(facts("draft", 1))).toBe(L.draft);
    expect(campaignStatusLabel(facts("draft", 3))).toBe(L.draft);
    expect(campaignStatusLabel(facts("awaiting_signoff", 1))).toBe(L.waiting);
    expect(campaignStatusLabel(facts("approved", 1))).toBe(L.signedOff);
    expect(campaignStatusLabel(facts("approved", 1, [launch("awaiting_approval")]))).toBe(L.launchWaiting);
    expect(campaignStatusLabel(facts("approved", 1, [launch("live", 14)]))).toBe("Live (simulated day 14)");
    expect(campaignStatusLabel(facts("approved", 1, [launch("ended", 30)]))).toBe(L.ended);
  });

  it("no campaign says Draft vN any more (BUG-13)", () => {
    for (const status of ["drafting", "draft", "awaiting_signoff", "approved"]) {
      for (const v of [0, 1, 2, 9]) expect(campaignStatusLabel(facts(status, v))).not.toMatch(/v\d/);
    }
  });

  it("a brief with no version yet is still being written, whatever its status says", () => {
    expect(campaignStatusLabel(facts("draft", 0))).toBe(L.writing);
    expect(campaignStatusLabel(facts("drafting", 2))).toBe(L.writing);
  });

  it("a launch outranks the brief: live, then launch waiting, then ended; a refused launch counts for nothing", () => {
    // Edited after sign-off (status draft) while a launch runs: the campaign is live.
    expect(campaignStatusLabel(facts("draft", 2, [launch("live", 6)]))).toBe("Live (simulated day 6)");
    expect(campaignStatusLabel(facts("awaiting_signoff", 2, [launch("ended", 30)]))).toBe(L.ended);
    // An ended launch and a new request: the request is what a person acts on.
    expect(campaignStatusLabel(facts("approved", 1, [launch("ended", 30), launch("awaiting_approval")]))).toBe(L.launchWaiting);
    // Live beats both, in any order.
    expect(campaignStatusLabel(facts("approved", 1, [launch("awaiting_approval"), launch("live", 3), launch("ended", 30)]))).toBe("Live (simulated day 3)");
    expect(campaignStatusLabel(facts("approved", 1, [launch("ended", 30), launch("live", 21)]))).toBe("Live (simulated day 21)");
    // Refused: as if it had never been asked.
    expect(campaignStatusLabel(facts("approved", 1, [launch("refused")]))).toBe(L.signedOff);
    expect(campaignStatusLabel(facts("approved", 1, [launch("refused"), launch("ended", 30)]))).toBe(L.ended);
    // A live launch on day 0 says it hasn't started its first simulated day.
    expect(campaignStatusLabel(facts("approved", 1, [launch("live", 0)]))).toBe("Live (simulated, before day 1)");
  });

  it("every combination of brief status, version and launches gives the one label the precedence says", () => {
    const statuses = ["drafting", "draft", "awaiting_signoff", "approved"] as const;
    const versions = [0, 1, 2];
    const launchSets: CampaignStatusFacts["launches"][] = [
      [],
      [launch("refused")],
      [launch("awaiting_approval")],
      [launch("live", 0)],
      [launch("live", 14)],
      [launch("ended", 30)],
      [launch("refused"), launch("awaiting_approval")],
      [launch("ended", 30), launch("awaiting_approval")],
      [launch("ended", 30), launch("live", 9)],
      [launch("refused"), launch("ended", 12)],
    ];
    const expected = (status: string, v: number, ls: CampaignStatusFacts["launches"]): string => {
      const live = ls.find((x) => x.status === "live");
      if (live) return live.simDay > 0 ? `Live (simulated day ${live.simDay})` : "Live (simulated, before day 1)";
      if (ls.some((x) => x.status === "awaiting_approval")) return L.launchWaiting;
      if (ls.some((x) => x.status === "ended")) return L.ended;
      if (status === "drafting" || v === 0) return L.writing;
      return { draft: L.draft, awaiting_signoff: L.waiting, approved: L.signedOff }[status as "draft"];
    };
    let n = 0;
    for (const s of statuses) {
      for (const v of versions) {
        for (const ls of launchSets) {
          expect(campaignStatusLabel(facts(s, v, ls)), `${s}, v${v}, ${JSON.stringify(ls)}`).toBe(expected(s, v, ls));
          n++;
        }
      }
    }
    expect(n).toBe(120);
  });

  it("the facts are only read: the launches list is left as it was", () => {
    const ls = [launch("ended", 30), launch("live", 4)];
    const f = facts("approved", 1, ls);
    const copy = structuredClone(f);
    campaignStatusLabel(f);
    expect(f).toEqual(copy);
  });

  it("the list puts each campaign's label on its pill, as data-campaign-status, on /campaigns and the brand page alike", () => {
    const at = new Date("2026-11-09T10:00:00Z");
    const row = (id: string, status: string, currentVersion: number, launches: CampaignStatusFacts["launches"]): CampaignSummary =>
      ({ id, objective: `Objective for ${id}`, status, currentVersion, launches, brand: { id: "b", name: "Fernhollow Outfitters" }, title: `Title ${id}`, updatedAt: at }) as CampaignSummary;
    const rows = [
      row("11111111-1111-4111-8111-111111111111", "approved", 1, [launch("live", 14)]),
      row("22222222-2222-4222-8222-222222222222", "awaiting_signoff", 1, []),
      row("33333333-3333-4333-8333-333333333333", "approved", 2, [launch("refused")]),
    ];
    for (const showBrand of [true, false]) {
      const html = renderToStaticMarkup(createElement(CampaignList, { campaigns: rows, showBrand, label: "Campaigns" }));
      const shown = [...html.matchAll(/data-campaign-status="[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);
      expect(shown, `showBrand ${showBrand}`).toEqual(["Live (simulated day 14)", "Waiting for sign-off", "Signed off"]);
      expect(html).not.toMatch(/Draft v\d/);
    }
  });
});

describe("U10-1 #4 a status the code doesn't know", () => {
  it("an unknown campaign status shows Draft, not an error", () => {
    for (const status of ["archived", "paused", "", "APPROVED", "awaiting_launch"]) {
      expect(() => campaignStatusLabel(facts(status, 2)), status).not.toThrow();
      expect(campaignStatusLabel(facts(status, 2)), status).toBe(L.draft);
      expect(campaignStatusLabel(facts(status, 1, [launch("refused")])), status).toBe(L.draft);
    }
  });

  it("an unknown launch status counts for nothing; a known launch still wins over an unknown campaign status", () => {
    expect(campaignStatusLabel(facts("approved", 1, [launch("paused", 5)]))).toBe(L.signedOff);
    expect(campaignStatusLabel(facts("draft", 2, [launch("scheduled")]))).toBe(L.draft);
    expect(campaignStatusLabel(facts("archived", 1, [launch("live", 7)]))).toBe("Live (simulated day 7)");
    expect(campaignStatusLabel(facts("archived", 1, [launch("ended", 30)]))).toBe(L.ended);
  });

  it("the list shows Draft for an unknown status too, and renders the rest", () => {
    const html = renderToStaticMarkup(
      createElement(CampaignList, {
        campaigns: [
          { id: "44444444-4444-4444-8444-444444444444", objective: "A future state", status: "archived", currentVersion: 3, launches: [], brand: { id: "b", name: "Quillmoor Money" }, title: "Future", updatedAt: new Date() } as unknown as CampaignSummary,
        ],
        label: "Campaigns",
      }),
    );
    expect([...html.matchAll(/data-campaign-status="[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["Draft"]);
  });
});
