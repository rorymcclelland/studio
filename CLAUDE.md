# Studio (working title)

A multi-agent campaign studio for marketing teams. Three squads of AI agents (Strategy, Creative, Performance) share one Business Context store and take a campaign from objective to on-brand creative that stays above its performance threshold, with a person approving every consequential move.

**North star:** campaigns that heal themselves and compound. **North-star metric:** healthy spend share, the share of live spend running on creative that is on-brand, compliant and above its KPI threshold.

@AGENTS.md

## Project rules (never break these)

1. **Honest by default.** No invented metrics, testimonials or claims in the UI, README or demo data. Simulated data is labelled as simulated wherever it is shown.
2. **Fictional brands only.** No real company names, logos or trademarks in seeds, creative prompts, generated assets or screenshots. Market notes (the Market agent) may name real companies, with their sources; those names never reach a brief or creative (the brief checks refuse them). Agreed by Rory, Sprint 4.
3. **People approve consequential actions.** Agents propose; anything that spends, publishes or replaces creative waits for an approval.
4. **Every agent run is traceable.** Inputs, outputs, model, tokens, cost, duration and outcome are recorded (`agent_steps`, `usage_ledger`).
5. **Spend is capped.** No model call bypasses `generate()` in `src/lib/models/generate.ts`, which checks the daily cap first.
6. **Secrets stay out of the repo.** Keys live only in environment variables; `.env*` is ignored except `.env.example`.
7. **Tenancy from day one.** Every business table carries `workspace_id` with row-level security. App code reads and writes only through `asUser()` in `src/lib/db/scoped.ts`.
8. **The image model never draws text.** Words, logos and layout are composed in code (from Sprint 5).

## Architecture

- **Next.js 16** (App Router, Cache Components on, Turbopack). Read the version-matched docs in `node_modules/next/dist/docs/` before using an API you have not used in this repo. Pages that read the session render inside `<Suspense>`.
- **Postgres** via `postgres` (porsager). Supabase in production (transaction pooler); plain Postgres plus `db/shim/supabase-shim.sql` locally and in CI.
- **Auth:** Supabase magic link for `ALLOWED_EMAILS`; everyone else comes in through a one-time invite link the owner (`OWNER_EMAIL`) makes on /invites and sends himself (decision 0010). Signed-out visitors see /welcome. `AUTH_MODE=dev` is a signed-cookie sign-in for local work only, refused on Vercel.
- **Spend:** the owner may use the whole daily cap; other workspaces get `WORKSPACE_DAILY_CAP_PENCE` each and never the owner's reserve (`OWNER_RESERVE_PENCE`). Web searches are priced in `src/config/prices.ts` and counted in the cap and ledger.
- **Agents:** each agent is a definition (`src/lib/agents/contract.ts`): typed input and output (Zod), instructions, prompt builder, summary, optional offline mock answer. `runModelStep()` does the call, validation, one repair attempt and the trail.
- **Workflows:** Inngest (`src/inngest`). Workflow logic lives in `src/lib/agents/workflow.ts` against the small `StepTools` interface, so it is testable with a fake runner. Approvals are `waitForEvent` steps.
- **Models:** `src/config/agents.ts` maps each agent to provider and model; `src/config/prices.ts` holds prices. `MODEL_PROVIDER_OVERRIDE=mock` uses the deterministic mock model.

## Where things live

| Path | What |
| --- | --- |
| `supabase/migrations/` | Schema, RLS policies, functions. Add new files; never edit an applied one. |
| `src/lib/agents/` | Agent contract, registry, model step, workflows, run queries |
| `src/lib/models/` | `generate()`, cap, cost, provider registry, mock model |
| `src/app/(app)/` | Signed-in app: home, runs, run detail |
| `src/app/directions/` | Sprint 1 design-direction prototypes (sample data only) |
| `tests/` | Vitest (unit, database, agents) and Playwright (`tests/e2e`) |
| `docs/decisions/` | Numbered decision records |
| `docs/refinement/` | Sprint refinements (stories, test cases, answers) |

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | App on :3000 |
| `npm run inngest` | Inngest dev server on :8288 (needed for agent runs) |
| `npm run db:reset` | Rebuild the local dev database with shim, migrations and seed |
| `npm test` | Unit, database and agent tests (rebuilds the test database) |
| `npm run test:e2e` | Playwright against a running app and Inngest dev server |
| `npm run typecheck` / `npm run lint` | Types and lint, zero warnings |
| `npm run check:secrets` | Secret scan of staged files (`-- --all` for every file) |

Local Postgres: `postgres://postgres@localhost:54329/<db>` (see `.env.example`).

## Definition of done

- The story's agreed test cases exist and pass (write them first).
- `typecheck`, `lint`, `test` and the relevant e2e specs pass; no new `npm audit` high findings.
- Rules 1 to 8 checked; any new table has `workspace_id`, RLS and a cross-workspace test.
- UI checked by screenshot at 375 px and 1440 px with AA contrast (light theme only until the dark theme, F-9, is built).
- Decisions recorded in `docs/decisions/`; README updated if setup changed.
- British English in all copy and docs.

## Working style

Sprints are refined first (`docs/refinement/sprint-N.md`), built only after sign-off, and closed by moving anything unfinished back to the backlog. Use the subagents in `.claude/agents/` for UI work, agent work, tests and review. Use the `add-an-agent` skill to scaffold a new product agent.
