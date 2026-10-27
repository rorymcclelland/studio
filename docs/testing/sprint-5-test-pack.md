# Sprint 5 test pack: Creative I, copy and imagery

**For Rory, on production.** Real models, real (small) costs. Contains no passwords or keys: you sign in as yourself, and the only files used are the two fictional test files in `docs/testing/files/`.

**Before you start**

- Production is live on commit `381e285` (Sprint 5). Nothing to start on your PC.
- Address: <https://campaign-studio-neon.vercel.app>, signed in as yourself (your usual magic link).
- Download the two test files from the chat or the repo: `docs/testing/files/test-logo-fictional.png` and `docs/testing/files/test-logo-refused.svg`.
- For TC-9, a private (incognito) window.
- **Time:** about 20 minutes. **AI cost:** about 20p in total (Make creative about 14p, at most 31p; New picture about 3p; the rest under 1p). The daily cap is £1.
- Do the cases in order: TC-1 makes the ads the later cases use.

---

### TC-1 Make creative from the signed-off brief

- **What it checks:** S5-1, S5-2, S5-3 and S5-4 #1: a signed-off brief becomes a gallery of checked ads, drawn by the real image model.
- **User:** you.
- **Flow:**
  1. Open **Campaigns**, then the Quillmoor campaign "Win back savers who stopped using the app this year" (signed off yesterday).
  2. Scroll to **Creative**. Note the cost on the button.
  3. Click **Make creative**. Wait; the section shows progress. Time it.
- **Expected outcome:**
  - The button shows "about 14p, at most 31p" before you click.
  - In about two minutes the gallery shows **12 ads** (four pictures × three sets of words), each with badges for contrast, fit and the legal line.
  - **No "Simulated image" badge** (these are real pictures).
  - A **Words for other channels** list shows the copy for the brief's other channels: search, email and app push.
  - **Runs and AI cost** shows Make creative with its Imagery and Copy runs, a total under 31p, and no "(simulated)" label.
- **Result:** ☐ Pass ☐ Fail. Time taken: ______. Total cost shown: ______.
- **Notes:** ________________________________________________

### TC-2 The pictures never contain text (rule 8)

- **What it checks:** S5-1: the image model draws pictures only; every word, the logo and the legal line are drawn by code.
- **User:** you.
- **Flow:**
  1. Click two or three ads to open them full size.
  2. Look at the picture behind the words.
- **Expected outcome:**
  - No letters, numbers, signs, logos or brand marks inside the picture itself.
  - The headline, body, button, Quillmoor logo and the three legal lines are crisp, in the brand's navy and yellow, and readable.
  - If the trail for the Imagery run says a picture was redrawn or dropped because it had text, that is the check working: note it.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-3 New picture changes one ad

- **What it checks:** S5-4 #2: a new picture replaces only that ad's picture, and costs what it says.
- **User:** you.
- **Flow:**
  1. On ad 1, click **New picture** (about 3p).
  2. Wait for it to finish.
- **Expected outcome:**
  - Only ad 1 has a new picture; the other 11 are unchanged.
  - The old ad 1 is listed under discarded, with undo.
  - Runs and AI cost shows the New picture run at about 3p.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-4 Editing words: refused, then saved

- **What it checks:** S5-2 and S5-4 #3: hand edits pass the same checks as the agent's words.
- **User:** you.
- **Flow:**
  1. On any ad, click **Edit words**.
  2. Change the headline to `Guaranteed returns, every week` and click **Save the words**.
  3. Then change the headline to something ordinary, such as `Pick up where you left off`, and save.
- **Expected outcome:**
  - Step 2: refused inline ("The headline uses the banned term "guaranteed returns""); nothing changes.
  - Step 3: saves; every ad that uses those words (four of them) shows the new headline.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-5 Pick, discard and undo survive a reload

- **What it checks:** S5-4 #4.
- **User:** you.
- **Flow:**
  1. **Pick** two ads. **Discard** one other ad.
  2. Reload the page.
  3. Undo the discard.
- **Expected outcome:** after the reload the two picks and the discard are still there; undo brings the ad back into the gallery.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-6 Switch an ad's layout

- **What it checks:** S5-3: the three layouts drawn in code.
- **User:** you.
- **Flow:** on one ad, switch the layout to **Split**, then **Card**.
- **Expected outcome:** the ad redraws in each layout with the same words, logo and legal lines; if a layout can't fit the words it says why and keeps the current one.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-7 A brief that isn't signed off can't make creative

- **What it checks:** S5-4 #5 and rule 3: sign-off is the gate before creative.
- **User:** you.
- **Flow:** open the Fernhollow campaign "Launch the winter range to lapsed customers" (version 1, not signed off) and scroll to **Creative**.
- **Expected outcome:** "Sign off the brief to make creative", with no Make creative button.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-8 Logo upload: a PNG accepted, a bad SVG refused

- **What it checks:** F-10.
- **User:** you.
- **Flow:**
  1. Open **Brands**, then **Fernhollow Outfitters**, then **Edit**.
  2. In **Logo**, choose `test-logo-refused.svg` and upload it.
  3. Then choose `test-logo-fictional.png` and upload it.
  4. Check the preview on light and dark; then click **Remove logo** if you want Fernhollow's own logo back (or keep the test one; it is fictional).
- **Expected outcome:**
  - Step 2: refused with a reason (it contains an event handler), "Nothing was changed."
  - Step 3: accepted; the preview shows the simple green mountain mark on light and dark backgrounds.
  - The brand page notes how its fonts are drawn in ads ("drawn with Source Serif 4, the nearest open font to Georgia").
  - Remove logo, if used, leaves the brand with no logo (you can restore Fernhollow's from the demo brands later, or ask me).
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-9 New sign-in link for an invitee

- **What it checks:** F-18a.
- **User:** you, then the test invitee (test@mcclelland.info) in a private window.
- **Flow:**
  1. Open **/invites**. On the used invite for test@mcclelland.info, click **New sign-in link**.
  2. Copy the link and open it in a private window. Click **Continue**.
- **Expected outcome:**
  - The link box opens below the row; New sign-in link and Revoke stay side by side.
  - In the private window you are signed in as the test invitee, in the same (empty) workspace as yesterday, not a new one.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-10 Inngest syncs itself after a deploy

- **What it checks:** F-17.
- **User:** none (GitHub).
- **Flow:** open the repo on GitHub, then **Actions**, then **After production deploy**.
- **Expected outcome:** a green run for commit `381e285`, about a minute long, whose first step says "Production is serving 381e285". (Already checked by me on 27 Oct; look only if you want to see it.)
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

---

**When you're done:** send "done", or the numbers of any failing cases with a screenshot of each. I will then check every run's trail, timing and cost in the database, record the results against these cases, and close Sprint 5.
