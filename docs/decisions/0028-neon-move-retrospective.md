# 0028 Retrospective: the move from Supabase to Neon

**Date:** 9 November 2026. **Status:** recorded (Rory asked for it). Looks back on 0015 (Neon and Studio's own sign-in) and 0016 (dropped database connections), eleven days after production moved on 29 October. Changes no decision; the follow-ups are backlog items.

## Why we moved

Supabase's free plan allows two active projects, and Studio's production and preview projects used both, so no other demo app could run. Rory expects to run several small demonstration apps. Neon's free plan allows 100 projects, each with its own compute and storage allowance, and never pauses an idle project (0015, Part 1).

## What we hoped for, and what happened

Figures from Neon and Supabase on 9 November 2026, and from the Sprint 6 record (`docs/refinement/sprint-6.md`).

| Hope | Outcome |
| --- | --- |
| Studio runs free | **Met.** Both Neon projects (`campaign-studio`, `campaign-studio-ci`) are on the free plan. This month: about 3.5 of production's 100 compute hours and about 4 of CI's 100; production's data is 44 MB against 1 GB |
| Room for several small demo apps | **Not yet tested.** Neon holds only Studio's two projects. The Supabase slots the move freed went to `rfi-respond-demo` and `rfi-respond-staging`, so Supabase's two free slots are full again, and the next demo app has to go on Neon anyway |
| No pausing, no keep-awake cron | **Met.** The cron is gone; nothing has been paused |
| Data moved intact, nobody locked out | **Met.** Copy 68 s, "Copy matches" (every row count and picture hash); same ids; sign-in by email worked for Rory and an invitee |
| About 3 to 5 days of work | **Met for the move** (built 27 to 29 October), plus about a day and a half of follow-ups over the next week (below) |
| Snappy for the UK and Japan | **A little slower when idle.** Warm queries 3 to 72 ms (Supabase 3 ms); the first query after 5 idle minutes 0.1 to 0.8 s (Supabase 94 ms). Rory: fine once warm. Japan unchanged: neither has a Tokyo region |

## What went well

- **Earlier choices made it small.** Data access was already plain Postgres through `asUser()`, the Data API was off (F-12a), and tests already ran without Supabase (the shim). Only sign-in had to be rebuilt.
- **Rehearsals.** The first rehearsal failed (it couldn't make the tests' branch); the copy on the day was right first time.
- **Sign-in is better than before.** Invitees sign themselves back in by email (F-18 closed), and the pattern can be copied into the next app (`docs/new-demo-app.md`).
- **Migrations have a ledger** and are checked by schema fingerprint, which Supabase never had.

## What didn't

- **Cutover day.** Pages hung for about 10 minutes behind a lock held by a transaction left open, then requests crashed. Neon closes idle connections far more often than Supabase's pooler did, which exposed three bugs in `postgres` 3.4.9. We now carry our own patch of the driver (0016). Its behaviour under a real Vercel suspension is unverified, but the log watch to 8 November found no errors (F-28a).
- **Lost sign-in emails** on cutover day, most likely the same bug; the logs don't reach back far enough to prove it.
- **Neon storage hit 100% on about 5 November.** CI's throwaway branches counted against production's 1 GB, and a full allowance blocks writes on the live site. Fixed by moving CI to its own project (F-34, 0015 update). Refinement didn't foresee it.
- **Agent tests can't run on Neon** from GitHub's US runners (timeouts against London), so they stay on plain Postgres (N-4).
- **Two hand checks were skipped:** sign-in on a preview (TC-1) and nothing written to Supabase during the cutover (TC-5).

## Lessons

1. **Refine the platform's behaviour, not only the code.** The refinement assumed Neon would behave like Supabase apart from sign-in; the risks were in connections and storage. A move between hosts gets a short trial of connections under load and a storage check before cutover.
2. **CI goes in its own Neon project from the start.** Branch writes count against a project's storage (now in `docs/new-demo-app.md`).
3. **Measure the reason for the move.** It was several small projects, so the move isn't proven until a second app runs on Neon.

## Follow-ups

| Item | When |
| --- | --- |
| N-7a: remove the cutover pieces and Supabase's three Vercel variables; Rory deletes Studio's two (already paused) Supabase projects | On or after 12 November |
| F-31: try `postgres` 4.0.0 and drop the 0016 patch if the dropped-connection tests pass without it | Backlog |
| Put the next demo app on Neon from `docs/new-demo-app.md` and record its set-up time | The next new app |
| Whether RFI Respond moves is its own decision; check how much of Supabase it uses first | Not decided |
