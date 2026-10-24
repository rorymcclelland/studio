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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
