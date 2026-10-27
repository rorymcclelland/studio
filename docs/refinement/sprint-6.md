# Sprint 6 refinement: move from Supabase to Neon

Refined 27 October 2026, from the code at `5cf136f`. Status: **all eight items Ready, Sprint 6** (Rory's answers at the end; six as recommended, Q4 changed). Not started until Sprint 5 is closed and Rory says go. Creative II moves to Sprint 7, and every later roadmap sprint moves back one.

## Sprint goal

Studio runs on Neon with its own sign-in, and nothing depends on Supabase. Rory and every invitee keep their accounts, workspaces, brands, campaigns, runs and images, with the same ids. Previews and CI run on Neon branches. Supabase is paused, kept as the way back for 14 days, then deleted.

**Why now:** Supabase's free plan allows two active projects, and Studio's production and preview projects use both, so no other demo app can run. Neon's free plan allows 100 projects, each with its own compute and storage allowance, and idle projects resume automatically instead of being paused.

**Demo:** sign in to the production address by email on Neon, open a campaign made before the move, and see its brief, personas, test plan and ads exactly as before. Then make new creative and see it costed against the same cap.

## What the code looks like today

- **Data access is already plain Postgres.** The app reads and writes through `postgres` (porsager) and `asUser()`, which sets `request.jwt.claims` and `set local role authenticated` in each transaction. The Data API is off (F-12a), so supabase-js is used only for sign-in.
- **The shim already stands in for Supabase.** `db/shim/supabase-shim.sql` creates the `anon`, `authenticated` and `service_role` roles, an `auth.users` table (id, email, created_at) and `auth.uid()`. Local work and CI run every migration on plain Postgres with it. On Neon, the shim becomes a real migration and `auth.users` becomes Studio's own table. `service_role` is never used and can go.
- **Migrations reference `auth.users`** for every `created_by`, `decided_by`, `used_by` and `approved_by` column (13 places), and two functions join `auth.users` to read an email. None use any other Supabase feature (no Storage, Realtime, edge functions or `auth.jwt()`).
- **Sign-in is the only real Supabase dependency.** Five files use it:
  - `src/lib/auth/supabase.ts` and `src/proxy.ts`: `@supabase/ssr` cookies and refresh on each navigation;
  - `src/lib/auth/session.ts`: `getClaims()` gives the user id and email;
  - `src/app/signin/actions.ts` and `src/app/auth/callback/route.ts`: magic links through Supabase's email, which reaches team members only;
  - `src/app/invite/[token]/actions.ts`: the admin API (`SUPABASE_SECRET_KEY`) creates the user and mints a sign-in.
- **A signed-cookie sign-in already exists** for local work (`AUTH_MODE=dev`, `dev-session.ts`), and invite tokens are already random, hashed and single use (`invites.ts`). Most of an own sign-in is in place.
- **No migration tracking.** Migrations were applied by the Supabase connector or pasted into the SQL editor; nothing in the repo records which are applied.
- **CI** has a required `real-stack` job that starts the Supabase CLI stack.
- **Hosting:** functions in London (`lhr1`); a daily Vercel cron calls `/api/health` to stop the free project pausing; previews use a second Supabase project (F-8).
- **The one advisory lock** (`ensure_workspace`) is transaction-scoped, so it works through a transaction-mode pooler.

## Neon facts this refinement rests on (checked 27 October 2026)

- Free plan: 100 projects, 10 branches each, 100 CU-hours of compute per project a month, 0.5 GB storage per project (Neon's blog says 1 GB since a recent change). Compute suspends after 5 minutes idle and resumes in a few hundred milliseconds.
- Region: AWS Europe (London), `aws-eu-west-2`, beside the functions. Neon has no Tokyo region, so Japanese users reach London as they do today.
- Studio's database is small: the largest table is `assets` (images up to 2 MB each, about 150 KB typical). Storage needs checking at cutover (N-5).

## Stories, in build order

### N-1 Neon project, baseline schema and a migration runner (M)

**The job.** A Neon database with exactly the schema Supabase has, built from the repo, with a record of what is applied, so no migration is ever applied twice or missed.

**Before and after.** Today migrations go in by hand, and the shim exists only for tests. After: `npm run db:migrate` applies whatever is pending to the database it is pointed at and records it, and the same files build local, CI, preview and production.

**What changes.**
- `supabase/migrations/` moves to `db/migrations/`. The shim becomes the first migration, `20261024000000_auth_schema.sql`: the `auth` schema, `auth.users`, `auth.uid()`, `auth.role()`, and the `anon` and `authenticated` roles (no `service_role`, no `bypassrls`). Its grants go to the connecting role by name, not `current_user`.
- New table `public.schema_migrations` (file name, sha256 of the file, applied_at). `scripts/db-migrate.mjs` applies pending files in order, each in its own transaction, refuses to run if an applied file's hash has changed, and has `--dry-run`. `db-reset.mjs` uses it.
- **Applying to Neon (Q4):** Claude applies pending files through the Neon connector, using its migration tools, which try a migration on a temporary branch before applying it. Each file is applied with its `schema_migrations` row in the same transaction, so the record and the schema can't disagree. `db:migrate` stays for local work and CI.
- Rory creates the Neon project `campaign-studio` in London, or Claude does through the Neon connector if he connects it (see "Rory's part").

**Test cases.**
1. On an empty database, `db:migrate` applies every file and records each one; a second run applies nothing.
2. Changing an applied file makes `db:migrate` stop with the file named, and nothing is applied.
3. A failing migration rolls back on its own and is not recorded; earlier ones stay recorded.
4. `--dry-run` lists the pending files and changes nothing; on Neon, the connector's pending list matches it.
5. On the Neon project: every migration applies, `set local role authenticated` works through the pooled connection, and the existing tenancy tests pass against it.
6. Schema comparison: tables, columns, constraints, policies and functions on Neon match production Supabase, apart from Supabase's own schemas (a script diffs `pg_dump --schema-only` of `public` from both).

**Out of scope.** Changing any table. The schema moves as it is.

**Risks.** Neon's owner role isn't a superuser. Creating the roles, granting them to the owner and `set role` are expected to work (Neon's own Data API uses an `authenticated` role); test case 5 proves it in the first hour.

### N-2 Studio's own sign-in: sessions and invites (M)

**The job.** Signing in no longer depends on any provider. A session is a random token in an httpOnly cookie, and only its hash is stored, as invite tokens already are.

**Before and after.** Today an invite calls Supabase's admin API to create a user and mint a sign-in. After: accepting an invite creates the user in `auth.users` if needed and starts a session directly. Everyone else signs in by email (N-3).

**What changes.**
- New table `auth.sessions` (id, user_id, token_hash, created_at, last_seen_at, expires_at). Not granted to `anon` or `authenticated`; the app reads it only through two security-definer functions, `public.session_user(token_hash)` and `public.end_session(token_hash)`.
- `src/lib/auth/session.ts`: `getCurrentUser()` reads the `cs_session` cookie, looks up the session, and still checks the allow-list or `is_invited()`, so revoking a person still locks them out on their next request. Sessions last 30 days and are extended when used after a day.
- Cookie: `cs_session`, httpOnly, Secure (except local), SameSite=Lax, path `/`. Sign-out ends the session in the database and clears the cookie.
- Revoking a person also ends their sessions.
- `acceptInvite()` creates or finds the user, redeems the invite and starts a session; no email.
- `proxy.ts`: no Supabase refresh; the welcome-page check looks for `cs_session`.
- `AUTH_MODE=dev` goes: local work and e2e use the real sign-in, with emails written to the console (N-3), so tests exercise the production path.
- `@supabase/ssr` and `@supabase/supabase-js` are removed.

**Test cases.**
1. Accepting an invite creates the user, starts a session and opens the empty workspace; the database holds only the token's hash.
2. Accepting a new sign-in link (F-18a) for an existing invitee signs in the same user, to the same workspace, with no second workspace.
3. A tampered, unknown, expired or ended session cookie is treated as signed out.
4. Sign-out ends the session: the same cookie no longer works, even replayed.
5. Revoking a person ends their open sessions, and their next request goes to sign-in.
6. A session older than its expiry is refused; one used after a day is extended.
7. Hostile: a cookie holding SQL, a 10 KB value or a valid-looking token for another user's hash gets no session; `anon` and `authenticated` can't read `auth.sessions` (database test).
8. The existing invite, tenancy and access tests pass unchanged apart from the sign-in helper.

**Out of scope.** Passwords, OAuth, passkeys, a sessions screen.

**Boundaries.** Rule 6: no new secret; tokens are random and only hashes stored. Rule 7: the session lookup returns a user id, and every read still goes through `asUser()`.

### N-3 Sign in by email (M)

**The job.** Rory, and anyone allow-listed or invited, signs in with a link sent to their email. This also lets invitees sign back in themselves, which closes F-18.

**Before and after.** Today the magic link comes from Supabase, which emails team members only, so invitees need a new link from Rory. After: anyone with access types their email and gets a link.

**What changes.**
- New table `auth.sign_in_tokens` (token_hash, email, created_at, expires_at 15 minutes, used_at). The sign-in page keeps its current reply, which doesn't reveal who has access.
- A small mailer: Resend's HTTP API in production (see Q2), sending from an address on a subdomain of mcclelland.info; the console locally, in CI and on previews.
- Opening the link shows **Continue** (a POST), as invites do, so link scanners can't use it up. It works once.
- Limits, to protect the free sending quota (100 a day) and stop abuse: 3 links per address per hour, 30 an hour in all.
- `/auth/callback` goes; `/signin/link/<token>` replaces it.
- The welcome and sign-in pages drop "Invited? Ask for a new sign-in link."

**Test cases.**
1. An allow-listed email gets a link; it signs in once; a second use, or use after 15 minutes, shows "This link has expired".
2. An invited, unrevoked person gets a link and lands in their own workspace.
3. An unknown or revoked email sees the same message and nothing is sent (the mailer records no send).
4. A fourth request within an hour for one address sends nothing and shows the same message.
5. Opening the link with GET doesn't use it; only Continue does.
6. Hostile: an email with header injection (`a@b.c\nBcc: x@y.z`) or 300 characters is refused by validation.
7. Production: Rory receives a link from the custom sender and signs in; it isn't in spam.

**Boundaries.** Rule 6: the Resend key lives in Vercel (Production, Sensitive) only. Rule 1: the email says what Studio is and that the link is single use.

**Dependency.** Rory adds the DNS records for the sending subdomain (SPF, DKIM) before the production check.

### N-4 CI on Neon (S)

**The job.** The required real-stack job proves the migrations and database tests on Neon, not the Supabase CLI stack.

**What changes.**
- `real-stack` becomes "Migrations and database tests on a Neon branch": it creates a branch from an empty `ci` parent, runs `db:migrate`, runs the database, agent and model tests, and deletes the branch, even when the tests fail.
- A Neon API key as a GitHub secret, scoped to the project if Neon allows it.
- The first job keeps plain Postgres; the shim file goes, because the baseline migration replaces it.

**Test cases.**
1. A push runs the job green on a fresh branch and leaves no branch behind.
2. A failing test still deletes the branch (a deliberate failure on a scratch branch).
3. Without the secret, the job fails with a message naming it.

**Risk.** The free plan allows 10 branches per project; CI branches are deleted at the end of each run, and concurrent runs are limited to one.

### N-5 Previews on a Neon branch (S)

**The job.** Previews keep their own database (F-8) without needing a second project anywhere.

**What changes.** A long-lived `preview` branch, made from the empty `ci` parent and seeded with the demo brands, not copied from production (see Q3). Vercel's Preview `DATABASE_URL` points at it. Previews keep the mock model.

**Test cases.**
1. A preview's health check names the preview branch's host, and a run there uses the mock model.
2. Rory can sign in on a preview (link written to the logs, or the allow-list) and sees only demo data.
3. Nothing written on a preview appears in production.

### N-6 Production cutover (M)

**The job.** Production moves to Neon with all its data, the same ids, a short pause and a tested way back.

**What changes.**
- A **Copy production data** GitHub Action (manual, run once, then removed): `pg_dump --data-only` of `public`, plus `id, email, created_at` from Supabase's `auth.users`, restored into the Neon production branch after N-1's migrations. Both connection strings are secrets on a protected environment, so neither touches chat or a laptop.
- Order: user rows first, then `public` in dependency order. The guard triggers (append-only versions, fixed run output) are switched off per table during the copy and back on after, as the table owner.
- A check script compares row counts for every table and the sha256 of every asset on both sides, and checks that no foreign key is broken.
- **Cutover steps** (runbook in `docs/hosting.md`): pick a quiet time with no run in progress; copy; check; switch Vercel's Production `DATABASE_URL`; redeploy by pushing; run the after-deploy sync; smoke test. Runs waiting for approval in Inngest carry on, because their ids are unchanged.
- **Way back:** Supabase stays as it was, untouched, for 14 days. Switching `DATABASE_URL` back and redeploying restores it; anything done on Neon in between is lost, so the 14 days are for finding problems, not running both.
- Everyone is signed out by the move. Rory signs in by email; invitees can too (N-3).

**Test cases.**
1. A rehearsal into a scratch Neon branch matches row counts and asset hashes exactly, and the full test suite passes against it.
2. After cutover, the same checks match on production Neon.
3. Rory signs in, opens a campaign from before the move, and sees its brief versions, personas, test plan, variants and images.
4. A new Make creative completes and is charged against today's cap, including spend from before the move.
5. An invitee's workspace and data are intact, and they can sign in by email.
6. Timing: page loads on production after a cold start and when warm, from the UK, recorded against the same pages on Supabase before the move.
7. Storage used after the copy is recorded against the free limit.

**Risks.**
- The copy could hit a check or trigger the schema dump doesn't show. The rehearsal (test case 1) finds it first.
- First request after 5 idle minutes waits a few hundred milliseconds while Neon resumes. Test case 6 measures it; the free plan can't keep compute on.

### N-7 Clean-up and records (S)

**The job.** Nothing refers to Supabase, and the setup is written down for the next demo app.

**What changes.**
- Remove the keep-awake cron from `vercel.json` (Neon doesn't pause projects); keep `/api/health`.
- Remove Supabase variables from Vercel (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) after the 14 days; `configProblems()` checks the new ones (`RESEND_API_KEY`, `EMAIL_FROM`).
- Rewrite `docs/hosting.md` for Neon; update CLAUDE.md (architecture, rules 6 and 7 wording, paths), README and `.env.example`.
- Decision 0015, "Neon and Studio's own sign-in", superseding the Supabase parts of 0001 and 0010.
- A short `docs/new-demo-app.md`: the sign-in, migrations and Neon set-up to copy into the next app.
- After 14 days: pause, then delete, both Supabase projects (Rory, Q6).

**Test cases.**
1. `grep -ri supabase` finds only history (refinements, decisions, the backlog).
2. The startup check names a missing `RESEND_API_KEY` in production.
3. A fresh clone with only `.env.example` filled in runs `db:reset`, the tests and the app.

### N-8 Test pack (S)

`docs/testing/sprint-6-test-pack.md` and `.pdf`, as the sprint-close routine requires: the production checks in N-3, N-5 and N-6, written for Rory signed in as himself.

## The sprint as a whole

| Order | Item | Size | Depends on |
| --- | --- | --- | --- |
| 1 | N-1 Neon project, baseline, migration runner | M | Neon account and connector |
| 2 | N-2 Own sessions and invites | M | N-1 |
| 3 | N-3 Sign in by email | M | N-2; DNS for the live check |
| 4 | N-4 CI on Neon | S | N-1; Neon API key |
| 5 | N-5 Previews on a branch | S | N-1 |
| 6 | N-6 Production cutover | M | N-1 to N-5 |
| 7 | N-7 Clean-up and records | S | N-6 |
| 8 | N-8 Test pack | S | all |

**Size:** four M and four S, about four to five days: lighter than Sprint 5. The S items are mostly configuration.

**If it runs over:** N-3 can ship with the console mailer and the email check left for later, but then Rory can only sign in through an invite-style link, so N-3 is the last thing to cut. N-4 can fall back to plain Postgres for a sprint.

**No spikes.** The one real unknown, whether roles and `set role` work on Neon, is the first hour of N-1, and the cutover is rehearsed before it is done.

**Costs.** No model spend beyond test runs. Neon, Resend and GitHub Actions stay on free plans.

## Boundaries check

- **Rule 1:** no change to what is shown; the welcome page's honesty text stays.
- **Rule 4 and 5:** `agent_steps`, `usage_ledger` and `spend_reservations` move with their rows, so today's cap and every trail survive the move (N-6 test case 4).
- **Rule 6:** new secrets (Neon connection strings, Neon API key, Resend key) go only into Vercel and GitHub secrets; the data copy runs in an Action so no string reaches chat or a laptop.
- **Rule 7:** RLS, the membership policies and `asUser()` are unchanged; the session lookup is the only new path, and it returns a user id only.
- **Rule 3 and 8:** untouched.

## Rory's part

Credentials never go in chat; each goes straight where it is used.

1. Create a Neon account and connect the Neon connector in claude.ai, so Claude can create the project `campaign-studio` in AWS Europe (London), its `ci` and `preview` branches, and apply migrations (Q4).
2. Put the connection strings in place: production pooled string as Vercel Production `DATABASE_URL` (at cutover, not before); the `preview` branch's pooled string as Vercel Preview `DATABASE_URL`; the production unpooled string as a GitHub environment secret for the one-off data copy.
3. A Neon API key as the GitHub secret `NEON_API_KEY` (N-4).
4. A Resend account; verify a sending subdomain of mcclelland.info by adding its DNS records; the API key as Vercel Production `RESEND_API_KEY` (N-3).
5. For the copy only: the Supabase production connection string as a GitHub environment secret, removed after cutover.
6. Pick the cutover time.

## Questions for Rory

| # | Question | Options | Recommended |
| --- | --- | --- | --- |
| Q1 | How should sign-in work? | (a) Studio's own sessions and sign-in links, built on the existing invite tokens and dev cookie. (b) Better Auth, self-hosted in the app. (c) Neon Auth (managed Better Auth) | (a): having read the code, most of it exists already, it has no new dependency, and it is the easiest kit to copy into the next demo app. Better Auth earns its place once an app needs OAuth or passwords |
| Q2 | How do sign-in links reach people? | (a) Resend's free plan (100 a day), from a subdomain of mcclelland.info; you add DNS records. (b) No email: invite-style links only, with your own sign-in link made by a manual GitHub Action | (a): it also lets invitees sign back in themselves, closing F-18 |
| Q3 | Previews' database | (a) One long-lived `preview` branch with demo data only. (b) A branch per preview through Neon's Vercel integration, copied from production | (a): like today, no copies of invitees' emails, no branch sprawl against the limit of 10; branch-per-preview can come later |
| Q4 | Who applies migrations? | (a) A manual "Apply migrations" Action, preview then production. (b) Automatically on every push to `main`. (c) Claude through the Neon connector | (a): one click, recorded in Actions, and no repeat of the connector refusing `REVOKE` statements. **Rory chose (c)** |
| Q5 | When does this run? | (a) Close Sprint 5 on Supabase first (its test pack is ready), then this as Sprint 6. (b) Hold Sprint 5's close and run its checks on Neon after the move | (a): Sprint 5's checks then test Sprint 5 alone, and any fault after the move is the move's |
| Q6 | Supabase after the move | (a) Untouched 14 days as the way back, then paused and deleted. (b) Deleted once the day-one checks pass | (a): costs nothing on the free plan and makes the cutover reversible |
| Q7 | CI's real-stack job | (a) A Neon branch per run (needs `NEON_API_KEY`). (b) Drop it and rely on plain Postgres | (a): it is the only check that runs on the real platform, and it is required |

## Answers (Rory, 27 October 2026)

| # | Answer | Effect on the stories |
| --- | --- | --- |
| Q1 | (a) Studio's own sessions | As written (N-2, N-3) |
| Q2 | (a) Resend from a mcclelland.info subdomain | As written; N-3 closes F-18 |
| Q3 | (a) One `preview` branch with demo data | As written (N-5) |
| Q4 | **(c) Claude applies migrations through the Neon connector** | N-1 changes: no Apply migrations Action. Claude applies each pending file with its `schema_migrations` row through the connector, trying it on a temporary branch first. If the connector's approval step refuses a statement, as Supabase's did with `REVOKE`, Rory runs that file in Neon's SQL editor and it is noted here. The data copy in N-6 stays a one-off Action, because it reads from Supabase |
| Q5 | (a) Close Sprint 5 on Supabase first | Sprint 6 starts after Sprint 5's close |
| Q6 | (a) Keep Supabase 14 days, then delete | As written (N-6, N-7) |
| Q7 | (a) A Neon branch per CI run | As written (N-4); `NEON_API_KEY` as a GitHub secret |

No acceptance criteria changed apart from N-1's, above.
