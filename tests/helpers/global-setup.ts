import { execFileSync } from "node:child_process";

// Rebuilds the test database from the shim and migrations once per run.
export default function setup() {
  // The real-stack CI job runs against `supabase start`, which applies migrations itself.
  if (process.env.SKIP_DB_RESET) return;
  const url =
    process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/campaign_studio_test";
  execFileSync("node", ["scripts/db-reset.mjs"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
