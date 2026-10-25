# Sprint 2 refinement: design system and brand kits

Refined 25 October 2026 against `main` at `2e056e1`, the roadmap and `docs/BACKLOG.md`. Status: **all six stories Ready, Sprint 2** (answers agreed 25 October 2026, recorded at the end).

## Sprint goal

Studio looks and feels like Soft machine everywhere (light theme), and two complete fictional brands live in it: each with a brand kit, products, simulated first-party customer data and a searchable Business Context store. Sprint 3's Strategy agents can then read real context instead of a brand name.

## What the code looks like today

- Production screens (home, runs, run detail, sign-in, configuration page) use a neutral Tailwind shell (`src/app/globals.css`, 66 lines) with tokens `bg`, `surface`, `ink`, `ink-2`, `line`, `accent`, `good`, `warn`, `bad`.
- Soft machine exists only as a prototype: `src/app/directions/soft-machine/` (`soft.module.css`, 449 lines, own light and dark token set, Figtree). It is not shared with the app.
- The database has workspaces, runs, steps, approvals and the usage ledger. Nothing about brands yet.

## Stories

### S2-1 Soft machine design system and app reskin (L)

**The job.** One set of tokens and components carries the chosen direction, and every existing screen uses it, so every later sprint builds screens from parts, not one-off styles.

**Before and after.** Before: the app is a neutral shell that follows the system theme; Soft machine lives only at `/directions/soft-machine`. After: the app is Soft machine throughout, in its light theme, and prototypes A and B are gone.

**What changes.**
- Tokens in `globals.css` from the prototype's light palette, mapped to Tailwind theme names and grouped so a dark set can be added later without touching components; Figtree loaded once for the app.
- Components in `src/components/ui/`: Button (primary, quiet, danger; sizes), Card, Pill (status: good, review, attention, neutral), Field with label, hint and error, Input, Textarea, Select, Segmented nav, Ring (health ring, data-driven), Empty state, Skeleton, Toast for action results.
- App shell: top bar with wordmark, navigation, spend meter and account menu. Light theme only (Q7); the app ignores the system dark setting rather than half-supporting it.
- Reskin home, runs, run detail and approval form, sign-in and the configuration page.
- **BUG-1:** costs under 0.01p show as "under 0.01p", never "0.00p".
- **F-6:** remove prototypes A and B and their fonts (Q4).
- A `/design` page (signed-in only) that shows every component, used for screenshot checks.

**Test cases.**
1. Every screen loads at 375 px and 1440 px with no sideways scroll.
2. Automated AA contrast check passes on every screen (axe).
3. With the operating system set to dark, every screen still renders the light theme correctly (no dark-on-dark text).
4. Keyboard: every control on home, runs and run detail is reachable with Tab, has a visible focus ring, and works with Enter or Space.
5. Approval form still works end to end (existing e2e run-flow specs pass unchanged in behaviour).
6. `formatPence(0.0032)` gives "under 0.01p"; `formatPence(0)` gives "0p"; `formatPence(1.234)` gives "1.23p"; `formatPence(123)` gives "£1.23".
7. Reduced motion: with `prefers-reduced-motion`, the ring and toasts do not animate.
8. Hostile: a brand or run name of 300 characters and one with `<script>` render as wrapped plain text without breaking layout.
9. No real brand or trademark appears on any screen or in the component page (rule 2).

**Out of scope.** Marketing pages, illustrations, a logo for Studio beyond the placeholder wordmark.

**Boundaries.** Rules 1 and 2: sample figures on the component page are labelled.

**Dependencies.** None; first, since every other story's screens use it.

**Risks.** Reskinning all screens and building components in one story is the largest item. If it runs long, the Toast and Skeleton components move to Sprint 3, where agent screens first need them.

### S2-2 Brand data model (M)

**The job.** A brand and everything the agents need to know about it are stored once, per workspace, with the same tenancy guarantees as runs.

**What changes.** Migration adding, all with `workspace_id` and RLS (rule 7):
- `brands` (name, slug, description, category, voice: tone words, voice notes, do rules, don't rules; visual: palette as named colours with hex, primary and secondary fonts, logo as SVG text; legal: required lines, banned terms, claims that need evidence; `is_simulated` flag)
- `products` (brand, name, category, price in pence, description, launched on, active)
- `customers` (brand, external ref, region, age band, first order on, consent to marketing; no names or emails, rule 1 and privacy by design)
- `orders` and `order_lines` (customer, product, quantity, price, ordered at, channel)
- Indexes on every foreign key and on the columns queries filter by (F-2's lesson applied from the start).
- Validation in Zod for every brand field (lengths, hex colours, at most 12 colours, at most 20 rules each).
- Logos stored as sanitised SVG text (Q2); sanitising strips scripts, event handlers, external references and `foreignObject`.

**Test cases.**
1. Member reads and writes their workspace's brands, products, customers and orders.
2. Cross-workspace: a member of workspace A sees no rows of B in any new table, and cannot insert into B.
3. Anonymous role reads zero rows from every new table.
4. Deleting a brand removes its products, customers and orders (cascade), and nothing in another brand.
5. Invalid brand input (bad hex, 13 colours, a 5,000-character rule) is refused with a field-level message.
6. Hostile SVG: a logo with `<script>`, `onload=`, `xlink:href="http://…"` or `<foreignObject>` is stored without them; a logo that is not SVG is refused.
7. The Supabase security and performance advisors show no new findings after the migration is applied to the hosted project.

**Out of scope.** Logo upload as PNG (Sprint 5, with imagery), brand versioning.

**Boundaries.** Rules 2 and 7. Customers carry no personal data by design.

**Dependencies.** None; can run alongside S2-1.

### S2-3 Brand kit editor and brand overview (M)

**The job.** You can see a brand at a glance and change any part of its kit, because the kit is what keeps every later agent on-brand.

**Before and after.** After: a Brands page lists the workspace's brands; each brand has an overview (palette swatches, type, voice, rules, legal lines, products, customer summary) and an editor with the same sections.

**What changes.** Brands list, brand overview, brand editor (sections: identity, voice, visual, legal), product list per brand, customer summary (counts by region and age band, orders by month, repeat-purchase rate) labelled "Simulated data" when `is_simulated` (rule 1). Saving shows a toast; unsaved changes warn before leaving.

**Test cases.**
1. Edit the tone words and a "don't" rule, save, reload: the change is shown on the overview.
2. Validation messages appear beside the right field, and nothing is saved while any field is invalid.
3. Leaving the editor with unsaved changes asks first; saved changes do not.
4. The customer summary's figures match a direct query on the seeded data (counts, orders by month).
5. Simulated brands show "Simulated data" next to every customer and order figure.
6. Another workspace's brand ID in the URL shows not found.
7. Screens pass S2-1's layout, contrast and keyboard checks.

**Out of scope.** Creating products and customers by hand (the demo generator does it; CSV import is a later item).

**Dependencies.** S2-1 (components) and S2-2 (tables).

### S2-4 Two fictional brands with simulated first-party data (M)

**The job.** The demo has rich, believable, clearly simulated data, so the Strategy agents in Sprint 3 have something real to reason over.

**What changes.**
- A deterministic generator (`src/lib/demo/`), seeded so the same input always gives the same data: two brands with full kits (Q1), about 20 products each, about 2,000 customers each and 24 months of orders, with seasonality, a lapsed segment (no order in 12 months or more), regional mix and a few best-sellers (Q6).
- Brand logos drawn as SVG wordmarks in code (Q2).
- An "Add demo brands" action on the Brands page that loads both brands into the current workspace, and refuses if they are already there (Q5).
- No model calls: costs nothing (rule 5).

**Test cases.**
1. Running the generator twice with the same seed gives identical rows.
2. Each brand has the expected counts (products, customers, orders within ±5% of target) and orders in each of the last 24 months.
3. The lapsed segment exists and is between 15% and 35% of customers.
4. Seasonality: each brand's peak months match its brief (for example, outdoor peaks before winter).
5. "Add demo brands" on an empty workspace adds both; pressing it again adds nothing and says why.
6. Loading completes in under 20 seconds on production.
7. No real company, person, product or trademark name appears in generated data (checked against a deny list).

**Boundaries.** Rules 1, 2 and 5.

**Dependencies.** S2-2. Brand briefs need Q1.

### S2-5 Business Context store and search (M)

**The job.** Everything Studio knows about a brand sits in one store that agents read and later write, and you can search it, so Sprint 3's agents get grounded context through one interface.

**What changes.**
- Tables `context_items` (workspace, brand, kind such as brand rule, product, segment, insight, result; title, body, source, tags, created by agent or person) and `context_edges` (from, to, relation), with RLS.
- The brand kit, products and customer summary are written into the store when a brand is created or edited, so the store is never out of date.
- Search with Postgres full-text search, ranked, filtered by brand and kind (Q3). One function, `searchContext()`, that agents will call from Sprint 3.
- A search box on the brand overview showing results with their source.

**Test cases.**
1. Searching "lapsed" on the outdoor brand finds the lapsed-segment summary first.
2. Editing a brand rule updates its context item; the old wording no longer matches.
3. Filters by kind and brand narrow the results; another brand's items never appear.
4. Cross-workspace: `searchContext()` as workspace A returns nothing of B.
5. Hostile: a search string with `' or 1=1 --`, `&`, `:*` or 1,000 characters returns normally or an empty result, never an error.
6. Search over both demo brands answers in under 300 ms on production.

**Out of scope.** Embeddings and semantic search (Q3), agents writing to the store (Sprint 3).

**Dependencies.** S2-2 and S2-4 (data to search).

### S2-6 Housekeeping from the Sprint 1 review (S)

**What changes.** **F-1:** the run list and run page take cost from `usage_ledger`. **F-2:** migration adding covering indexes on Sprint 1's foreign keys and `(select auth.uid())` in its policies. **F-7:** GitHub MCP server in `.mcp.json`.

**Test cases.**
1. A run whose ledger has two rows shows their sum on the list and the run page.
2. A run with no ledger rows shows "0p".
3. The Supabase performance advisor shows no unindexed foreign keys or per-row `auth.uid()` warnings after the migration.
4. All Sprint 1 database tests still pass.

**Dependencies.** None; quick win, done first.

## The sprint as a whole

**Order.** S2-6 first (quick win). Then S2-1 and S2-2 in parallel; S2-3 once both land; S2-4 after S2-2; S2-5 last.

**Size.** 1 small, 4 medium, 1 large: about 7 to 8 days of build, in line with Sprint 1. If it runs long, S2-5's search box on the overview (not the store or `searchContext()`) moves to Sprint 3.

**Spike check.** No spikes. Embeddings are deliberately deferred (Q3), so nothing waits on a model choice.

**Not in this sprint.** F-3 public production address (Sprint 4), F-4 generalised agent wiring and F-5 evals runner (Sprint 3), F-8 separate preview database (backlog).

## Questions for Rory

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | The two demo brands | (a) Fernhollow Outfitters (outdoor, from the prototypes) and a fictional fintech app. (b) Fernhollow and a coffee chain. (c) Fernhollow and a skincare brand | (a): a fintech brand brings financial-promotion rules and banned claims, the strongest compliance story for Sprint 7, and fits your fintech background |
| Q2 | Logos | (a) SVG wordmarks drawn in code for the demo brands; upload in Sprint 5. (b) Upload (PNG or SVG) now | (a): no storage or file-sanitising work until imagery needs it |
| Q3 | Context search | (a) Postgres full-text now; embeddings when an agent needs meaning-based search. (b) Embeddings now | (a): free, fast, testable; avoids choosing an embedding model before an agent needs one |
| Q4 | The prototypes | (a) Remove A and B; keep C as reference until Sprint 3. (b) Remove all three. (c) Keep all | (a) |
| Q5 | Loading demo data | (a) An "Add demo brands" action in the app. (b) A seed script only | (a): works on production and for any future workspace, and later for demo mode |
| Q6 | Data size | (a) About 2,000 customers and 24 months per brand (around 30,000 rows in all). (b) About 500 customers | (a): enough for believable segments, far inside the free tier's 500 MB |
| Q7 | Theme | (a) Follow the system, with a remembered toggle. (b) Light only for now | (a): the prototype already has both |

## Answers and changes (25 October 2026)

| # | Answer | Effect |
|---|---|---|
| Q1 | Fernhollow Outfitters (outdoor) and a fictional fintech app | S2-4 builds both briefs; the fintech kit carries financial-promotion lines and banned claims for Sprint 7 |
| Q2 | SVG wordmarks drawn in code; upload in Sprint 5 | S2-2 stores sanitised SVG text; no storage work |
| Q3 | Postgres full-text now; embeddings when an agent needs them | S2-5 as written |
| Q4 | Remove A and B; keep C as reference until Sprint 3 | S2-1 as written |
| Q5 | In-app "Add demo brands" action | S2-4 as written |
| Q6 | About 2,000 customers and 24 months per brand | S2-4 as written |
| Q7 | **Light theme only for now** | S2-1 changed: tokens and test cases are light only; test case 3 now checks that a dark operating system still gets a correct light screen. The definition of done's "light and dark" check becomes light only until dark returns. Dark theme logged as F-9 in the backlog |
| Scope | Sprint 2 contents confirmed | F-3 stays in Sprint 4, F-4 and F-5 in Sprint 3, F-8 in the backlog |

All six stories: **Ready, Sprint 2**.

## Changes during the build (25 October 2026)

| Story | Change | Why |
|---|---|---|
| S2-4 | The fintech brand is **Quillmoor Money** | "Tallymore" was too close to real fintech brands (Tally, Tally Money, TallyMint); "Quillmoor" returned no matches |
| S2-2 | Child tables reference their parent by `(id, workspace_id)` | A row can then only attach to a brand, customer, order or product in its own workspace, even if another workspace's id is known (test in S2-2 #2) |
| S2-2 | Logo sanitising uses `sanitize-html` 2.18.1 with an allow-list of SVG elements and attributes; `xmlns` may only be the SVG namespace | 2.18.0 carried a moderate advisory fixed in 2.18.1 |
| S2-4 | Order targets calibrated to about 5,150 (Fernhollow) and 5,970 (Quillmoor) orders; about 31,000 rows in all | After the review, test cases 2 to 4 are checked with the seed the app ships (`DEMO_SEED`) on every week of a year: orders stay within ±5% of target, every month has orders, the peak month holds and the lapsed share stays between 15% and 35% (16% to 28% in practice). The first calibration had claimed this without checking the shipped seed; it did not hold |
| S2-5 | Search uses `websearch_to_tsquery`, so any input is valid syntax; context items are upserted by a stable `source_ref` and only system items are ever removed by a re-sync | Hostile input never errors (S2-5 #5); agent-written items in Sprint 3 will survive brand edits |
| S2-1 | `decide()` returns `{ done }` so approvals show a toast; decision 0007 records the token structure and light-only theme | Built by the UI subagent |
| S2-2 #7, S2-6 #3 | Hosted advisors after the migrations: no unindexed foreign keys or per-row `auth.uid()` left; only "unused index" (new tables) and the accepted security-definer functions remain. "Leaked password protection" is reported off; it does not apply, since sign-in is by email link only | Checked 25 October 2026 |

## Fresh-eyes review before deploy (25 October 2026)

A reviewer subagent checked the whole sprint (`git diff 76936ce..HEAD`). No tenancy breach. Findings and what happened:

| # | Finding | Action |
|---|---|---|
| 1 | S2-4 #3 failed for the shipped seed on some load dates (lapsed share as low as 13.4%) | Fixed: lifetimes and order rates retuned; tests now sweep `DEMO_SEED` over 53 weekly load dates |
| 2 | Load time and search time never measured on production; no function time limit | `maxDuration = 60` on the Brands page; load time logged; measured on production at deploy |
| 3 | A kit at the list limits could fail to save (banned-terms context text over 4,000 characters) | Fixed: context text capped to the column limits; test at every list limit |
| 4 | Supabase's Data API would let a signed-in user write to the tables directly, bypassing validation and the simulated flag | Database now checks palettes and refuses changes to a brand's workspace, creator and simulated flag; Rory switched off the Data API on 25 October 2026 (the app never uses it) |
| 5 | Summaries and context text measured windows from today, so they go stale | Fixed: brands store `data_as_of`; every window counts back from it; the overview says "as of" |
| 6 | Policies checked membership once per row | Fixed: membership subquery on the Sprint 2 tables |
| 7 | Two presses of "Add demo brands" at once gave the wrong message | Fixed: advisory lock and duplicate mapped to "already loaded"; test runs two loads at once |
| 8 | Two reads not limited to the current workspace | Fixed: `listBrands` and the loader's check take the workspace |
| 9 | Test gaps (context tables in the anonymous test, cross-workspace inserts per table, S2-3 #4 figures, S2-5 #3 filter) | Fixed: tests added or tightened |
| 10 | SVG sanitiser refuses some good logos (`data:` or `https:` in any attribute; no `xmlns`) | Backlog F-10, for Sprint 5 when uploads arrive (safe today; logos are shown only as images) |
| 11 | Rule context items are keyed by position | Backlog F-11, for Sprint 3 when agents link to rules |
| 12 | Not-found inside a streamed page returns HTTP 200 | Backlog F-12 (screen is correct) |

## Production check (25 October 2026)

| Test case | Target | Measured on production | Result |
|---|---|---|---|
| S2-4 #6 | Demo load under 20 s | 2.7 s (`[addDemoBrands] loaded 2 brands in 2746 ms`, London region); 4,000 customers, 11,087 orders, 73 context items, both brands marked simulated | Pass |
| S2-5 #6 | Search under 300 ms | About 23 ms in the database (22.9 ms planning, 0.4 ms execution) for "lapsed customers" as a signed-in member, with row-level security applied | Pass |

Deploy `cb32f18` is healthy (`/api/health` ok, no runtime errors). With 73 items, Postgres scans the table rather than using the search index; the GIN index takes over as the store grows.
