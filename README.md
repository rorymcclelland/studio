# Studio (working title)

A multi-agent campaign studio for marketing teams. Three squads of AI agents (Strategy, Creative and Performance) share one Business Context store and take a campaign from a one-line objective to on-brand creative that stays above its performance threshold. A person approves every consequential move.

**Status: Sprint 1 of 10.** What works today: magic-link sign-in to your own workspace; a hello-world tagline agent that proposes three taglines, waits for your approval and records a full decision trail; a daily spending cap on every model call; and three design-direction prototypes. The Strategy, Creative and Performance squads arrive in Sprints 3 to 9. All brands and figures in the app are fictional or simulated.

## Stack

Next.js 16 on Vercel, Postgres on Supabase (with row-level security per workspace), Inngest for durable agent workflows, the Vercel AI SDK with Claude and Gemini behind one provider layer. See `docs/decisions/` for why.

## Run it locally

Needs Node 22 and a local Postgres 16 on port 54329 (trust auth for `postgres`).

```bash
npm ci
cp .env.example .env.local     # AUTH_MODE=dev and MODEL_PROVIDER_OVERRIDE=mock need no keys
npm run db:reset               # shim, migrations and dev seed
npm run dev                    # app on http://localhost:3000
npm run inngest                # workflow dev server on http://localhost:8288 (separate terminal)
```

With `MODEL_PROVIDER_OVERRIDE=mock` nothing is spent. To use real models, set `ANTHROPIC_API_KEY` (and `GOOGLE_GENERATIVE_AI_API_KEY` for Gemini) and remove the override.

## Checks

| Command | Does |
| --- | --- |
| `npm run typecheck` / `npm run lint` | Types and lint, zero warnings |
| `npm test` | Unit, database (tenancy and RLS) and agent-workflow tests |
| `npm run test:e2e` | Playwright against a running app and Inngest dev server |
| `npm run check:secrets` | Blocks anything key-shaped from being committed |

CI runs all of these on every push. A git pre-commit hook and Claude Code hooks run the same checks locally.

## Project rules

Honest by default; fictional brands only; people approve consequential actions; every agent run is traceable; spend is capped; secrets stay out of the repo; tenancy from day one; the image model never draws text. In full in `CLAUDE.md`.

## Docs

- `docs/refinement/`: each sprint's stories, test cases and agreed answers
- `docs/decisions/`: decision records
- `docs/design/directions.md`: the three Sprint 1 design directions
- `docs/hosting.md`: setting up Supabase, Vercel, Inngest and the model keys
