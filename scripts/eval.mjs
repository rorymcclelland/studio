#!/usr/bin/env node
// Runs agent evals (F-5).
//   npm run eval                       every agent with an eval file, mock model (free)
//   npm run eval -- brief --mock       one agent, mock model
//   npm run eval -- brief              one agent, real model: prints the estimate and stops
//   npm run eval -- --real             every agent, real model: prints the estimate and stops
//   npm run eval -- brief --yes        one agent, real model, within the daily AI cap
//   --max-pence=100                    with --yes: fail if the run's real cost is over 100p (F-16a)
//   --part=1/2                         only every second case of each agent, starting at the first
// Real-model runs need the provider key in .env.local; the estimate doesn't, as
// it calls no model. Each run rebuilds a local eval database with the demo
// brands, so it never touches the hosted one.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { realRunProblems, summaryMarkdown } from "./eval-check.mjs";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const named = args.filter((a) => !a.startsWith("--"));
const mock = args.includes("--mock") || (!yes && !args.includes("--real") && named.length === 0);
const maxArg = args.find((a) => a.startsWith("--max-pence="));
const maxPence = maxArg ? Number(maxArg.slice("--max-pence=".length)) : null;
const available = readdirSync("tests/evals").filter((f) => f.endsWith(".eval.ts")).map((f) => f.replace(/\.eval\.ts$/, "")).sort();

const unknown = named.filter((n) => !available.includes(n));
if (unknown.length) {
  console.error(`No eval file for: ${unknown.join(", ")}. Agents with evals: ${available.join(", ") || "none"}.`);
  process.exit(2);
}
if (maxArg && !(maxPence !== null && Number.isFinite(maxPence) && maxPence >= 0)) {
  console.error("--max-pence needs a number of pence, for example --max-pence=100.");
  process.exit(2);
}
// --part=k/n runs every nth case of each agent, starting at the kth, so an agent whose
// cases cost more than one run's cap (imagery, with its pictures) can be split (F-16a).
const partArg = args.find((a) => a.startsWith("--part="));
const partMatch = partArg ? /^--part=([1-9]\d?)\/([1-9]\d?)$/.exec(partArg) : null;
if (partArg && !(partMatch && Number(partMatch[1]) <= Number(partMatch[2]) && Number(partMatch[2]) <= 10)) {
  console.error("--part needs k/n with 1 <= k <= n <= 10, for example --part=1/2.");
  process.exit(2);
}
const part = partMatch ? `${partMatch[1]}/${partMatch[2]}` : "";
const agents = named.length ? named : available;
const base = process.env.EVAL_DATABASE_URL ?? "postgres://postgres@localhost:54329/campaign_studio_eval";

// Only a confirmed real run calls a model, so only it needs a key; without
// --yes the runner prints the estimate and stops before any call (F-16a).
if (!mock && yes && !process.env.ANTHROPIC_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
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
  EVAL_PART: part,
  DAILY_CAP_PENCE: cap,
  // The eval database has one workspace, so it may use the whole cap (decision 0010's
  // per-workspace limit is for production's invited workspaces).
  WORKSPACE_DAILY_CAP_PENCE: cap,
  OWNER_RESERVE_PENCE: "0",
};
if (mock) env.MODEL_PROVIDER_OVERRIDE = "mock";
else delete env.MODEL_PROVIDER_OVERRIDE;

const started = Date.now();
const r = spawnSync("npx", ["vitest", "run", "--config", "vitest.eval.config.ts", "--reporter", "dot"], { stdio: "inherit", env });
let status = r.status ?? 1;

// F-16a #1: after a confirmed real run, every agent has a report and the run's
// real cost (the ledger, less what was carried in) is within --max-pence.
if (!mock && yes) {
  let costPence = Number.NaN;
  try {
    const { default: postgres } = await import("postgres");
    const db = postgres(base, { onnotice: () => {}, connect_timeout: 3 });
    const [row] = await db`select coalesce(sum(cost_pence), 0)::float as p from public.usage_ledger
      where provider not in ('mock', 'carried') and agent <> 'eval-carried'`;
    costPence = Number(row.p);
    await db.end();
  } catch (err) {
    console.error(`Could not read the run's cost: ${err instanceof Error ? err.message : String(err)}`);
  }
  const dir = "evals/reports";
  const reports = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && statSync(`${dir}/${f}`).mtimeMs >= started)
    .sort()
    .map((f) => ({ file: `${dir}/${f}`, text: readFileSync(`${dir}/${f}`, "utf8") }));
  const limit = maxPence ?? Number(cap);
  const problems = realRunProblems({ agents, reports, costPence, maxPence: limit });
  const summary = summaryMarkdown({ reports, costPence, maxPence: limit, problems });
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (problems.length) {
    for (const p of problems) console.error(`F-16a check: ${p}`);
    status = status || 3;
    // Over the limit is its own failure, whatever the cases did.
    if (problems.some((p) => /over the .*limit|could not be read/.test(p))) status = 3;
  }
}
process.exit(status);
