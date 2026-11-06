# Studio (working title)

A multi-agent campaign studio for marketing teams. Three squads of AI agents (Strategy, Creative and Performance) share one Business Context store and take a campaign from a one-line objective to on-brand creative that stays above its performance threshold. A person approves every consequential move.

**Status: Sprint 8 of 11 closed (Creative and compliance complete); Sprint 9, the Performance squad, is next.** What works today:

- sign-in by emailed link or invite, with each person in their own workspace;
- brands and their Business Context;
- the Strategy squad: market notes, audiences, a brief with sign-off, personas and a test plan;
- the Creative squad: copy, imagery and ads composed in code, in four social sizes, three banners and several languages;
- compliance checks on every ad, including ads uploaded from outside Studio, with a person deciding anything that needs judgement;
- a synthetic pre-test panel;
- a launch pack of the ads that pass;
- a full decision trail for every agent run, and a daily spending cap on every model call.

The Performance squad (a simulator, monitoring, swaps and budget) arrives in Sprints 9 and 10. All brands and figures in the app are fictional or simulated.

## Stack

Next.js 16 on Vercel (London), Postgres on Neon (London, with row-level security per workspace), Studio's own sign-in with links sent by Resend, Inngest for durable agent workflows, the Vercel AI SDK with Claude and Gemini behind one provider layer. See `docs/decisions/` for why (0015 for Neon and the sign-in).

## Run it locally

Needs Node 22 and a local Postgres 16 on port 54329 (trust auth for `postgres`).

```bash
npm ci
cp .env.example .env.local     # the console mailer and MODEL_PROVIDER_OVERRIDE=mock need no keys
npm run db:reset               # rebuild the local database from db/migrations, with the dev seed
npm run dev                    # app on http://localhost:3000
npm run inngest                # workflow dev server on http://localhost:8288 (separate terminal)
```

To sign in, enter an `ALLOWED_EMAILS` address on /signin. Locally no email is sent: the sign-in link is written to the `npm run dev` log (look for `[mail]`); open it and press Continue. It works once, for 15 minutes.

With `MODEL_PROVIDER_OVERRIDE=mock` nothing is spent. To use real models, set `ANTHROPIC_API_KEY` (and `GOOGLE_GENERATIVE_AI_API_KEY` for Gemini) and remove the override.

## Checks

| Command | Does |
| --- | --- |
| `npm run typecheck` / `npm run lint` | Types and lint, zero warnings |
| `npm test` | Unit, database (tenancy and RLS) and agent-workflow tests |
| `npm run test:e2e` | Playwright against a running app and Inngest dev server |
| `npm run check:secrets` | Blocks anything key-shaped from being committed |
| `npm run db:migrate` | Applies pending files in `db/migrations` to `DATABASE_URL` and records them in `schema_migrations`; `-- --dry-run` lists them and changes nothing |

CI runs all of these on every push. A git pre-commit hook and Claude Code hooks run the same checks locally.

**Sprint sign-off (decision 0021).** Every agreed test case is in `tests/e2e/cases.ts` with how it is checked. In CI the browser tests are recorded, and each push's results and recordings go to the branch `e2e-results/ci/<branch>`; `node scripts/demo-page.mjs --results <checkout of that branch> --sprint <N> --out <folder>` builds the demo page Rory signs the sprint off from. Locally, `E2E_VIDEO=1 npm run test:e2e` records too, and `node scripts/e2e-results.mjs --out <folder>` gathers a run's results the same way.

## Project rules

Honest by default; fictional brands only; people approve consequential actions; every agent run is traceable; spend is capped; secrets stay out of the repo; tenancy from day one; the image model never draws text. In full in `CLAUDE.md`.

## Docs

- `docs/refinement/`: each sprint's stories, test cases and agreed answers
- `docs/decisions/`: decision records
- `docs/design/directions.md`: the Sprint 1 design directions (Soft machine chosen; see decision 0007 and `/design` for the design system)
- `docs/hosting.md`: setting up Neon, Resend, Vercel, Inngest and the model keys, and applying migrations
- `docs/new-demo-app.md`: the sign-in, migrations and Neon set-up to copy into the next demo app
