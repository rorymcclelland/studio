# Sprint 6 test pack: the move to Neon and Studio's own sign-in

**For Rory, on production, on the day of the switch.** Real email and real (small) AI costs. Contains no passwords or keys: you sign in as yourself, and every connection string stays in Vercel or GitHub, pasted straight from Neon or Supabase.

This pack follows the runbook in `docs/hosting.md` ("Cutover"), step by step. Claude runs alongside you in the chat, checks each run's results and records the timings.

**Before you start**

- **Pick a quiet time** (about 45 minutes). Tell invitees beforehand not to use Studio during the switch: anything they do between the copy and the switch is lost.
- **Have to hand:**
  - Production's Supabase connection string (the transaction pooler one, port 6543), from your password manager or Supabase's **Connect** page. It's the way back.
  - Neon's `production` branch pooled string (Neon → `production` → **Connect**, database `studio`, role `studio_owner`, **Connection pooling on**, host with `-pooler`). It goes into Vercel in TC-4.
  - A private (incognito) window, for TC-9.
- **Already done:** Neon is set up (all 25 migrations, checked against a local build), CI runs on Neon, previews run on Neon, production's password is its own, and the copy was rehearsed twice (94 seconds, "Copy matches", tests green on the copy).
- **AI cost:** about 15p (TC-8). **Time:** about 45 minutes, of which Studio is paused for about 10 (copy, switch, redeploy).
- **Before the move**, Claude recorded production's health check on Supabase: the first database query took 94 ms, then 3 ms once warm.

---

### TC-1 Previews sign in on Neon, with demo data only

- **What it checks:** N-5 #2 and #3.
- **User:** you, on the preview (signed in to Vercel).
- **Flow:**
  1. Open `https://campaign-studio-git-sprint-6-mcclelland.vercel.app` and click **Sign in**.
  2. Enter your usual email and send the link.
  3. Previews don't send email: in Vercel, open that preview deployment, then **Logs**, and find the line starting `[mail]`. Open the link in it and click **Continue**.
  4. Look around: Brands, Campaigns.
- **Expected outcome:**
  - The sign-in page shows the same "check your email" reply for any address.
  - The link signs you in; opening it a second time says the link has expired.
  - You see an empty workspace (or demo brands only), none of production's campaigns.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-2 Resend is ready before anyone is signed out

- **What it checks:** N-3 #7 (first half): the move signs everyone out, so email must work first.
- **User:** you, in Resend.
- **Flow:**
  1. Resend → **Domains** → `mail.mcclelland.info`.
- **Expected outcome:** the status is **Verified** and every DNS record (SPF/MX and DKIM) has a green tick. If not, stop here: the switch waits until it is. (Resend's dashboard has no send-a-test button, so the first real email is the sign-in link in TC-6; if it doesn't arrive, Claude checks the logs and, if needed, the way back puts production on Supabase in a minute or two.)
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-3 Copy production's data into Neon

- **What it checks:** N-6 #2 (the copy and its check on production), runbook step 3.
- **User:** you, in GitHub.
- **Flow:**
  1. Check nothing is running: Studio's **Runs** list shows nothing queued or running.
  2. GitHub → **Actions** → **Copy production data (one-off, N-6)** → **Run workflow**. Use workflow from `sprint-6`, target `production`, confirm `production`.
  3. Tell Claude it has started.
- **Expected outcome:**
  - **Copy the data** ends "every trigger is enabled again", in about a minute and a half.
  - **Check the copy against Supabase** says **Copy matches**.
  - If either fails: stop. Production is still on Supabase and unchanged, and Neon kept nothing.
- **Result:** ☐ Pass ☐ Fail. Copy took: ______.
- **Notes:** ________________________________________________

### TC-4 Point production at Neon and deploy Sprint 6

- **What it checks:** N-6 runbook steps 4 to 6: the switch itself.
- **User:** you in Vercel, then Claude (the merge).
- **Flow:**
  1. Vercel → campaign-studio → Settings → Environment Variables → Production `DATABASE_URL` → **Edit**: paste Neon's `production` pooled string (host with `-pooler`). Save. Check Production also has `RESEND_API_KEY` and `EMAIL_FROM`.
  2. Tell Claude. Claude merges Sprint 6 into `main`; the push redeploys production.
  3. Claude watches the **After production deploy** Action.
- **Expected outcome:**
  - The deployment is Ready and the After production deploy Action is green ("Production is serving <the merge commit>"), with Inngest resynced.
  - Claude confirms production's health check is on the merge commit (it no longer shows the database host in production, by design).
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-5 Nothing was written to Supabase during the switch

- **What it checks:** N-6 #2 (second half): no writes lost between the copy and the switch.
- **User:** you, in GitHub.
- **Flow:** Actions → **Copy production data (one-off, N-6)** → **Run workflow**, from `sprint-6`, target `check`, confirm `check`.
- **Expected outcome:** **Copy matches**. A difference names the table: tell Claude, and the runbook's way back applies (writes after the copy would otherwise be lost).
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-6 Sign in on production by email

- **What it checks:** N-3 #1 and #7, N-2 #4.
- **User:** you, on production.
- **Flow:**
  1. Open `https://campaign-studio-neon.vercel.app`. You are signed out (everyone is, after the move).
  2. **Sign in** with your usual email.
  3. Open the email and click the link, then **Continue**.
  4. Open the same link again.
- **Expected outcome:**
  - The email arrives within two minutes, from `mail.mcclelland.info`, in your inbox, not spam.
  - You land in your own workspace.
  - The second use says the link has expired.
  - If no email arrives in two minutes: tell Claude, who checks Vercel's runtime logs for `[signIn] couldn't send`.
- **Result:** ☐ Pass ☐ Fail. Minutes to arrive: ______.
- **Notes:** ________________________________________________

### TC-7 A campaign from before the move is all there

- **What it checks:** N-6 #3.
- **User:** you.
- **Flow:**
  1. **Campaigns** → Quillmoor, "Win back savers who stopped using the app this year".
  2. Look through the brief (version 1, signed off), the persona review, the test plan, and the Creative section.
  3. Click an ad to open it full size.
  4. **Brands** → Fernhollow Outfitters: its products and logo.
- **Expected outcome:** the brief, personas, test plan, all current ads (with their pictures and words) and discarded ones are there as before; pictures open full size; the Fernhollow campaign "Launch the winter range to lapsed customers" is still version 1, not signed off.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-8 A new Make creative, charged against today's cap

- **What it checks:** N-6 #4.
- **User:** you.
- **Flow:**
  1. Note **Runs and AI cost** for today before you start.
  2. On the Quillmoor campaign, click **New picture** on one ad (about 3p). Or **Make creative** for a full set (about 14p, at most 31p).
  3. Wait for it to finish.
- **Expected outcome:** the run completes; today's cost goes up by the run's cost, on top of anything spent before the move today.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______.
- **Notes:** ________________________________________________

### TC-9 An invitee keeps their workspace and signs in by email

- **What it checks:** N-6 #5, N-3 #2.
- **User:** the test invitee (test@mcclelland.info), in a private window.
- **Flow:**
  1. In a private window, open production and **Sign in** with `test@mcclelland.info`.
  2. Open that mailbox's email and use the link.
- **Expected outcome:** signed in to the same workspace as before the move (it was empty in Sprint 5), not a new one. On **/invites** (as you), that invite still shows as used.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-10 Sign-out really ends the session

- **What it checks:** N-2 #4 and the review fix for ended sessions.
- **User:** you, in the private window from TC-9.
- **Flow:** **Sign out**, then press the browser's Back button and reload.
- **Expected outcome:** you are not let back in: the page shows Welcome or Sign in.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-11 Speed and storage

- **What it checks:** N-6 #6 and #7.
- **User:** Claude records; you note how it feels.
- **Flow:** Claude reads production's health check after five idle minutes (cold) and then warm, and Neon's storage for `production`.
- **Expected outcome:** recorded against Supabase's 94 ms (first) and 3 ms (warm). The first request after five idle minutes may take under a second while Neon resumes; that is expected on the free plan. Storage well under 0.5 GB (the rehearsal copy was 19 MB).
- **Result:** Cold: ______ ms. Warm: ______ ms. Storage: ______. Your impression: ______.
- **Notes:** ________________________________________________

---

**If anything goes badly wrong after TC-4:** the runbook's way back (`docs/hosting.md`, Cutover, "The way back"): Vercel **Instant Rollback** to the last deployment before the switch, then set Production `DATABASE_URL` back to the Supabase string, then resync Inngest. Don't push to `main` while rolled back. Supabase is untouched and stays for 14 days; after about a week idle it pauses, and **Restore project** in its dashboard wakes it in a few minutes.

**When you're done:** send "done", or the numbers of any failing cases with a screenshot of each. Claude then checks the runs, timings and costs in the database, records the results against these cases, and closes Sprint 6.
