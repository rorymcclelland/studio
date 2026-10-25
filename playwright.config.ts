import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running app and Inngest dev server
// (npm run dev and npm run inngest, or the CI job that starts both).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    // S2-4 #5 needs an empty workspace, so it runs once, before every spec
    // that reads the demo brands, instead of emptying it under them.
    { name: "demo-brands", testMatch: /demo-brands\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["demo-brands"] },
  ],
});
