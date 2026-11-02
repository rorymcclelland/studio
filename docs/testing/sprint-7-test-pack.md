# Sprint 7 hand checks: real pictures, real translations and the demo legal lines

**For Rory, on production.** Your own sign-in. Contains no passwords or keys.

Everything else in Sprint 7 is checked by browser tests and other CI checks, and shown on the demo page. These four checks are the ones CI can't do, because CI runs the mock model: it has no real pictures, no real translations, and no one to judge the wording.

**Before you start**

- **Time:** about 20 minutes.
- **AI cost:** about 26p, at most about 47p, within the £1 daily cap. Making creative is about 20p, at most 41p. Translating four ads into three languages is about 6p. Both buttons show the cost before you click.
- **Production** is already on Sprint 7 (deployed 2 November, before the demo; decision 0021 records that).

---

### HC-1 Crops on real 2K pictures

- **What it checks:** C7-1 test case 3. The automatic crop keeps the subject in frame on real pictures. CI checks the crop arithmetic, but only a person can judge a crop.
- **User:** you.
- **Flow:**
  1. **Brands** → Fernhollow Outfitters → **New campaign for Fernhollow Outfitters**, with an objective that names two groups, for example "Sell the new trail range to weekend hikers and to commuters who cycle to work".
  2. Write the brief, send version 1 for sign-off and approve it.
  3. Note the cost on **Make creative**, click it and wait for it to finish.
  4. Open **Sizes** on two paid-social ads with different pictures, and on one display ad if there is one.
  5. Open the 9:16 (1080 × 1920) and 1200 × 628 sizes full size.
- **Expected outcome:**
  - In every size the subject of the picture stays in frame and isn't cut badly (no heads or products sliced off at the edge).
  - No "Upscaled from a 1K picture" note on these sizes.
  - Today's cost rose by about the amount the button showed.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes (name any bad crop):** ________________________________________________

### HC-2 The demo legal lines

- **What it checks:** C7-2 set-up (your answer to Q4: you review the demo legal lines Claude wrote).
- **User:** you.
- **Flow:**
  1. **Brands** → Fernhollow Outfitters → **Languages**. If it's empty, click **Add the demo languages**.
  2. Read the French, German and Spanish legal lines and banned terms.
  3. Do the same for Quillmoor Money.
- **Expected outcome:**
  - Each language is marked "written for the demo".
  - The legal lines read as sensible equivalents of the English ones, and you're happy for them to appear in demo packs.
- **Result:** ☐ Pass ☐ Fail.
- **Notes (any wording to change):** ________________________________________________

### HC-3 Translation quality

- **What it checks:** C7-2 test case 1 with the real model. CI checks the translation flow, badges and cost with the mock model, but not whether the translations are any good.
- **User:** you.
- **Flow:**
  1. On the campaign from HC-1, pick four paid-social ads, two from each audience.
  2. In the **Languages** bar, note the cost on **Translate the picked ads**, then click it and wait for it to finish.
  3. Open **Sizes** on one picked ad and switch the language to German, then to French and Spanish.
- **Expected outcome:**
  - The translations read naturally and keep the meaning and tone of the English. Judge as far as you can; for a language you don't read, a quick check with a speaker or a second translation tool is enough.
  - Accented letters (é, ü, ñ, ß) draw properly, and long German words break with a hyphen rather than running off the edge.
  - Today's cost rose by about the amount the button showed.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes:** ________________________________________________

### HC-4 The launch pack from real creative (optional)

- **What it checks:** C7-3 on production with real 2K pictures and translations. CI builds and checks a pack from mock creative.
- **User:** you.
- **Flow:**
  1. On the same campaign, click **Build launch pack (N ads)** and open the zip.
  2. Open two or three PNGs, including a German one, and skim `manifest.csv`.
- **Expected outcome:** the pictures and words look as they did on the Sizes page; the manifest marks translations as machine translations and the legal lines as written for the demo.
- **Result:** ☐ Pass ☐ Fail ☐ Skipped.
- **Notes:** ________________________________________________

---

**When you're done:** send "done", or the numbers of any failing checks with a screenshot of each. Claude then checks today's runs, costs and production logs, records the results with the demo sign-off, and closes Sprint 7.
