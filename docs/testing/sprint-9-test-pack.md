# Sprint 9 hand check: the monitor's answers from the real model

**For Rory, on production, after the Sprint 9 deploy.** Your own sign-in. Contains no passwords or keys. Every figure you see in this check is simulated, and the page says so.

Everything else in Sprint 9 (the launch request, the simulator and clock, the Performance view, the alerts, and the Ask box with the mock model) is checked by browser tests and other CI checks, and shown on the demo page. This one check is what CI can't do, because CI runs the mock model: it never plans a real query or writes a real answer.

**Before you start**

- **Time:** about 15 minutes.
- **AI cost:** about 1p in all. Each question is about 0.1p, which the Ask box shows. Launching and moving the simulated clock cost nothing: no AI is involved.
- **Production** must be on Sprint 9: a campaign whose brief is signed off shows **Ask to launch**, and the Approvals inbox can hold a launch request.
- **You need** a campaign whose brief is signed off and that has ads made (an earlier sprint's Fernhollow or Quillmoor campaign will do). If you'd rather not launch an existing one, make a new campaign and its creative first (about 20p more).

---

### HC-1 Ten typical questions on a real launch

- **What it checks:** P9-4 test case 9. Whether Haiku plans the right query for a typical question, and words an answer that matches the table shown under it. CI checks the flow, the figure check and the refusals with the mock model, and F-16a's eval run checks the plans against fixed cases, but only a person can judge whether the answers to real questions are right and useful.
- **User:** you.
- **Flow:**
  1. Open the campaign. In the launch panel, keep the defaults and click **Ask to launch**.
  2. **Approvals** → the launch request → **Approve**.
  3. Back on the campaign, open its **Performance** view. Click **Next week** twice, so the clock reads **Simulated day 14 of 30**.
  4. Under **Ask about this campaign**, note the cost shown, then ask each question below, one at a time. Wait for each answer before asking the next.
  5. For each answer, compare it with the table under it and, where useful, with **Show the chart as a table** and the **Ads** table above.

  | # | Question to type | What a right answer looks like |
  |---|---|---|
  | 1 | Which ad had the lowest cost per acquisition last week? | Names one ad and its cost per acquisition over the last seven simulated days; the table lists each ad, lowest first. |
  | 2 | Which ad has the best click-through rate so far? | Names one ad, over every simulated day so far; the table is sorted highest first. |
  | 3 | How much have we spent in total? | One total, in pounds, for every day so far; it matches the sum of **Spend to date** in the Ads table (allow for rounding). |
  | 4 | How many conversions did each ad get in the last three days? | One figure per ad, for the last three simulated days. |
  | 5 | Which day had the most clicks? | Names one simulated day; the table is by day, most clicks first. |
  | 6 | What's the return on ad spend for Ad 2 this week? | Ad 2 only, over the last seven days. |
  | 7 | Is any ad getting worse? | Either a sensible comparison drawn only from the table (for example click-through rate by ad over two periods), or "I can only answer from this campaign's simulated results". It must not guess at a cause. |
  | 8 | Show me impressions per day for the first week. | A by-day table for simulated days 1 to 7, and a short answer. |
  | 9 | What will our cost per acquisition be next month? | Refused: "I can only answer from this campaign's simulated results", with no table. |
  | 10 | What did our competitors spend on their ads? | Refused in the same way, with no table. |

- **Expected outcome:**
  - Every answer is at most three sentences, labelled **Simulated data. Answer written by AI**, with the table it used underneath.
  - Every figure in an answer appears in its table (allowing for rounding). None is invented, and none is a forecast.
  - The day range and the ads in each table match what the question asked for (for example "last week" is the last seven simulated days, not every day).
  - Questions 9 and 10 are refused without a table.
  - Today's cost rose by about the total the box showed for ten questions (about 1p).
  - Afterwards, you may **End the launch**, or leave it running; it spends nothing real.
- **Result:** ☐ Pass ☐ Fail. Cost shown per question: ______. Cost charged in all: ______.
- **Notes (the number of any question whose plan or answer was wrong, and what was wrong):** ________________________________________________

---

**When you're done:** reply "done", or give the failing question numbers with a screenshot of the answer and its table. Each failure becomes a BUG- row in the backlog, and a wrong plan also becomes a regression case in the monitor's evals.
