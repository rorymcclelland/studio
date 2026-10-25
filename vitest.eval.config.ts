import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `npm run eval` only (scripts/eval.mjs sets the environment). Never part of `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/helpers/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/evals/runner.eval-run.ts"],
    fileParallelism: false,
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
  },
});
