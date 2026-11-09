# Sprint 10 refinement: UX, shorter pages with the same look

Refined 8 November 2026, after Sprint 9 closed. Rory asked for this sprint before Performance II: he likes the design, but some pages are too long. The roadmap's Performance II and the flywheel move to Sprints 11 and 12. Questions are at the end, each with a recommended answer.

## Sprint goal

Every page puts what needs a person at the top, and no page is longer than it has to be, in the design Studio already has: the same colour tokens, type, cards, badges and controls. Nothing new is invented visually; pages are reorganised.

**Demo:** the live Fernhollow campaign from the audit opens on one screen that says it is live on simulated day 14, with 5 unseen alerts and the one ad below threshold, and every earlier stage is one click away. The same campaign is under 6 screens on a phone, down from 29.

## What the audit found (8 November)

Full page screenshots of every page at 375 and 1440 px, with the mock model and the seed's brands, measured for height, sections and the depth of each page's main action. The longest pages:

| Page | 375 px | 1440 px | Main thing, and how far down it is at 375 |
| --- | --- | --- | --- |
| Campaign, live on day 14 | 29.1 screens | 12.1 screens | Its live state (launch panel): 12.7 screens down |
| Campaign, two audiences | 42.9 screens | 15.1 screens | Launch panel: 13.8 screens down |
| Brand page (10 segments) | 18.2 screens | 8.7 screens | Its campaigns are near the top; market notes 8 screens down |
| Campaign, waiting for sign-off | 11.1 screens | 6.4 screens | Approve is near the top (good) |
| Performance, day 14 | 7.6 screens | 5.0 screens | Which ads are below threshold: 4.2 screens down |
| Brand kit editor | 7.2 screens | 5.2 screens | Save brand kit: at the end on a phone (not sticky below 640 px) |
| Campaign, brief only | 6.6 screens | 4.5 screens | Send for sign-off is near the top (good) |

The top problems, by cost to a person:
1. The live campaign page opens on the brief editor, and nothing at the top says it is live.
2. Every ad card shows every tool in every state: 242 controls on the page, a card about 1,000 px tall on a phone. Launched ads still offer Discard, New picture and New words, and Discard works: the gallery then calls a running ad discarded while the simulation keeps running it.
3. Campaign lists say "Draft vN" for every campaign, live or not (BUG-13).
4. Home leads with the Sprint 1 tagline demo; approvals and alerts are a small card, and its alerts link goes to the list.
5. Performance shows the history before what needs action: alerts oldest first, resolved ones kept as they were, every answer in full.
6. The brand page shows reference data in full: 20 products, charts, 10 segment cards repeating their text.
7. On a phone, the kit editor's Save is at the bottom of a 7-screen form.
8. Spent steps and empty states keep their full size.
9. The runs list has no filters, no campaign, and silently stops at 50.
10. Out-of-date copy (BUG-14): "Coming next" lists built features; the test plan says the simulator "is not built yet".

The intermittent 375 px failures on `main` (F-36) are the header's spend meter: while any model call is in flight, its pill reads "42.62p simulated" instead of "Simulated" and the row grows to 387 px. It happens on production too.

## Principles for every story

- **Same look.** Existing tokens, components and spacing only. A new pattern (the stage bar, a disclosure, a filter row) is built from existing parts and checked by screenshot against today's pages.
- **What needs you first.** Each page's top screen answers "what do I do here now?".
- **History on request.** Finished steps, earlier versions, seen alerts and old answers collapse to one line with a count, and open in place.
- **Tools follow state.** A control shows only when it can be used; a reason replaces a disabled button only where the person would otherwise look for it.
- **No behaviour lost.** Every action available today stays reachable, in at most one more click. Browser tests that use today's controls are updated, not deleted.
- **Rules.** Simulated figures keep their labels (rule 1). Nothing here changes what needs an approval (rule 3), except that the UI stops offering actions the rules don't allow.

## Stories, in build order

### U10-1 Quick fixes: the spend meter, list status, out-of-date copy, the kit editor's Save (S)

**The job.** Fix four small faults the audit found, first, because they stand alone. F-36, BUG-13 and BUG-14 fold in here.

**Before and after.**
- The spend meter overflows on a phone whenever any call is in flight (F-36). After: it wraps or shortens and never widens the page; while calls are in flight its label says so ("Simulated, 1 call running" or similar) rather than implying real spend.
- Lists say "Draft vN" for every campaign (BUG-13). After: the status a person would act on: Writing the brief, Draft, Waiting for sign-off, Signed off, Launch waiting, Live (simulated day N), Ended.
- "Coming next" and the test plan's simulator line are out of date (BUG-14). After: they describe what is built.
- The kit editor's Save is at the end of the form on a phone. After: the save bar is sticky at every width.

**What changes.** `src/components/spend-meter.tsx`; `campaignStatus()` in `src/app/(app)/campaigns/campaign-list.tsx` and the query behind it; the welcome page's copy; the test plan's copy in the agent's output wording or the page around it; the kit editor's save bar.

**Test cases.**
1. With a spend reservation in the database, every signed-in page at 375 px has no sideways scroll (the design-system spec's check, now made deterministic by inserting the reservation). Browser test.
2. While a call is in flight, the meter's text says a call is running and does not state an amount as real spend. CI (component) and browser test.
3. Each campaign status shows correctly in /campaigns and on the brand page, one campaign per state. Browser test.
4. A status the code doesn't know (a future campaign state) shows "Draft", not an error. CI.
5. The welcome page and the test plan no longer say built features are coming. CI (text check against a list of built features).
6. At 375 px, Save brand kit is on screen at the top and the bottom of the kit editor. Browser test.

**Out of scope.** A redesigned header (U10-2 looks at it at 1440).

**Boundaries.** Rule 1: the meter must not imply real spend; every simulated figure keeps its label.

**Size.** S.

### U10-2 The campaign in stages, opening on what needs you (L)

**The job.** A campaign opens on an overview that says where it is and what needs a person, and each stage has its own page. The longest page in Studio becomes several short ones.

**Before and after.** Today /campaigns/[id] holds the brief, revisions, sign-off, personas, test plan, every ad, compliance, pre-test, the pack, the launch and the history: 29 screens on a phone when live. After:
- **A stage bar** under the campaign's title, at every width: Brief, Audience, Creative, Launch, Performance. Each stage shows its state in a word or a count ("Signed off", "12 ads, 4 picked", "Live, day 14", "5 alerts"). On a phone it scrolls sideways inside itself, never the page.
- **The overview** (/campaigns/[id]): the objective, the campaign's state, and a "Needs you" list built from the same facts the stage bar uses: a sign-off to send or decide, ads waiting for a compliance decision, a launch waiting for approval, unseen alerts, a clock to move. Each item links to the place it is done. Below it, one short summary card per stage.
- **Stage pages:** /campaigns/[id]/brief (the brief, sign-off, versions), /campaigns/[id]/audience (personas and the test plan), /campaigns/[id]/creative (the gallery and its checks: languages, compliance rules, pre-test, picture checks, the launch pack), /campaigns/[id]/launch (the launch panel and clock), and the existing /campaigns/[id]/performance.
- **History collapses:** brief versions, discarded sets, creative runs and the campaign's runs and AI cost become one line each with a count, opening in place.
- Old links to /campaigns/[id]#creative and similar still land on the right stage (redirect by fragment where possible, or the overview's stage card).

**What changes.** `src/app/(app)/campaigns/[id]/page.tsx` splits into the overview and route segments; the sections move largely as they are. A shared loader works out each stage's state once (no extra queries per stage card beyond what the page reads today). The browser tests that walk the campaign page (most specs) go through the stage bar. Server actions keep their revalidation paths, now per stage.

**Test cases.**
1. A live campaign opens on the overview, and its first screen at 375 px and 1440 px shows "Live (simulated), day 14", the unseen alert count and the below-threshold ad. Browser test.
2. Each "Needs you" item links to the page where it is done, and doing it removes it: send for sign-off, decide a sign-off, decide a compliance review, approve a launch, mark alerts seen. Browser test.
3. A campaign with nothing to do says so ("Nothing needs you") rather than showing an empty list. Browser test.
4. The stage bar shows the right state for a campaign in each state, from writing to ended. CI (the state function, every combination) and browser test (three states).
5. Every action on today's campaign page is reachable from the new pages; the existing specs pass through the stage bar. Browser tests (the existing suite, updated).
6. Each stage page is within its length budget (U10-6) with the audit's fullest data. Browser test.
7. Another workspace's campaign id gives the not-found page on every stage route. Browser test and CI.
8. A stage that isn't reachable yet (Creative before sign-off, Performance before launch) shows a one-line reason and a link to the step that unlocks it, not an error. Browser test.
9. The stage bar never makes the page scroll sideways at 375 px, with the longest labels. Browser test.
10. Keyboard: the stage bar is a nav with `aria-current` on the current stage; every stage link and "Needs you" link works with Enter. Browser test (axe and keys).

**Out of scope.** New features on any stage. The ad cards themselves (U10-3).

**Boundaries.** Rule 3: approvals stay in the inbox and on their stage; the overview only links to them. Rule 7: every stage route reads through `asUser()`. Rule 1: simulated labels stay on every figure the overview repeats.

**Risks.** The biggest change in the sprint, and most browser tests walk this page. Mitigation: move sections, don't rewrite them; update the shared e2e helpers first so specs change in one place.

**Size.** L. If the sprint is over, the Audience page can stay inside Brief for now.

### U10-3 Ad cards that follow the ad's state, and a filterable gallery (M)

**The job.** A person can see the ads that matter (picked, launched, needing a decision) without scrolling past every tool on every card, and can't change an ad that is running.

**Before and after.** Every card shows every control. After:
- **A compact card:** the picture, its number and headline, its state (picked, launched, needs a decision, discarded) and its scores. Tools open from "Edit" or "More" on the card, and only the tools the ad's state allows appear.
- **Launched ads are locked:** no Discard, New picture, New words or Edit words while their launch is live; the card says "Running in the launch (simulated)". Today Discard works on a running ad (it only marks it), so the gallery and the launch disagree. The server refuses these too, not only the page.
- **Filters** above the gallery: All, Picked, Needs a decision, Launched; and by audience when there are several. The choice is in the URL, so a "Needs you" link can open the gallery filtered.
- **Groups by audience** collapse, with their counts.

**What changes.** The creative stage's gallery and card components; `discardVariant`, `redrawVariant`, `newWords` and the edit-words action refuse an ad in a live or waiting launch (`src/lib/creative/gallery.ts`), with a clear message.

**Test cases.**
1. A launched ad's card offers no Discard, New picture, New words or Edit words, and says it is running. Browser test.
2. Discarding, redrawing or re-wording a launched ad through the server action is refused with "That ad is running in a launch (simulated), so it can't change until the launch ends." CI (each action) and browser test (one).
3. Once the launch ends, the tools come back. CI and browser test.
4. Filter Picked shows only picked ads, Needs a decision only ads with an open compliance review, Launched only ads in the live launch; counts match. Browser test.
5. The filter survives a reload and a shared link (`?show=picked`). Browser test.
6. An unknown filter value shows All. CI.
7. A gallery card at 375 px is at most about 450 px tall when its tools are closed (today about 1,000). Browser test.
8. Every tool on today's card is still reachable from the card's menu, by keyboard. Browser test.

**Out of scope.** Changing what the tools do.

**Boundaries.** Rule 3: this stops a running ad being replaced or discarded without a decision, which today the UI allows.

**Size.** M.

### U10-4 Performance: what needs action first (M)

**The job.** The Performance page answers "which ads need me" in its first screen, and its history stops growing in full.

**Before and after.** After:
- **Order:** healthy spend share, then the ads below threshold or tiring now (with the alert that flagged each), then the full ads table, then the chart (chart and table as two tabs), then Ask.
- **Alerts:** newest first; unseen ones in full, seen ones one line each; an alert whose ad has since recovered says "Recovered on day N" (worked out from stored days, not stored); "Mark all as seen"; each alert links to its ad's row.
- **Ask:** the latest answer in full; earlier ones as their question, opening in place.

**What changes.** `src/app/(app)/campaigns/[id]/performance/page.tsx` and its components; a "mark all as seen" action (one statement, guarded like the single one); recovery worked out in `src/lib/performance/health.ts`.

**Test cases.**
1. On day 14 of the audit's launch, the first screen at 375 px shows the share and the below-threshold ad. Browser test.
2. Alerts are newest first; a seen alert is one line; an unseen one is in full. Browser test.
3. Ad 1's day-6 alert shows "Recovered on day N" once Ad 1 has been at or above threshold for two days. CI (health) and browser test.
4. Mark all as seen marks every unseen alert of this launch only, records who, and the home line updates. CI (another launch's alerts unchanged; another workspace refused) and browser test.
5. An alert's link scrolls to and highlights its ad's row. Browser test.
6. Only the latest answer is open; opening an older one shows its answer and table. Browser test.
7. The chart and table tabs work by keyboard and keep the table alternative for screen readers. Browser test (axe).

**Out of scope.** Performance II's forecasts, swaps and budget.

**Boundaries.** Rule 1: every figure keeps its simulated label; "Recovered" is worked out from stored simulated days only. Rule 3: alerts still change nothing.

**Size.** M.

### U10-5 Home leads with work (S)

**The job.** Home shows what needs a person across all campaigns.

**Before and after.** Today the hero is the Sprint 1 tagline demo. After: a "Needs you" list (approvals waiting, unseen alerts per campaign, linked to that campaign's Performance page), live campaigns with their day and share, and recent runs naming their campaign. The tagline demo moves to a smaller card lower down, or off home (question 4).

**Test cases.**
1. With approvals and alerts waiting, home's first screen lists them, each linking to its place. Browser test.
2. With nothing waiting, home says so. Browser test.
3. The alerts item links to the campaign's Performance page, not the list. Browser test.
4. Recent runs show their campaign. Browser test.

**Size.** S.

### U10-6 Length budgets, checked in CI (S)

**The job.** Pages stay short after this sprint: each page has a length budget, and a browser test fails when a page grows past it.

**What changes.** A spec that builds the audit's fullest data (reusing the audit's script as e2e helpers) and measures every page at 375 and 1440 px against a table of budgets in one file, plus the depth of each page's main action.

**Test cases.**
1. Every page is within its budget at both widths (budgets in question 7). Browser test.
2. Each page's main action is within its first 1.5 screens at 375 px. Browser test.
3. A page over budget fails with its measured height and the budget in the message. CI (the spec's own check, run against a deliberately long fixture).

**Size.** S.

### U10-7 The brand page: campaigns first, reference data on request (M)

**The job.** The brand page shows the brand's campaigns and what to do next first, and keeps its reference data (products, charts, segments, market notes, kit, legal) a click away rather than in full.

**Before and after.** 12 to 18 screens on a phone today, with 20 product rows, charts and 10 segment cards repeating their text, and the new-campaign form always open. After:
- **Top:** the brand's campaigns with their real status (U10-1) and objective, and a "New campaign" button that opens the form.
- **Sections as tabs** below: Audience (segments and market notes), Voice and visual (the kit summary, linking to the kit editor), Legal and languages, Products and data (products, charts). The tab is in the URL.
- **Segment cards** show their name, size and one-line definition; the rest opens in place. The repeated badge sentences go.

**Test cases.**
1. The brand page's first screen at 375 px shows its campaigns with their status, and "New campaign". Browser test.
2. "New campaign" opens the form; submitting it works as today. Browser test.
3. Each tab shows its section and is in the URL; a shared link opens that tab; an unknown tab shows the first. Browser test and CI.
4. A segment card is one line plus its definition until opened; nothing is shown twice. Browser test.
5. The tabs work by keyboard with the right roles. Browser test (axe).
6. With Quillmoor's 10 segments and market notes, every tab is within budget. Browser test (U10-6).

**Boundaries.** Rule 1: demo data keeps its "Simulated data" labels, once per section rather than on every card. Rule 2 unchanged: market notes may name real companies, with their sources.

**Size.** M.

### U10-8 The runs list: filters, the campaign, and every run reachable (M)

**The job.** A person can find a run: by campaign, agent or status, and past the first 50.

**Before and after.** No filters, no campaign column, silently stops at 50, and every cost says "(simulated)". After: filters for campaign, agent and status (in the URL), a campaign column, "Older runs" paging, and the simulated label once in the column header. The run trail's step numbers stop skipping (number the shown steps, or say how many were left out).

**Test cases.**
1. Filtering by campaign, agent or status shows only matching runs, and the filters survive a reload. Browser test.
2. With 60 runs, "Older runs" shows runs 51 to 60, and none is shown twice or missed. CI (paging query) and browser test.
3. Each row names its campaign, or "No campaign" for the tagline demo. Browser test.
4. Another workspace's runs never appear, whatever the filters. CI.
5. A run trail's steps are numbered without gaps, or the gap is explained. Browser test.

**Boundaries.** Rule 4: the trail itself is unchanged. Rule 7: the filters run through `asUser()`.

**Size.** M.

### Proposed to join: BUG-4 and BUG-11 (S each)

Agent fixes that touch no pages, so they don't clash with the UX work, and they affect real output today.
- **BUG-4:** the brief's quantities-in-words check refuses "most of", "Many people", "a good share of", and the brief keeps writing them; it fails cases in five agents. Fix the prompt and the check together so they agree, with eval cases from the F-16a failures.
- **BUG-11:** the brand name reached the image-prompt model in the Fernhollow imagery case (rule 8 risk). Find where it leaks, strip or refuse it, with a regression case from the F-16a report.

Each is checked by CI (evals against the mock, the regression tests) and by a real-model eval run of the affected agents (about 60p, under the £1 cap).

## Not in this sprint (to the backlog)

- **The 1440 px header on one row** (the audit's note). S.

## The sprint as a whole

| Order | Story | Size |
| --- | --- | --- |
| 1 | U10-1 Quick fixes (F-36, BUG-13, BUG-14, kit save) | S |
| 2 | U10-6 Length budgets (the measuring spec first, so every later story is checked against it) | S |
| 3 | U10-2 The campaign in stages | L |
| 4 | U10-3 Ad cards and the gallery | M |
| 5 | U10-4 Performance | M |
| 6 | U10-5 Home | S |
| 7 | U10-7 The brand page | M |
| 8 | U10-8 The runs list | M |
| 9 | BUG-4, BUG-11 (in parallel with any of the above) | S + S |

About ten days, with the brand page and runs list joining (Q6). U10-2 is the risk: if it runs over, the Audience stage page stays inside Brief, and U10-8 is the first to move to the backlog.

**Test pack.** Nothing here needs real AI output except BUG-4 and BUG-11, which the eval run checks. Rory signs off from the demo page as usual. No mock-up first (Q8): the demo's recordings and screenshots at both widths are where he judges the look.

**Spike check.** No story depends on a spike. Question 1 (stage pages or one page) is a design choice, answered now.

## Questions for Rory

| # | Question | Recommended |
| --- | --- | --- |
| Q1 | How should the campaign be split? | **Separate stage pages with a stage bar** (each loads less and has its own address). Alternatives: tabs on one page (one address, everything still loaded), or collapsible sections on one long page (shortest change, least gain) |
| Q2 | Where does a campaign open? | **On the overview with "Needs you"**. Alternative: on the stage it's at |
| Q3 | Ad card tools | **Hidden behind Edit or More, showing only what the ad's state allows; launched ads locked** |
| Q4 | The Sprint 1 tagline demo on home | **Move it to a small card at the bottom of home** (it still shows the approval flow). Alternatives: off home, reachable from Runs; or keep it as it is |
| Q5 | Do BUG-4 and BUG-11 join? | **Yes**: small, no page conflicts, and they affect real output today |
| Q6 | Brand page and runs list | **Backlog, the brand page next**; join only if the sprint has room |
| Q7 | Length budgets | **Every page at most 6 screens at 375 px and 4 at 1440 px with the audit's fullest data, and each page's main action within its first 1.5 screens at 375 px**. The gallery on the Creative stage may be longer when filtered to All; its budget is measured with the default filter |
| Q8 | A look at the design before building? | **Yes, a clickable mock-up of the overview, stage bar and an ad card in the current style, for Rory to react to before U10-2 starts** (half a day). Alternative: go straight to building and judge from the demo |

## Answers (Rory, 9 November)

| # | Answer | Effect |
| --- | --- | --- |
| Q1 | Stage pages with a stage bar | U10-2 as written |
| Q2, Q3 | Opens on the overview; ad tools by state, launched ads locked | U10-2 and U10-3 as written |
| Q4 | The tagline demo becomes a small card at the bottom of home | U10-5 as written |
| Q5 | BUG-4 and BUG-11 join | Both in Sprint 10, with a real-model eval run of the affected agents |
| Q6 | The brand page and the runs list both join | New stories U10-7 and U10-8; the sprint is about ten days |
| Q7 | 6 screens at 375 px, 4 at 1440 px; the main action within 1.5 screens on a phone | U10-6 budgets |
| Q8 | No mock-up; judge from the demo | No design step before U10-2 |

U10-1 to U10-8, BUG-4 and BUG-11 are Ready, Sprint 10. Building starts when Rory says go.
