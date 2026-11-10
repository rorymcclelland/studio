import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running app and Inngest dev server
// (npm run dev and npm run inngest, or the CI job that starts both).
// Sign-in is the real one (N-2, N-3): links go to the console mailer, and the
// specs read them through /api/dev/last-sign-in-link.
//
// Decision 0021: in CI (or with E2E_VIDEO=1) every test is recorded, and the
// results are written as JSON beside the usual output, for the demo page that
// Rory signs the sprint off from (scripts/e2e-results.mjs, scripts/demo-page.mjs).
const recording = Boolean(process.env.CI || process.env.E2E_VIDEO);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: [[process.env.CI ? "dot" : "list"], ["json", { outputFile: process.env.E2E_JSON ?? "playwright-report/results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    video: recording ? { mode: "on", size: { width: 1280, height: 720 } } : "off",
  },
  projects: [
    // Signs the owner in by email once and saves the session for every spec.
    { name: "sign-in", testMatch: /sign-in\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    // S2-4 #5 needs an empty workspace, so it runs once, before every spec
    // that reads the demo brands, instead of emptying it under them.
    { name: "demo-brands", testMatch: /demo-brands\.setup\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["sign-in"] },
    // U10-6: the audit's fullest data (tests/e2e/fullest-data.ts), built beside the specs, one part per worker.
    {
      name: "page-length-data",
      testMatch: /page-length-data\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["demo-brands"],
      fullyParallel: true,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["demo-brands"],
      grepInvert: /@brand-kit/,
      testIgnore: /page-length\.spec\.ts/,
    },
    // Sprint 8 QA fix: the tests tagged @brand-kit change a demo brand's kit for a moment (a don't rule, a banned or
    // German term, German legal lines, the palette, tone words) and put it back. Other specs read those kits (the
    // launch pack, the pre-test and the uploads count Quillmoor's and Fernhollow's don't rules, for example), so
    // these run after every other spec, one at a time, never beside a test that reads what they change. A
    // failure in the main project skips them (Playwright's rule for dependencies); CI retries a test once first.
    // The fullest data's live campaign accepts Fernhollow's don't rules, so it is built before these change them.
    {
      name: "brand-kit",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["chromium", "page-length-data"],
      grep: /@brand-kit/,
      workers: 1,
      fullyParallel: false,
    },
    // U10-6: every page measured against its length budget once every other spec has run, so every list is as
    // long as the suite makes it (tests/e2e/page-length.spec.ts; the budgets are tests/e2e/page-budgets.ts).
    {
      name: "page-length",
      testMatch: /page-length\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["brand-kit"],
      workers: 1,
      fullyParallel: false,
    },
  ],
});
