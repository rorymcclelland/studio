// U10-6 #3 in CI: the length-budget check's own messages, against a
// deliberately long fixture measurement, and the budgets table itself
// (tests/e2e/page-budgets.ts). The browser test of the same check, on a long
// fixture page, is "U10-6 #3" in tests/e2e/page-length.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STORIES } from "../e2e/cases";
import {
  BUDGET_SCREENS,
  lengthProblem,
  MAIN_ACTION_SCREENS,
  mainActionProblem,
  PAGE_BUDGETS,
  verdict,
  VIEWPORT_HEIGHT,
  type FullestData,
  type Measurement,
} from "../e2e/page-budgets";

const LONG: Measurement = { width: 375, viewportHeight: 812, status: 200, notFound: false, height: 23_655, mainActionTop: 10_345 };
const SAVE = { css: "main button", text: "Save brand kit", what: "Save brand kit" };
const DATA: FullestData = {
  fernhollow: "f0000000-0000-4000-8000-000000000001",
  quillmoor: "f0000000-0000-4000-8000-000000000002",
  live: "c0000000-0000-4000-8000-000000000001",
  twoAudiences: "c0000000-0000-4000-8000-000000000002",
  waiting: "c0000000-0000-4000-8000-000000000003",
  early: "c0000000-0000-4000-8000-000000000004",
  imageryRun: "r0000000-0000-4000-8000-000000000001",
  taglineRun: "r0000000-0000-4000-8000-000000000002",
};

describe("U10-6 #3 a page over budget fails with its measured height and the budget", () => {
  it("the budgets are Rory's (Q7): 6 screens at 375 px, 4 at 1440 px, the main action within 1.5 screens", () => {
    expect(VIEWPORT_HEIGHT).toEqual({ 375: 812, 1440: 900 });
    expect(BUDGET_SCREENS).toEqual({ 375: 6, 1440: 4 });
    expect(MAIN_ACTION_SCREENS).toBe(1.5);
  });

  it("a deliberately long page (the audit's live campaign, 23,655 px at 375 px) gets its height and the budget in the message", () => {
    expect(lengthProblem("Campaign, live on day 14", LONG)).toBe(
      "Campaign, live on day 14 at 375px is 23,655 px tall, 29.1 screens of 812 px; its budget is 6 screens (4,872 px).",
    );
    expect(lengthProblem("Campaign, live on day 14", { ...LONG, width: 1440, viewportHeight: 900, height: 10_860 })).toBe(
      "Campaign, live on day 14 at 1440px is 10,860 px tall, 12.1 screens of 900 px; its budget is 4 screens (3,600 px).",
    );
    const v = verdict("Campaign, live on day 14", [lengthProblem("Campaign, live on day 14", LONG)!], undefined, "lengthUntil");
    expect(v).toEqual({ kind: "fail", message: expect.stringContaining("23,655 px tall") });
    expect((v as { message: string }).message).toContain("its budget is 6 screens (4,872 px)");
  });

  it("exactly at the budget passes; one pixel over fails", () => {
    expect(lengthProblem("Edge", { ...LONG, height: 6 * 812 })).toBeNull();
    expect(lengthProblem("Edge", { ...LONG, height: 6 * 812 + 1 })).toMatch(/is 4,873 px tall, 6 screens of 812 px; its budget is 6 screens \(4,872 px\)\.$/);
    expect(lengthProblem("Edge", { ...LONG, width: 1440, viewportHeight: 900, height: 3600 })).toBeNull();
  });

  it("a main action too far down says how far, and the limit; a missing one says it isn't there", () => {
    expect(mainActionProblem("Brand kit editor", SAVE, { ...LONG, height: 5_825, mainActionTop: 5_700 })).toBe(
      'Brand kit editor at 375px: its main action, Save brand kit (main button with "Save brand kit"), is 5,700 px down, 7 screens; it must start within 1.5 screens (1,218 px).',
    );
    expect(mainActionProblem("Brand kit editor", SAVE, { ...LONG, mainActionTop: null })).toBe(
      'Brand kit editor at 375px has no main action: Save brand kit (main button with "Save brand kit") isn\'t on the page.',
    );
    expect(mainActionProblem("Brand kit editor", SAVE, { ...LONG, mainActionTop: 1_218 })).toBeNull();
  });

  it("a page that isn't built yet (the not-found screen) can't pass, unless it is the not-found page on purpose", () => {
    const missing = { ...LONG, status: 404, notFound: true, height: 812, mainActionTop: null };
    expect(lengthProblem("Brief stage", missing)).toBe("Brief stage at 375px is the not-found screen (status 404), so it can't be within its budget (is the page built?).");
    expect(lengthProblem("Brief stage", { ...missing, status: 200 })).toMatch(/is the not-found screen \(status 200\)/);
    expect(mainActionProblem("Brief stage", SAVE, missing)).toMatch(/is the not-found screen/);
    expect(lengthProblem("Not found in the app", missing, { notFoundPage: true })).toBeNull();
  });

  it("a page marked for a later story skips while over budget, and fails once it fits so the marker goes", () => {
    const until = { story: "U10-2" as const, why: "one page holds every stage" };
    expect(verdict("Campaign", ["too long"], until, "lengthUntil")).toEqual({ kind: "skip", message: "Over budget until U10-2 (one page holds every stage): too long" });
    expect(verdict("Campaign", [], until, "lengthUntil")).toEqual({
      kind: "fail",
      message: "Campaign is within its budget now: remove its lengthUntil (U10-2) from tests/e2e/page-budgets.ts, so the budget holds from here on.",
    });
    const none = { story: "unassigned" as const, why: "no story shortens it" };
    expect(verdict("Kit", ["too long"], none, "lengthUntil")).toEqual({ kind: "skip", message: "Over budget, and no Sprint 10 story shortens it (no story shortens it): too long" });
    expect(verdict("Kit", [], none, "lengthUntil")).toEqual({ kind: "pass" });
    expect(verdict("Home", [], undefined, "mainActionUntil")).toEqual({ kind: "pass" });
  });
});

describe("U10-6 the budgets table", () => {
  it("lists every page the audit measured, the stage pages U10-2 adds and the brand page's tabs U10-7 adds, once each", () => {
    const keys = PAGE_BUDGETS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      "welcome",
      "home",
      "brands",
      "brand-fernhollow",
      "brand-quillmoor",
      "brand-quillmoor-audience",
      "brand-quillmoor-voice",
      "brand-quillmoor-legal",
      "brand-quillmoor-products",
      "brand-kit-editor",
      "brand-languages",
      "campaigns",
      "campaign-live",
      "campaign-live-brief",
      "campaign-live-audience",
      "campaign-live-creative",
      "campaign-live-launch",
      "performance",
      "campaign-two-audiences",
      "campaign-two-audiences-creative",
      "campaign-waiting",
      "campaign-waiting-brief",
      "campaign-early",
      "campaign-early-brief",
      "approvals",
      "runs",
      "run-trail",
      "run-awaiting",
      "invites",
      "not-found-app",
    ]);
    // U10-2's stage pages, at their future addresses.
    const path = (k: string) => PAGE_BUDGETS.find((b) => b.key === k)!.path(DATA);
    expect(path("campaign-live-brief")).toBe(`/campaigns/${DATA.live}/brief`);
    expect(path("campaign-live-audience")).toBe(`/campaigns/${DATA.live}/audience`);
    expect(path("campaign-live-creative")).toBe(`/campaigns/${DATA.live}/creative`);
    expect(path("campaign-live-launch")).toBe(`/campaigns/${DATA.live}/launch`);
    expect(path("performance")).toBe(`/campaigns/${DATA.live}/performance`);
    for (const b of PAGE_BUDGETS) expect(b.path(DATA), b.key).toMatch(/^\/[^\s]*$/);
  });

  it("every page but the not-found one has a main action; only the welcome page is signed out", () => {
    for (const b of PAGE_BUDGETS) expect(b.mainAction === null, b.key).toBe(b.key === "not-found-app");
    expect(PAGE_BUDGETS.filter((b) => !b.signedIn).map((b) => b.key)).toEqual(["welcome"]);
  });

  it("every marker names a Sprint 10 story, with a reason", () => {
    const sprint10 = STORIES.filter((s) => s.sprint === 10).map((s) => s.id);
    // U10-1 and U10-6 are in the case list now; the others join with their own cases.
    const later = ["U10-2", "U10-3", "U10-4", "U10-5", "U10-7", "U10-8"];
    for (const b of PAGE_BUDGETS) {
      for (const u of [b.lengthUntil, b.mainActionUntil]) {
        if (!u) continue;
        expect(u.why.length, b.key).toBeGreaterThan(10);
        if (u.story !== "unassigned") expect([...sprint10, ...later], b.key).toContain(u.story);
      }
    }
  });

  it("the pages over budget that no Sprint 10 story fixes are exactly these, so a new one is a deliberate change", () => {
    const unassigned = PAGE_BUDGETS.flatMap((b) => [
      ...(b.lengthUntil?.story === "unassigned" ? [`${b.key}: length`] : []),
      ...(b.mainActionUntil?.story === "unassigned" ? [`${b.key}: main action`] : []),
    ]);
    expect(unassigned).toEqual(["brand-kit-editor: length", "brand-languages: main action", "campaigns: length", "approvals: length", "approvals: main action"]);
  });

  it("the pages already within budget today carry no marker, so their tests must pass now", () => {
    const clean = PAGE_BUDGETS.filter((b) => !b.lengthUntil && !b.mainActionUntil).map((b) => b.key);
    expect(clean).toEqual([
      "welcome",
      "brands",
      // U10-2: the campaign's overview and its Brief, Audience and Launch stages fit their budgets.
      "campaign-live",
      "campaign-live-brief",
      "campaign-live-audience",
      "campaign-live-launch",
      "campaign-two-audiences",
      "campaign-waiting",
      "campaign-waiting-brief",
      "campaign-early",
      "campaign-early-brief",
      "run-trail",
      "run-awaiting",
      "invites",
      "not-found-app",
    ]);
  });

  it("the spec has both cases' tests for every page, by key", () => {
    const spec = readFileSync(join(process.cwd(), "tests/e2e/page-length.spec.ts"), "utf8");
    for (const b of PAGE_BUDGETS) {
      expect(spec, b.key).toContain(`test("U10-6 #1: ${b.key} is within its length budget at 375 px and 1440 px"`);
      if (b.mainAction) expect(spec, b.key).toContain(`test("U10-6 #2: the main action of ${b.key} is within 1.5 screens at 375 px"`);
    }
  });
});
