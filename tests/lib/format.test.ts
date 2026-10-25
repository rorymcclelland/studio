// S2-1 test case 6 (BUG-1): tiny costs must never read as free.
import { describe, expect, it } from "vitest";
import { formatPence } from "@/lib/format";

describe("formatPence", () => {
  it("S2-1 #6: the agreed examples", () => {
    expect(formatPence(0.0032)).toBe("under 0.01p");
    expect(formatPence(0)).toBe("0p");
    expect(formatPence(1.234)).toBe("1.23p");
    expect(formatPence(123)).toBe("£1.23");
  });

  it("shows fractions of a penny to two places", () => {
    expect(formatPence(0.01)).toBe("0.01p");
    expect(formatPence(0.42)).toBe("0.42p");
    expect(formatPence(0.999)).toBe("1.00p");
  });

  it("never shows 0.00p for a cost above zero", () => {
    for (const n of [0.00001, 0.004, 0.0049, 0.0099]) expect(formatPence(n)).toBe("under 0.01p");
  });

  it("switches to pounds at 100p", () => {
    expect(formatPence(99.994)).toBe("99.99p");
    expect(formatPence(100)).toBe("£1.00");
    expect(formatPence(12345)).toBe("£123.45");
  });

  it("accepts numeric strings, as Postgres returns them", () => {
    expect(formatPence("0.0032")).toBe("under 0.01p");
    expect(formatPence("0")).toBe("0p");
    expect(formatPence("250")).toBe("£2.50");
  });
});
