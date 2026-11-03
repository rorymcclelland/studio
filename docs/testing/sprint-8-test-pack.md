# Sprint 8 hand checks: the AI's eyes on real pictures, a real uploaded ad and the panel's reasons

**For Rory, on production, after the Sprint 8 deploy.** Your own sign-in. Contains no passwords or keys.

Everything else in Sprint 8 is checked by browser tests and other CI checks, and shown on the demo page. These four checks are the ones CI can't do, because CI runs the mock model: it never looks at a real picture, never reads a real ad, and never writes a real reason.

**Before you start**

- **Time:** about 15 minutes.
- **AI cost:** about 21p, at most about 42p, within the £1 daily cap. Making creative is about 20p, at most 41p (it now includes the picture check, about 0.03p a picture). Checking an uploaded ad is about 0.1p. Pre-testing four picked ads is about 0.2p. Check pictures on an older campaign is about 0.03p a picture. Every button shows its cost before you click.
- **Production** must be on Sprint 8: the campaign page shows **Check pictures** and **Pre-test picked ads**, and each brand page has **Check an ad**.
- **The file for HC-2** is in the repository: `docs/testing/files/sprint-8-hc2-fernhollow-ad.png` (a fictional Fernhollow ad drawn by Studio's own renderer, 1080 × 1350, 335 KB). You can use your own fictional ad instead, as long as it is a PNG or JPEG under 4 MB, with no real company's name or logo.

---

### HC-1 Picture judgement checks on real pictures

- **What it checks:** C8-2 test case 7. Whether Haiku spots a face for a finance brand, and a picture that breaks a don't rule, on real pictures. CI checks the flow with the mock model, but only a person can judge whether the AI looked properly.
- **User:** you.
- **Flow:**
  1. **Brands** → Quillmoor Money (a finance brand) → **Edit brand kit**. Under **Don't**, add a rule that the pictures are likely to break, for example "Show coins, banknotes or piggy banks". **Save brand kit**.
  2. **New campaign for Quillmoor Money**, for example "Bring lapsed savers back to the Plus plan before spring". Write the brief, send version 1 for sign-off and approve it (this also starts the persona review HC-3 needs).
  3. Note the cost on **Make creative**, click it and wait for it to finish. Read the run's summary.
  4. Open the **Compliance** view of two ads with different pictures, and read **The picture** section.
- **Expected outcome:**
  - If the run summary says a picture was dropped for a close-up face, that is believable (a face really was the subject); no picture in the gallery shows a person's face in close-up.
  - Each ad's **Picture: face (finance brands)** says "No issues found by AI" with "Checked by AI", or Review if the AI saw something; never a green Pass.
  - **Picture: don't rules**: where a picture shows coins, notes or a piggy bank, it is Review, and the AI's reason names what it saw; where it doesn't, "No issues found by AI". Each is marked "Checked by AI".
  - The brand's don't rules are still listed once for the whole ad, as Review, for you to accept.
  - Today's cost rose by about the amount the button showed.
  - Afterwards, take the test rule out of Quillmoor's **Don't** list again.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes (any picture the AI judged wrongly, either way):** ________________________________________________

### HC-2 Reading a real uploaded ad

- **What it checks:** C8-3 test case 6. Whether Haiku reads the words in a real ad exactly and places their boxes well enough for code to check them. CI uses fixture ads whose words the mock model reads from a fixed list.
- **User:** you.
- **Flow:**
  1. **Brands** → Fernhollow Outfitters → **Check an ad**.
  2. Choose `sprint-8-hc2-fernhollow-ad.png` (or your own fictional ad under 4 MB), channel **Paid social**, language **English**.
  3. Note the cost on **Upload and check**, click it and wait for the check to finish.
  4. Read the words read by AI, then each finding.
- **Expected outcome (for the supplied ad):**
  - **Read by AI** lists the headline "Made for the long way round", the body, the button "Shop jackets" and both legal lines, word for word, in reading order (the "Simulated image" labels may be listed too, as other words).
  - **Banned terms** fails, quoting "indestructible". **Legal lines present** passes. **Real company name** passes.
  - **Text contrast** and **Text density** are Review, marked "Estimated", with a ratio and a share that look plausible (light words on dark green are well above AA).
  - **Logo** is Review: found by AI, with a clear-space estimate. Each of Fernhollow's three don't rules is Review, with the AI's view.
  - Nothing says "Simulated reading from the mock model".
  - Today's cost rose by about 0.1p.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes (any word misread, or a box clearly in the wrong place):** ________________________________________________

### HC-3 The panel's reasons

- **What it checks:** C8-4 test case 5. Whether the synthetic panel's reasons are sensible and quote the ad. CI checks with the mock model that the scores are scores only and the quotes are the ad's own words, but not whether the reasons make sense.
- **User:** you.
- **Flow:**
  1. On the campaign from HC-1, pick four paid-social ads.
  2. Note the cost on **Pre-test picked ads**, click it and wait for it to finish.
  3. On two of the picked ads, open the panel's scores and read each persona's reasons.
- **Expected outcome:**
  - Every score is labelled "Synthetic panel, not real customers", with no "(simulated scores)".
  - Each reason is one sensible sentence about that ad, from that persona's point of view, and its quote is words the ad really says.
  - No reason gives a click rate, a percentage or a prediction of what people will do.
  - The scores differ between ads where the ads differ (not the same numbers everywhere).
  - Today's cost rose by about the amount the button showed.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes:** ________________________________________________

### HC-4 Check pictures on an existing campaign, and the pack afterwards

- **What it checks:** C8-2 test case 4 and C8-1 test case 9 on production, with real pictures made before Sprint 8 (the Sprint 7 hand-check campaign, or any older one).
- **User:** you.
- **Flow:**
  1. Open the Fernhollow campaign from the Sprint 7 hand checks (its pictures were made before Sprint 8).
  2. Its ads' Compliance views say "The picture check didn't run" for the picture items. Note the cost on **Check pictures**, click it and wait for it to finish.
  3. Under the compliance summary, use **Accept for every picked ad** on each of the brand's don't rules, and accept any picture item that is Review if you agree with it.
  4. Click **Build launch pack** and open `manifest.json` and `manifest.csv` in the zip.
- **Expected outcome:**
  - After the check, the **Check pictures** button says every picture is checked, and the picture items say "Checked by AI".
  - The pack holds the picked ads that pass or that you accepted; anything left out is listed with the reason.
  - In `manifest.json`, each file's `compliance` has the picture rules with `"checkedBy": "Checked by AI"`, and an AI "no" is recorded as `"no issues found by AI"`, never as `"pass"`. Your email is beside each item you accepted.
  - If the ads were pre-tested, the manifest's `pretest` says "Synthetic panel, not real customers".
  - Today's cost rose by about the amount the Check pictures button showed.
- **Result:** ☐ Pass ☐ Fail. Cost shown: ______. Cost charged: ______.
- **Notes:** ________________________________________________

---

**When you're done:** send "done", or the numbers of any failing checks with a screenshot of each. Claude then checks today's runs, costs and production logs, records the results with the demo sign-off, and closes Sprint 8.
