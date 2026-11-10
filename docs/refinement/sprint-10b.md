# Sprint 10b refinement: demo readiness (your own brand, from scratch to monitoring)

Refined 10 November 2026, injected before Sprint 11 at Rory's request (Sprint 11 is unchanged and starts after this one). Status: **Ready, Sprint 10b. Rory said go on 10 November at 09:40.** The demo is at 08:45 on 11 November, so the deploy and D-6 happen this evening. It builds on Sprint 10, which merges first.

## Sprint goal

On production, Rory can add a brand of his own, give it simulated customers, and take a campaign from its line through the brief, creative, launch pack and launch, to simulated monitoring. Real models are used throughout. Tomorrow's journey is Cookpad, with Cookpad Moment as a separate brand.

**Demo:** sign in, then:
1. **New brand**, "Cookpad", with its kit.
2. Generate simulated data, and the audiences.
3. Market notes.
4. A campaign with its line, typed or suggested.
5. The brief, then sign-off, personas and the test plan.
6. Make creative, then the pre-test and the launch pack.
7. Launch, then the Performance page over 14 simulated days.

## Rory's answers (10 November)

| # | Question | Answer | Effect |
| --- | --- | --- | --- |
| A1 | Rule 2, fictional brands only | A brand a person adds themselves may be real. The demo brands, seeds, tests and screenshots stay fictional. A real brand's logo is used only with its owner's permission | D-5: rule 2 reworded in CLAUDE.md and a decision record |
| A2 | Cookpad Moment | A separate brand. Its description says it is part of Cookpad | D-2's own names let Cookpad Moment's copy say "Cookpad". A real parent and child goes to the backlog |
| A3 | A new brand's data | Generated, simulated, from a short profile, and labelled as simulated everywhere | D-3 |
| A4 | The campaign's line | Both: type your own, or ask for suggestions, then pick | D-4 |

## What the code looks like today

- `createBrand()` exists (`src/lib/brands/repo.ts:87`), but only the tests and the demo loader call it. There's no New brand form. The kit editor edits an existing brand.
- `brands.is_simulated` means two things at once: "this brand is fictional", and "its data is simulated". Labels ("Simulated data", "Demo brand") and the launch pack README ("The brand in this pack is fictional.") all read it.
- `generateDemoBrand()` (`src/lib/demo/generate.ts`) is pure and deterministic. It takes a `DemoBrief` (kit, products with weights, customer count, seasonality, regions and so on) and returns customers and orders. There's no product editor.
- The brief, copy and translation checks refuse any company named in the market notes. Only the brand's own name is exempt. The market notes for Cookpad Moment would likely name Cookpad, so its brief and ads would be refused for saying "Cookpad".
- The Tagline agent takes a brand name only and returns three lines. It's a demo card on home and isn't part of a campaign.
- Headline limits: paid social 40 characters, display 30, search 30.

## Stories, in build order

### D-1 New brand (S)

**The job.** Anyone can start a brand of their own from the Brands page, so Studio isn't limited to the two demo brands.

**What changes.**
- A **New brand** form on /brands: name (required, 80 characters at most), short name (filled in from the name and editable), category and description.
- It creates the brand in the reader's workspace through `createBrand()` with `asUser()`, as a real (not fictional) brand with no simulated data, then opens the kit editor.
- The empty state on /brands and /campaigns offers both **New brand** and **Add demo brands**.

**Test cases.**
1. "Brightwater Kitchen" with a category creates a brand in the reader's workspace, opens its kit editor, and the brand is listed on /brands. Browser test.
2. A short name another brand in the workspace already uses is refused with the field error, and nothing is created. Browser test.
3. An empty name, and a name of 81 characters, are refused with field errors. Browser test.
4. Hostile input: a name containing markup or SQL is stored as text and shown escaped. Another workspace never sees the brand (a cross-workspace database test).
5. The form fits within 1.5 screens at 375 px. AA contrast and no sideways scroll at 375 and 1440 px. Browser test.

**Boundaries.** Rule 7: the reader's workspace only. Rule 2 (as A1): the tests use fictional names.

### D-2 Fictional versus simulated, and a brand's own names (M)

**The job.** A real brand with simulated data is labelled truthfully. Its copy may use its own names, including a parent brand's.

**What changes.**
- **Migration:**
  - `brands.is_fictional` (boolean, default false), true for the existing demo brands;
  - `is_simulated` keeps one meaning only: the brand's data is simulated;
  - `brands.own_names`: up to 5 names of 80 characters or fewer, such as "Cookpad" for Cookpad Moment.
- **Labels:** "Demo brand" and the README's "The brand in this pack is fictional." read `is_fictional`. "Simulated data" reads `is_simulated`.
- **Kit editor:** an "Also known as" field for own names.
- **Checks:** the brief, copy, translation and upload checks treat the brand's own names like its name. Market notes may still name the company, which is allowed by rule 2's market exception.
- **Imagery:** the prompt still removes the brand's name and its own names (rule 8 and the picture check are unchanged).

**Test cases.**
1. After the migration, Fernhollow and Quillmoor are fictional and simulated. A new brand is neither. Database test.
2. A new brand with generated data shows "Simulated data" and no "Demo brand" pill. Its launch pack README makes no claim that the brand is fictional. Browser test and unit test.
3. A brand with own name "Brightwater", whose market notes name Brightwater: a brief and a headline saying "Brightwater" pass. A different company in the same notes is still refused. Unit tests.
4. Own names: more than 5, or an empty one, are refused with field errors. A name the brand also bans is refused. Unit test.
5. The imagery prompt contains neither the brand's name nor its own names. Unit test.

### D-3 Simulated data for a new brand (M)

**The job.** A new brand gets customers, orders and products to work from, so the Audience agent can size segments and the brief can cite them. The data is clearly labelled as simulated.

**What changes.**
- On a brand with no customers, the Products and data tab offers **Generate simulated data**. The profile asks for:
  - products, 1 to 10 rows: name, category, price and how popular each is (low, medium or high);
  - the number of customers (500 to 20,000, default 5,000);
  - a region set: UK regions, or Japan's regions (8 regions);
  - the busiest months.
- It builds a `DemoBrief` from the profile and the kit, runs `generateDemoBrand()` with a seed taken from the brand id and today's date, and saves the products, customers and orders in one transaction. The brand becomes `is_simulated`.
- The context store syncs as it does for the demo brands. There are no model calls (rule 5).
- It refuses on a brand that already has customers. Removing simulated data is out of scope.

**Test cases.**
1. A profile with 3 products and 2,000 customers creates them within 5% of the orders the generator promises. The customer summary shows counts and "Simulated data". Browser test with the database.
2. The same profile, brand and day produces the same data. Unit test.
3. The Audience agent (mock model) finds sized segments for the new brand. Each size equals a direct SQL count. Flow test.
4. Refused: no products, 11 products, a price of 0 or more than £10,000, a customer count outside 500 to 20,000, or a brand that already has customers. Field errors, and nothing is saved. Browser and unit tests.
5. Hostile input: a product name with markup or SQL is stored as text. Another workspace's brand id is refused. Cross-workspace test.
6. Generating 20,000 customers finishes in under 20 seconds on CI. Measured in the flow test.

### D-4 The campaign's line: typed, or suggested and picked (M)

**The job.** A campaign carries one line, such as "Cook something today", that every ad uses as its headline. You can write it yourself or have the Tagline agent suggest some.

**What changes.**
- The brief gets an optional `line` field, 3 to 30 characters, so it fits every headline limit. It is versioned and signed off with the brief, like the other sections. It's on the Brief stage as **Campaign line**, with Edit.
- **Suggest lines** runs the Tagline agent with the brief's title, story, the audiences' names and the kit's voice. Its input grows from a brand name to this context. It still returns 3 lines, each 30 characters at most. You pick one, or edit it, and it's saved as a new brief version. The cost is shown before you click (about 0.02p with Haiku; corrected from 0.2p during the build). It goes through `generate()` (rule 5).
- **Copy:** when the signed-off version has a line, every paid-social and display headline is the line exactly. Search keeps its own headlines. The copy checks refuse a set whose headline isn't the line. Translations translate the line once and use it for every ad in that language.
- The home tagline card stays as it is.

**Test cases.**
1. Type a line, save it (a new version), send for sign-off, approve, Make creative (mock): every social and display ad's headline is the line. Browser test.
2. Suggest lines (mock) shows 3 lines, each 30 characters or fewer. Picking one saves it as a new version and resets sign-off as editing does today. Browser test.
3. A line of 31 characters is refused with a field error. A line with a banned term, or naming a company from the market notes, is refused by the brief checks. Unit tests.
4. A brief with no line works as today. The existing creative specs pass unchanged.
5. A Copy reply whose headline differs from the line is repaired once, then the set is refused. Agent test.
6. A translated campaign uses the same translated line in every ad of that language. Flow test (mock).
7. Hostile input: a line telling the model to ignore its instructions is treated as data. The Tagline agent's existing injection cases still pass. Agent test.

### D-5 Rule 2, as answered (S)

**What changes.**
- CLAUDE.md rule 2: "Fictional brands in seeds, demo data, tests, evals and screenshots. A person may add their own real brand to their own workspace; a real brand's logo is used only with its owner's permission. Market notes may name real companies with their sources; those names never reach a brief or creative unless they are the brand's own names."
- A decision record, and the README.

**Test cases.**
1. The case list's guard finds no real company names in seeds and fixtures. Existing CI check, extended to the new fixtures.

### D-6 Run-through on production (by hand, Rory)

This is a hand check, because CI runs the mock model.
- After the deploy, Rory runs the demo journey on production with real models, as Cookpad. There's a Markdown test pack in `docs/testing/sprint-10b-test-pack.md`.
- Before it, Rory raises `DAILY_CAP_PENCE` in Vercel for 10 and 11 November.
- The pack lists each step's expected cost.

## Out of scope, to the backlog

- A real parent and child brand with an inherited kit.
- Japanese copy and Japanese fonts in composed ads.
- Importing CSV files.
- A product editor beyond the generation profile.
- Removing simulated data.
- QA's Sprint 10 residuals (Quillmoor kit editor length, long-name test data).

## The sprint as a whole

- **Order:** D-5 and D-2's migration first, because the others build on them. Then D-1. Then D-3 and D-4 in parallel. D-6 comes after the deploy.
- **Size:** two S and three M, about two days at the usual pace, to be done in one. **The cut line, if the day runs short:** D-4's Suggest lines goes first; typing the line still works. (Japan's regions stay: Rory chose them for Cookpad.)
- **No spikes.**
- **Risk:** real-model output on a real brand can't be checked in CI. D-6 is where it gets checked, so it is booked for this evening, leaving time to fix before the demo.

## Questions for Rory

| # | Question | Recommended |
| --- | --- | --- |
| Q1 | Cut line if the day runs short | Drop Suggest lines first, then the Japan regions |
| Q2 | Regions for Cookpad's simulated customers | Your call: the profile offers both sets |
| Q3 | Who drives tomorrow? | You, on your login. An invite for Aki only if he'll use it himself afterwards |

### Answers (Rory, 10 November, 09:40)

| # | Answer | Effect |
| --- | --- | --- |
| Go | Go, as written | Build in the order D-5 and D-2, then D-1, then D-3 and D-4 together |
| Q1 | Cut line: Suggest lines first, then the Japan regions | As recommended |
| Q2 | Cookpad's simulated customers use Japan's regions | D-3 offers UK and Japan's regions; Japan's 8 regions must be built (no longer on the cut line) |
| Q3 | Not answered | Rory drives on his own login unless he says otherwise |

### Sign-off and release approval (Rory, 10 November, 09:42)

Rory approved in advance the sign-off, the production database change and the merge for both Sprint 10 and Sprint 10b ("Approved - signed-off"). Claude proceeds without stopping at each point, on these conditions; any one of them failing means stopping and asking Rory:
- CI is fully green, and the QA and the review find no blocker;
- the migration matches the tested schema on a Neon trial branch (fingerprint);
- the deploy shows no production errors;
- nothing is cut or changed beyond the agreed cut line (Suggest lines first).

Rory still gets each demo page before its merge and can hold it. `DAILY_CAP_PENCE` was raised to 500 in Vercel by Rory at 09:43 (production and preview), for 10 and 11 November.
