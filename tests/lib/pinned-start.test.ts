// QA finding 3 (10 November): the fullest-data launch (tests/e2e/fullest-data.ts)
// and performance-attention.spec's launch start on a fixed date whose 14 simulated days hold no simulator event, so the
// Performance page measured for its length doesn't depend on the calendar.
import { describe, expect, it } from "vitest";
import { SIMULATION } from "@/config/simulation";
import { PINNED_STARTS_ON } from "../e2e/launch-fixture";

const days = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(`${PINNED_STARTS_ON}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

describe("the pinned launch start for the Performance page's browser tests", () => {
  it("is a weekday", () => {
    expect([1, 2, 3, 4, 5]).toContain(new Date(`${PINNED_STARTS_ON}T00:00:00Z`).getUTCDay());
  });

  it("has no UK bank holiday, Black Friday or Cyber Monday in its 14 days", () => {
    const events = [...SIMULATION.bankHolidays.days.map((d) => d.date), ...SIMULATION.retail.map((r) => r.date)];
    expect(days.filter((d) => events.includes(d))).toEqual([]);
  });

  it("is within the dates a launch may have (2026 and 2027)", () => {
    expect(PINNED_STARTS_ON >= "2026-01-01" && days.at(-1)! <= "2027-12-31").toBe(true);
  });
});
