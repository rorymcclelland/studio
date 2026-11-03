# Sprint 7 demo: case results

From CI run [41547303603](https://github.com/rorymcclelland/campaign-studio/actions/runs/41547303603) on `sprint-7`, commit `68999d5`, 3 November 2026, 00:05 (London).

**Sign-off:** Rory signed the demo off on 3 November 2026 at 14:01 ("All good"). The hand checks in `sprint-7-test-pack.md` (HC-1 to HC-4) had not been run on production at that point; their results are recorded here when they come in.

**Totals:** 37 cases, 22 passed in the browser, 0 failed, 0 not run, 9 passed in CI, 0 failed in CI, 5 by hand, 1 withdrawn.

Built by `scripts/demo-page.mjs` (decision 0021). A case shows Passed or Failed only from a browser test that ran in this run. The recordings are on the demo page; they use the mock model, so their pictures and words are simulated.

## Sprint goal

A picked ad becomes a launch pack: every size each channel needs, in English and three more languages, checked in every size and language, and downloaded as one zip with a manifest. Nothing that fails a check is dropped silently: the pack says what was left out and why.

**Demo:** pick four paid-social ads from the Quillmoor campaign, click **Build launch pack**, and download one zip of 64 ready ads (four ads × four social sizes × four languages), with a manifest that lists every file, its words, its checks and anything left out.

## C7-1 Sizes: every ad in every size a channel needs

| Case | What | Result | How it is checked |
| --- | --- | --- | --- |
| C7-1.1 | A picked paid-social ad renders in all four social sizes, keeping every part, passing contrast and fit. | Passed | Browser: sizes.spec.ts. Shows each size drawn full size with its contrast, fit and legal-line checks; that every size keeps the same headline, body, button and logo is the CI test.<br>CI: tests/lib/render-sizes.test.ts: "C7-1 #1: a paid-social ad renders in all four social sizes with every part, passing contrast and fit" (passed in this run)<br>CI: tests/db/ad-sizes.test.ts: "#1 a paid-social ad is served in each social size, each with its own ETag (the square's is the ad's own)" (passed in this run) |
| C7-1.2 | A display ad renders in the three banner sizes with headline, button, logo and legal lines. | Passed | Browser: sizes.spec.ts<br>CI: tests/lib/render-sizes.test.ts: "C7-1 #2: a display ad renders in the banner sizes with headline, button, logo and legal lines (no body)" (passed in this run)<br>CI: tests/db/ad-sizes.test.ts: "#2 a display ad is served in the three banner sizes" (passed in this run) |
| C7-1.3 | Full bleed at 9:16 crops around the picture's subject, never stretches; split and card keep the square picture whole. | Passed in CI | CI: tests/lib/render-sizes.test.ts: "C7-1 #3: the picture is fitted, never stretched" (passed in this run)<br>By hand: How well the crop keeps the subject of real 2K pictures. CI runs the mock model and has no real keys, so this needs real model output: checked by hand on production after the deploy (hand check HC-1 in docs/testing/sprint-7-test-pack.md). |
| C7-1.4 | A size that can't hold the words at the smallest step is refused with the reason; the other sizes still render. | Passed | Browser: sizes.spec.ts<br>CI: tests/lib/render-sizes.test.ts: "C7-1 #4: a size whose box can't hold the words at the smallest step is refused with the reason" (passed in this run)<br>CI: tests/db/ad-sizes.test.ts: "#4 a size the legal lines don't fit is a 422 with the reason; the other sizes still render" (passed in this run) |
| C7-1.5 | A simulated picture carries its "Simulated image" label in every size, including the smallest banner. | Passed | Browser: sizes.spec.ts. Shows the badge on every size; that the label is drawn into the pixels is the CI test.<br>CI: tests/lib/render-sizes.test.ts: "C7-1 #5 (rule 1): a simulated picture carries its label in every size, including 728 × 90" (passed in this run) |
| C7-1.6 | The 1080 square is pixel-identical to the ad drawn before sizes. | Passed in CI | CI: tests/lib/render-golden.test.ts: "C7-1 #6: the 1080 square is pixel-identical to today's ad" (passed in this run) |
| C7-1.7 | Hostile: an unknown size, or another channel's size, is a 404; another workspace's ad is a 404 in every size. | Passed | Browser: sizes.spec.ts. Unknown and other-channel sizes only; another workspace's ad is the CI test.<br>CI: tests/db/ad-sizes.test.ts: "#7 hostile: unknown sizes, the other channel's sizes, another workspace's ad, no session and malformed ids are all 404" (passed in this run) |
| C7-1.8 | A 1K picture (made before this sprint) renders in every size, noted as "upscaled from a 1K picture". | Passed in CI | CI: tests/db/ad-sizes.test.ts: "#5 and #8: a simulated 1K picture is labelled in every size, and noted as upscaled where it is enlarged" (passed in this run)<br>CI: tests/lib/render-sizes.test.ts: "C7-1 #8: a 1K picture still renders in every size; the enlargement is recorded" (passed in this run) |

## C7-2 Languages: the words in three more languages

| Case | What | Result | How it is checked |
| --- | --- | --- | --- |
| C7-2.1 | Translating a paid-social set into French, German and Spanish makes three linked sets, within limits, with each language's legal lines. | Passed | Browser: languages.spec.ts. Shows the three translations, the German translation's own legal lines in the ad's details, and every German size drawing all of them; the channel limits and the link to the English set are the CI test.<br>CI: tests/agents/localise.test.ts: "#1 translating a paid-social set into French, German and Spanish makes three sets linked to the English one, within the limits, with the kit's legal lines for each language" (passed in this run)<br>By hand: Translation quality and tone. CI runs the mock model and has no real keys, so this needs real model output: checked by hand on production after the deploy (hand check HC-3 in docs/testing/sprint-7-test-pack.md). |
| C7-2.2 | Each translated ad renders in every size of its channel and passes fit and contrast, or is left out with the reason. | Passed | Browser: languages.spec.ts. The German ad: all four social sizes drawn at full size, each with its fit, contrast and legal-line checks. A size left out with its reason, and the display banners, are the CI test.<br>CI: tests/agents/localise.test.ts: "#2 each translated ad renders in every size of its channel and passes fit and contrast, or is left out with the reason" (passed in this run) |
| C7-2.3 | A German headline that overflows 4:5 gets one repair and then fits; one that still overflows is left out of that size only. | Passed in CI | CI: tests/agents/localise.test.ts: "#3 a German headline too long for a size gets one repair naming the field and size, and then fits" (passed in this run)<br>CI: tests/agents/localise.test.ts: "#3 words that still overflow after the repair are left out of that size only, with the reason" (passed in this run) |
| C7-2.4 | A translation with a banned term for that language is repaired once, then refused. | Passed in CI | CI: tests/agents/localise.test.ts: "#4 a translation with a banned term for that language is repaired once, then refused" (passed in this run) |
| C7-2.5 | A brand with no German legal lines can't translate into German; the button explains why. | Passed | Browser: languages.spec.ts. On Fernhollow, which no other browser test translates: its German legal lines are cleared on the Languages page and put back afterwards. A brand whose only language is refused is the CI test.<br>CI: tests/agents/localise.test.ts: "#5 a brand with no German legal lines can't translate into German: the button explains why" (passed in this run) |
| C7-2.6 | Every translated ad shows "Machine translation" in the gallery and the manifest. | Passed | Browser: languages.spec.ts. The gallery and the Sizes view.<br>Browser: launch-pack.spec.ts. The manifest. Measured: 64-ad demo pack: 19.7 s from click to complete download, 22.6 MB.<br>CI: tests/agents/localise.test.ts: "#6 every translated ad says 'Machine translation' in the gallery and the Sizes view (rule 1), simulated when the mock wrote it" (passed in this run) |
| C7-2.7 | Hostile: an instruction hidden in the English words is translated as words, and the testimonial check still refuses a quote. | Passed in CI | CI: tests/agents/localise.test.ts: "#7 hostile: an instruction in the English words is translated as words, and the testimonial check still refuses a first-person quote" (passed in this run)<br>CI: tests/lib/translation-first-person.test.ts: "first person in a translation" (passed in this run) |
| C7-2.8 | The mock model returns fixed translations, labelled simulated, so previews spend nothing. | Passed | Browser: languages.spec.ts. Shows the "(simulated)" label; the rest is the CI test.<br>CI: tests/agents/localise.test.ts: "#8 the mock model returns fixed translations, labelled simulated, so previews spend nothing real" (passed in this run) |
| C7-2.Q4 | Rory reviews the French, German and Spanish legal lines Claude wrote for the demo brands (answer to Q4). | Hand check | By hand: Rory reviews the demo legal lines Claude wrote (answer to Q4); hand check HC-2 in docs/testing/sprint-7-test-pack.md. |

## C7-3 Launch pack: a zip per channel with a manifest

| Case | What | Result | How it is checked |
| --- | --- | --- | --- |
| C7-3.1 | Picked ads in three languages give a zip with every size and language that passed, in channel and language folders; the count matches the gallery's. | Passed | Browser: launch-pack.spec.ts. Four picked social ads (the sprint demo); the mix of two social and one display ad is the CI test. Measured: 64-ad demo pack: 19.7 s from click to complete download, 22.6 MB.<br>CI: tests/db/pack.test.ts: "#1 holds every picked ad in every size and language that passed, in channel and language folders, and the count matches the gallery's" (passed in this run) |
| C7-3.2 | The manifest lists every file with its words, checks and provenance, and every left-out size or language with its reason. | Passed | Browser: launch-pack.spec.ts. Checks that every file is listed with its headline, fit and labels. The body, button, legal lines, contrast and provenance fields, and a left-out size with its reason (nothing is left out in the demo pack), are the CI test. Measured: 64-ad demo pack: 19.7 s from click to complete download, 22.6 MB.<br>CI: tests/db/pack.test.ts: "#2 the manifests list every file with its words, checks and provenance, and every left-out size or language with its reason" (passed in this run) |
| C7-3.3 | An unpicked or discarded ad, or one from an earlier brief version, is not in the pack. | Passed in CI | CI: tests/db/pack.test.ts: "#3 unpicked, discarded and earlier-version ads are not in the pack" (passed in this run) |
| C7-3.4 | A brief not signed off, or nothing picked, shows why there's no pack and offers no download. | Passed | Browser: launch-pack.spec.ts. Nothing picked; a brief that isn't signed off is the CI test. Measured: 64-ad demo pack: 19.7 s from click to complete download, 22.6 MB.<br>CI: tests/db/pack.test.ts: "#4 no sign-off, or nothing picked: a refusal with the reason, never an empty zip; the gallery offers no download" (passed in this run) |
| C7-3.5 | A 60-file pack downloads completely (time and size measured). | Passed | Browser: launch-pack.spec.ts. 64 ads. The time from click to complete download and the zip's size are shown as the test's measurement; the test fails above 120 s or 50 MB. Measured: 64-ad demo pack: 19.7 s from click to complete download, 22.6 MB. |
| C7-3.6 | Simulated pictures and machine translations are labelled in the manifest and README. | Passed | Browser: launch-pack.spec.ts. Measured: 64-ad demo pack: 19.7 s from click to complete download, 22.6 MB.<br>CI: tests/db/pack.test.ts: "#6 rule 1: simulated pictures and machine translations are labelled in both manifests and the README" (passed in this run) |
| C7-3.7 | Hostile: another workspace's campaign is a 404; a crafted file name in the words can't escape the zip's folders. | Passed in CI | CI: tests/db/pack.test.ts: "#7 hostile: another workspace's campaign, no session and malformed ids are the same 404" (passed in this run)<br>CI: tests/db/pack.test.ts: "#7 hostile: words like ../../x can't leave the zip's folders, and the CSV defuses formulas" (passed in this run)<br>CI: tests/lib/pack-names.test.ts: "C7-3 pack file names" (passed in this run) |

## F-27 Several audiences

| Case | What | Result | How it is checked |
| --- | --- | --- | --- |
| F-27.1 | A brief with two audiences gets 24 social ads (12 each), grouped by audience in the gallery. | Passed | Browser: several-audiences.spec.ts<br>CI: tests/agents/creative.test.ts: "#1 two audiences get 24 social ads (12 each) and 24 display ads, grouped by audience in the brief's order" (passed in this run) |
| F-27.2 | New words works on the second audience's words and redraws only its ads. | Passed | Browser: several-audiences.spec.ts<br>CI: tests/agents/creative.test.ts: "#2 New words on the second audience's words redraws only that audience's ads on those words" (passed in this run) |
| F-27.3 | A brief with no named audience works as today ("all"). | Passed in CI | CI: tests/agents/creative.test.ts: "F-27 #3: a brief with no named audience works as today: 12 ads for everyone, in one group" (passed in this run) |
| F-27.4 | The cost shown before Make creative is unchanged. | Passed | Browser: several-audiences.spec.ts. Compares the Make creative button's cost with one audience signed off and then with two.<br>CI: tests/agents/creative.test.ts: "#4 the cost shown before Make creative is the same as for one audience (pictures are shared, the words are one Copy run)" (passed in this run) |

## F-26 Redraw with the current kit

| Case | What | Result | How it is checked |
| --- | --- | --- | --- |
| F-26.1 | After a palette change the button appears on older ads; redrawing makes new ads in the new colours and discards the old. | Passed | Browser: creative.spec.ts. The palette is changed in the brand editor, and the older-kit badges go once the ads are redrawn; that the redrawn ads are drawn in the new colours is the CI test.<br>CI: tests/agents/creative.test.ts: "#1 and #4 after a palette change: the older ads say so; a redraw makes a new ad in the new colours (same picture, words and layout, the pick carried over) and discards the old one, at no AI cost" (passed in this run) |
| F-26.2 | Undo restores the old ads. | Passed | Browser: creative.spec.ts<br>CI: tests/agents/creative.test.ts: "#2 undo: restoring the old ad brings it back with its pick and discards the redrawn one" (passed in this run) |
| F-26.3 | An ad already on the current kit has no button. | Passed | Browser: creative.spec.ts<br>CI: tests/agents/creative.test.ts: "#3 an ad already on the current kit has no button, and a redraw is refused" (passed in this run) |
| F-26.4 | Picks carry over to the redrawn ad. | Passed | Browser: creative.spec.ts<br>CI: tests/agents/creative.test.ts: "#1 and #4 after a palette change: the older ads say so; a redraw makes a new ad in the new colours (same picture, words and layout, the pick carried over) and discards the old one, at no AI cost" (passed in this run) |

## F-28 The database-driver patch: report and watch

| Case | What | Result | How it is checked |
| --- | --- | --- | --- |
| F-28.1 | The upstream issue is filed, linked from decision 0016. | Withdrawn | Withdrawn: Withdrawn by Rory's decision on 2 November 2026: the issue is not posted (postgres.js 4.0.0 rewrote that code and similar issues are closed); trying 4.0.0 is F-31 in the backlog. Recorded in decision 0016. |
| F-28.2 | No "Cannot read properties of null" or CONNECT_TIMEOUT in a week of production logs, or each one explained. | Hand check | By hand: Needs a week of production logs, which CI doesn't have: Claude reads them at the sprint's close. |

## N-7a Remove the cutover pieces and Supabase

| Case | What | Result | How it is checked |
| --- | --- | --- | --- |
| N-7a.1 | grep -ri supabase finds only history. | Hand check | By hand: The removal is not done before 12 November (Q7); checked then. |
| N-7a.2 | CI and production are green after the removal. | Hand check | By hand: After the removal on or after 12 November; production is checked on the live site. |
| N-7a.3 | Rory confirms both Supabase projects are deleted. | Hand check | By hand: Rory deletes them in Supabase's dashboard, on or after 12 November. |
