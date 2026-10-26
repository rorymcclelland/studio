# Hosting set-up runbook

How Studio is hosted: Supabase (database and sign-in), Vercel (the app), Inngest (agent workflows), Anthropic (models). First set up 25 October 2026. Never paste the database password, the pooler connection string or any API key into chat, an issue or the repo: they go only into Vercel's environment variables.

## 1. Supabase

1. Create a project on the free plan: name `campaign-studio`, region London (eu-west-2). Generate the database password and save it in a password manager.
2. **SQL Editor → New query.** Paste the whole of `supabase/migrations/20261024000001_foundations.sql` and run it. Expect "Success. No rows returned". Each later migration is applied the same way, in order (until a deploy workflow does it).
3. **Authentication → Users → Add user → Create new user.** Enter the email you will sign in with, any long random password (it is never used), and tick **Auto confirm user**. Sign-in sends magic links only to existing users, so this step is what gives you access.
4. **Authentication → Sign In / Providers.** Turn off **Allow new users to sign up**. Keep the Email provider on.
5. **Connect** (top of the dashboard). Note the **Project URL** and the **publishable key** (`sb_publishable_…`). Under **Transaction pooler**, copy the URI (port 6543) and replace `[YOUR-PASSWORD]` with the database password. That string is `DATABASE_URL`.

## 2. Anthropic key

1. In the Anthropic Console, under **Limits**, set a monthly spend limit (suggested $20) as a backstop to the app's own £1-a-day cap.
2. **API keys → Create key**, named `campaign-studio-vercel`. Copy it straight into Vercel (step 3); it is shown once.

The Google key is not needed until Sprint 5 (imagery).

## 3. Vercel

1. Sign in with GitHub. **Add New → Project**, give Vercel access to `rorymcclelland/campaign-studio`, and import it. The framework is detected as Next.js; leave the build settings alone.
2. Before deploying, open **Environment Variables** and add:

| Name | Value | Environments |
| --- | --- | --- |
| `DATABASE_URL` | the transaction pooler URI from 1.5 | Production, Preview |
| `ALLOWED_EMAILS` | the email from 1.3 | Production, Preview |
| `NEXT_PUBLIC_SUPABASE_URL` | the Project URL | Production, Preview |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key | Production, Preview |
| `ANTHROPIC_API_KEY` | the key from 2.2 | Production |
| `MODEL_PROVIDER_OVERRIDE` | `mock` | Preview only (previews spend nothing) |
| `DAILY_CAP_PENCE` | `100` | Production, Preview |

3. **Deploy.** The first deployment shows a configuration page asking for `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`. That is expected until step 4. Note the production URL (`https://….vercel.app`).

## 4. Inngest

1. In Vercel, **Integrations → Browse Marketplace → Inngest → Install**, and connect it to the `campaign-studio` project. It creates the Inngest account, adds `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to the project, and registers the app at `/api/inngest`.
2. **Deployments → the latest → ⋯ → Redeploy**, so the new variables take effect.
3. In the Inngest dashboard, **Apps** should list `campaign-studio` with one function, the tagline run.

## 5. Sign-in links

In Supabase, **Authentication → URL Configuration**:

- **Site URL:** the production URL.
- **Redirect URLs:** add `<production URL>/auth/callback`, and a wildcard for previews in the form `https://*-<your-team-slug>.vercel.app/**` (copy the ending from any preview URL).

## 6. Check it works

Open the production URL, sign in with the email from 1.3, follow the link in the email, and start a tagline run. It should propose three taglines, wait for your approval and complete, with its cost shown in the spend meter. Then Claude checks the rest: preview links per branch, the production deploy from `main`, and the daily keep-awake cron (Vercel → Settings → Cron Jobs lists `/api/health`).

## Notes from the first set-up (25 October 2026)

- **Redeploy by pushing to GitHub, or with Vercel's own Redeploy button after changing a variable.** A redeploy made through the Vercel API from an earlier deployment reuses that deployment's environment variables, so a changed `DATABASE_URL` is not picked up.
- If the database check fails, `/api/health` logs the user, host and port it tried (never the password) in Vercel's runtime logs.
- Functions run in London (`lhr1`) beside the database.
- **After a deploy that adds, renames or removes an Inngest function, resync Inngest.** Open the project in Vercel, then **Integrations → Inngest → Open in Inngest** (this signs in to the linked account; signing in at app.inngest.com directly makes a separate, empty one), choose **Production → Apps → campaign-studio → Resync**, and check **Functions** lists what the code serves (from Sprint 3: **Agent run**). Until then, new runs stay queued. Sprint 3 needed this once (backlog F-15); from Sprint 5 the after-deploy Action does it (step 6 below), so this is the fallback.
- **Migrations that change data or remove a permission** may be refused by the Supabase connector's approval step. Run those in the Supabase SQL editor and note it in the sprint's refinement.


## Sprint 4: public address, invites and previews

Done once, in this order, after the Sprint 4 deploy.

1. **Supabase secret key (for invite sign-ins).** Supabase → Project Settings → API Keys → copy the **secret** key (starts `sb_secret_`). In Vercel → campaign-studio → Settings → Environment Variables, add `SUPABASE_SECRET_KEY` for **Production** only. Never prefix it with `NEXT_PUBLIC_`.
2. **Owner and caps.** In the same place, add `OWNER_EMAIL` (your sign-in email) and, if you want a different per-workspace limit than 50p a day, `WORKSPACE_DAILY_CAP_PENCE`, both for Production.
3. **Preview database (F-8).** A second free Supabase project, `campaign-studio-preview`, in London, with the same migrations. In Vercel, for **Preview** only, set `DATABASE_URL` to its transaction pooler string (port 6543), `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the preview project's (so previews sign in against their own users, review 7), and `MODEL_PROVIDER_OVERRIDE=mock`, so previews never spend or touch production data. Add your email as a user in the preview project (Authentication → Users → Add user) to sign in there; its built-in email reaches you as a team member.
4. **Redeploy** production by pushing to GitHub (or Vercel's Redeploy button), so the new variables apply.
5. **Public address (F-3).** Vercel → campaign-studio → Settings → Deployment Protection → **Vercel Authentication**: set it to protect **Preview deployments only** (not production). The app still requires sign-in; signed-out visitors see the welcome page.
6. **Inngest sync after every deploy (F-15, F-17).** Nothing to set up: on every push to `main` the `After production deploy` GitHub Action waits until `/api/health` reports the new commit (up to 15 minutes), then syncs Inngest and checks `agent-run` is served. It needs the production address to be public (step 5). Vercel doesn't send this repo deployment events, so the Action doesn't rely on them. If it fails, use the manual resync above.
7. **Real-model evals (F-16, optional).** GitHub → the repo → Settings → Secrets and variables → Actions → New repository secret `ANTHROPIC_API_KEY` (a key with its own spending limit). Run them from Actions → Real-model evals → Run workflow; the reports are attached to the run.

**Inviting someone:** sign in, open the account menu → **Invites**, enter their email, copy the link and send it in your own message. It works once, for 7 days. If they lose their session later, make a new invite. Revoke an invite to stop the link, or to remove someone who has used it.
