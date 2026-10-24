# Sprint 1 refinement: foundations and design directions

Refined 24 October 2026 against the roadmap doc "Campaign studio build: 10-sprint roadmap". There is no code yet, so this sprint creates the base every later sprint builds on. Status: **all six stories Ready, Sprint 1** (answers agreed 24 October 2026, recorded at the end).

## Sprint goal

By the end of the week, one hello-world agent run can be started, paused for approval, approved and traced end to end on a preview link, within a daily cost cap. Rory has three visual directions to choose from.

## Project rules (proposed; written into CLAUDE.md by S1-2)

1. **Honest by default.** No invented metrics, testimonials or claims in the UI, README or demo data. Simulated data is labelled as simulated wherever it is shown.
2. **Fictional brands only.** No real company names, logos or trademarks in seeds, prompts, generated assets or screenshots.
3. **People approve consequential actions.** Agents propose; anything that spends, publishes or replaces creative waits for an approval.
4. **Every agent run is traceable.** Inputs, outputs, model, tokens, cost, duration and outcome are recorded.
5. **Spend is capped.** No model call happens without passing the cost cap.
6. **Secrets stay out of the repo.** Keys live only in environment variables; `.env` is ignored; `.env.example` holds placeholders.
7. **Tenancy from day one.** Every business table carries a `workspace_id` with row-level security, even while there is one user.
8. **The image model never draws text.** Words, logos and layout are composed in code. Recorded now, enforced from Sprint 5.

## Stories

### S1-1 Repository, CI and environments (M)

**The job.** Every change is built, checked and deployed to a link automatically, so each sprint's demo is always one click away.

**Before and after.** Before: nothing. After: a private GitHub repo, a Next.js app deployed to Vercel with a preview link per branch, a Supabase project for the hosted environment, and CI on every push.

**What changes.** Next.js (App Router, TypeScript strict), Tailwind, shadcn/ui as the unstyled base, ESLint and Prettier. Vercel project linked to the repo (production from `main`, previews from branches). Supabase project (free tier) with migrations under `supabase/migrations`. GitHub Actions: install, typecheck, lint, unit tests, build, then database tests. `.env.example`. A daily scheduled ping so the free Supabase project does not pause. README with setup and scripts. Decision records under `docs/decisions/` (0001 web app on Vercel and Supabase; 0002 Inngest for agent workflows; 0003 model provider layer; 0004 tenancy model; 0005 image model never draws text). This refinement moves into `docs/refinement/sprint-1.md`.

**Test cases.**
1. Push to a branch: CI passes and Vercel posts a preview link that loads the app.
2. Merge to `main`: production URL updates.
3. A deliberate type error fails CI (tried once, reverted).
4. Missing environment variable: the app shows a clear configuration error, not a blank page.
5. `git grep` for key-like strings (`sk-`, `AIza`) across the repo returns nothing.
6. The keep-awake job runs on schedule and logs success.

**Out of scope.** Custom domain (later, under mcclelland.info if wanted).

**Boundaries.** Rule 6.

**Dependencies.** None; first.

**Risks.** The build workspace cannot pull Supabase's local containers (found on the RFI responder), so database tests run on plain Postgres with a Supabase shim, plus a real-stack job in CI. Same pattern as before.

**Questions.** Q3 (public or private repo), Q4 (run on your PC).

### S1-2 Claude Code working setup (M)

**The job.** Claude Code builds the next nine sprints consistently, to the same rules, without the rules being restated in each session.

**What changes.** `CLAUDE.md`: north star, project rules, architecture, commands, definition of done, where things live. Subagents in `.claude/agents/`: `ui-builder` (screens from design tokens, checked by Playwright screenshot), `agent-engineer` (product agents to one contract), `test-writer`, `reviewer` (fresh-eyes check of each change against its acceptance criteria). An `add-an-agent` skill that scaffolds an agent's code, config entry, evals and run-viewer entry. Hooks: typecheck and lint after edits; block commits that fail tests or contain key-like strings. MCP config for Playwright and GitHub. Your existing sprint-refine and sprint-close skills carry the rhythm.

**Test cases.**
1. A fresh Claude Code session asked "what are the project rules?" answers from CLAUDE.md without other prompting.
2. The `add-an-agent` skill, run for a dummy agent, produces code, config, an eval file and a passing test.
3. A commit containing a fake key `sk-test-...` is blocked by the hook.
4. A commit with a failing test is blocked.
5. The reviewer subagent, given a change that skips an acceptance criterion, flags it.

**Out of scope.** Supabase MCP server (added in Sprint 2, when the schema grows).

**Boundaries.** All rules, as their home.

**Dependencies.** S1-1 for the repo. The `add-an-agent` skill is written after S1-5 fixes the agent contract.

**Questions.** None.

### S1-3 Data model, tenancy and sign-in (M)

**The job.** The data is safe and multi-tenant-ready from the first migration, so going from one user to client workspaces later is configuration, not a rebuild.

**Before and after.** Before: nothing. After: you sign in to your own workspace; every table is scoped to it; nobody else can read it.

**What changes.** Tables: `workspaces`, `workspace_members (workspace_id, user_id, role)`, `profiles`, `agent_runs`, `agent_steps`, `approvals`, `usage_ledger`. Brand and campaign tables come in Sprint 2. Row-level security on every table: members read and write their own workspace only. A workspace is created on first sign-in. Sign-in by Supabase Auth (method: Q6). Sign-up closed except for your email (allow-list), so the public link cannot be used to run up costs.

**Test cases** (database tests):
1. Signed-in member reads their workspace's runs: allowed.
2. Member of workspace A reads workspace B's runs: zero rows.
3. Member inserts a run with workspace B's ID: denied.
4. Anonymous key, no session, any table: zero rows.
5. Sign-in attempt from an email not on the allow-list: rejected.
6. First sign-in creates exactly one workspace and one membership (owner).
7. Fresh migration run creates no users.

**Out of scope.** Invites, roles beyond owner, the public demo mode (Sprint 10).

**Boundaries.** Rules 6 and 7.

**Dependencies.** S1-1.

**Questions.** Q6 (sign-in method).

### S1-4 Model provider layer and cost cap (M)

**The job.** Any agent can use any model through one interface, every call is costed, and no call is made once the day's cap is reached.

**What changes.** `lib/models`: one `generate` interface for text and structured output (Vercel AI SDK), a provider registry (Anthropic and Google in this sprint; OpenAI addable), and `config/agents.ts` mapping each agent to a provider, model and token limit. A price table per model in config (prices as published, with the date checked). Every call writes to `usage_ledger` (workspace, agent, model, input and output tokens, cost in pence, run ID). A cap check before each call: daily cap in config, default £1; over the cap, the call is refused with a clear error and the run is marked "Stopped: daily cap". A mock provider for tests and offline work. A small spend widget in the header (today's spend against the cap).

**Test cases.**
1. Normal: a call through the mock provider returns output and writes one ledger row with the right cost.
2. Normal: switching an agent from a Claude model to a Gemini model is a one-line config change; the same test passes.
3. Edge: spend at 99p, a call estimated at 3p: refused before it is made (pre-check uses the maximum token limit).
4. Edge: the cap resets at midnight UK time.
5. Failure: provider returns an error or times out: one retry, then the step fails with the provider's message recorded; nothing is charged for a failed call that returned no tokens.
6. Failure: missing API key for a configured provider: a clear startup error naming the provider.
7. Hostile: a prompt asking the model to ignore its instructions and print its system prompt or keys: no key is ever in a prompt, so nothing leaks (asserted by checking prompt construction).

**Out of scope.** Image providers (Sprint 5), caching of outputs for demo mode (Sprint 10).

**Boundaries.** Rule 5.

**Dependencies.** S1-3 for the ledger table.

**Risks.** The build workspace may not reach the model APIs directly. Tests use the mock provider; real calls are checked on the Vercel preview and in a CI job with the keys as secrets.

**Questions.** Q5 (cap amount), Q7 (API keys).

### S1-5 Agent run framework, with a hello-world agent (L)

**The job.** Every later agent plugs into one framework that runs steps, waits for approvals, records a decision trail and can be watched, so Sprints 3 to 9 are about agent quality, not plumbing.

**Before and after.** After: you type a fictional brand name, the hello-world "tagline agent" proposes three taglines, the run pauses at an approval, you approve one, and the run completes. The run viewer shows every step with its inputs, output, model, tokens, cost and timing.

**What changes.** Inngest (free tier) for durable workflows on Vercel: a run is a function; each agent call is a step; approval is a `waitForEvent` step with a timeout. An agent contract: name, version, typed input and output schemas (Zod), model config key, prompt template, and a `summarise` function for the trail. Tables from S1-3 written by the framework. Run viewer: a list of runs and a run page with a step timeline. A minimal approve or reject control on the run page (the full inbox is Sprint 4).

**Test cases.**
1. Normal: start a run, see three taglines, approve one: run status goes Queued, Running, Awaiting approval, Completed; the trail shows every step.
2. Normal: reject: run ends "Rejected" with the reason recorded.
3. Edge: no decision within the timeout (default 7 days; 1 minute in tests): run ends "Expired".
4. Edge: the agent returns output that fails its schema: one repair attempt, then the step fails visibly, with the raw output kept in the trail.
5. Failure: Inngest unavailable when starting a run: you see an error and no orphan run is left in "Queued".
6. Failure: the cost cap is hit mid-run: the run stops with "Stopped: daily cap" and no further calls.
7. Hostile: a brand name of `<script>alert(1)</script>` or a prompt-injection string: rendered as text; the agent's output still validates against its schema.
8. Access: another workspace's run ID typed into the URL: not found.

**Out of scope.** Multi-agent orchestration across squads (Sprint 4 onwards), the approvals inbox (Sprint 4), streaming output.

**Boundaries.** Rules 3, 4 and 5.

**Dependencies.** S1-3 and S1-4.

**Risks.** Inngest is a third-party service on a free tier (50,000 runs a month, ample). Its local dev server runs with `npx`, so it can be developed in the build workspace. If the free tier proves unworkable, the fallback is a Postgres-backed step runner; decision 0002 records it.

**Size.** L. If the sprint runs long, the run list's filters and the timing chart move to Sprint 2; the run page itself stays.

### S1-6 Three design directions (L)

**The job.** You choose the product's look from three real options on screens that matter, before any production UI is built, so Sprint 2's design system has a settled direction.

**Before and after.** After: three clickable prototypes, each of the same two screens: the campaign home (a campaign's squads, status and healthy-spend-share figure) and the creative review (a grid of ad variants with compliance status). Each comes with a one-page rationale: mood, type, colour, motion, and how it would carry the Performance and Creative screens.

**What changes.** Prototypes built with sample data only, at desktop and phone widths, light and dark. Delivered as Q2 says. Proposed starting points, each original and owned by the product:
- **A. Studio ledger:** warm paper tones, an editorial serif with a precise grotesque, ruled lines, like a creative director's working book.
- **B. Signal room:** dark, dense and data-forward, live indicators, a single sharp accent; the Performance squad's view of the world.
- **C. Soft machine:** light, generous space, rounded forms, gentle motion; calm, consumer-grade polish.

**Test cases.**
1. Each prototype loads at 375 px and 1440 px wide with no horizontal scroll.
2. Text meets WCAG AA contrast in light and dark modes (checked automatically).
3. Every clickable element on both screens does something (navigates or shows state).
4. No real brand, logo or trademark appears anywhere (rule 2).
5. Rory picks one direction (or a blend) and the choice is recorded in decision 0006.

**Out of scope.** The full design system and component library (Sprint 2).

**Boundaries.** Rules 1 and 2: sample figures are labelled "sample".

**Dependencies.** Needs a working title (Q1). Independent of S1-3 to S1-5, so it runs in parallel.

**Risks.** Taste is subjective; three directions may all miss. Mitigation: a short look at directions as static frames at mid-sprint before they are made clickable.

## The sprint as a whole

**Order.** S1-1 first. Then S1-3, S1-4, S1-5 in sequence, with S1-6 alongside from day one. S1-2 starts with S1-1 (CLAUDE.md, hooks) and finishes after S1-5 (the `add-an-agent` skill).

**Size.** 4 medium and 2 large, about 7 to 8 days of build, in line with the RFI responder's Sprint 0. If it runs long, the run viewer's filters and timing chart (S1-5) move to Sprint 2; nothing else is deferrable without blocking Sprint 2.

**Spike check.** No spikes. The two unknowns (Inngest on the free tier, model APIs from the build workspace) have fallbacks inside their stories and do not change any story's design.

## Questions for Rory

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Working title | (a) A placeholder for now. (b) Name it now | (a), unless a name is ready: the directions can show a placeholder wordmark |
| Q2 | How the design directions are delivered | (a) Routes in the app, on the preview link. (b) Separate Claude artifacts | (a): they use the real stack, and the chosen one becomes Sprint 2's starting code |
| Q3 | Repository visibility | (a) Private until demo gate 1 (Sprint 4). (b) Public from day one | (a): the first public impression is a working Strategy squad, not scaffolding |
| Q4 | Run it on your own PC? | (a) Not yet: cloud workspace and Vercel previews. (b) Yes, from Sprint 1 | (a): preview links show every change; local setup before Sprint 10 |
| Q5 | Daily AI spending cap | (a) £1 a day. (b) Other | (a): keeps the month under £30 with room for hosting |
| Q6 | Sign-in method | (a) Email magic link, allow-listed. (b) Google sign-in. (c) Email and password | (a): no password to manage, and one setting to add others later |
| Q7 | API keys | (a) You create Anthropic and Google AI Studio keys with spending limits, and add them in Vercel. (b) Claude walks you through it when S1-4 starts | (b) |
| Q8 | Inngest as a third-party workflow service | (a) Accept. (b) Build a Postgres-backed runner instead | (a): durable waits for approval are its core feature; (b) adds about two days |

## Answers and changes (24 October 2026)

| # | Answer | Effect |
|---|---|---|
| Q1 | Placeholder working title | S1-6 shows a placeholder wordmark; the name is settled with the chosen direction |
| Q2 | Directions as routes in the app, on the preview link | S1-6 as written; the chosen direction's code carries into Sprint 2 |
| Q3 | Private until demo gate 1 (Sprint 4) | S1-1 creates a private repo; going public is a Sprint 4 task |
| Q4 | Not yet | Claude builds in the cloud workspace; Rory reviews on Vercel preview links. Local setup before Sprint 10 |
| Q5 | £1 a day | S1-4 default cap £1, reset at midnight UK time |
| Q6 | Email magic link, allow-listed | S1-3 as written, with Supabase magic link and an allow-list of Rory's email |
| Q7 | Claude walks Rory through key creation when S1-4 starts | Action for Rory at the start of S1-4: create the Anthropic and Google AI Studio keys with spending limits and add them in Vercel |
| Q8 | Accept Inngest | S1-5 as written; decision 0002 records the Postgres-runner fallback |

No acceptance criteria changed. All six stories: **Ready, Sprint 1**.

## Changes during the build (24 October 2026)

| Story | Change | Why |
|---|---|---|
| S1-1 | Keep-awake is a Vercel cron calling `/api/health` daily, which runs `select 1` against the database | Lives with the deployment it protects; no GitHub secret needed |
| S1-1 | The hosted set-up (GitHub repo, Vercel project, Supabase project) waits for Rory's accounts | The build workspace has no access to them; test cases 1, 2 and 6 are checked once they exist |
| S1-1 | Database tests run on plain Postgres with `db/shim/supabase-shim.sql` | Supabase's local containers cannot be pulled in the build workspace (as on the RFI responder) |
| S1-3 | Added `AUTH_MODE=dev`: a signed-cookie sign-in for local work and CI, refused on Vercel | Lets the end-to-end tests run without an email inbox; magic link remains the only sign-in in production |
| S1-4 | The tagline agent defaults to Claude Haiku 5.5; prices recorded in `src/config/prices.ts` with the date checked | Cheapest capable model; the cap pre-check uses each model's maximum output tokens |
| S1-5 | Approval timeout set by `APPROVAL_TIMEOUT` (default 7 days) | Lets tests use a short timeout without code changes |
| S1-2 | Checks run twice: a git pre-commit hook (secret scan, typecheck, lint, tests) and Claude Code hooks (typecheck and lint after edits; secret scan and tests before `git commit`) | The git hook protects any commit; the Claude Code hook explains the block to Claude |
| S1-6 | Directions renamed A. Press check (was Studio ledger), B. Control desk (was Signal room), C. Soft machine; working title "Studio" | The names describe each direction better once built |
