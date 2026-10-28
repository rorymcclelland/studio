# Starting the next demo app

What to copy from Studio into a new demo app so it has the same sign-in, migrations and Neon set-up from day one. Each app gets its own Neon project, Resend key and Vercel project. Why it is built this way: decision 0015. Step-by-step console clicks: `docs/hosting.md`, sections 1 to 6.

## 1. Sign-in

Email links and invite links, with sessions Studio keeps itself. No passwords, no OAuth, no provider SDK.

**Copy:**

| From Studio | What it is |
| --- | --- |
| `db/migrations/20261024000000_auth_schema.sql` | `auth` schema, `auth.users` (id, email, created_at), `auth.uid()`, `auth.role()`, the `anon` and `authenticated` roles |
| `db/migrations/20261029000001_sessions_and_sign_in_tokens.sql` | `auth.sessions`, `auth.sign_in_tokens` and the security-definer functions that are the only way in |
| `public.invites` with `check_invite`, `use_invite` and `is_invited`, from `20261027000005_invites_and_workspace_caps.sql` as changed by `20261029000001` | only if the app has invitees; write them as one new file for the new app, without Studio's workspace caps |
| `src/lib/auth/` | tokens, sessions, sign-in links, invites, finding or creating a user |
| `src/lib/email/` | the mailer: Resend over `fetch` in production, the console everywhere else |
| `src/proxy.ts` | sends signed-out visitors to the welcome page; keeps the session cookie's lifetime fresh |
| `src/app/signin/`, `src/app/invite/`, `src/app/api/dev/last-sign-in-link/` | the pages, the Continue POSTs, and the e2e mailbox (404 on any Vercel deployment) |
| `src/lib/env.ts` (`configProblems()`) | names any missing variable on a configuration page instead of a blank screen |
| `tests/auth/`, `tests/db/sign-in-tables.test.ts` | sessions, links, limits, hostile inputs, the mailer choice |

**Keep these rules:**

- Tokens are 32 random bytes; only their SHA-256 is stored. The `cs_session` cookie is httpOnly, SameSite=Lax, Secure except on local http, 30 days, extended when used after a day.
- A link or invite is used only by a POST behind a **Continue** button, so link scanners can't use it up. Links last 15 minutes and work once.
- /signin gives the same reply, at once, whoever asks; the access check and the email run after the response.
- Limits: 3 links per address and 30 in all per hour (Resend's free plan sends 100 a day).
- Links point at the production domain (`VERCEL_PROJECT_PRODUCTION_URL`) or the preview's own address, never the request's Host header.
- Every request re-checks the allow-list or invite, so revoking someone signs them out on their next request.
- The `anon` role must only be reachable by the app's own server: never turn on a Data API for the database.

**Variables:** `ALLOWED_EMAILS`, `OWNER_EMAIL`, and in Vercel Production only `RESEND_API_KEY` (Sensitive) and `EMAIL_FROM`. Rename the cookie and the email's wording for the new app.

## 2. Migrations

**Copy:** `scripts/db-migrate.mjs`, `scripts/db-reset.mjs`, `scripts/neon-statements.mjs`, `scripts/schema-fingerprint.sql`, `tests/db/migrate.test.ts`, and the `db:migrate` and `db:reset` scripts in `package.json`.

- **Runner.** Files in `db/migrations/` apply in name order, each in its own transaction with its ledger row. `-- --dry-run` lists what is pending.
- **Baseline.** The new app's first file is Studio's `20261024000000_auth_schema.sql`, unchanged. It needs no superuser and grants the roles to the connecting role by name, so it runs as Neon's owner role and on plain local Postgres alike.
- **Ledger.** `public.schema_migrations` holds each file's name, sha256 and applied time. The runner refuses to run, naming the file, if an applied file has changed or gone. Never edit an applied file: add a new one.
- **Connector statements.** On Neon, Claude applies migrations through the Neon connector: `db-migrate.mjs --list-pending --json --applied rows.json --with-sql` lists what is pending against the ledger rows read through the connector, and `neon-statements.mjs` splits each file into statements with its ledger insert last. One `run_sql_transaction` call per file, so a file and its record commit together or not at all. (The connector's own migration tool splits on every `;` and breaks function bodies.)
- **Fingerprint check.** Run `schema-fingerprint.sql` on the Neon branch (through the connector) and on a local database built with `db:migrate`. Every row must match: columns, constraints, indexes, policies, function bodies, triggers, row-level security, grants and the ledger.

## 3. Neon

1. **Project:** a new one per app on the free plan, region AWS Europe (London) beside Vercel's `lhr1`. One database and its owner role. Leave Neon Auth and the Data API off.
2. **Branches:** `production` (real data); `ci` (empty, the parent of CI's throwaway branches); `preview` (made from `ci`, migrated, demo data only). Never reset `ci` or `preview` from `production`.
3. **Connection strings:** pooled (`-pooler` host) for the app, with prepared statements off in the client; direct for the runner and one-off scripts. Strings go only into Vercel's variables and GitHub's secrets.
4. **CI job:** copy the `real-stack` job from `.github/workflows/ci.yml` and change the project id. It checks `NEON_API_KEY` is set, makes `ci-run-<run id>` from `ci` with a two-hour expiry, applies every migration with the runner, runs the database tests, and deletes the branch even after a failure. One run at a time (a `concurrency` group) keeps it inside the 10-branch limit. Pin the Neon actions by commit.
5. **Masking connection strings:** `neondatabase/create-branch-action` doesn't mask its connection-string outputs, and a step's `env` is printed in the log. Take only `branch_id` from the action, fetch the string from Neon's `connection_uri` API in a step of your own, write `::add-mask::` for the whole string and its password (raw and URL-decoded) before anything prints, and pass it on through `GITHUB_ENV`.
6. **No keep-awake cron.** Neon resumes compute on the next connection (a few hundred milliseconds after 5 idle minutes) and never pauses a project. Keep a `/api/health` route for the after-deploy check.

## 4. Integration choices, and why

- **Neon's Vercel integration: not used.** It makes a branch per preview copied from production, which would put real people's emails in previews and runs into the 10-branch limit. Instead the `production` and `preview` pooled strings are pasted into Vercel's Production and Preview `DATABASE_URL` by hand, once.
- **Neon's GitHub integration: used, for the key only.** Connecting the Neon project to the repository (Neon's **GitHub integration**, installed for that one repository only) creates the Neon API key and saves it as the repository secret `NEON_API_KEY`, so nobody handles the key. It also adds a `NEON_PROJECT_ID` variable, which the workflows don't need (the id is written in them). Skip the sample Actions it offers: they make a branch per pull request, copied from production.
- **Vercel and GitHub:** Vercel deploys on push; Vercel Authentication protects previews only, so the production address stays public for the after-deploy Action, which waits for the new commit at `/api/health` and then resyncs Inngest.
- **Resend:** a sending subdomain per owner domain (Studio uses `mail.mcclelland.info`), with its SPF and DKIM records verified before the first production send.
