import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/helpers/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/campaign_studio_test",
      MODEL_PROVIDER_OVERRIDE: "mock",
      DAILY_CAP_PENCE: "100",
      USD_TO_GBP: "0.79",
    },
  },
});
