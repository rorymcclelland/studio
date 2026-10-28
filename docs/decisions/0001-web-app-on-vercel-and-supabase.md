# 0001 Web app on Vercel and Supabase

**Superseded in part, 28 October 2026:** Postgres moved to Neon and sign-in to Studio's own, so the Supabase parts and the keep-awake cron no longer apply (decision 0015). The web app on Vercel, functions in London and the Hobby-tier note stand.

**Date:** 24 October 2026. **Status:** accepted.

**Context.** The people who matter (interviewers, prospects, testers) should open a link and see the product working, with nothing to install. The product should be able to become multi-tenant later. Budget is under £30 a month.

**Decision.** A Next.js web app hosted on Vercel (Hobby tier while it is a showcase), with Postgres, auth and storage on Supabase's free tier. Not a downloadable executable.

**Consequences.** Functions run in London (`lhr1`, set in `vercel.json`) beside the Supabase database in eu-west-2. Every branch gets a preview link. Free Supabase projects pause after a week without traffic, so a daily cron calls `/api/health`. Vercel Hobby is for non-commercial use: move to Pro before any paid use.
