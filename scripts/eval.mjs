#!/usr/bin/env node
// Runs agent evals (F-5).
//   npm run eval                       every agent with an eval file, mock model (free)
//   npm run eval -- brief --mock       one agent, mock model
//   npm run eval -- brief              one agent, real model: prints the estimate and stops
//   npm run eval -- brief --yes        one agent, real model, within the daily AI cap
// Real-model runs need the provider key in .env.local. Each run rebuilds a
// local eval database with the demo brands, so it never touches the hosted one.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const args = process.argv.slice(2);
const mock = args.includes("--mock") || args.length === 0 || (!args.includes("--yes") && args.every((a) => a.startsWith("--")));
const yes = args.includes("--yes");
const named = args.filter((a) => !a.startsWith("--"));
const available = readdirSync("tests/evals").filter((f) => f.endsWith(".eval.ts")).map((f) => f.replace(/\.eval\.ts$/, "")).sort();

const unknown = named.filter((n) => !available.includes(n));
if (unknown.length) {
  console.error(`No eval file for: ${unknown.join(", ")}. Agents with evals: ${available.join(", ") || "none"}.`);
  process.exit(2);
}
const agents = named.length ? named : available;
const base = process.env.EVAL_DATABASE_URL ?? "postgres://postgres@localhost:54329/campaign_studio_eval";

if (!mock && !process.env.ANTHROPIC_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error("Real-model evals need a provider key in .env.local (ANTHROPIC_API_KEY). Use --mock to run them free.");
  process.exit(2);
}

// The eval database is rebuilt every run, so today's real-model eval spend is
// carried over into the new one: the daily cap covers all of today's eval runs.
let carried = 0;
try {
  const { default: postgres } = await import("postgres");
  const old = postgres(base, { onnotice: () => {}, connect_timeout: 3 });
  // Mock calls cost nothing real, so only real-model spend is carried.
  const [r] = await old`select coalesce(sum(cost_pence), 0)::float as p from public.usage_ledger
    where provider <> 'mock' and (created_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date`;
  carried = Number(r.p);
  await old.end();
} catch {
  carried = 0; // no eval database yet
}

execFileSync("node", ["scripts/db-reset.mjs"], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, DATABASE_URL: base } });

// Mock calls cost nothing real, so a mock run gets a cap that covers every
// agent's cases (2K pictures, C7-1, took the full mock run past £1), whatever
// .env.local says; a real run keeps £1 unless DAILY_CAP_PENCE says otherwise.
const cap = mock ? "1000" : (process.env.DAILY_CAP_PENCE ?? "100");

const env = {
  ...process.env,
  DATABASE_URL: base,
  EVAL_AGENTS: agents.join(","),
  EVAL_MODE: mock ? "mock" : "real",
  EVAL_CONFIRMED: yes ? "1" : "",
  EVAL_CARRIED_PENCE: String(carried),
  DAILY_CAP_PENCE: cap,
  // The eval database has one workspace, so it may use the whole cap (decision 0010's
  // per-workspace limit is for production's invited workspaces).
  WORKSPACE_DAILY_CAP_PENCE: cap,
  OWNER_RESERVE_PENCE: "0",
};
if (mock) env.MODEL_PROVIDER_OVERRIDE = "mock";
else delete env.MODEL_PROVIDER_OVERRIDE;

const r = spawnSync("npx", ["vitest", "run", "--config", "vitest.eval.config.ts", "--reporter", "dot"], { stdio: "inherit", env });
process.exit(r.status ?? 1);
