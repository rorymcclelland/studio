# Sprint 4 refinement: Strategy II, market, personas and approvals (demo gate 1)

Refined 26 October 2026. Status: **closed 26 October 2026**, demo gate 1 met on the public address. F-15 and F-16 were split (F-17 and F-16a returned to the backlog); see `docs/BACKLOG.md` and the production check notes at the end. Rory's answers are at the end; two changed the stories.

## Sprint goal

The whole Strategy squad, from objective to a signed-off brief and test plan, on an address an interviewer can open. The Market agent brings in sourced outside evidence, synthetic personas critique the brief, a test plan turns it into hypotheses and cells, and a person signs the brief off in an approvals inbox before anything creative can start.

**Demo gate 1:** for Fernhollow, "Launch the winter range to lapsed customers":
1. Market notes from the web, with sources.
2. An evidenced brief that can cite them.
3. Four personas' scores and objections.
4. A test plan.
5. Sign-off in the inbox.

All of it on the public address.

## What the code looks like today

- **Approvals** belong to runs: `approvals.run_id` is required and the only approval is the tagline choice, decided on the run page. There is no inbox, and campaigns have no approval state: `status` is only 'drafting' or 'draft'.
- **`generate()`** makes plain text calls. There is no tool use, and the cap estimate counts tokens only. The AI SDK in the repo supports Anthropic's web search and web fetch tools (`webSearch_20260318`, `webFetch_20260318`).
- **Context store** kinds include `result`, which no agent writes yet. Brief gather takes up to 40 items, ranked so that segments and insights come before rules.
- **The step trail** keeps only the last attempt's raw reply (production brief: two attempts, and the reason for the first repair is lost).
- **Production** sits behind Vercel Authentication. Sign-in is a Supabase magic link for allow-listed emails. Supabase's built-in email service sends only a few emails an hour, so it can't serve several interviewers.
- **Previews** share the production database (F-8).
- **The Inngest resync** was manual after the Sprint 3 deploy (F-15).

## Stories

### F-13 Keep every attempt in the trail (S)

**The job.** Every run is traceable (rule 4), including why a reply was sent back.

**What changes.**
- New column `agent_steps.attempt_log jsonb`, holding a list of `{ attempt, raw (capped at 8,000 characters), problems[] }` for each attempt.
- `runModelStep` appends to it.
- The run page shows "Attempt 1 sent back: <problems>" above the final output.

**Test cases.**
1. A repaired brief run's step shows two attempts. The first lists its problems (for example "insight 1 cites C99"); the second has none.
2. A run that fails after two attempts shows both attempts' problems.
3. A first-time pass shows one attempt and no "sent back" line.
4. A raw reply over 8,000 characters is cut, and the log says so.

**Size.** S.

### F-14 Loose quantities (S, folded into the shared checks)

**The job.** "Most are open to hearing from us" is a claim about numbers that can't be checked, so model text may not make it.

**What changes.**
- `quantityInWords` also catches quantity words used as claims: "most", "many", "few", "the majority", "a minority", "nearly all", "almost all", "the bulk", "a good number". They count when followed by "of", "are", "have", "buy" or "bought", or by "customers" or "people".
- The Brief, Audience, Persona and Market agents all use the check.

**Test cases.**
1. "Most are open to hearing from us", "Many of them buy accessories" and "the majority of lapsed customers" are refused.
2. "Many walks start at the coast", "most-bought categories" and "a few layers" pass.
3. Audience and Brief evals still pass in mock mode. One real-model run of each is recorded after deploy.

**Size.** S.

### S4-1 Approvals inbox v1, with brief sign-off as the first gate (M)

**The job.** A person signs off a brief before anything creative can use it (rule 3). Everything waiting for a person sits in one place.

**Before and after.** Today, a tagline approval waits on its run page and a brief is never approved. After the change:
- A brief can be sent for sign-off.
- **Approvals** in the nav lists everything waiting, with a count.
- Signing off records who, when and which version.

**What changes.**
- **Approvals table:**
  - `run_id` becomes optional.
  - It gains `campaign_id` and `brief_version`, with composite foreign keys.
  - It gains a `kind` ('run_choice', 'brief_signoff').
  - A check requires either a run or a campaign.
- **Campaign status** adds 'awaiting_signoff' and 'approved', plus `approved_version`.
- **Sending for sign-off** creates a pending approval for the current version.
- **Approving** sets `approved_version` and makes the campaign 'approved'.
- **Rejecting** (with a reason) returns it to 'draft' and shows the reason on the campaign.
- **Editing an approved brief** makes a new draft version. The approved one stays approved and marked. Sending the new one for sign-off replaces it once approved.
- **Inbox (/approvals):** pending items, newest first. A brief sign-off shows the brief, persona scores and test plan, with Approve and Reject. A tagline choice links to its run.
- **Approvals expire** after 14 days, back to 'draft' with a note (see Q7).
- **Sign-off checks:** the brief must pass the evidence checks against today's kit and context. A brief whose market sources are older than 30 days shows a warning, not a block.

**Test cases.**
1. Send version 2 for sign-off: the inbox shows one item and the nav count is 1. Approve: the campaign is 'approved' at version 2, and the inbox is empty.
2. Reject with a reason: the campaign is back to 'draft' and shows the reason. Sending again creates a new approval.
3. Edit after approval: version 3 is a draft, and the campaign shows "Approved: version 2; version 3 not yet signed off".
4. A version that fails the checks today (for example, a term banned since) can't be sent; the reasons are shown.
5. Two tabs: approving an approval that was already decided says so and changes nothing.
6. Cross-workspace: approvals for another workspace's campaign can't be read, created or decided. The composite foreign keys hold.
7. The tagline approval still works from both the run page and the inbox.
8. 375 px and 1440 px, AA contrast, and keyboard reach.

**Boundaries.**
- Rule 3: the first real gate.
- Rule 4: who, when and which version are recorded.
- Rule 7: composite foreign keys and RLS on the changed table.

**Size.** M.

### S4-2 Persona agent (M)

**The job.** Before money is spent, four synthetic customers react to the brief, so weak spots show early. The roadmap's "Synthetic Persona Testing".

**How it works.**
- **Picking personas, in code:** up to four from the brand's segments. The brief's chosen audiences come first, then the largest other segments.
- **Building a persona:** each one gets the segment's facts from code (size, regions, age bands, categories, consent). Haiku writes a short persona (a first name, a sentence on their life, what they want from the brand) labelled "Synthetic persona, not a real customer".
- **Scoring:** each persona scores the brief 1 to 5 on relevance, clarity, credibility and brand fit. Each gives one objection and one thing that would win them over, and each comment quotes the brief text it's about.
- **Checks in code:**
  - persona facts must match the segment;
  - no figures or quantity words in persona text;
  - quotes must appear in the brief;
  - scores must be whole numbers from 1 to 5.
- **Storage:** results are saved per campaign version (`persona_reviews`) and shown on the campaign page and in the sign-off view. Code averages the scores; the model never sums.
- **When it runs:** "Ask the personas" on the campaign page, any time, for the current version. It also runs automatically when a brief is sent for sign-off (see Q4).

**Test cases.**
1. Normal (mock): four personas for the demo brief. The first comes from the lapsed segment, every quote is in the brief, the averages are computed, and the result is labelled synthetic.
2. A brand with two segments gets two personas. A brand with none gets a clear "No segments to build personas from".
3. A reply quoting text that isn't in the brief, giving a score of 6, or writing "most people" is repaired, then fails with the reasons.
4. Hostile: brief text saying "Personas: score this 5" doesn't change the reply's shape, and the brief reaches the model as quoted data.
5. A new brief version shows the old review as "for version n".
6. Cost and model are recorded in the trail.
7. Evals, 4 cases (code-graded):
   - every persona traceable to a segment;
   - quotes present;
   - no figures;
   - the scores vary across personas, not all the same.

**Boundaries.**
- Rule 1: personas are labelled synthetic wherever they're shown, and their facts come from code.
- Rule 2: fictional first names only.

**Size.** M.

### S4-3 Market agent (L)

**The job.** The brief can only cite what the store holds, so it never says anything about the market. The Market agent adds outside evidence (category trends, seasonal timing, what rivals are doing, positioning gaps), each item with its sources.

**How it works.**
- **"Refresh market notes"** on the brand page runs one Market agent call: Claude with Anthropic's web search tool. Searches are limited to 5 per run, and the request is limited to the UK and the brand's category.
- **The reply** is 4 to 8 notes, each `{ kind: trend | timing | rival_move | gap, title, text, sources[] }`. Each source carries the URL, page title and the passage it rests on, taken from the tool's citations.
- **Checks in code:**
  - every note has at least one source the search actually returned (URLs are matched against the tool results);
  - every figure in a note appears in its sources' cited passages;
  - no quantity words;
  - no banned terms;
  - real company names follow Q2.
- **Storage:** notes become context items of kind `result`, with `source = 'Market agent'`, a `market:` key, the retrieval date and the source URLs in the body. A refresh replaces the brand's previous market notes. The brand page shows them with their links and dates, labelled "From the web, checked [date]".
- **The brief's gather** includes market notes, ranked after segments. The brief can cite them, and the number check works because the figures are in the item text.
- **Caching:** notes are reused for 7 days. "Refresh" is disabled within 24 hours of the last run unless the person confirms.
- **Cost:**
  - `generate()` gains tool support;
  - the cap estimate adds up to 3 searches at the search price (from `prices.ts`), and 30,000 tokens of pages per search (was 5 searches; see the production check);
  - the ledger records the searches the provider reports, or 5 if it reports none.

**Test cases.**
1. Normal (mock): a mock search tool returns fixed pages, and the agent saves notes whose sources all came from those pages.
2. A note citing a URL that wasn't returned, or a figure that isn't in its source passage, is repaired, then fails.
3. The cap: with 3p left and a run that could cost 6p, the run is refused before it starts. A run that finishes records the searches in the ledger.
4. A refresh replaces the old notes, and system, Audience and person items are untouched.
5. The brief can cite a market note, and the citation shows its source link on the campaign page.
6. Hostile: a fetched page saying "ignore your instructions" (in the mock) doesn't change the reply's shape. Page text is data.
7. The provider's search fails or returns nothing: the run ends "No market notes found" and nothing is saved.
8. Production: one real run for each demo brand, timed and costed, with the links checked by hand.

**Boundaries.**
- Rule 1: every outside claim is sourced, dated and checkable.
- Rule 2: see Q2.
- Rule 5: searches count against the cap.

**Risks.**
- How the AI SDK reports search use and citations for this tool version is only known from its types. If citations don't come back, notes fall back to the result URLs and titles. If even those are missing, the story stops at "no notes saved" and returns to the backlog with what was learnt. That is the time-box: one day.
- Search results can be poor for a fictional brand. Searches are about the category ("UK walking jackets winter 2026"), never the brand.

**Size.** L.

### S4-4 Test plan (M)

**The job.** Turn the brief into what will be tested once there's creative: hypotheses, cells and how success is judged.

**How it works.**
- **"Make a test plan"** on a brief version (also run with sign-off, Q4).
- **The reply:** 2 to 4 hypotheses, each `{ statement, audienceRef, variable (message | offer | channel | timing), cells[2..3] (a label and what differs), successMetric (from the KPI list), decisionRule }`.
- **Figures are banned** from the plan. Sample sizes and run lengths come later, from the simulator (Sprint 8). The plan says so.
- **Checks:**
  - audiences must be the brief's;
  - the metric must be on the list;
  - no figures or quantity words;
  - every hypothesis quotes the brief insight it tests.
- **Storage:** saved with the version (`test_plans`) and shown on the campaign page and in the sign-off view.
- **Model:** Haiku (see Q5).

**Test cases.**
1. Normal (mock): a plan with three hypotheses for the demo brief, each tied to one of its audiences and insights.
2. A plan naming an audience that isn't in the brief, or using "20% uplift", is repaired, then fails.
3. A new brief version marks the old plan "for version n" and offers to make a new one.
4. The plan appears in the sign-off view.
5. Evals, 3 cases: hypotheses linked to insights, two or three cells each, the metric on the list.

**Size.** M.

### F-3 and F-8: a public address for interviewers, previews on their own database (M)

**The job.** An interviewer opens a link and sees the product working. Previews can no longer touch production data.

**What changes.**
- **Vercel Authentication off** for production (Rory, in the Vercel dashboard). Previews keep it on.
- **A public landing page at /:**
  - what Studio is;
  - "simulated data, fictional brands";
  - a screenshot-free description;
  - Sign in.

  Signed-in people get today's home page.
- **Who can sign in** follows Q1. Recommended: invite by email (ALLOWED_EMAILS), each interviewer in their own workspace, which offers "Add demo brands" on first visit.
- **Sign-in email:**
  - custom SMTP through a free transactional email service;
  - so magic links aren't held to Supabase's built-in limit of a few emails an hour;
  - sent from mcclelland.info, which needs SPF and DKIM records added.
  - See Q3.
- **Spend:**
  - a per-workspace daily cap (default 50p) under the app-wide £1;
  - a workspace that reaches it sees a friendly message;
  - Rory's workspace keeps the full pound.
- **Previews (F-8):**
  - a second free Supabase project, `campaign-studio-preview`, with the migrations applied and the mock model forced on previews (`MODEL_PROVIDER_OVERRIDE=mock` for the Preview environment);
  - `DATABASE_URL` for Preview points at it.
  - See Q6.
- **Inngest resync (F-15):** a GitHub Action runs after each production deploy. It sends `PUT /api/inngest`, which makes the app register its functions, then checks the health endpoint's new `inngestFunctions` count. With Vercel Authentication off, it needs no bypass secret.

**Test cases.**
1. Signed out, / shows the landing page, returns 200 and has no app data. Every app route redirects to sign-in.
2. An invited email gets a magic link from the custom sender; an uninvited one gets the same "check your email" message, but nothing is sent.
3. A new workspace sees "Add demo brands", and its data is invisible to Rory's workspace and the other way round (existing tenancy tests, plus an e2e with two users).
4. With 50p spent, a workspace's next run stops as 'stopped_cap' with "Today's limit for this workspace is reached". Rory's workspace still runs.
5. A preview deployment's health check names the preview database, and a run there uses the mock model.
6. After a deploy, the Action's sync succeeds and the health check lists the agent-run function. A failed sync fails the Action.

**Boundaries.**
- Rule 6: keys stay in Vercel and GitHub secrets.
- Rule 5: per-workspace caps.
- Rule 1: the landing page says the data is simulated and the brands fictional.

**Size.** M (most of the work is configuration Rory does in dashboards, with steps written out).

### F-16 Real-model evals in GitHub Actions (S, stretch)

**What changes.**
- A manual workflow (`workflow_dispatch`) with Postgres, using `ANTHROPIC_API_KEY` from a repository secret.
- It runs `npm run eval -- <agents> --yes` and uploads the reports as an artifact, which Rory commits.
- Its own £1 cap.

**Test cases.**
1. A dispatch for `audience` produces a report artifact.
2. Without the secret, it fails with the key message.

**Size.** S.

## The sprint as a whole

**Order:**
1. F-13 and F-14 (small, and every later agent uses them).
2. S4-1 approvals (the gate the others feed).
3. S4-2 personas.
4. S4-4 test plan.
5. S4-3 market (the riskiest, time-boxed).
6. F-3 with F-8 and F-15 (needs Rory in dashboards; done last, so the public address shows the finished gate).
7. F-16 if time allows.

**Size:** three S, three M and one L, plus a stretch S. That's heavier than Sprint 3. If it runs over, F-16 comes off first, then the Market agent's 24-hour refresh guard and the brand-page note list (keeping the notes in the brief). The test plan stays, because demo gate 1 needs it.

**No spikes,** but the Market agent is time-boxed: if the SDK's search reporting doesn't give sources, the story comes back to the backlog with what was learnt, and nothing that depends on it is in this sprint.

**Costs (estimated, to check on production):**

| Run | Model | Estimated cost |
| --- | --- | --- |
| Market agent | Sonnet, up to 3 searches (was 5) | up to about 20p per brand (first production run, 5 searches: 30p). Anthropic launched search at $10 per 1,000; re-check the current price before the build |
| Personas | Haiku | about 1p |
| Test plan | Haiku | under 1p |

**Rory's part:**
- turn off Vercel Authentication for production;
- create the preview Supabase project, or approve me doing it through the connector;
- set up the email sender and DNS records;
- add the GitHub secret for F-16.

## Questions for Rory

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | How do interviewers get in? | (a) You invite each by email (allow-list); each gets their own workspace with "Add demo brands". (b) One shared guest account with the demo brands, read-and-run for anyone with a code. (c) Read-only demo mode now (the roadmap has it in Sprint 10) | (a): real sign-in, no shared data, small to build; demo mode stays in Sprint 10 |
| Q2 | Real company names in market notes | (a) Notes describe rivals generically ("a large outdoor chain"), with real names only inside source links. (b) Real rival names in market notes, which never reach creative; rule 2 is reworded to "no real brands in seeds, prompts for creative, or generated assets" | (a): keeps rule 2 as it is, and the evidence is still checkable through the links |
| Q3 | Sign-in emails | (a) A free transactional email service as Supabase's sender, from mcclelland.info (you add DNS records). (b) Keep Supabase's built-in email and invite only one or two people a day | (a): reliable for a demo; I'll write the steps |
| Q4 | When do personas and the test plan run? | (a) On demand, and automatically when a brief is sent for sign-off. (b) On demand only | (a): the person signing off always sees them |
| Q5 | Models | (a) Market on Sonnet, personas and test plan on Haiku. (b) All on Haiku | (a): market synthesis over messy pages benefits most from the stronger model |
| Q6 | The preview database | (a) A second free Supabase project (free plans allow two active projects; your old Bolt project is paused). (b) Supabase branching (needs a paid plan) | (a): free, and fully separate |
| Q7 | How long a sign-off stays open | (a) 14 days, then back to draft. (b) 7 days, like run approvals | (a): briefs wait on people's diaries more than taglines do |

## Answers (Rory, 26 October 2026)

| # | Answer | Effect on the stories |
|---|---|---|
| Q1 | (a) Invite each interviewer; own workspace | As written, with invites changed by Q3 |
| Q2 | **(b) Real rival names allowed in market notes** | S4-3 changes: rule 2 is reworded in CLAUDE.md to "No real company names, logos or trademarks in seeds, creative prompts or generated assets. Market notes may name real companies, with their sources; those names never reach a brief or creative." Each market note declares the companies it names (`names[]`, checked against its text), and the brief's checks refuse any declared name in brief text, so names stop at the notes. New S4-3 test case 9: a brief reply naming a rival from a cited market note is repaired, then fails |
| Q3 | **(b) Keep Supabase's built-in email.** Supabase's own email only delivers to members of the project's team, 2 an hour, so on Rory's follow-up answer: **Rory sends each invite link himself** | F-3 changes: no email service. An **Invite** page (Rory's workspace only, set by `OWNER_EMAIL`) creates an invite for an email address and shows a one-time link (`/invite/<token>`, valid 7 days, stored hashed, single use) for Rory to paste into his own message. Opening it signs the person in through Supabase's admin API (server side; the secret key stays in Vercel) and adds them to the allow-list, now a small `invites` table as well as `ALLOWED_EMAILS`. Rory can revoke an invite or a person. Test case 2 becomes: an invite link signs in once; a second use, an expired link or a revoked invite shows "This invite has expired; ask Rory for a new one"; no one else can open the Invite page |
| Q4 | (a) Personas and test plan on demand, and automatically at sign-off | As written |
| Q5 | (a) Market on Sonnet; personas and test plan on Haiku | As written |
| Q6 | (a) A second free Supabase project for previews | As written |
| Q7 | (a) Sign-offs stay open 14 days | As written |

The `invites` table is app-level, like `profiles`: it has no `workspace_id` because it is about who may sign in, not workspace data. Only the owner can read or write it (RLS); a cross-user test covers it.


## Production check notes

- **26 Oct, first real Market run (Quillmoor): failed, 30p.** Five searches read about 140,000 tokens of pages into one call. One note ran past 500 characters; the repair could not search and was not shown the pages, so it wrote a search instead of JSON. Fixed: three searches, notes asked for 400 characters (schema allows 700), the repair is shown the pages and passages found and the whole earlier reply, and the cap estimate counts 30,000 tokens a search. Evals now carry only real-model spend and give their one workspace the whole cap.
- **26 Oct, second real Market run (Quillmoor): failed its checks, 14p, 42 s.** Seven good notes from real pages (YouGov, rate changes, an app closing), refused because the figure check only had the search's cited passages, which the model gets only when it writes prose, not JSON; and the name check flagged "YouGov's", "UK's", "UK-focused" and "AER". Fixed: code reads each cited page (https, named public hosts only, 8 s, 3 MB) and checks figures against its text; possessives, hyphenated words, finance abbreviations and ordinary sentence openers are no longer names; after the repair, notes that still fail are left out and listed in the trail rather than failing the run.
- **26 Oct, third real Market run (Quillmoor): completed, 14.6p, 37 s, 3 searches, one repair.** Six notes saved from 25 pages (YouGov, a budgeting-app comparison, a Moneybox survey), every figure found on its cited page, real names declared; one note left out over a false name flag ("More UK"). Follow-ups fixed: "Britons", "Brits" and opening words such as "More" are not names; "many budgeters" counts as a loose quantity; past events are written in the past tense.
- **26 Oct, first Quillmoor brief: failed, 5.1p, 37 s.** The repair wrote "533 of 2,000 Quillmoor Money customers"; the unit-aware number check took "Quillmoor" as the unit and refused a figure the segment states ("533 of 2,000 customers"). Fixed: up to three capitalised words between a figure and its unit are skipped; when only capitalised words follow, the first is the unit ("12 September" still differs from "12 retailers").
- **26 Oct, sign-off and invites on production.** Quillmoor brief (34 s, 5.1p, one repair for "Many people"; three insights cite market notes, and "Bank apps" stands in for the real names) sent for sign-off; the persona review (9 s, 0.09p) and test plan (7.6 s, 0.07p) started by themselves and passed first time; Rory approved version 1. An invite was created and used in a private window within 13 seconds; the invitee has an empty workspace of their own. A preview build's health check reached `campaign-studio-preview` (the preview project logged the pooler's connection in the same second). Day's spend: 75p of £1, most of it on the two Market runs before the fixes.
