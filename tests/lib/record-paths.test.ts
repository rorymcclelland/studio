// F-12 test case 1: malformed ids on record pages are answered with a 404 before the page streams.
import { describe, expect, it } from "vitest";
import { malformedRecordPath } from "@/proxy";

const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";

describe("F-12 record paths", () => {
  it("flags record pages whose id can't be an id", () => {
    for (const p of ["/brands/nope", "/runs/123", "/campaigns/x", "/brands/nope/edit", "/campaigns/%E0%A4%A", `/runs/${ID}x`]) {
      expect(malformedRecordPath(p), p).toBe(true);
    }
  });
  it("leaves real ids and other pages alone", () => {
    for (const p of [`/brands/${ID}`, `/brands/${ID}/edit`, `/runs/${ID.toUpperCase()}`, `/campaigns/${ID}/`, "/brands", "/campaigns", "/", "/design", "/api/health"]) {
      expect(malformedRecordPath(p), p).toBe(false);
    }
  });
});
