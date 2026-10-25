# Backlog

The working backlog for Studio. The roadmap (Claude doc "Campaign studio build: 10-sprint roadmap") sets the sprint themes; this file holds every committed and waiting item with its status. Updated at each sprint close.

## Sprint 1: foundations and design directions (closed 25 October 2026)

| ID | Story | Status |
| --- | --- | --- |
| S1-1 | Repository, CI and environments | Done, Sprint 1. Residual: the daily keep-awake cron's first run (26 Oct, 07:17 UTC) still to be seen |
| S1-2 | Claude Code working setup | Done, Sprint 1 |
| S1-3 | Data model, tenancy and sign-in | Done, Sprint 1 |
| S1-4 | Model provider layer and cost cap | Done, Sprint 1 (first real call on production: 0.0032p) |
| S1-5 | Agent run framework, with a hello-world agent | Done, Sprint 1 (completed run on production, approved by Rory) |
| S1-6 | Three design directions | Done, Sprint 1 (Soft machine chosen, decision 0006) |

Nothing returned to the backlog.

## Where every Sprint 1 review item now lives

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| BUG-1 | Costs under 0.01p display as "0.00p", which reads as free | First production run | Planned, Sprint 2 (S2-1) |
| F-1 | Run list sums cost from `agent_steps`, not `usage_ledger`, which the cap uses | Reviewer dry run | Planned, Sprint 2 (S2-6) |
| F-2 | Supabase performance advisor: covering indexes on foreign keys; `(select auth.uid())` in policies | Hosted set-up | Planned, Sprint 2 (S2-6) |
| F-3 | Production address is behind Vercel Authentication; make it public for interviewers | Hosted set-up | Folded into Sprint 4 (demo gate 1) |
| F-4 | Inngest function, run list and start form handle only the tagline agent; generalise for any agent | `add-an-agent` dry run | Folded into Sprint 3 (first real agents) |
| F-5 | Evals runner (`npm run eval`) and eval file shape | `add-an-agent` dry run | Folded into Sprint 3 |
| F-6 | Remove prototypes A and B once the design system exists | Decision 0006 | Planned, Sprint 2 (S2-1) |
| F-7 | Add the GitHub MCP server now the repo exists | S1-2 | Planned, Sprint 2 (S2-6) |
| F-8 | Preview deployments use the production database | Hosted set-up | Backlog, from Sprint 1 review. Accepted until real users arrive: previews are Rory-only and use the mock model |
| F-9 | Dark theme (the prototype's dark palette exists) | Sprint 2 refinement, Q7 | Backlog, from Sprint 2 refinement |

## Sprint 2: design system and brand kits (confirmed 25 October 2026)

| ID | Story | Size | Status |
| --- | --- | --- | --- |
| S2-6 | Housekeeping from the Sprint 1 review (F-1, F-2, F-7) | S | Ready, Sprint 2 |
| S2-1 | Soft machine design system and app reskin (with BUG-1, F-6) | L | Ready, Sprint 2 |
| S2-2 | Brand data model | M | Ready, Sprint 2 |
| S2-3 | Brand kit editor and brand overview | M | Ready, Sprint 2 |
| S2-4 | Two fictional brands with simulated first-party data | M | Ready, Sprint 2 |
| S2-5 | Business Context store and search | M | Ready, Sprint 2 |

Detail and test cases: `docs/refinement/sprint-2.md`.

## Not yet in a sprint (ranked)

1. F-8 Separate database for previews (Supabase branch or a second free project), before anyone but Rory uses the app
2. F-9 Dark theme, once the light design system has settled
3. Later-backlog items from the roadmap: multi-tenancy screens, Slack approvals, CSV import, Figma import, short video, live ad-platform connectors, skills authoring, role-based views

## Decisions

| Date | Decision |
| --- | --- |
| 24 Oct 2026 | Web app on Vercel and Supabase (0001); Inngest (0002); model provider layer and £1-a-day cap (0003); tenancy from day one (0004); image model never draws text (0005) |
| 25 Oct 2026 | Soft machine design direction (0006); functions run in London; redeploy by pushing to GitHub; Sprint 2 confirmed, light theme only for now |
