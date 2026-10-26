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

## Where every review item now lives (Sprints 1 and 2)

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| BUG-1 | Costs under 0.01p display as "0.00p", which reads as free | First production run | Done, Sprint 2 (S2-1) |
| F-1 | Run list sums cost from `agent_steps`, not `usage_ledger`, which the cap uses | Reviewer dry run | Done, Sprint 2 (S2-6) |
| F-2 | Supabase performance advisor: covering indexes on foreign keys; `(select auth.uid())` in policies | Hosted set-up | Done, Sprint 2 (S2-6) |
| F-3 | Production address is behind Vercel Authentication; make it public for interviewers | Hosted set-up | Folded into Sprint 4 (demo gate 1) |
| F-4 | Inngest function, run list and start form handle only the tagline agent; generalise for any agent | `add-an-agent` dry run | Ready, Sprint 3 |
| F-5 | Evals runner (`npm run eval`) and eval file shape | `add-an-agent` dry run | Ready, Sprint 3 |
| F-6 | Remove prototypes A and B once the design system exists | Decision 0006 | Done, Sprint 2 (S2-1) |
| F-7 | Add the GitHub MCP server now the repo exists | S1-2 | Done, Sprint 2 (S2-6) |
| F-8 | Preview deployments use the production database | Hosted set-up | Backlog, from Sprint 1 review. Accepted until real users arrive: previews are Rory-only and use the mock model |
| F-9 | Dark theme (the prototype's dark palette exists) | Sprint 2 refinement, Q7 | Backlog, from Sprint 2 refinement |
| F-10 | SVG sanitiser refuses good logos with `data:`/`https:` in any attribute, and stores logos without `xmlns` that then don't display | Sprint 2 review | Backlog, for Sprint 5 (logo upload) |
| F-11 | Rule context items are keyed by position (`rule:dont:2`), so deleting a rule shifts the others | Sprint 2 review | Ready, Sprint 3 |
| F-12 | `notFound()` inside a streamed page returns HTTP 200 (the screen is right) | Sprint 2 review | Ready, Sprint 3 |
| F-12a | Switch off Supabase's Data API (the app never uses it); renumbered from F-13, which Sprint 3 reused | Sprint 2 review, finding 4 | Done, 25 Oct 2026 (Rory) |

## Sprint 2: design system and brand kits (closed 25 October 2026)

| ID | Story | Size | Status |
| --- | --- | --- | --- |
| S2-6 | Housekeeping from the Sprint 1 review (F-1, F-2, F-7) | S | Done, Sprint 2 (hosted advisors clean of unindexed foreign keys and per-row `auth.uid()`) |
| S2-1 | Soft machine design system and app reskin (with BUG-1, F-6) | L | Done, Sprint 2 (light theme; dark is F-9) |
| S2-2 | Brand data model | M | Done, Sprint 2 (database guards added; Rory switched off the Data API, F-12a) |
| S2-3 | Brand kit editor and brand overview | M | Done, Sprint 2 |
| S2-4 | Two fictional brands with simulated first-party data | M | Done, Sprint 2 (loaded on production in 2.7 s against a 20 s target) |
| S2-5 | Business Context store and search | M | Done, Sprint 2 (search about 23 ms on production against 300 ms) |

Evidence: 82 unit and database tests and 33 end-to-end tests passing; fresh-eyes review with all nine fixable findings fixed before deploy; deploy `cb32f18` healthy with no runtime errors; demo brands loaded by Rory on production. Detail: `docs/refinement/sprint-2.md`. Nothing returned to the backlog.

## Sprint 3: Strategy I, brief and audiences (closed 26 October 2026)

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| F-11 | Stable keys for brand rules (and legal lines, banned terms, claims) | S | Done, Sprint 3 (production re-keyed in place; SQL and app keys match). Residual: case folding is ASCII-only, accepted (decision 0009) |
| F-4 | Run any agent: workflow registry, one Inngest function, labels on run pages | M | Done, Sprint 3. Needed a manual Inngest resync after deploy (F-15) |
| F-5 | Evals runner (`npm run eval`), eval database, committed reports, mock mode in CI | M | Done, Sprint 3, for mock mode. The real-model eval report is split out as F-16 (no provider key is kept locally) |
| S3-1 | Audience agent: SQL counts segments, Haiku names them, saved to the context store | M | Done, Sprint 3 (production: 11 s, 0.08p, nine segments, passed first time) |
| S3-2 | Campaigns and the Brief agent (Sonnet), with evidence checks in code | L | Done, Sprint 3 (production: demo brief in 39 s against 60 s, 5.7p with one repair; every figure traced to its source) |
| S3-3 | Brief editor: hand edits, revise with AI (whole or per section), version history | M | Done, Sprint 3. Test case 6 changed (legal lines are carried by code rather than a revision being refused), confirmed by Rory 26 Oct 2026 |
| F-12 | Not-found pages return 404 (two-hour time-box) | S | Done, Sprint 3, for malformed ids (404 on production). Residual: a well-formed missing id shows not found with HTTP 200 and `noindex`, the agreed fallback |

Evidence: 138 unit and database tests and 40 end-to-end tests passing against a production build; mock evals 13 of 13; fresh-eyes review with 13 of its 15 findings fixed before deploy (the other two: F-16, and S3-3 #6, which Rory has since confirmed); production runs above. Detail: `docs/refinement/sprint-3.md`.

## Where the Sprint 3 review items now live

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| F-13 | Record why a reply was repaired: the first attempt's problems and raw reply are not kept in the step trail (rule 4) | Production brief run (two attempts, reasons not shown) | Ready, Sprint 4 |
| F-14 | Loose quantities in words ("most are", "many") pass the checks; extend the quantity-word check or ask the model to cite a figure instead | Production Audience run | Ready, Sprint 4 |
| F-15 | Inngest didn't pick up the changed function on deploy; it needed a manual resync. Add a post-deploy sync (or check) and a runbook step | Sprint 3 deploy | Ready, Sprint 4, with F-3 (runbook step done) |
| F-16 | Real-model evals: a manual GitHub Actions job with the key as a secret, so reports can be committed without keeping keys locally | Review finding 10 | Ready, Sprint 4 (stretch) |

## Sprint 4: Strategy II, market, personas and approvals, demo gate 1 (closed 26 October 2026)

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| F-13 | Keep every attempt (raw reply and problems) in the step trail | S | Done, Sprint 4 (production: each repaired run shows both attempts and why the first was sent back) |
| F-14 | Refuse loose quantities ("most are", "the majority of") in model text | S | Done, Sprint 4 (production: "Many people" sent back in two briefs; "many budgeters" added after the Market run) |
| S4-1 | Approvals inbox v1, brief sign-off as the first gate (14 days) | M | Done, Sprint 4 (production: Quillmoor version 1 sent and approved by Rory) |
| S4-2 | Persona agent: four synthetic personas from the segments score and critique the brief (Haiku) | M | Done, Sprint 4 (production: started by sign-off, 9 s, 0.09p, first attempt) |
| S4-4 | Test plan: hypotheses, cells, success metric and decision rule, no figures (Haiku) | M | Done, Sprint 4 (production: started by sign-off, 7.6 s, 0.07p, first attempt) |
| S4-3 | Market agent: web search, sourced and dated notes, real rival names allowed in notes only (Sonnet) | L | Done, Sprint 4, after four production fixes (below). Production: six notes from 25 pages in 37 s for 14.6p, every figure found on its cited page, real names kept out of the brief. Residual: a refresh costs 15 to 20p against the refined 6 to 10p (F-21), and pages that block automated readers lose their figure notes |
| F-3, F-8 | Public address with invite links Rory sends himself; per-workspace cap; previews on a second Supabase project | M | Done, Sprint 4 (welcome page public under Standard Protection; invite used in a private window, the invitee got an empty workspace of their own; preview build's health check reached `campaign-studio-preview`) |
| F-15 | Automatic Inngest sync after each production deploy | S | Split. Done, Sprint 4: the "After production deploy" Action and the runbook step. Returned as F-17: the Action has never been triggered |
| F-16 | Real-model evals in GitHub Actions | S | Split. Done, Sprint 4: `evals.yml` (manual run, key on the eval step only). Returned as F-16a: the first real-model run and its committed report |

Evidence: 180 unit, database and agent tests and 45 end-to-end tests passing; mock evals for all six agents (audience 4, brief 6, market 2, persona 4, tagline 3, test plan 3); fresh-eyes review with 18 of 19 findings fixed before deploy and finding 14 accepted (decision 0010); production runs above. Demo gate 1 met on the public address: objective to signed-off brief with market notes, persona scores and a test plan. Detail: `docs/refinement/sprint-4.md`, "Production check notes".

Fixed during the production check (26 Oct, all deployed and tested): five searches read 140,000 tokens (30p), now three with an honest cap estimate; the repair after searching now sees the pages found; figures are checked against the cited page's own text (the search's passages only come with prose replies); possessives, hyphens, finance abbreviations and sentence openers are no longer read as company names; notes that still fail after the repair are left out, not the whole run; a brand name between a figure and its unit ("2,000 Quillmoor Money customers") no longer fails the brief; evals carry only real-model spend and give their one workspace the whole cap.

## Where the Sprint 4 review items now live

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| F-16a | First real-model eval run in GitHub Actions, report committed; add today's production replies (the long note, the possessive names, the brand-name figure) as regression cases | F-16 split | Backlog, returned from Sprint 4 |
| F-17 | The "After production deploy" Action has never run: Vercel does not appear to send GitHub deployment events. Check the repo's Deployments, then trigger on Vercel's event or a check after the CI run | F-15 split | Backlog, returned from Sprint 4 |
| F-18 | Invitees can't sign back in by email: Supabase's built-in email only reaches team members. A fresh invite to the same address is untested. Add an email service (with Rory's domain) or test and document the re-invite | Sprint 4 production check | Backlog, from Sprint 4 review |
| F-19 | A withdrawn sign-off shows as "expired" in the history; give it its own state | Sprint 4 build | Backlog, from Sprint 4 review |
| F-20 | The persona facts check compares segment keys only, not age or region | Sprint 4 build | Backlog, from Sprint 4 review |
| F-21 | Two runs started together can both pass the cap check before either is charged; and a Market refresh costs 15 to 20p. Reserve the estimate when a call starts; consider Haiku for the Market agent | Sprint 4 review and production check | Backlog, from Sprint 4 review |
| F-22 | A test pack (Markdown and PDF in `docs/testing/`) for each sprint's hand checks, per the sprint-close routine agreed 26 Oct; Sprint 4's checks were given in chat | Sprint 4 close | Folded into the Sprint 5 refinement |

## Not yet in a sprint (ranked)

Proposed for Sprint 5 (Creative I: copy and imagery), to refine and confirm: the Copy agent, the Imagery agent, code-drawn ad templates, the variant gallery, F-10 with logo upload, F-21 (images make the cap race expensive) and F-17 (Sprint 5 changes the run function, so the sync matters).

1. F-18 Invitees signing back in, before more interviewers are invited (M)
2. F-16a First real-model eval report and regression cases (S)
3. F-20 Persona facts check compares age and region (S)
4. F-19 Withdrawn sign-offs get their own state (S)
5. F-9 Dark theme, once the light design system has settled
6. Later-backlog items from the roadmap: multi-tenancy screens, Slack approvals, CSV import, Figma import, short video, live ad-platform connectors, skills authoring, role-based views

## Decisions

| Date | Decision |
| --- | --- |
| 24 Oct 2026 | Web app on Vercel and Supabase (0001); Inngest (0002); model provider layer and £1-a-day cap (0003); tenancy from day one (0004); image model never draws text (0005) |
| 25 Oct 2026 | Soft machine design direction (0006); functions run in London; redeploy by pushing to GitHub; Sprint 2 confirmed, light theme only for now |
| 25 Oct 2026 | Sprint 2 closed; demo data windows count back from each brand's "as of" time (`data_as_of`); Sprint 3 proposed |
| 25 Oct 2026 | Sprint 3 refined; Rory accepted all seven recommendations (segments saved without approval, Sonnet for briefs, no chaining, section-level revise, keep every version, code-only graders, Campaigns in the nav) |
| 26 Oct 2026 | Sprint 3 closed: Audience and Brief agents live on production; evidence checks in code (0009); Inngest resynced after the run-function change; Sprint 4 proposed |
| 26 Oct 2026 | Sprint 4 refined: invites by link Rory sends himself (Supabase's own email only reaches team members); real rival names allowed in market notes only, rule 2 to be reworded; previews on a second free Supabase project; market on Sonnet, personas and test plan on Haiku; sign-offs open 14 days |
| 26 Oct 2026 | Sprint 4 closed: demo gate 1 met on the public address; Market agent fixed in four production rounds (three searches, figures checked against the cited pages, notes that fail are left out); previews on their own Supabase project; Sprint 5 proposed |
