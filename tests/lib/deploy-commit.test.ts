// F-17 test case 1: the health payload names the deployed commit.
import { describe, expect, it } from "vitest";
import { deployedCommit } from "@/lib/deploy/commit";

describe("F-17 deployed commit", () => {
  it("is the first seven characters of Vercel's commit, or null", () => {
    expect(deployedCommit({ VERCEL_GIT_COMMIT_SHA: "A33B51B9E76931F65D7EDB4759C228A2AFDCAAFE" })).toBe("a33b51b");
    expect(deployedCommit({})).toBeNull();
    expect(deployedCommit({ VERCEL_GIT_COMMIT_SHA: "not-a-sha; rm -rf" })).toBeNull();
  });
});
