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
| F-17 | The "After production deploy" Action has never run: Vercel does not appear to send GitHub deployment events. Check the repo's Deployments, then trigger on Vercel's event or a check after the CI run | F-15 split | Done, Sprint 5 |
| F-18 | Invitees can't sign back in by email: Supabase's built-in email only reaches team members. A fresh invite to the same address is untested. Add an email service (with Rory's domain) or test and document the re-invite | Sprint 4 production check | Split: F-18a (new sign-in link) Done, Sprint 5; the email service is N-3, Ready, Sprint 6 |
| F-19 | A withdrawn sign-off shows as "expired" in the history; give it its own state | Sprint 4 build | Backlog, from Sprint 4 review |
| F-20 | The persona facts check compares segment keys only, not age or region | Sprint 4 build | Backlog, from Sprint 4 review |
| F-21 | Two runs started together can both pass the cap check before either is charged; and a Market refresh costs 15 to 20p. Reserve the estimate when a call starts; consider Haiku for the Market agent | Sprint 4 review and production check | Done, Sprint 5 (the reservation; the Market model stays Sonnet, Q6) |
| F-22 | A test pack (Markdown and PDF in `docs/testing/`) for each sprint's hand checks, per the sprint-close routine agreed 26 Oct; Sprint 4's checks were given in chat | Sprint 4 close | Done, Sprint 5 |

## Sprint 5: Creative I, copy and imagery (closed 27 October 2026)

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| F-21 | Reserve spend before each call, so concurrent calls can't pass the cap together | S | Done, Sprint 5 (reservations under an app-wide then workspace lock; a failed charge write keeps the reservation; two tabs can't both start the same paid run) |
| F-17 | Sync Inngest after each deploy by polling the health endpoint for the new commit | S | Done, Sprint 5 (first production run green in 73 s; three tries for the sync after one cold start failed) |
| F-18a | New sign-in link for an invitee (split from F-18) | S | Done, Sprint 5 (TC-9: same user, same workspace) |
| F-10 | Logo upload (SVG and PNG) and the sanitiser's false refusals | S/M | Done, Sprint 5 (TC-8). Residual: a cleaned SVG must fit the existing 50,000-character column, so a very detailed SVG is refused with a suggestion to upload a PNG |
| S5-1 | Images through the provider layer (Nano Banana 2.1, 1K), assets in Postgres, Imagery agent (Haiku) with prompt and vision checks | L | Done, Sprint 5, after three production fixes (reply limit, ruled-out faces and prompts left out, Google's free-tier quota). Production: four pictures in about 15 s each, 2.65p each, all passing the text check first time, about 40 KB each. Residual: the vision check looks for text only; faces for finance brands are kept out by the prompt check (F-24) |
| S5-2 | Copy agent (Sonnet): sets per audience and channel, channel limits and the brief's checks, no testimonials | M | Done, Sprint 5 (production: 4.0p with one repair, for a repeated legal line and a Title Case "Your Quillmoor") |
| S5-3 | Ad templates composed in code: three 1:1 layouts, bundled open fonts, contrast and fit checked | L | Done, Sprint 5 (TC-6; simulated pictures carry their own label in every layout) |
| S5-4 | Variant gallery: pick, discard, new picture, new words, edit words | M | Done, Sprint 5 (TC-1 to TC-7: 12 ads in 37 s for about 14.7p; full-size view added after TC-2). Residual: the worst case shown on the button is 31p against the refined 20p (F-25) |
| F-22 | Test pack for Rory's hand checks (Markdown and PDF) | S | Done, Sprint 5 (`docs/testing/sprint-5-test-pack.md` and `.pdf`; all ten cases pass) |

Evidence: 418 unit, database and agent tests and 51 end-to-end specs passing; mock evals for all eight agents; the real-Supabase CI job green and now required; fresh-eyes review with 12 findings and 5 nits, all fixed before deploy (decisions 0011 to 0014); five migrations applied by the connector to preview then production; Rory's test pack, all ten cases passing. Nothing returned to the backlog. Detail: `docs/refinement/sprint-5.md`, "Review evidence" and "Production check notes".

## Where the Sprint 5 review items now live

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| F-23 | Gate production on the checks: Vercel waits for GitHub's checks before a production deploy, and `main` takes changes only through pull requests whose checks pass. About ten minutes more per deploy; worth it before real users arrive. Today CI reports (and emails) but doesn't stop a deploy | Rory, 27 Oct 2026, after the real-Supabase job was made required | Backlog |
| F-24 | The picture check looks for text only. For finance brands, ask it about faces too (a close-up face is refused in the prompt today, but a picture could still show one) | Sprint 5 production check (picture 3: correct, but only the prompt kept the face out) | Backlog, from Sprint 5 review |
| F-25 | Make creative's worst case is 31p (every picture redrawn, every call repaired at full length) against the refined 20p; a typical run measured 14.7p. Options: one redraw across the four pictures, or a lower output allowance for repairs | Sprint 5 review, finding 9 | Backlog, from Sprint 5 review |
| F-26 | Redraw existing ads with the current kit, at no AI cost, after a logo, palette or font change (today ads keep the kit they were made with, and a change means new pictures) | Sprint 5 build (decision 0014) | Backlog, from Sprint 5 review |
| F-27 | Several audiences: the gallery shows the first audience's ads, and New words isn't offered on other audiences' words | Sprint 5 build | Backlog, from Sprint 5 review |
| F-16a | Folded: add today's Imagery production replies (the cut-off reply, the ruled-out face, the aspect wording) to the real-model eval regression cases | Sprint 5 production check | Folded into F-16a |

## Sprint 6: move from Supabase to Neon (closed 2 November 2026)

Supabase's free plan allows two active projects and Studio used both, so no other demo app could run. Production moved to Neon on 29 October. Detail: `docs/refinement/sprint-6.md`.

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| N-1 | Neon project in London; the shim becomes a real baseline migration (`auth.users`, `auth.uid()`, roles); `db:migrate` with a record of applied files; migrations applied by Claude through the Neon connector | M | Done, Sprint 6 (26 files on `production` and `preview`, each fingerprint-identical to a local build; the connector's migration tool can't handle function bodies, so files go through `run_sql_transaction` with `scripts/neon-statements.mjs`) |
| N-2 | Studio's own sign-in: hashed session tokens in an httpOnly cookie; invites start a session directly; Supabase packages removed | M | Done, Sprint 6 (TC-10; dead cookies are cleared after the review) |
| N-3 | Sign in by email through Resend from a mcclelland.info subdomain, rate limited (closes F-18) | M | Done, Sprint 6 (TC-6, TC-9; daily limits of 10 per address and 80 in all added after the review). Residual: some links on cutover day were never sent, most likely the connection bug (decision 0016); step logs now show every request |
| N-4 | CI's required real-stack job runs on a throwaway Neon branch | S | Done, Sprint 6 (green; the agent tests stay on plain Postgres because a US runner times out against London) |
| N-5 | Previews on a long-lived Neon `preview` branch with demo data (replaces F-8's second Supabase project) | S | Done, Sprint 6 (health check on the `preview` branch, mock model). Residual: Rory's sign-in on a preview (TC-1) not reported |
| N-6 | Production cutover: data copied by a one-off Action, row counts and asset hashes checked, rehearsed first; Supabase kept 14 days as the way back | M | Done, Sprint 6 (29 Oct: copy 68 s, "Copy matches", 18 MB). Residual: the post-switch check (TC-5) wasn't run, as Studio was already in use; two production fixes the same day (workspace lock, dropped connections, decision 0016) |
| N-7 | Clean-up: keep-awake cron, Supabase code removed; hosting docs, CLAUDE.md, decision 0015, a new-demo-app guide | S | Done, Sprint 6, split: what must wait for Supabase's 14 days became N-7a |
| N-8 | Test pack for Rory's hand checks | S | Done, Sprint 6 (`docs/testing/sprint-6-test-pack.md` and `.pdf`; nine of eleven pass, TC-1 partly checked, TC-5 not run) |

Evidence: 532 unit, database and agent tests and 55 end-to-end specs; CI green on Neon; fresh-eyes review with one must-fix and six should-fix findings, all fixed before the switch; two rehearsals; the connection fix reviewed separately and its three findings fixed before deploy; decisions 0015 and 0016.

## Where the Sprint 6 review items now live

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| N-7a | After 12 November (Q6): remove the one-off copy Action, `scripts/copy-data.mjs`, `scripts/check-copy.mjs` and their test; the `cutover` environment and its secrets; Supabase's three Vercel variables; then pause and delete both Supabase projects (Rory) | N-7 split | Backlog, returned from Sprint 6; Ready, Sprint 7 |
| F-28 | The `postgres` 3.4.9 patch (decision 0016): report the three bugs upstream, drop the patch when a release fixes them, and watch production's logs for connection errors for a week (behaviour under a real Vercel suspension is unverified) | Cutover day | Backlog, from Sprint 6 review; Ready, Sprint 7 |
| F-29 | `NEON_API_KEY` is a repository secret, so CI on any branch can fetch any branch's connection string, production's included. Move the CI job to a GitHub environment or use a narrower key | Sprint 6 review, note | Done, 5 Nov 2026 with F-34: `NEON_API_KEY` is now a key scoped to the CI project only |
| F-34 | Neon alert (early November): `campaign-studio` reached 100% of its 1 GB storage, which blocks writes on production. Cause: CI's throwaway branches in the same project (production has written 48 MB in all). Fix: CI in its own Neon project, `campaign-studio-ci` (decision 0015 update); the old `ci` branch stays as `preview`'s parent | Neon alert, Rory, 5 Nov 2026 | Done, 5 Nov 2026 (merged as `85f4cc0` with Rory's approval; CI passed on the new project with his project-scoped key) |
| F-31 | Try `postgres` 4.0.0 (released 29 Oct 2026, a rewrite of the connection code that checks for a closed connection before writing): upgrade on a branch, run the dropped-connection tests without the 3.4.9 patch, and drop the patch if they pass; keep it if not. Replaces reporting the 3.4.9 bugs upstream (F-28) | Sprint 7, F-28 | Backlog, from Sprint 7 (Rory, 2 Nov) |
| F-30 | A database error caught inside an `asUser` callback could let later statements run on a connection that has reconnected, outside the transaction and its role. Don't swallow database errors there; optionally make a transaction refuse statements after its connection closes | Connection-fix review, note | Backlog, from Sprint 6 review |
| F-23 | Folded: on this plan GitHub doesn't enforce required checks or reviewers on a private repository, so F-23 needs Vercel's own "wait for checks" or a plan change | Sprint 6 review | Folded into F-23 |

## Sprint 7: Creative II, sizes, languages and the launch pack (closed 3 November 2026)

A picked ad becomes a launch pack: every size each channel needs, in English and three more languages, checked, in one zip with a manifest. Detail: `docs/refinement/sprint-7.md`, "Review evidence".

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| F-26 | Redraw ads with the current kit | S | Done, Sprint 7 (one or all, no AI cost, with undo) |
| F-27 | Several audiences in Make creative, the gallery and New words | M | Done, Sprint 7 (24 ads in two groups; New words on the second audience changes only its 4 ads; cost shown is unchanged) |
| C7-1 | Sizes: four social sizes and three banners from one ad, 2K pictures, attention crop or boxed picture | L | Done, Sprint 7. Residual: crops on real 2K pictures are a hand check (N-8d, HC-1) |
| C7-2 | Languages: Localise agent (Sonnet), per-brand languages (French, German and Spanish first), legal lines per language written by a person, overflow checked in every size | L | Done, Sprint 7. Residual: translation quality with the real model and Rory's review of the demo legal lines are hand checks (N-8d, HC-2 and HC-3). C7-2 #3 is checked on the square, not 4:5 (layout fallback) |
| C7-3 | Launch pack: a streamed zip per campaign with manifest and README, picked ads only | M | Done, Sprint 7 (64 ads in 19.7 s, 22.6 MB, in CI) |
| F-28 | Watch production for a week; the upstream report was dropped on 2 Nov | S | Split: the decision is done (report withdrawn, F-31 replaces it); the week's log watch is F-28a, returned |
| N-7a | Remove the cutover pieces and Supabase, on or after 12 November | S | Backlog, returned from Sprint 7 (waits for 12 Nov; reminder set) |
| N-8b | Test pack, hand checks only | S | Done, Sprint 7 (`docs/testing/sprint-7-test-pack.md`, Markdown only); running the checks is N-8d, returned |
| N-8c | Demo sign-off: case list, browser tests for Sizes and several audiences, recordings, results to `e2e-results/ci/<branch>`, the demo page, an independent QA review | M | Done, Sprint 7 (Rory signed off 3 Nov from CI run 41547303603) |

Evidence: 718 unit, database and agent tests and 33 browser tests (22 Sprint 7 cases) passing in CI, with recordings; an independent QA review of the tests against the agreed cases, with 12 findings, all fixed before the demo; the demo page built from CI's results; two migrations applied by the connector to preview and then production, checked by fingerprint; decisions 0017 to 0021. Sprint 7 went to production on 2 Nov before its demo (Rory approved), which decision 0021 records.

## Where the Sprint 7 review items now live

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| N-8d | Rory's four production hand checks, HC-1 to HC-4 in `docs/testing/sprint-7-test-pack.md`: crops on real 2K pictures, the demo legal lines, translation quality, a launch pack from real creative. About 20 minutes and 26p; a failure becomes a BUG- row | N-8b split | Backlog, returned from Sprint 7 (Rory, 3 Nov) |
| F-28a | Watch production's logs for connection errors (`CONNECT_TIMEOUT`, `Cannot read properties of null`) until 9 November; Vercel keeps one hour, so Claude checks on each visit | F-28 split | Backlog, returned from Sprint 7 |
| F-32 | The results branch grows the repository: each push adds about 25 MB of recordings, and force-pushes leave old objects for GitHub to collect. Keep fewer recordings, shorten them, or store them outside git | Demo pipeline build | Backlog, from Sprint 7 review |
| F-33 | Merge the sign-off pipeline, QA test fixes and the `data-words` attribute to `main` (a production deploy, with nothing visible to users), once Rory approves the deploy | Sprint 7 close | Done, Sprint 8 (deployed with Sprint 8 at `3be96cf`, 3 November) |
| QA-7 | Folded: the independent QA review's 12 findings on the Sprint 7 tests | Sprint 7 QA review | Fixed in Sprint 7 (`68999d5`), before the demo |

## Sprint 8: Compliance and pre-testing (closed 6 November 2026)

Every ad in the pack checked against the brand's and the channel's rules in every size and language, as pass, review or fail with the reason and a fix; a synthetic panel scores picked ads before spend. Demo gate 2. Detail: `docs/refinement/sprint-8.md`.

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| C8-1 | Compliance checks in code: contrast margin, legal lines, banned terms, logo safe zone, text density, 9:16 platform zones, don't rules for a person; decisions recorded; the pack holds only ads that pass or are accepted | L | Done, Sprint 8 (signed off 3 Nov, CI run 41717589833; deployed as `3be96cf`) |
| C8-2 | Vision checks for judgement calls (faces for finance brands, the kit's don't rules), with F-24 folded in; Check pictures for older campaigns | M | Done, Sprint 8. Residual: real-model judgement is a hand check (N-8e, passed) |
| C8-3 | Check an uploaded ad: words read by AI, checked in code; estimates labelled | M | Done, Sprint 8 (upload limit 4 MB, decision 0025) |
| C8-4 | Pre-test panel: the brief's personas score picked ads, labelled synthetic | M | Done, Sprint 8 |
| F-33 | Merge Sprint 7's tests and pipeline to `main` | S | Done, Sprint 8 (merged with Sprint 8 at `3be96cf`) |
| N-7a | Remove the cutover pieces and Supabase, on or after 12 November | S | Returned from Sprint 8 (waits for 12 Nov); carried into Sprint 9 |
| F-28a | Watch production's logs until 9 November | S | Returned from Sprint 8 (runs to 9 Nov); carried into Sprint 9 |
| N-8d | Rory's Sprint 7 hand checks | S | Done, Sprint 8 (Rory reported them passed, 6 Nov) |
| N-8e | Sprint 8 test pack, hand checks of real AI output only | S | Done, Sprint 8 (`docs/testing/sprint-8-test-pack.md`; Rory reported HC-1 to HC-4 passed, 6 Nov) |

## Where the Sprint 8 review items now live

No new findings came from the demo or the hand checks. The two items raised during the sprint, F-34 (Neon storage) and F-29 (the narrow key), are in the Sprint 6 table above, both done on 5 November.

## Sprint 9: Performance I, the simulator and monitor (refined and confirmed 6 November 2026)

Picked, compliant ads launch into a simulation after an approval. The simulation gives deterministic daily results, with fatigue and events. A Performance dashboard is headed by healthy spend share. A monitor raises alerts and answers questions from the stored results. Every figure is simulated and labelled. Detail: `docs/refinement/sprint-9.md`.

| ID | Item | Size | Status |
| --- | --- | --- | --- |
| F-23 | Production deploys wait for the checks: Vercel's Deployment Checks, or a deploy hook from CI's last job | S | Ready, Sprint 9 |
| P9-1 | Launch a simulated campaign: budget, length, start date and KPI threshold; the pack's eligibility rule; approval in the inbox | M | Ready, Sprint 9 |
| P9-2 | The simulator: daily results per ad from a seed, fatigue, weekends, UK bank holidays, Black Friday; a clock a person moves | L | Ready, Sprint 9 |
| P9-3 | Performance dashboard and healthy spend share; one line on Studio's home | M | Ready, Sprint 9 |
| P9-4 | Monitor agent: alerts in code (below threshold, tiring, not compliant) and ask-your-data (a typed query plan, figures checked in the answer) | M | Ready, Sprint 9 (ask-your-data first to move if over) |
| F-16a | First real-model eval run and report, with the production regression cases | S | Ready, Sprint 9 (Rory adds or checks the key in GitHub) |
| F-28a | Watch production's logs until 9 November | S | Carried from Sprint 8 |
| N-7a | Remove the cutover pieces and Supabase, on or after 12 November | S | Carried from Sprint 8 |
| N-9a | Sprint 9 test pack, hand checks of real AI output only (the monitor's answers) | S | Ready, Sprint 9 |

## Where the F-16a eval findings now live

F-16a's first real-model runs (6 and 7 November; reports on `e2e-results/evals/sprint-9`). Run A (brief, market) cost 57p, run B (copy, localise and the nine small agents) 83p, and imagery's three parts 42p, 25p and 41p: £2.49 in all, each run under its £1 cap. Every failure is a row here, for ranking at the Sprint 9 review.

| ID | Item | Source | Status |
| --- | --- | --- | --- |
| BUG-2 | Audience on Haiku: 0 of 4. Two replies aren't valid JSON; two put numbers in segment text, which the checks refuse | F-16a run B | Backlog, from F-16a's run |
| BUG-3 | Persona on Haiku: 0 of 4. Two replies aren't valid JSON; two fail in the brief step (BUG-4) | F-16a run B | Backlog, from F-16a's run |
| BUG-4 | The brief's quantities-in-words check refuses "most of", "Many people", "a good share of" and "Plenty of customers", and the brief keeps writing them: it fails cases in brief, copy, persona, testPlan and imagery (whose cases make a brief first). The prompt and the check disagree | F-16a runs A, B and imagery part 2 | Backlog, from F-16a's run |
| BUG-5 | Localise: 3 of 6. French and Spanish paid-social bodies don't fit 1080 × 1080 Full bleed; one French headline is 41 characters (limit 40) | F-16a run B | Backlog, from F-16a's run |
| BUG-6 | Brief: the Quillmoor win-back brief mentions a guarantee; one insight cites more than the schema's four sources | F-16a run A | Backlog, from F-16a's run |
| BUG-7 | Monitor answer: invited to forecast, the model wrote "next month"; the check refused it (nothing wrong was shown), but the person gets no answer | F-16a run B | Backlog, from F-16a's run |
| BUG-8 | Pretest: one reply of six isn't valid JSON | F-16a run B | Backlog, from F-16a's run |
| BUG-9 | Eval reports show 0 tokens and 0p for a case that errored, so each agent's cost undercounts; the run's total, from the usage ledger, is right | F-16a run B | Backlog, from F-16a's run |
| BUG-11 | Imagery, Fernhollow winter range: the brief reached the image-prompt model with the brand's name in it, which invites the picture model to draw it as text (rule 8) | F-16a imagery part 3 | Backlog, from F-16a's run |
| BUG-12 | Imagery, Fernhollow winter range: 3 of 4 pictures kept; one was dropped | F-16a imagery part 3 | Backlog, from F-16a's run |
| BUG-10 | The monitor's answer check rounded half-way figures differently from the table (£8.335 shown as £8.34, checked as £8.33), so about 3.6% of correct answers were refused; it made P9-4.4's browser test flaky | Sprint 9 demo CI run (passed on a retry) | Done, Sprint 9: the check also accepts the figure exactly as the table shows it |
| F-35 | The monitor workflow's plan and answer steps catch every error, so a transient database or Inngest error becomes a permanent "AI unreached" refusal instead of a retry | BUG-10 investigation | Backlog, from Sprint 9 |

## Not yet in a sprint (ranked)

Re-ranked at the Sprint 8 close; Sprint 9 is above.

1. F-30: don't swallow database errors inside transactions (S), with F-31.
2. F-31: try `postgres` 4.0.0 and drop the patch if the dropped-connection tests pass (S).
3. F-32: keep the results branch small (S). Sprint 9 adds recordings, so it moves up.
4. F-20: the persona facts check compares age and region (S).
5. F-19: withdrawn sign-offs get their own state (S).
6. F-25: a cheaper worst case for Make creative (S).
7. F-9: the dark theme, once the light design system has settled.
8. Sprint 10 (Performance II: fatigue forecasts, swaps, diagnostics, budget, and the test plan's sample sizes) and Sprint 11 (the flywheel, demo mode and launch), from the roadmap.
9. Later-backlog items from the roadmap: multi-tenancy screens, Slack approvals, CSV import, Figma import, short video, live ad-platform connectors, skills authoring and role-based views.

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
| 26 Oct 2026 | Sprint 5 refined: Nano Banana 2.1 at 1K; images kept in Postgres; Copy on Sonnet, Imagery and vision checks on Haiku; vision check for text now; SVG and PNG logos; bundled open fonts; no testimonials; Market stays on Sonnet |
| 27 Oct 2026 | Sprint 6 refined: move to Neon (London), Studio's own sign-in, migrations recorded and applied by Claude through the Neon connector, Resend for sign-in links (folds in F-18), previews and CI on Neon branches, Supabase kept 14 days; starts after Sprint 5 closes |
| 27 Oct 2026 | Sprint 5 closed: all nine items done; a signed-off brief becomes 12 checked ads in 37 s for about 14.7p; three Imagery fixes and a full-size view from the production check; the real-Supabase CI job is required; Sprint 6 (Neon) confirmed to start next |
| 28 Oct 2026 | Sprint 6 built and reviewed; production's database password reset so no branch shares it; migrations applied by the connector one file per transaction, checked by schema fingerprint |
| 29 Oct 2026 | Production moved to Neon (copy 68 s, "Copy matches"); the same day, a workspace-lock hang and dropped-connection crashes fixed (decision 0016: `postgres` 3.4.9 patched); idle transactions end after 15 s |
| 2 Nov 2026 | Sprint 6 closed: all eight items done, N-7 split (N-7a after 12 Nov); new rows F-28 to F-30; Sprint 7 (Creative II) to be refined |
| 2 Nov 2026 | F-28: don't report the 3.4.9 driver bugs upstream (4.0.0 rewrote that code and similar issues are closed); try 4.0.0 instead, as F-31 (Rory) |
| 2 Nov 2026 | Studio adopts the build working agreement (decision 0021): Claude is QA, Rory signs off from a demo page built from CI's browser tests, hand checks only for real AI output; the live site changes only after sign-off. Sprint 7 had already been deployed to production (Rory approved) before its demo existed; its demo and sign-off follow, and from Sprint 8 the merge to `main` waits for sign-off (Rory) |
| 2 Nov 2026 | Sprint 7 refined and confirmed (all as recommended): 2K pictures; three banners with honest refusals; per-brand languages, French, German and Spanish first; legal lines per language written by a person; Sonnet translates; picked ads in the pack, no approval to download; N-7a on or after 12 Nov |
| 3 Nov 2026 | Sprint 7 closed: Rory signed off from the demo page (CI run 41547303603); all five stories and N-8c done; F-28 and N-8b split (F-28a log watch, N-8d hand checks); N-7a returned (12 Nov); new rows F-32 and F-33; the independent QA review's 12 findings fixed before the demo; Sprint 8 (Compliance and pre-testing) proposed |
| 3 Nov 2026 | Sprint 8 (Compliance and pre-testing) refined; Rory took all seven answers as recommended: Studio's own thresholds in one config file, density not on banners, review items accepted inline, only the finance face rule fails on the model's word, unaccepted reviews left out of the pack, pre-test on a click, the 9:16 zone rule in Sprint 8 |
| 3 Nov 2026 | Sprint 8 signed off from the demo page (CI run 41717589833) and deployed with Rory's approval: five migrations applied to preview, then production (both match a fresh build in all 11 fingerprint parts), merged to `main` as `3be96cf`; CI and After production deploy passed, health OK. Hand checks (N-8d, N-8e) follow on production |
| 5 Nov 2026 | CI moves to its own Neon project, `campaign-studio-ci`, after Neon's storage alert; its key is scoped to that project (F-34, F-29; decision 0015 update) |
| 6 Nov 2026 | Sprint 8 closed: C8-1 to C8-4, N-8d and N-8e done (Rory reported the hand checks passed); F-28a and N-7a carried into Sprint 9 (dated); no new findings. Sprint 9 (Performance I: simulator and monitor) refined, with F-23 and F-16a proposed to join |
| 6 Nov 2026 | Sprint 9 confirmed (all seven as recommended): launches approved in the inbox; a clock a person moves; base rates from the seed, not the panel; learning spend outside the share; Deployment Checks or a deploy hook (F-23); Rory checks the eval key (F-16a); four KPI measures |
