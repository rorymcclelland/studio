// U10-1 #2 (F-36): while a model call is in flight, the header's spend meter
// says a call is running and states no amount as real spend (rule 1). Today a
// live reservation counts in the spend but not in the simulated part, so the
// pill turns into "47.62p simulated" (implying 5p of real spend) and the row
// grows to 387 px on a 375 px phone. The interface the builder provides is
// written at the top of tests/e2e/quick-fixes.spec.ts; the words are pinned here.
//
// The decided words (British English, no amount ever called real):
// - The figure is what has been charged today, without the calls in flight:
//   "42.62p of £10.00". A reservation is an estimate, never shown as spend.
// - The pill: "Simulated" when everything charged came from the mock models;
//   "<amount> simulated" only when some charged spend is real; none when
//   nothing has been charged.
// - Calls in flight: "1 call running" or "<n> calls running", beside the pill;
//   nothing when none is.
// - The meter's accessible value: "<figure>[, all simulated | , <amount> simulated][, <n> call(s) running]".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { callsRunning, spendMeterText, type SpendMeterFacts } from "@/components/spend-meter-text";
import { SpendMeterView } from "@/components/spend-meter-view";

const CAP = 1000; // £10.00
const facts = (over: Partial<SpendMeterFacts>): SpendMeterFacts => ({ chargedPence: 42.62, simulatedPence: 42.62, callsInFlight: 0, capPence: CAP, ...over });

/** Text of the leaf element carrying a data attribute in rendered markup, or null when it isn't there. */
const leaf = (html: string, attr: string) => {
  const m = new RegExp(`${attr}="[^"]*"[^>]*>([^<]*)<`).exec(html);
  return m ? m[1] : null;
};
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/**
 * An amount labelled as only partly simulated ("47.62p simulated", "£1.20 simulated"), which implies the rest is
 * real. Lower-case "simulated" after an amount: the pill's own word is "Simulated", which may follow the figure.
 */
const PARTLY_SIMULATED = /(\d[\d.,]*p|£[\d.,]+|under 0\.01p),? simulated\b/;

describe("U10-1 #2 the spend meter's words", () => {
  it("calls running: none, one, several", () => {
    expect(callsRunning(0)).toBeNull();
    expect(callsRunning(1)).toBe("1 call running");
    expect(callsRunning(2)).toBe("2 calls running");
    expect(callsRunning(12)).toBe("12 calls running");
  });

  it("no call in flight, everything simulated: the figure and Simulated, as today", () => {
    expect(spendMeterText(facts({}))).toEqual({
      figure: "42.62p of £10.00",
      pill: "Simulated",
      running: null,
      label: "42.62p of £10.00, all simulated",
    });
  });

  it("one call in flight: Simulated and 1 call running; the reservation is not added to the figure or called spend", () => {
    const t = spendMeterText(facts({ callsInFlight: 1 }));
    expect(t).toEqual({
      figure: "42.62p of £10.00",
      pill: "Simulated",
      running: "1 call running",
      label: "42.62p of £10.00, all simulated, 1 call running",
    });
    for (const part of [t.figure, t.pill, t.running, t.label]) expect(part ?? "").not.toMatch(PARTLY_SIMULATED);
  });

  it("several calls in flight say how many", () => {
    expect(spendMeterText(facts({ callsInFlight: 3 })).running).toBe("3 calls running");
    expect(spendMeterText(facts({ callsInFlight: 3 })).label).toBe("42.62p of £10.00, all simulated, 3 calls running");
  });

  it("a call in flight before anything is charged: no pill, the call is still said", () => {
    expect(spendMeterText(facts({ chargedPence: 0, simulatedPence: 0, callsInFlight: 1 }))).toEqual({
      figure: "0p of £10.00",
      pill: null,
      running: "1 call running",
      label: "0p of £10.00, 1 call running",
    });
  });

  it("nothing charged and nothing running: just the figure", () => {
    expect(spendMeterText(facts({ chargedPence: 0, simulatedPence: 0 }))).toEqual({ figure: "0p of £10.00", pill: null, running: null, label: "0p of £10.00" });
  });

  it("some charged spend is real (a real model run): only then the simulated part is an amount", () => {
    const t = spendMeterText(facts({ chargedPence: 142.62, simulatedPence: 41.8 }));
    expect(t.figure).toBe("£1.43 of £10.00");
    expect(t.pill).toBe("41.80p simulated");
    expect(t.label).toBe("£1.43 of £10.00, 41.80p simulated");
    // A call in flight doesn't change that, and is said beside it.
    expect(spendMeterText(facts({ chargedPence: 142.62, simulatedPence: 41.8, callsInFlight: 1 })).label).toBe("£1.43 of £10.00, 41.80p simulated, 1 call running");
  });

  it("sums from the database that differ in the last places still read as all simulated", () => {
    expect(spendMeterText(facts({ chargedPence: 42.62004, simulatedPence: 42.62 })).pill).toBe("Simulated");
  });
});

describe("U10-1 #2 the spend meter as rendered", () => {
  const render = (f: SpendMeterFacts, owner = true) => renderToStaticMarkup(createElement(SpendMeterView, { ...f, owner }));

  it("while a call is in flight it says a call is running, and states no amount as real spend", () => {
    const html = render(facts({ callsInFlight: 1 }));
    expect(leaf(html, "data-spend-figure")).toBe("42.62p of £10.00");
    expect(leaf(html, "data-simulated-spend")).toBe("Simulated");
    expect(leaf(html, "data-calls-running")).toBe("1 call running");
    expect(html).toMatch(/data-spend-meter=/);
    expect(html).toMatch(/role="meter"/);
    expect(html).toContain('aria-valuetext="42.62p of £10.00, all simulated, 1 call running"');
    const text = textOf(html);
    expect(text).toContain("Simulated");
    expect(text).toContain("1 call running");
    expect(text).not.toMatch(PARTLY_SIMULATED);
  });

  it("with nothing in flight it shows no running text, as before", () => {
    const html = render(facts({}));
    expect(leaf(html, "data-simulated-spend")).toBe("Simulated");
    expect(html).not.toMatch(/data-calls-running=/);
    expect(textOf(html)).not.toMatch(/running/);
  });

  it("a guest's meter reads the same way against the workspace's limit", () => {
    const html = render(facts({ chargedPence: 12.5, simulatedPence: 12.5, callsInFlight: 2, capPence: 200 }), false);
    expect(leaf(html, "data-spend-figure")).toBe("12.50p of £2.00");
    expect(leaf(html, "data-calls-running")).toBe("2 calls running");
    expect(textOf(html)).not.toMatch(PARTLY_SIMULATED);
  });

  it("the header's meter renders through SpendMeterView, so the header shows these words", () => {
    const src = readFileSync(join(process.cwd(), "src/components/spend-meter.tsx"), "utf8");
    expect(src).toMatch(/<SpendMeterView\b/);
  });
});
