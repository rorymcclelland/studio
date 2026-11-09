// U10-3 Ad cards that follow the ad's state, and a filterable gallery: the pure
// part. Which filter an address asks for (?show= and ?audience=, anything
// unknown reads as All), which ads each filter shows and its count, an ad's
// state on its card, the line a locked ad shows, which tools its card offers,
// and the sentence the server refuses with. All in
// src/lib/creative/gallery-filter.ts, which is pure (no server imports), so CI
// checks every combination. The interface is written at the top of
// tests/e2e/creative-gallery.spec.ts; the words are pinned here. The server's
// refusals, against the database, are tests/flows/creative-lock.test.ts.
import { describe, expect, it } from "vitest";
import { stageHref } from "@/lib/campaigns/stages";
import {
  AD_STATE_LABELS,
  adState,
  adTools,
  emptyLine,
  factsFor,
  filterAds,
  GALLERY_SHOWS,
  galleryHref,
  galleryOrder,
  GROUP_PREVIEW,
  pickedChecksLine,
  previewCount,
  showAllLabel,
  LOCK_LINES,
  LOCKED_TOOLS,
  lockLine,
  lockRefusal,
  matchesShow,
  parseAudience,
  parseShow,
  RUNNING_IN_LAUNCH,
  SHOW_LABELS,
  showCounts,
  type AdFacts,
  type AdTool,
  type GalleryShow,
  type LaunchHold,
  WAITING_FOR_LAUNCH,
} from "@/lib/creative/gallery-filter";

const ID = "11111111-1111-4111-8111-111111111111";
const CREATIVE = `/campaigns/${ID}/creative`;

let n = 0;
/** An ad in the gallery: not picked, nothing to decide, in no launch, for no named audience; `over` changes any fact. */
function ad(over: Partial<AdFacts> = {}): AdFacts {
  n++;
  return { id: `ad-${n}`, picked: false, toDecide: false, launch: null, segmentRef: null, ...over };
}

describe("U10-3 #6 the filter in the address", () => {
  it("#6 an unknown filter value shows All", () => {
    for (const v of [undefined, null, "", " ", "everything", "Picked", "PICKED", " picked", "picked ", "needs-a-decision", "launch", "live", "discarded", "0", "show=picked", "<script>alert(1)</script>", "x".repeat(2000)]) {
      expect(parseShow(v), JSON.stringify(v)).toBe("all");
    }
  });

  it("reads each agreed value exactly: all, picked, decide (U10-2's Needs you link) and launched", () => {
    expect(GALLERY_SHOWS).toEqual(["all", "picked", "decide", "launched"]);
    for (const v of GALLERY_SHOWS) expect(parseShow(v)).toBe(v);
    expect(SHOW_LABELS).toEqual({ all: "All", picked: "Picked", decide: "Needs a decision", launched: "Launched" });
  });

  it("a repeated parameter reads its first value, and an unknown first value is All", () => {
    expect(parseShow(["picked", "launched"])).toBe("picked");
    expect(parseShow(["nonsense", "picked"])).toBe("all");
    expect(parseShow([])).toBe("all");
  });

  it("an audience is one of the campaign's own, else every audience", () => {
    const refs = ["seg-1", "seg-2"];
    expect(parseAudience("seg-2", refs)).toBe("seg-2");
    expect(parseAudience(["seg-1", "seg-2"], refs)).toBe("seg-1");
    for (const v of [undefined, null, "", "seg-3", "SEG-1", "all", "<b>"]) expect(parseAudience(v, refs), JSON.stringify(v)).toBeNull();
    // One audience (or none named): nothing to choose, so every audience.
    expect(parseAudience("seg-1", [])).toBeNull();
  });

  it("the filter's links: All has no show; the rest carry it, then the audience, so a shared link opens the same view", () => {
    expect(galleryHref(ID, { show: "all", audience: null })).toBe(CREATIVE);
    expect(galleryHref(ID, { show: "picked", audience: null })).toBe(`${CREATIVE}?show=picked`);
    expect(galleryHref(ID, { show: "decide", audience: null })).toBe(`${CREATIVE}?show=decide`);
    expect(galleryHref(ID, { show: "launched", audience: null })).toBe(`${CREATIVE}?show=launched`);
    expect(galleryHref(ID, { show: "all", audience: "seg-2" })).toBe(`${CREATIVE}?audience=seg-2`);
    expect(galleryHref(ID, { show: "picked", audience: "seg 2&x" })).toBe(`${CREATIVE}?show=picked&audience=seg%202%26x`);
    // U10-2's "Decide compliance" links go to the same address as the filter's own link.
    expect(`${stageHref(ID, "creative")}?show=decide`).toBe(galleryHref(ID, { show: "decide", audience: null }));
    // Every link reads back as the filter it was made for.
    for (const show of GALLERY_SHOWS) {
      const url = new URL(galleryHref(ID, { show, audience: "seg-1" }), "http://x");
      expect(parseShow(url.searchParams.get("show")), show).toBe(show);
      expect(parseAudience(url.searchParams.get("audience"), ["seg-1"]), show).toBe("seg-1");
    }
  });
});

describe("U10-3 #4 what each filter shows, and its count", () => {
  const gallery = [
    ad({ id: "plain" }),
    ad({ id: "picked", picked: true }),
    ad({ id: "decide", picked: true, toDecide: true }),
    ad({ id: "live", picked: true, launch: "live" }),
    ad({ id: "waiting", picked: true, launch: "awaiting_approval" }),
    ad({ id: "other-audience", picked: true, segmentRef: "seg-2" }),
  ];
  const ids = (show: GalleryShow, audience: string | null = null) => filterAds(gallery, show, audience).map((a: AdFacts) => a.id);

  it("#4 All shows every ad; Picked only picked ads; Needs a decision only ads with an open compliance review; Launched only ads in the live launch", () => {
    expect(ids("all")).toEqual(["plain", "picked", "decide", "live", "waiting", "other-audience"]);
    expect(ids("picked")).toEqual(["picked", "decide", "live", "waiting", "other-audience"]);
    expect(ids("decide")).toEqual(["decide"]);
    // A launch waiting for approval isn't running yet: its ads are locked, but not Launched.
    expect(ids("launched")).toEqual(["live"]);
  });

  it("#4 the counts match what each filter shows", () => {
    expect(showCounts(gallery)).toEqual({ all: 6, picked: 5, decide: 1, launched: 1 });
    for (const show of GALLERY_SHOWS) expect(showCounts(gallery)[show], show).toBe(ids(show).length);
    expect(showCounts([])).toEqual({ all: 0, picked: 0, decide: 0, launched: 0 });
  });

  it("an audience narrows every filter, and the order of the gallery is kept", () => {
    expect(ids("all", "seg-2")).toEqual(["other-audience"]);
    expect(ids("picked", "seg-2")).toEqual(["other-audience"]);
    expect(ids("decide", "seg-2")).toEqual([]);
    expect(ids("all", null)).toEqual(gallery.map((a) => a.id));
  });

  it("matchesShow agrees with filterAds for every combination of the facts", () => {
    const launches: LaunchHold[] = [null, "awaiting_approval", "live"];
    for (const picked of [false, true])
      for (const toDecide of [false, true])
        for (const launch of launches) {
          const a = ad({ picked, toDecide, launch });
          expect(matchesShow(a, "all")).toBe(true);
          expect(matchesShow(a, "picked")).toBe(picked);
          expect(matchesShow(a, "decide")).toBe(toDecide);
          expect(matchesShow(a, "launched")).toBe(launch === "live");
          for (const show of GALLERY_SHOWS) expect(filterAds([a], show, null).length).toBe(matchesShow(a, show) ? 1 : 0);
        }
  });

  it("an empty filter says so in one line, rather than showing an empty gallery", () => {
    expect(emptyLine("picked")).toBe("No ad is picked yet.");
    expect(emptyLine("decide")).toBe("No picked ad needs a compliance decision.");
    expect(emptyLine("launched")).toBe("No ad is in a live launch (simulated).");
    expect(emptyLine("all")).toBe("No ads yet.");
  });

  it("an ad needs a decision as U10-2 counts it: picked, of the signed-off version, its compliance pill to review", () => {
    const v = (id: string, picked: boolean, briefVersion: number, segmentRef: string | null = null, launch: { launchId: string; status: "live" | "awaiting_approval" } | null = null) => ({
      id,
      picked,
      briefVersion,
      launch,
      words: { audience: { segmentRef } },
    });
    const facts = factsFor(
      [v("a", true, 2), v("b", false, 2), v("c", true, 1), v("d", true, 2, "seg-2", { launchId: "l1", status: "live" }), v("e", true, 2)],
      2,
      { a: { tone: "review" }, b: { tone: "review" }, c: { tone: "review" }, d: { tone: "pass" }, e: { tone: "fail" } },
    );
    expect(facts).toEqual([
      { id: "a", picked: true, toDecide: true, launch: null, segmentRef: null },
      // Not picked: compliance is decided for picked ads only, so nothing waits on it.
      { id: "b", picked: false, toDecide: false, launch: null, segmentRef: null },
      // Made for an older version: not the signed-off version's to decide.
      { id: "c", picked: true, toDecide: false, launch: null, segmentRef: null },
      { id: "d", picked: true, toDecide: false, launch: "live", segmentRef: "seg-2" },
      { id: "e", picked: true, toDecide: false, launch: null, segmentRef: null },
    ]);
    // No pill yet (compliance still loading, or none): nothing to decide.
    expect(factsFor([v("a", true, 2)], 2, {})[0].toDecide).toBe(false);
    // Before sign-off: nothing to decide.
    expect(factsFor([v("a", true, 2)], null, { a: { tone: "review" } })[0].toDecide).toBe(false);
  });
});

describe("U10-3 #1 and #3 the card follows the ad's state", () => {
  it("one state per card, the most pressing first: discarded, launched, needs a decision, picked; none for a plain ad", () => {
    expect(AD_STATE_LABELS).toEqual({ discarded: "Discarded", launched: "Launched", decide: "Needs a decision", picked: "Picked" });
    expect(adState(ad())).toBeNull();
    expect(adState(ad({ picked: true }))).toBe("picked");
    expect(adState(ad({ picked: true, toDecide: true }))).toBe("decide");
    expect(adState(ad({ picked: true, launch: "live" }))).toBe("launched");
    expect(adState(ad({ picked: true, toDecide: true, launch: "live" }))).toBe("launched");
    // Waiting for approval: not launched yet, so the card shows what it otherwise is (and the lock line).
    expect(adState(ad({ picked: true, launch: "awaiting_approval" }))).toBe("picked");
    expect(adState({ ...ad({ picked: true }), discarded: true })).toBe("discarded");
  });

  it("#1 a launched ad's card says it is running; one in a waiting launch says so; otherwise nothing", () => {
    expect(LOCK_LINES).toEqual({ live: "Running in the launch (simulated)", awaiting_approval: "In a launch waiting for approval (simulated)" });
    expect(lockLine("live")).toBe("Running in the launch (simulated)");
    expect(lockLine("awaiting_approval")).toBe("In a launch waiting for approval (simulated)");
    expect(lockLine(null)).toBeNull();
  });

  it("#2 the sentence the server refuses with", () => {
    expect(RUNNING_IN_LAUNCH).toBe("That ad is running in a launch (simulated), so it can't change until the launch ends.");
  });

  it("#2 a launch waiting for approval has its own refusal (Rory, 9 November 2026); another ad on the same words says so", () => {
    expect(WAITING_FOR_LAUNCH).toBe("That ad is in a launch waiting for approval (simulated), so it can't change until the launch is decided.");
    expect(lockRefusal("live")).toBe(RUNNING_IN_LAUNCH);
    expect(lockRefusal("awaiting_approval")).toBe(WAITING_FOR_LAUNCH);
    expect(lockRefusal("live", true)).toMatch(/^Those words are on an ad running in a launch \(simulated\), so they can't change until the launch ends\.$/);
    expect(lockRefusal("awaiting_approval", true)).toMatch(/^Those words are on an ad in a launch waiting for approval \(simulated\), so they can't change until the launch is decided\.$/);
  });

  const tools = (over: Partial<Parameters<typeof adTools>[0]> = {}) => adTools({ picked: false, launch: null, olderKit: false, translate: false, ...over });

  it("#1 an ad in a live or waiting launch offers no Discard, New picture, New words, Edit words or Redraw", () => {
    // Rory's decision 1 (9 November 2026): nor the layout switch, which changes what the running ad shows.
    expect([...LOCKED_TOOLS].sort()).toEqual(["discard", "edit-words", "layout", "new-picture", "new-words", "redraw"]);
    for (const launch of ["live", "awaiting_approval"] as const) {
      for (const olderKit of [false, true]) {
        const offered = tools({ picked: true, launch, olderKit });
        for (const t of LOCKED_TOOLS) expect(offered, `${launch} ${olderKit} ${t}`).not.toContain(t);
        // What doesn't change the running ad stays: its shortlist mark, its sizes, its compliance, what it is made of.
        for (const t of ["pick", "sizes", "compliance", "about"] as AdTool[]) expect(offered, `${launch} ${t}`).toContain(t);
      }
    }
  });

  it("#3 out of a launch (none, or ended), every tool today's card has is offered again, each only when it can be used", () => {
    expect(tools()).toEqual(expect.arrayContaining(["layout", "pick", "discard", "new-picture", "new-words", "edit-words", "sizes", "compliance", "about"]));
    // Redraw only for an ad made with an older kit (F-26); Translate only where today's card shows it (a picked ad with languages to write).
    expect(tools()).not.toContain("redraw");
    expect(tools({ olderKit: true })).toContain("redraw");
    expect(tools()).not.toContain("translate");
    expect(tools({ picked: true, translate: true })).toContain("translate");
    // No tool twice.
    for (const t of [tools(), tools({ picked: true, olderKit: true, translate: true })]) expect(new Set(t).size).toBe(t.length);
  });
});

describe("U10-3 #10 the gallery's order and how many ads a group shows (Rory's choice b, 9 November 2026)", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 12, minute));
  const ad = (id: string, over: Partial<AdFacts> & { minute?: number; runId?: string | null } = {}) => ({
    id,
    picked: false,
    toDecide: false,
    launch: null as LaunchHold,
    segmentRef: null,
    createdAt: at(over.minute ?? 0),
    runId: "make" as string | null,
    ...over,
  });

  it("#10 launched, then needing a decision, then picked, then the rest", () => {
    const ads = [ad("plain"), ad("picked", { picked: true }), ad("decide", { picked: true, toDecide: true }), ad("live", { picked: true, launch: "live" })];
    expect(galleryOrder(ads).map((a) => a.id)).toEqual(["live", "decide", "picked", "plain"]);
    // A waiting launch's ad is ordered by what it otherwise is (it isn't running).
    expect(galleryOrder([ad("plain"), ad("waiting", { picked: true, launch: "awaiting_approval" })]).map((a) => a.id)).toEqual(["waiting", "plain"]);
  });

  it("#10 newest first within each; ads one run made together keep the order they were given in", () => {
    // Make creative's twelve ads, a second apart, then a new picture and a person's edited words (no run) later.
    const batch = ["a1", "a2", "a3", "a4"].map((id, i) => ad(id, { minute: i, runId: "make" }));
    const later = [ad("picture", { minute: 10, runId: "picture-run" }), ad("edited", { minute: 20, runId: null })];
    expect(galleryOrder([...batch, ...later]).map((a) => a.id)).toEqual(["edited", "picture", "a1", "a2", "a3", "a4"]);
    // Within a tier only: a picked ad from the old batch still comes before a newer plain one.
    expect(galleryOrder([ad("old", { minute: 0, picked: true }), ad("new", { minute: 30, runId: "x" })]).map((a) => a.id)).toEqual(["old", "new"]);
    // It doesn't change the list it was given.
    const given = [...batch, ...later];
    galleryOrder(given);
    expect(given.map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4", "picture", "edited"]);
  });

  it("#10 under All a group shows its first six, with Show all N ads; a filter shows every ad it matches", () => {
    expect(GROUP_PREVIEW).toBe(6);
    expect(previewCount("all", 12)).toBe(6);
    expect(previewCount("all", 6)).toBe(6);
    expect(previewCount("all", 4)).toBe(4);
    for (const show of ["picked", "decide", "launched"] as const) expect(previewCount(show, 9), show).toBe(9);
    expect(showAllLabel(12)).toBe("Show all 12 ads");
  });
});

describe("U10-3 #9 the folded checks on the picked ads say their state in one line (Rory's choice a)", () => {
  const facts = (over: Partial<Parameters<typeof pickedChecksLine>[0]> = {}) => ({
    picked: 4,
    toDecide: 1,
    pretested: { count: 0, simulated: false },
    translated: { count: 0, simulated: false },
    picturesUnchecked: 0,
    packReady: true as boolean | null,
    ...over,
  });
  const line = (over: Parameters<typeof facts>[0] = {}) => {
    const l = pickedChecksLine(facts(over));
    return `${l.title}: ${l.state}`;
  };

  it("#9 the line Rory gave: the picked ads, those needing a decision, the launch pack", () => {
    expect(line()).toBe("Checks on the 4 picked ads: 1 needs a decision, launch pack ready");
    expect(line({ toDecide: 2, packReady: false })).toBe("Checks on the 4 picked ads: 2 need a decision, no launch pack yet");
    expect(line({ toDecide: 0 })).toBe("Checks on the 4 picked ads: none needs a decision, launch pack ready");
    expect(line({ picked: 1, toDecide: 1 })).toBe("Checks on the 1 picked ad: 1 needs a decision, launch pack ready");
    // While the pack is worked out the line leaves it out, rather than guessing.
    expect(line({ packReady: null })).toBe("Checks on the 4 picked ads: 1 needs a decision");
  });

  it("#9 simulated figures say so (rule 1): mock pre-test scores and mock translations", () => {
    expect(line({ pretested: { count: 4, simulated: true }, translated: { count: 1, simulated: true } })).toBe(
      "Checks on the 4 picked ads: 1 needs a decision, 4 pre-tested (simulated scores), 1 translated (simulated), launch pack ready",
    );
    expect(line({ pretested: { count: 4, simulated: false }, translated: { count: 1, simulated: false } })).toBe(
      "Checks on the 4 picked ads: 1 needs a decision, 4 pre-tested, 1 translated, launch pack ready",
    );
    expect(line({ picturesUnchecked: 1 })).toBe("Checks on the 4 picked ads: 1 needs a decision, 1 picture not checked yet, launch pack ready");
    expect(line({ picturesUnchecked: 3 })).toContain("3 pictures not checked yet");
  });

  it("#9 with nothing picked it says so", () => {
    expect(line({ picked: 0, toDecide: 0 })).toBe("Checks on the picked ads: no ad is picked yet");
  });
});
