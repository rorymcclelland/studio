import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running app and Inngest dev server
// (npm run dev and npm run inngest, or the CI job that starts both).
// Sign-in is the real one (N-2, N-3): links go to the console mailer, and the
// specs read them through /api/dev/last-sign-in-link.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    // Signs the owner in by email once and saves the session for every spec.
    { name: "sign-in", testMatch: /sign-in\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    // S2-4 #5 needs an empty workspace, so it runs once, before every spec
    // that reads the demo brands, instead of emptying it under them.
    { name: "demo-brands", testMatch: /demo-brands\.setup\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["sign-in"] },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["demo-brands"] },
  ],
});
