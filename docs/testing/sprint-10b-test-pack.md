# Sprint 10b hand check: your own brand, from scratch to monitoring, on real models

**For Rory, on production, this evening, after the Sprint 10b deploy.** Your own sign-in. Contains no passwords or keys.

This is D-6, the full journey for tomorrow's demo, run once with real models. Everything else in Sprint 10b is checked by browser tests and other CI checks with the mock model, and shown on the demo page. This check is what CI can't do: it judges what real models write for a real brand.

**Before you start**

- **Time:** about 40 minutes, most of it waiting for agents.
- **AI cost:** about 50p in all, at most about £1. The daily cap is £5 today and tomorrow (`DAILY_CAP_PENCE` = 500). Each button shows its cost before you click.

  | Step | Estimated cost |
  | --- | --- |
  | Market notes | about 20p (up to 3 web searches) |
  | Audiences, brief, personas, test plan | a few pence in all |
  | Suggest lines | about 0.02p |
  | Make creative | about 20p, at most about 41p |
  | Pre-test | about 0.2p |
  | Ask about this campaign | about 0.1p a question |
  | Generating data, launching, the simulated clock | nothing: no AI is used |

- **Production** must be on Sprint 10b: **Brands** shows a **New brand** link.
- **Logo:** only if you have Cookpad's permission (decision A1). Everything works without one.
- **Two things that are true and worth knowing before Aki sees them:**
  - Studio works in pounds, so product prices and costs show in £ even with Japan's regions.
  - Copy and ads are in English. There's no Japanese yet.
- Write down **AI today** (top right) before step 1.

---

### HC-1 Cookpad, from New brand to the Performance page

- **What it checks:** D-6, which covers D-1 to D-5 end to end with real models: a real brand's kit, simulated data with Japan's regions, the Market agent researching a real brand in Japan, a brief that may name the brand, the campaign line (typed and suggested), creative using the line, and the launch and monitoring.
- **User:** you.

**Flow**

1. **New brand.** Brands → **New brand**. Fill in:
   - Name: "Cookpad";
   - Category: for example "Home cooking";
   - Description: one or two sentences in your own words.
   
   Click **Create brand**. The kit editor opens.
2. **Kit.** Fill in the tone words, voice notes, do and don't rules, the palette (at least one colour, which Make creative needs) and any legal lines you want on the ads. Upload the logo only with permission. Save.
3. **Simulated data.** On the brand page, open **Products and data** → **Generate simulated data**.
   - Add 2 to 5 products, with prices and popularity. Use your own understanding of what Cookpad offers, for example a premium subscription. Every figure that results is labelled simulated.
   - Choose **Japan's regions** and one to three busiest months, then **Generate data**.
4. **Audiences.** **Audience** tab → **Find audiences**.
5. **Market notes.** Run the market notes (**Refresh market notes** on the brand page).
6. **Campaign.** **New campaign**, for Cookpad, with an objective, for example "Bring lapsed home cooks back for the new year". Click **Write the brief**.
7. **The line, suggested.** On the **Brief** stage, under **Campaign line**, click **Suggest lines**. Pick one with **Use this line**, or use **Edit first** to change it.
8. **The line, typed.** Optional: **Edit the campaign line**, type your own, and save.
9. **Sign-off.** **Send version N for sign-off**, then **Approve** it, on the Brief stage or in Approvals. The **Audience** stage then shows the personas and the test plan.
10. **Creative.** **Creative** stage → **Make creative**. **Pick** three or four ads, then **Pre-test picked ads**.
11. **Launch pack.** Download the launch pack from the Launch stage.
12. **Launch.** **Ask to launch** → Approvals → **Approve** → **Next week** twice → **See performance (simulated)**. Ask one question in **Ask about this campaign**.
13. **Optional:** repeat steps 1 to 3 for "Cookpad Moment", with "Cookpad" under **Also known as**, and a description saying it is part of Cookpad. Then run steps 5 and 6. A brief or ad that says "Cookpad" must pass.

**Expected outcome**

- **Step 1:** the brand is created. Its page shows no "Demo brand" pill.
- **Step 3:** about the number of customers you chose, spread over Japan's 8 regions (Kanto largest). The brand shows **Simulated data**. No AI cost.
- **Step 4:** sized segments, each labelled as proposed by the Audience agent and simulated.
- **Step 5:** notes about the market **in Japan**, each with a source link. Notes may name Cookpad and real competitors.
- **Step 6:** a brief that may say "Cookpad", and refers to Japanese places without being refused as "another brand". Any figure it uses is cited or marked as added by a person.
- **Step 7:**
  - three lines, each 30 characters or fewer;
  - **none with a figure, a quote or another company's name** (review fix B1);
  - picking one saves a new version, which needs signing off again.
- **Step 10:**
  - every paid-social and display ad's headline is the campaign line exactly;
  - bodies differ;
  - pictures contain no words or logos;
  - legal lines are present where the kit has them.
- **Step 11:** the pack's README makes **no** claim that the brand is fictional.
- **Step 12:** Performance shows simulated days, at most the newest 3 alerts in full, and an answer labelled **Simulated data. Answer written by AI**.
- **Sign-in:** the sign-in and welcome pages no longer say every brand is fictional.
- **AI today** rose by about 50p, and no more than about £1.

**Result:** ☐ Pass ☐ Fail. Cost charged in all: ______.

**Notes (the step number and what was wrong, with a screenshot):** ________________________________________________

---

**When you're done:** reply "done", or give the failing step numbers with a screenshot. Anything that fails tonight is fixed before 08:45. Each finding also becomes a BUG- row in the backlog.

**After the demo:** set `DAILY_CAP_PENCE` back to 100 in Vercel.
