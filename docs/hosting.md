# Hosting set-up runbook

How Studio is hosted: Neon (Postgres), Resend (sign-in emails), Vercel (the app), Inngest (agent workflows), Anthropic and Google (models), GitHub (code, CI and the after-deploy Action). First set up on 25 October 2026; the database moved to Neon in Sprint 6 (decision 0015; the Cutover section under History is the record). Never paste a connection string, a database password or any API key into chat, an issue or the repo: they go only into Vercel's environment variables or GitHub's secrets.

The sections below describe the set-up as it stands. The Cutover section and the dated Sprint 4 and Sprint 5 notes at the end are history, kept as they were done.

## 1. Neon (the database)

1. Create the project on the free plan: name `campaign-studio`, region **AWS Europe (London)** (`aws-eu-west-2`, beside the functions in `lhr1`), Postgres 17. Studio's project id is `misty-moon-16212068`. Leave **Neon Auth** and the **Data API** off: Studio has its own sign-in, and its `anon` role must only ever be reached by the app's own server.
2. Database `studio`, owned by the role `studio_owner`. The owner is not a superuser; the baseline migration needs none.
3. Three permanent branches:

   | Branch | Holds | Used by |
   | --- | --- | --- |
   | `production` | the app's data | Vercel Production |
   | `ci` | no longer used by CI (5 November 2026: CI has its own project, step 7), but kept: `preview` was made from it and Neon keeps a parent while a child exists | `preview`'s parent only |
   | `preview` | made from `ci`, every migration applied, demo data only | Vercel Preview |

   Never reset `preview` from `production`, so no invitee's data reaches a copy. The free plan allows 10 branches and 1 GB of storage per project, and every branch's writes count towards the project's storage.
4. Apply the migrations through the Neon connector (see "Migrations" below): a new file on a fresh branch first, then `production`, then `preview`. `ci` stays empty.
5. **Connection strings.** On the branch's **Connect** page choose database `studio` and role `studio_owner`.
   - **Pooled** (Connection pooling on; the host has `-pooler`): the app's `DATABASE_URL` on Vercel. The pooler runs in transaction mode, so the app switches prepared statements off (`src/lib/db/client.ts`).
   - **Direct** (Connection pooling off): for the migration runner and one-off scripts only, and never needed on a laptop for production.
6. Nothing keeps the database awake. Compute suspends after 5 minutes idle and resumes on the next connection in a few hundred milliseconds; Neon doesn't pause projects.
7. **A separate project for CI** (F-34, 5 November 2026): `campaign-studio-ci` (id `little-shadow-88992377`), London, Postgres 17, history window 1 hour. Its only permanent branch is `ci`, holding database `studio` owned by `studio_owner` and nothing else: never migrate it. CI makes a throwaway branch from it per run and deletes it at the end. It exists because CI's throwaway branches rebuild the test database many times a run, and in the same project as production that filled the 1 GB storage allowance (Neon's alert of early November), which would block writes on the live site. It holds no app data and no copy of production.

## 2. Resend (sign-in emails)

1. Create a Resend account on the free plan (100 emails a day; Studio limits sign-in links to 3 an hour and 10 a day per address, and 30 an hour and 80 a day in all).
2. **Domains → Add domain:** the sending subdomain `mail.mcclelland.info`. Add the DNS records Resend lists (SPF and DKIM) at the DNS provider, then **Verify**. Sign-in emails go to spam or are refused until it says Verified.
3. **API keys → Create API key** with **Sending access** for that domain only. Copy it straight into Vercel as `RESEND_API_KEY` (step 4); it is shown once.
4. `EMAIL_FROM` is the sender, on the verified subdomain, for example `Studio <sign-in@mail.mcclelland.info>`.

Only production sends email. Local work, CI and previews use the console mailer: the email, link included, is written to the server log (look for `[mail]`).

## 3. Model keys

1. **Anthropic.** In the Anthropic Console, under **Limits**, set a monthly spend limit (suggested $20) as a backstop to the app's own £1-a-day cap. **API keys → Create key**, named `campaign-studio-vercel`, and copy it straight into Vercel.
2. **Google (pictures).** In Google AI Studio, **Get API key**. The key's Google project must have **billing on**: on Google's free tier the image models have no quota, and Make creative fails with "the API key's Google project is on the free tier" (Sprint 5 production check). Choose **Set up billing** on that project and put the budget alert on the same project.

## 4. Vercel

1. Sign in with GitHub. **Add New → Project**, give Vercel access to `rorymcclelland/campaign-studio`, and import it. The framework is detected as Next.js; leave the build settings alone. Functions run in London (`vercel.json`).
2. **Settings → Environment Variables:**

| Name | Value | Environments |
| --- | --- | --- |
| `DATABASE_URL` | Neon `production` branch, pooled string | Production |
| `DATABASE_URL` | Neon `preview` branch, pooled string | Preview |
| `ALLOWED_EMAILS` | the emails that may sign in, comma-separated | Production, Preview |
| `OWNER_EMAIL` | your sign-in email (may invite people; defaults to the first allowed email) | Production |
| `RESEND_API_KEY` | the key from 2.3, marked **Sensitive** | Production only |
| `EMAIL_FROM` | the sender from 2.4 | Production only |
| `ANTHROPIC_API_KEY` | the key from 3.1 | Production |
| `GOOGLE_GENERATIVE_AI_API_KEY` | the key from 3.2 | Production |
| `MODEL_PROVIDER_OVERRIDE` | `mock` | Preview only (previews spend nothing) |
| `DAILY_CAP_PENCE` | `100` | Production, Preview |
| `WORKSPACE_DAILY_CAP_PENCE`, `OWNER_RESERVE_PENCE` | optional; both default to `50` | Production |
| `APP_URL` | optional; where sign-in links point (defaults to the production domain, or the preview's own address) | Production |

   Without a required variable, every page shows a configuration page naming it (for example a missing `RESEND_API_KEY` or `EMAIL_FROM` in production).
3. **Settings → Deployment Protection → Vercel Authentication:** **Preview deployments only**. The production address stays public (the after-deploy Action needs it); the app still requires sign-in, and signed-out visitors see the welcome page.
4. **Deploy by pushing to `main`.** After changing a variable, redeploy by pushing, or with Vercel's own **Redeploy** button. A redeploy made through the Vercel API from an earlier deployment reuses that deployment's variables, so a changed `DATABASE_URL` is not picked up.
5. **Production waits for CI (F-23, decision 0026).** The gate is on GitHub, not Vercel: the ruleset **Protect main** (GitHub → Settings → Rules → Rulesets) takes changes to `main` only through a pull request whose three CI checks pass on its latest commit, with the branch up to date with `main`, and nobody can bypass it:
   - `Typecheck, lint, unit and database tests, build`
   - `End-to-end (app, Inngest dev server, mock model)`
   - `Migrations and database tests on a Neon branch`

   So every commit Vercel deploys from `main` has already passed CI; the wait (about 40 minutes) comes before the merge, and the deploy itself takes a few minutes. A branch behind `main` must merge `main` in and pass CI again before it can merge. Vercel's own Deployment Checks are not needed.

   **In an emergency** (production is broken and the fix can't wait for CI), use **Instant Rollback** on an earlier deployment in Vercel. A fix still goes through a pull request.

## 5. Inngest

1. In Vercel, **Integrations → Browse Marketplace → Inngest → Install**, and connect it to the `campaign-studio` project. It creates the Inngest account, adds `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to the project, and registers the app at `/api/inngest`. Redeploy so the new variables take effect.
2. In the Inngest dashboard, **Apps** lists `campaign-studio`, and **Functions** lists **Agent run**.
3. When CI passes on `main`, the **After production deploy** GitHub Action waits until `/api/health` reports the new commit (up to 15 minutes), then resyncs Inngest and checks `agent-run` is served. If it fails, resync by hand (see "Notes").

## 6. GitHub

**Settings → Secrets and variables → Actions → Repository secrets:**

- `NEON_API_KEY`: a **project-scoped** organization API key for `campaign-studio-ci` only (Neon → organization **Settings → API keys → Create**, choose project-scoped and that project), so CI can never reach production's connection details (F-29). Paste it straight into the GitHub secret. CI's required job uses it to make and delete its throwaway branch; without it the job fails, naming the secret. CI takes the project id from `.github/workflows/ci.yml` and fetches the branch's connection string itself, masking it before anything prints.
- `ANTHROPIC_API_KEY` (optional): a key with its own spending limit, for the manual **Real-model evals** Action (F-16).

## 7. Check it works

1. `https://<production address>/api/health` answers `ok: true` with `environment: production` and the latest commit. Production's answer is public, so it doesn't name its database host (previews and local work do); the after-deploy Action reads only `commit` and `inngestFunctions`.
2. Sign in: enter your email on /signin, open the link in the email (from `EMAIL_FROM`; check it isn't in spam), press **Continue**.
3. Start a run on a campaign: it proposes, waits for your approval and completes, with its cost in the spend meter.
4. Open a preview: its `/api/health` names the `preview` branch's host, and a run there uses the mock model. To sign in on a preview, request a link and copy it from the preview's runtime logs (`[mail]`).

## Notes

- If the database check fails, `/api/health` logs the user, host and port it tried (never the password) in Vercel's runtime logs.
- **Resync Inngest by hand** when the after-deploy Action fails: open the project in Vercel, then **Integrations → Inngest → Open in Inngest** (this signs in to the linked account; signing in at app.inngest.com directly makes a separate, empty one), choose **Production → Apps → campaign-studio → Resync**, and check **Functions** lists what the code serves (**Agent run**). Until then, new runs stay queued.
- **Inviting someone:** sign in, open the account menu → **Invites**, enter their email, copy the link and send it in your own message. It works once, for 7 days. After that they sign in by email themselves. Revoke an invite to stop the link, or to remove someone who has used it (their sessions end too).
- **Neon's free plan:** 1 GB storage per project (every branch's writes count), 10 branches, 100 CU-hours of compute and 5 GB of transfer a month. When storage is full, inserts and updates fail until it is freed. Check **Storage** on the `campaign-studio` project now and then.

## Migrations

Every database is built from the files in `db/migrations`, in file-name order. The first, `20261024000000_auth_schema.sql`, makes the `auth` schema, `auth.users` (id, email, created_at), `auth.uid()`, `auth.role()` and the `anon` and `authenticated` roles, and grants both roles to the connecting role by name. It needs no superuser, so it runs as Neon's owner role. Each applied file is recorded in `public.schema_migrations` (file name, sha256 of the file, applied time), which the runner creates if it is missing; the app's roles can't read it.

- **Locally and in CI:** `npm run db:migrate` applies whatever is pending to `DATABASE_URL` (`node scripts/db-migrate.mjs --url NAME` reads the connection string from the variable `NAME`). Each file runs in its own transaction with its record. It stops before applying anything if an applied file has changed or gone, naming it; a failing file rolls back alone and stops the run, naming it. `-- --dry-run` lists the pending files and changes nothing. `npm run db:reset` and `npm test` rebuild their databases through it.
- **On Neon (Rory's answer to Q4): Claude applies migrations through the Neon connector.** No connection string leaves Vercel or GitHub.
  1. Through the connector, run `select file_name, sha256 from public.schema_migrations order by file_name` (on a new project, run the `bootstrapSql` from step 2 first) and save the rows as JSON.
  2. `node scripts/db-migrate.mjs --list-pending --json --applied rows.json --with-sql` prints `bootstrapSql`, and for each pending file its `name`, `sha256`, `path`, `recordSql` (the `schema_migrations` insert) and `applySql` (begin, the file, its record, commit). It refuses, naming the file, if a row's sha256 differs from the file on disk.
  3. `node scripts/neon-statements.mjs pending.json OUTDIR` writes each pending file as a list of statements, with its `schema_migrations` insert last. Apply each list with the connector's `run_sql_transaction`, one file per call, so a file and its record commit together or not at all. (The connector's migration tool can't be used: it splits on every `;` and breaks on function bodies.) Try a new file on a fresh branch first, then production, then `preview`.
  4. Repeat step 1: the rows should now list every file.
  5. Check the schema: run `scripts/schema-fingerprint.sql` on the Neon branch (through the connector) and on a local database built with `db:migrate`; every row should match. It hashes each kind of object (columns, constraints, indexes, policies, function bodies, triggers, row-level security, grants) and the ledger. Postgres 17's `MAINTAIN` privilege is left out, since local Postgres is 16.
- **Neon branches:** see section 1. `ci` began as a copy of `production` before production held any rows, and was then emptied.
- **Comparing two live schemas:** `node scripts/schema-diff.mjs --a A_DB_URL --b B_DB_URL`, with the two connection strings in those variables (never on the command line). It compares tables, columns, constraints, indexes, policies, functions (by a hash of their bodies), triggers, enums and the grants to `anon`, `authenticated` and `PUBLIC` in `public`, plus auth.users's id, email and created_at, `auth.uid()` and `auth.role()`, and ignores every other schema, other auth columns and roles. It prints each difference and exits 1, or says "No differences". `--a NAME --dump` prints one database's description. N-1 test case 6 used it to compare the old production database with Neon.

## History

Everything from here down is a record of what was done, kept for reference. It is not the current set-up.

## Cutover: production data from Supabase to Neon (Sprint 6, N-6)

**Finished.** The 14 days ended on 12 November 2026 (N-7a): the Action, its two scripts and their test were removed, and Supabase's projects, variables and the `cutover` environment were deleted, so the way back below no longer exists. The steps are kept as a record.

Done once. Production's data moves from Supabase into the Neon `production` branch with every id unchanged, through the **Copy production data** Action (`.github/workflows/copy-production-data.yml`), so no connection string reaches chat or a laptop. The Action, its two scripts and their test are removed once the cutover is checked, and the `cutover` environment with its two secrets is deleted then.

- `scripts/copy-data.mjs --from NAME --to NAME` copies `auth.users` (id, email and created_at only) and then every table in `public` except `schema_migrations`, in foreign-key order. It reads Supabase in one read-only snapshot and writes Neon in one transaction, as the table owner, with each table's own triggers (the guards) switched off during the copy and on again before it commits. If anything fails, nothing is kept. It refuses unless the target has every migration in `db/migrations` and holds no rows, unless both sides have the same tables and columns, and unless every `auth.users` email on Supabase is already lower-case and trimmed (sign-in looks people up by lower-cased address; it reports how many are not, never the addresses). It prints row counts, never rows.
- `scripts/check-copy.mjs --a NAME --b NAME` compares the two: row counts and a hash of every row for each table (for `auth.users`, its id, email and created_at), a count of `auth.users` emails that aren't lower-case and trimmed on either side, the sha256 of every picture (stored and recomputed from its bytes), no broken foreign key on Neon, every trigger on and the usage ledger's next id above its highest. It prints "Copy matches", or each difference.
- Everyone is signed out by the move (sessions are not copied). Rory signs in by email; invitees can too (N-3).
- Two details of the schema the copy handles: `brands.logo_asset_id` and `assets.brand_id` point at each other, so a brand's logo link is copied empty and filled in once the pictures are in; and copy sets and ad variants can be based on an earlier one, so their rows are copied parents first.

### 1. Set up the `cutover` environment (Rory, once)

1. **Put the Action on `main`.** GitHub lists a manual Action only once its file is on the default branch. Until Sprint 6 is merged, Claude puts `.github/workflows/copy-production-data.yml` on `main` by itself (it changes nothing in the app), and you run it from the `sprint-6` branch (step 2.1), which has the scripts and `db/migrations`.
2. **GitHub → the repo → Settings → Environments → New environment**, named `cutover`.
   - **Deployment protection rules:** on this plan (a private repository), GitHub doesn't enforce required reviewers or required checks, so don't count on an approval step. The safeguards are that the Action only ever starts by hand (Run workflow) and refuses to run unless the target's name is typed again in the confirm box.
   - **Deployment branches and tags:** **Selected branches and tags**, then add `main` and `sprint-6`.
3. In the same environment, under **Environment secrets → Add environment secret**, add two secrets. Paste each value straight from the provider's page:
   - `SUPABASE_DB_URL`: Supabase → the production project → **Connect** → **Session pooler** (port 5432 on the `pooler.supabase.com` host), with `[YOUR-PASSWORD]` replaced by the database password. Not the direct connection (GitHub's runners have no IPv6, and Supabase's direct address is IPv6 only) and not the transaction pooler.
   - `NEON_DB_URL`: Neon → `campaign-studio` → branch `production` → **Connect**, database `studio`, role `studio_owner`, **Connection pooling off** (the host has no `-pooler`).
4. `NEON_API_KEY` is already a repository secret (N-4); the rehearsal uses it to make its branch.

### 2. Rehearse first

1. **GitHub → Actions → Copy production data (one-off, N-6) → Run workflow.** Use workflow from `sprint-6` (or `main` once Sprint 6 is merged), target `rehearsal`, and type `rehearsal` in the confirm box.
2. It makes a Neon branch `rehearsal-<run id>` from the empty `ci` branch, applies every migration, copies, checks, and then makes a second, throwaway branch the same way (migrated, copied, checked) for the database and model tests, which empty tables as they go; the rehearsal branch is left as copied. (Neon can't branch from a branch that has an expiry date, so the suite can't use a copy of the rehearsal branch.) The rehearsal branch is kept for two days and then deletes itself.
3. **What to check:**
   - The **Copy the data** step lists every table with its row count and ends "Copied … rows across … tables; every trigger is enabled again." Note how long the step took: the real copy takes about as long, and that is the pause.
   - The **Check the copy against Supabase** step says "Copy matches".
   - The test step is green (N-6 test case 1).
   - In Neon's SQL editor on the rehearsal branch, a campaign from Supabase has its brief versions, personas, test plan, variants and pictures, and `select count(*) from public.assets` matches the count in the Copy step.
   - Neon → the rehearsal branch → **Storage**: record the size against the free plan's 0.5 GB (N-6 test case 7).
4. If anything fails, nothing needs undoing: Supabase is only read, and the rehearsal branch expires. Fix, then rehearse again (each run makes a new branch).

### 3. The switch (pick a quiet time)

Production keeps running on Supabase until step 5. Anything done in Studio between the copy (step 3) and the switch is not copied, so nobody uses Studio meanwhile: tell invitees beforehand, with the time, not to use Studio during the switch.

**Before the switch** (a day or so before, and again on the day for the last check):

- **Give production its own password.** The `ci` branch, and through it `preview` and every CI and rehearsal branch, began as a copy of `production`, so they share its `studio_owner` password. On the Neon `production` branch only: Neon → `campaign-studio` → **Branches** → `production` → **Roles & Databases** → `studio_owner` → **Reset password**. Don't reset it on any other branch. Then update the `cutover` environment secret `NEON_DB_URL` (section 1, step 3) with the new direct string, and take the pooled string for step 4 below only after the reset. Production's password must never match that of a branch made from it.
- **Resend is ready.** Resend → **Domains** shows `mail.mcclelland.info` as **Verified**, with a green tick on every DNS record (SPF/MX and DKIM). Resend's dashboard has no send-a-test button, so the first real email is the sign-in link in step 7.

1. **Check nothing is in progress.** In Studio's runs list nothing is queued or running, and in the Inngest dashboard (through Vercel, see "Notes" above) **Runs** shows nothing running. A run waiting for an approval can stay waiting (its id is unchanged, so it carries on after the move), but nobody approves anything until the smoke test.
2. **Keep the way back.** Have Production `DATABASE_URL`'s current value, the Supabase transaction pooler string, in your password manager. Vercel can't reveal a variable marked Sensitive, so if it isn't saved already, take it from Supabase → the production project → **Connect** → **Transaction pooler** (port 6543), with the database password. Note which deployment is current under **Deployments** (the last one on Supabase).
3. **Copy.** Run the Action again with target `production` and `production` in the confirm box. The Copy step must end with "every trigger is enabled again" and the Check step must say "Copy matches". If either fails, stop here: production is still on Supabase and unchanged, and Neon's transaction left it empty.
4. **Point production at Neon.** Vercel → campaign-studio → Settings → Environment Variables → Production `DATABASE_URL` → **Edit**, and paste Neon's `production` string with **Connection pooling on** (database `studio`, role `studio_owner`; the host has `-pooler`), taken after the password reset above. Check that Production also has `RESEND_API_KEY` and `EMAIL_FROM` (N-3).
5. **Redeploy by pushing to `main`**: the merge of Sprint 6 (its sign-in needs the tables only Neon has). Not the Vercel API: a redeploy from an earlier deployment keeps that deployment's variables.
6. **After-deploy sync.** The **After production deploy** Action waits for the new commit at `/api/health`, then resyncs Inngest. Check it is green.

   Then, before anyone uses Studio on Neon, run the Action with target `check` (type `check` in the confirm box). It copies nothing; it compares Supabase with Neon production as they stand and must say "Copy matches", which proves nothing was written to Supabase after the copy. If it lists a difference, something was: stop, take the way back (section 4), and plan the switch again (the Neon `production` branch has to be emptied before the copy will run again).
7. **Smoke test.** Sign in by email (everyone was signed out). Open a campaign from before the move and check its brief versions, personas, test plan, variants and pictures. The spend meter shows today's spend, including what was spent before the move. Make creative on a campaign: it completes and is charged against today's cap. An invitee's workspace is intact and they can sign in by email. Then record page timings (N-6 test case 6).

   If no sign-in email arrives within 2 minutes (check spam too): Vercel → campaign-studio → **Logs** (runtime logs), and search for `[signIn] couldn't send`. The line says why (for example a missing or wrong `RESEND_API_KEY` or `EMAIL_FROM`, or a domain Resend hasn't verified). Fix the variable and redeploy (push, or Vercel's **Redeploy** button), or take the way back.

### 4. The way back

**While on the way back, don't push to `main` and don't undo the Instant Rollback**: either would deploy the Sprint 6 code, which can't sign anyone in against Supabase. Stay on the rollback until the problem is fixed and the switch is planned again.

Supabase stays exactly as it was, untouched, for 14 days after the switch: don't change it or delete it, and leave its variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) in Vercel, because the Sprint 5 deployment reads them. After the 14 days Rory removes those variables, then pauses and deletes both Supabase projects (Q6).

**A free Supabase project pauses itself after about a week without activity**, and nothing reaches it once production is on Neon (the keep-awake cron is gone too, and it called Neon anyway). So from about a week after the switch, going back starts with a step 0: Supabase dashboard → the production project → **Restore project** (a click, then a few minutes until it says it is healthy). The data is kept while paused. Then:

1. Vercel → **Deployments** → the last production deployment from before the switch (step 3.2) → **⋯ → Instant Rollback**. It runs that deployment's code with the variables it was built with, so the Sprint 5 code on Supabase, with Supabase's sign-in. (Setting `DATABASE_URL` back alone is not enough: Sprint 6's sign-in needs tables Supabase doesn't have.)
2. Set Production `DATABASE_URL` back to the Supabase string you saved, so a later push doesn't reach Neon by surprise. Vercel doesn't promote new pushes after an Instant Rollback until you undo it, so nothing redeploys onto Neon meanwhile.
3. Resync Inngest by hand (see "Notes" above).

Anything done on Neon between the switch and the way back is lost. The 14 days are for finding problems, not for running both.

## Sprint 4: public address, invites and previews (Supabase era)

Done once, in this order, after the Sprint 4 deploy. Steps 1 and 3 were replaced in Sprint 6 (own sign-in; the Neon `preview` branch); steps 2, 5 and 6 are in the set-up above.

1. **Supabase secret key (for invite sign-ins).** Supabase → Project Settings → API Keys → copy the **secret** key (starts `sb_secret_`). In Vercel → campaign-studio → Settings → Environment Variables, add `SUPABASE_SECRET_KEY` for **Production** only. Never prefix it with `NEXT_PUBLIC_`.
2. **Owner and caps.** In the same place, add `OWNER_EMAIL` (your sign-in email) and, if you want a different per-workspace limit than 50p a day, `WORKSPACE_DAILY_CAP_PENCE`, both for Production.
3. **Preview database (F-8).** A second free Supabase project, `campaign-studio-preview`, in London, with the same migrations. In Vercel, for **Preview** only, set `DATABASE_URL` to its transaction pooler string (port 6543), `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the preview project's (so previews sign in against their own users, review 7), and `MODEL_PROVIDER_OVERRIDE=mock`, so previews never spend or touch production data. Add your email as a user in the preview project (Authentication → Users → Add user) to sign in there; its built-in email reaches you as a team member.
4. **Redeploy** production by pushing to GitHub (or Vercel's Redeploy button), so the new variables apply.
5. **Public address (F-3).** Vercel → campaign-studio → Settings → Deployment Protection → **Vercel Authentication**: set it to protect **Preview deployments only** (not production). The app still requires sign-in; signed-out visitors see the welcome page.
6. **Inngest sync after every deploy (F-15, F-17).** Nothing to set up: when CI passes on `main` the `After production deploy` GitHub Action waits until `/api/health` reports the new commit (up to 15 minutes), then syncs Inngest and checks `agent-run` is served. It needs the production address to be public (step 5). Vercel doesn't send this repo deployment events, so the Action doesn't rely on them. If it fails, use the manual resync above.
7. **Real-model evals (F-16, optional).** GitHub → the repo → Settings → Secrets and variables → Actions → New repository secret `ANTHROPIC_API_KEY` (a key with its own spending limit). Run them from Actions → Real-model evals → Run workflow. The job summary shows the estimate before anything is spent (worked out with no key), then each agent's model, pass rate and cost, and the total; the run fails if the total is over 100p or an agent has no report (F-16a). The reports are attached to the run and pushed to the branch `e2e-results/evals/<branch>` (one orphan commit, replaced each run), which a cloud session can read. The workflow has only the Anthropic key, so the Imagery cases that draw pictures can't draw them there (they need the Google key).

**Inviting someone:** sign in, open the account menu → **Invites**, enter their email, copy the link and send it in your own message. It works once, for 7 days. If they lose their session later, make a new invite. Revoke an invite to stop the link, or to remove someone who has used it.

## Sprint 5: migrations and the image key (Supabase era)

Done once, before or with the Sprint 5 deploy, for production and then the preview project.

1. **Migrations.** Apply these five, in order (everything up to `20261027000006` should already be applied by the Sprint 4 deploy; check the project's migration list first):
   - `20261028000001_spend_reservations.sql`
   - `20261028000002_assets_and_images.sql`
   - `20261028000003_copy_sets.sql`
   - `20261028000004_ad_variants_and_logos.sql`
   - `20261028000005_sprint5_review_fixes.sql` (the latest `20261028` file)

   All five contain `REVOKE` statements (the anon role loses its grants on the new tables and on the simulated-spend function, and authenticated users lose update, delete or truncate on the new tables). The Supabase connector may refuse a `REVOKE` at its approval step, as noted above. If it does, Rory runs that migration file in full in the Supabase SQL Editor (Supabase → SQL Editor → New query, paste the file, Run), and notes it in `docs/refinement/sprint-5.md`. Don't skip the `REVOKE` lines: without them the anon role keeps its default grants on the new tables.
2. **Google key for pictures.** In Vercel → campaign-studio → Settings → Environment Variables, add `GOOGLE_GENERATIVE_AI_API_KEY` for **Production** only (previews use the mock image model through `MODEL_PROVIDER_OVERRIDE=mock`). Without it, the startup check names the missing key, and no picture can be drawn. The key's Google project must have **billing on**: on Google's free tier image models have no quota, and Make creative fails with "the API key's Google project is on the free tier" (Sprint 5 production check). In Google AI Studio, open **Get API key**, find the key's project and choose **Set up billing**; put the budget alert on that same project.
3. **Redeploy** by pushing to GitHub; the after-deploy Action resyncs Inngest.
