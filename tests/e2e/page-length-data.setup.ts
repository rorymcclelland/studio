// U10-6: builds the audit's fullest data (tests/e2e/fullest-data.ts) beside
// the other specs, one part per test so the parts build in parallel
// (the page-length-data project in playwright.config.ts is fully parallel).
// tests/e2e/page-length.spec.ts measures every page once every other spec has
// run. Each part is reused when it is already complete, so a local re-run is quick.
import { test } from "@playwright/test";
import postgres from "postgres";
import { buildEarly, buildLive, buildTagline, buildTwoAudiences, buildWaiting } from "./fullest-data";
import { signIn } from "./helpers";

const PARTS = [
  ["the live campaign on simulated day 14", buildLive, 1_200_000],
  ["the two-audience campaign with 24 ads", buildTwoAudiences, 600_000],
  ["the campaign waiting for sign-off", buildWaiting, 300_000],
  ["the brief-only campaign", buildEarly, 120_000],
  ["the tagline run waiting for a choice", buildTagline, 120_000],
] as const;

for (const [what, build, timeout] of PARTS) {
  test(`U10-6 fullest data: ${what}`, async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to find, seed and check the fullest data");
    test.setTimeout(timeout);
    await signIn(page);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await build(page, sql);
    } finally {
      await sql.end();
    }
  });
}
