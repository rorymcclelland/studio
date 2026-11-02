# Sprint 7 test pack: sizes, languages, the launch pack, redraw and several audiences

**For Rory, on production, after Sprint 7 is deployed.** Real AI costs (small) and your own sign-in. Contains no passwords or keys.

Claude deploys first (both database changes applied to production and checked, then the merge to `main`) and tells you when production is on the Sprint 7 commit. Then work through the cases in order; Claude is in the chat to check runs, costs and logs as you go.

**Before you start**

- **Time:** about 45 minutes.
- **AI cost:** about 30p in all, at most about 75p, within the £1 daily cap:
  - the new brief and its words: a few pence (TC-4);
  - Make creative: about 20p, at most 41p, as the button says (TC-4);
  - Translate the picked ads: about 6p for four ads in three languages; the button shows the cost (TC-7).
  - Sizes, redraws and the launch pack are drawn in code and cost nothing.
- **Have to hand:** something that opens a zip and a spreadsheet (for `manifest.csv`).
- **What's simulated:** nothing in this pack uses the mock model; pictures and translations are real. Older demo pictures from before Sprint 5's real images may still carry "Simulated image".

---

### TC-1 Production is on Sprint 7

- **What it checks:** the deploy (both migrations, the merge).
- **User:** Claude.
- **Flow:** Claude applies the two migrations to production, checks its schema against a fresh build, merges `sprint-7` into `main`, and watches the **After production deploy** Action.
- **Expected outcome:** the schema matches in all eleven parts; the Action is green; production's health check shows the merge commit.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-2 Existing ads are unchanged, and show their sizes

- **What it checks:** C7-1 test cases 6 and 8; the new fonts load in production.
- **User:** you.
- **Flow:**
  1. **Campaigns** → Quillmoor, "Win back savers who stopped using the app this year" → the Creative section.
  2. Look at the ads: they should look exactly as before.
  3. On one paid-social ad, click **Sizes**.
  4. Open the 9:16 (1080 × 1920) size full size.
- **Expected outcome:**
  - The square ads are unchanged (same words, colours, logo, layout).
  - The Sizes page shows four sizes: 1080 × 1080, 1080 × 1350, 1080 × 1920 and 1200 × 628. Each has its words, logo and legal lines, or "Left out" with a plain reason.
  - Sizes other than the square say "Upscaled from a 1K picture" (these pictures were drawn before Sprint 7).
  - No size shows empty boxes where letters should be.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-3 Redraw with the current kit, and undo

- **What it checks:** F-26 test cases 1 to 4.
- **User:** you.
- **Flow:**
  1. On the same Quillmoor campaign, **pick** one ad (the pick button on its card) and note which.
  2. **Brands** → Quillmoor Money → **Edit brand kit**. Under **Palette**, change one colour slightly (note the old value). **Save brand kit**.
  3. Back to the campaign's Creative section.
  4. Click **Redraw with current kit** on the ad you picked.
  5. Under **Discarded**, click **Restore** on the old version of that ad.
  6. Click **Redraw all N older ads**.
  7. Put the palette colour back as it was, save, and click **Redraw all N older ads** again.
- **Expected outcome:**
  - After step 2, the ads say "Made with an older kit", and a bar says "All N ads were made with an older kit."
  - Step 4 makes a new ad in the new colour, with the same picture and words, and still picked; the old one moves to Discarded and says restoring it undoes the redraw.
  - Step 5 brings back the old ad, picked, and discards the redrawn one.
  - Steps 6 and 7 redraw every older ad with no AI cost (today's **Runs and AI cost** doesn't move); any ad that can't be drawn keeps the older kit and says why.
  - Afterwards the ads are in the original colours again.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-4 A campaign with two audiences

- **What it checks:** F-27 test cases 1 and 4; Make creative at 2K.
- **User:** you.
- **Flow:**
  1. **Brands** → Fernhollow Outfitters → **New campaign for Fernhollow Outfitters**, with an objective that names two groups, for example "Sell the new trail range to weekend hikers and to commuters who cycle to work".
  2. Write the brief and check it lists **two audiences**. (If it has only one, tell Claude before going on.)
  3. Send version 1 for sign-off and approve it, as in earlier sprints.
  4. Note the cost on **Make creative** (about 20p, at most 41p), then click it and wait for it to finish.
- **Expected outcome:**
  - The run summary says, for example, "48 ads from 4 pictures and 12 sets of words, for 2 audiences" (fewer if the brief has no display channel).
  - The gallery has a heading "For <audience> (N ads)" for each audience, in the brief's order.
  - The cost shown before the run is what one audience would cost: pictures are shared.
  - Today's cost rises by about the amount shown.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes:** ________________________________________________

### TC-5 New ads in every size

- **What it checks:** C7-1 test cases 1 to 4 on 2K pictures.
- **User:** you.
- **Flow:**
  1. On the new Fernhollow campaign, open **Sizes** for one paid-social ad, then for one display ad if there is one.
  2. Open the 9:16 size and the 1200 × 628 size full size.
  3. Repeat for a Quillmoor display ad if one exists (its English legal lines are long).
- **Expected outcome:**
  - Paid social: four sizes; display: 300 × 250, 300 × 600 and 728 × 90.
  - No "Upscaled" note on these (the pictures are 2K).
  - Full-bleed crops keep the subject in frame. **Tell Claude about any crop that cuts the subject badly**: the crop is automatic and this is its first real test.
  - Quillmoor's 728 × 90 is "Left out" with the reason that the legal lines don't fit at a readable size; its other banners draw.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-6 Each brand's languages and legal lines

- **What it checks:** C7-2 set-up (Q3, Q4); you review the demo legal lines Claude wrote.
- **User:** you.
- **Flow:**
  1. **Brands** → Fernhollow Outfitters → **Languages** (under the brand's sections).
  2. If it's empty, click **Add the demo languages**.
  3. Read the French, German and Spanish legal lines and banned terms. Do the same for Quillmoor Money.
- **Expected outcome:**
  - French, German and Spanish are listed for both brands, each marked "written for the demo".
  - The legal lines read as sensible equivalents of the English ones. Note any wording you want changed.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-7 Translate the picked ads

- **What it checks:** C7-2 test cases 1, 2 and 6, with the real model.
- **User:** you.
- **Flow:**
  1. On the Fernhollow campaign, pick four paid-social ads (two from each audience).
  2. In the **Languages** bar, note the cost on **Translate the picked ads**, then click it and wait for the run to finish.
  3. Look at a translation thumbnail, then open **Sizes** on one picked ad and switch the language to German.
- **Expected outcome:**
  - Each picked ad gains French, German and Spanish versions, each with a "Machine translation" badge.
  - The German Sizes view draws the German words in every size, with the German legal lines, or leaves a size out with the reason.
  - Accented letters (é, ü, ñ, ß) draw properly; long German words break with a hyphen rather than running off the edge.
  - Today's cost rises by about the amount shown on the button.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes:** ________________________________________________

### TC-8 The launch pack

- **What it checks:** C7-3 test cases 1, 2, 5 and 6.
- **User:** you.
- **Flow:**
  1. On the Fernhollow campaign, read the **Launch pack** panel: file count, languages, sizes, labels and anything left out.
  2. Click **Build launch pack (N ads)** and time the download.
  3. Open the zip.
  4. Open `manifest.csv` in a spreadsheet, and read `README.txt`.
- **Expected outcome:**
  - The download completes and the zip opens. Folders are `paid-social/<language>/` (and `display/…` if picked), and the files match the panel's count.
  - Each PNG is the size its name says.
  - `manifest.csv` has a row per file (words, legal lines, alt text, checks, picture and words' provenance), marks translations as machine translations and the legal lines as written for the demo, and lists every left-out size or language with its reason.
  - `README.txt` says what the pack is and when it was made, and gives the honesty labels.
- **Result:** ☐ Pass ☐ Fail. Files: ______. Size: ______. Time: ______.
- **Notes:** ________________________________________________

### TC-9 No pack without picks

- **What it checks:** C7-3 test cases 3 and 4.
- **User:** you.
- **Flow:**
  1. Open the Fernhollow campaign "Launch the winter range to lapsed customers" (version 1, not signed off).
  2. Open a signed-off campaign where nothing is picked (or unpick everything on one, then pick again afterwards).
- **Expected outcome:** the Launch pack panel says why there's no pack (not signed off; nothing picked) and offers no download.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

### TC-10 Runs, costs and logs

- **What it checks:** rules 4 and 5; F-28's log watch.
- **User:** Claude.
- **Flow:** Claude reads today's runs and ledger (Imagery, Copy, Localise), and production's runtime logs for errors.
- **Expected outcome:** every run traced with its model, tokens and cost; charges match the buttons; no `Cannot read properties of null`, `CONNECT_TIMEOUT` or font errors in the logs.
- **Result:** ☐ Pass ☐ Fail.
- **Notes:** ________________________________________________

---

**If anything goes badly wrong:** Vercel **Instant Rollback** to the last Sprint 6 deployment. Before that, discard any translations (Claude does this): Sprint 6's code doesn't know about them (decision 0019). The two database changes stay; Sprint 6 works with them.

**When you're done:** send "done", or the numbers of any failing cases with a screenshot of each. Claude then records the results, checks the runs and costs, and closes Sprint 7. N-7a (removing the cutover pieces and Supabase) follows on or after 12 November.
