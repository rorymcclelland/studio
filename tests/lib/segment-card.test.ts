// U10-7 #4 in CI: a segment card's parts (size, one-line definition, and the
// rest for when it is opened), split from the body the store holds. The
// browser test is "U10-7 #4" in tests/e2e/brand-page.spec.ts.
import { describe, expect, it } from "vitest";
import { segmentCardParts } from "@/lib/brands/segment-card";

const AGENT =
  "Savers who drifted away. 493 of 2,000 customers (24.6%). Customers whose last order was 12 months or more before the data date. " +
  "Top regions: London 18.7%, Wales 12.2%. Main age bands: 25-34 33.1%. Most-bought categories: Add-ons 56.4%. Median order £3.00. " +
  "42.4% have agreed to marketing. As of 10 November 2026. Proposed by the Audience agent. Simulated data.";

describe("U10-7 #4 segment card parts", () => {
  it("splits the Audience agent's body into size, definition, description and facts, without the badge sentences", () => {
    const p = segmentCardParts(AGENT);
    expect(p.size).toBe("493 of 2,000 customers (24.6%)");
    expect(p.definition).toBe("Customers whose last order was 12 months or more before the data date.");
    expect(p.description).toBe("Savers who drifted away.");
    expect(p.facts).toEqual([
      "Top regions: London 18.7%, Wales 12.2%.",
      "Main age bands: 25-34 33.1%.",
      "Most-bought categories: Add-ons 56.4%.",
      "Median order £3.00.",
      "42.4% have agreed to marketing.",
    ]);
    expect(p.asOf).toBe("10 November 2026");
    expect(JSON.stringify(p)).not.toMatch(/Simulated data|Proposed by/);
  });

  it("says the definition once, even when the agent's description repeats it", () => {
    const body = "A group from the data. Customers whose most-bought category is Add-ons. 1,126 of 2,000 customers (56.3%). Customers whose most-bought category is Add-ons. 46.0% have agreed to marketing.";
    const p = segmentCardParts(body);
    expect(p.definition).toBe("Customers whose most-bought category is Add-ons.");
    expect(p.description).toBe("A group from the data.");
  });

  it("reads the customer summary's segments as one sentence each", () => {
    const lapsed = segmentCardParts("493 of 2,000 customers (24.6%) have not ordered in the 12 months to the data date. As of 8 November 2026. Simulated data.");
    expect(lapsed).toEqual({ size: "493 of 2,000 customers (24.6%)", definition: "Customers who have not ordered in the 12 months to the data date.", description: null, facts: [], asOf: "8 November 2026" });
    const repeat = segmentCardParts("1,420 customers (71.0%) have ordered more than once.");
    expect(repeat.size).toBe("1,420 customers (71.0%)");
    expect(repeat.definition).toBe("Customers who have ordered more than once.");
  });

  it("falls back to the first sentence for a body it doesn't know", () => {
    expect(segmentCardParts("people who like walks. More later.")).toMatchObject({ size: null, definition: "People who like walks.", facts: ["More later."] });
  });
});
