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
