// U10-1 Quick fixes through the UI (F-36, BUG-13, BUG-14 and the kit
// editor's Save), with the mock models. Cases 1, 2, 3 and 6 are here; case 2's
// words, case 3's state function and case 4 are also CI tests
// (tests/lib/spend-meter.test.ts, tests/lib/campaign-status.test.ts,
// tests/flows/campaign-status.test.ts), and case 5 is CI only
// (tests/lib/built-copy.test.ts).
//
// 1. With a 5p spend reservation in the database (what any model call in
//    flight leaves, F-21), every signed-in page at 375 px has no sideways
//    scroll. Before the fix the meter's pill read "47.62p simulated" and the
//    page was 387 px wide; it only showed when another spec's run happened to
//    be in flight, which is why F-36 was intermittent. The reservation makes it
//    happen every time. The design-system spec's own checks stay as they are.
// 2. With the reservation, the meter says a call is running and states no
//    amount as real spend.
// 3. One campaign per status (tests/e2e/status-fixture.ts) shows its label on
//    /campaigns and on Fernhollow's brand page.
// 6. At 375 px, Save brand kit is on screen at the top, the middle and the
//    bottom of the kit editor, and nothing covers it.
//
// ---------------------------------------------------------------- interface
// What the builder provides. The tests here and in the CI files above pin it.
//
// The spend meter (F-36), src/components/:
// - spend-meter-text.ts (pure, no server imports):
//     type SpendMeterFacts = { chargedPence: number; simulatedPence: number; callsInFlight: number; capPence: number }
//       chargedPence: charged today (usage_ledger) WITHOUT live reservations;
//       simulatedPence: the mock models' part of it; callsInFlight: live
//       reservations (under 10 minutes old), app-wide for the owner and the
//       workspace's for everyone else, as the spend figures are; capPence: the
//       cap this person is measured against (as today).
//     callsRunning(n): null for 0, "1 call running", "<n> calls running".
//     spendMeterText(facts) => { figure, pill, running, label }:
//       figure  "42.62p of £10.00"  (formatPence(charged) of formatPence(cap); never includes reservations)
//       pill    "Simulated" when all charged spend is simulated (to 0.0001p);
//               "<formatPence(simulated)> simulated" only when some is real;
//               null when nothing is charged
//       running callsRunning(callsInFlight)
//       label   figure, then ", all simulated" or ", <amount> simulated", then ", <running>", each only when present
//               e.g. "42.62p of £10.00, all simulated, 1 call running"
// - spend-meter-view.tsx: SpendMeterView(props: SpendMeterFacts & { owner: boolean }),
//   synchronous, renders:
//     a root with data-spend-meter, which wraps or shortens and never widens a 375 px page;
//     role="meter" with aria-valuetext = label (aria-label "AI spend today", as today);
//     a leaf span data-spend-figure holding only the figure;
//     a leaf span data-simulated-spend holding only the pill's words (as today, inside the Pill);
//     a leaf span data-calls-running holding only the running words, only while a call is in flight.
//   The title attribute keeps today's wording.
// - spend-meter.tsx: SpendMeter (async, same props) reads the facts and renders <SpendMeterView .../>.
//   The cap arithmetic is unchanged: reservations still count against the cap, they are only not shown as spend.
//
// Campaign status in lists (BUG-13):
// - src/lib/campaigns/status.ts (pure):
//     type CampaignStatusFacts = { status: string; currentVersion: number; launches: { status: string; simDay: number }[] }
//     CAMPAIGN_STATUS_LABELS = { writing: "Writing the brief", draft: "Draft", waiting: "Waiting for sign-off",
//       signedOff: "Signed off", launchWaiting: "Launch waiting", ended: "Ended" }
//     liveLabel(simDay): "Live (simulated day <n>)", or "Live (simulated, before day 1)" on day 0
//     campaignStatusLabel(facts): string. Precedence: a live launch (liveLabel of its sim_day), else a launch
//       awaiting approval ("Launch waiting"), else an ended launch ("Ended"); refused launches and launch statuses
//       it doesn't know count for nothing. Then the brief: 'drafting' or version 0 "Writing the brief", 'draft'
//       "Draft", 'awaiting_signoff' "Waiting for sign-off", 'approved' "Signed off", anything else "Draft" (case 4).
// - src/lib/brief/repo.ts: CampaignSummary.status widens to string and gains
//   launches: { status: string; simDay: number }[] (every launch of the campaign); listCampaigns() reads them in
//   the same query, through asUser().
// - src/app/(app)/campaigns/campaign-list.tsx: each row's pill holds a leaf span data-campaign-status with
//   campaignStatusLabel(row) and nothing else; the old campaignStatus() and "Draft vN" go.
//
// Out-of-date copy (BUG-14): the welcome page (src/app/welcome/page.tsx) and PLAN_NOTE
// (src/app/(app)/campaigns/[id]/reviews-view.tsx) say nothing built is still to come; the words are the
// builder's, checked by tests/lib/built-copy.test.ts.
//
// The kit editor (src/app/(app)/brands/[id]/edit/brand-editor.tsx): the save bar is sticky at every width
// (today sm:sticky), so the button "Save brand kit" is on screen at the top and the bottom of the form at 375 px,
// and nothing covers it.
// ----------------------------------------------------------------------------
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { demoBrandId, expectNoHorizontalScroll, settle, signIn, startRunAwaitingApproval, step } from "./helpers";
import { insertReservation, insertStatusCampaigns, removeCampaigns, removeReservation, STATUS_LABELS, type StatusKey } from "./status-fixture";

const PHONE = { width: 375, height: 812 };
const meter = (page: Page) => page.locator("header [data-spend-meter]").filter({ visible: true });
/** An amount labelled as only partly simulated ("47.62p simulated"), which implies the rest is real spend. */
const PARTLY_SIMULATED = /(\d[\d.,]*p|£[\d.,]+|under 0\.01p),? simulated\b/;

function sqlOrSkip() {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to write the fixture rows (a spend reservation, campaigns in each state)");
  return postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "U10-1 #1: with a spend reservation in the database, every signed-in page at 375 px has no sideways scroll",
  { annotation: [{ type: "case", description: "U10-1.1" }] },
  async ({ page }) => {
    test.setTimeout(300_000);
    const sql = sqlOrSkip();
    let reservation = "";
    let campaigns: Record<StatusKey, string> | null = null;
    try {
      const fernhollow = await demoBrandId(page, "Fernhollow Outfitters");
      const quillmoor = await demoBrandId(page, "Quillmoor Money");
      const run = await startRunAwaitingApproval(page, "Harebell Walks");
      campaigns = await insertStatusCampaigns(sql, fernhollow, "Page width check");
      const pages: [string, string][] = [
        ["home", "/"],
        ["runs", "/runs"],
        ["run detail with approval form", run],
        ["components (/design)", "/design"],
        ["brands", "/brands"],
        ["brand page (Fernhollow)", `/brands/${fernhollow}`],
        ["brand page with search results", `/brands/${fernhollow}?q=lapsed`],
        ["brand page (Quillmoor)", `/brands/${quillmoor}`],
        ["brand kit editor", `/brands/${fernhollow}/edit`],
        ["brand languages", `/brands/${fernhollow}/languages`],
        ["campaigns", "/campaigns"],
        ...(Object.keys(STATUS_LABELS) as StatusKey[]).map((k): [string, string] => [`campaign, ${STATUS_LABELS[k]}`, `/campaigns/${campaigns![k]}`]),
        ["approvals", "/approvals"],
        ["invites", "/invites"],
        ["brand not found", "/brands/11111111-1111-4111-8111-111111111111"],
        ["not found in the app", "/runs/11111111-1111-4111-8111-111111111111"],
      ];

      await step(page, "A 5p spend reservation, as a model call in flight leaves one", async () => {
        reservation = await insertReservation(sql, 5);
      });

      await page.setViewportSize(PHONE);
      for (const [name, path] of pages) {
        await step(page, `U10-1.1: ${name} at 375px, with a call in flight`, async () => {
          await page.goto(path);
          await settle(page);
          // The reservation is live, so the meter shows a call running on every page.
          await expect(meter(page).locator("[data-calls-running]")).toHaveText(/^\d+ calls? running$/);
          await expectNoHorizontalScroll(page, `${name} at 375px with a call in flight`);
          // Nothing in the header sticks out past the viewport either (content scrolling inside its own box is fine).
          const out = await page.evaluate(() => {
            const clipped = (el: Element) => {
              for (let p = el.parentElement; p && p.tagName !== "HEADER"; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return true;
              return false;
            };
            return Array.from(document.querySelectorAll("header *"))
              .filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 && !clipped(el))
              .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
          });
          expect(out, `${name}: header elements past the right edge`).toEqual([]);
        });
      }
    } finally {
      if (reservation) await removeReservation(sql, reservation);
      if (campaigns) await removeCampaigns(sql, Object.values(campaigns));
      await sql.end();
    }
  },
);

test(
  "U10-1 #2: while a call is in flight, the spend meter says a call is running and states no amount as real spend",
  { annotation: [{ type: "case", description: "U10-1.2" }] },
  async ({ page }) => {
    test.setTimeout(120_000);
    const sql = sqlOrSkip();
    let reservation = "";
    try {
      await step(page, "A 5p spend reservation, as a model call in flight leaves one", async () => {
        reservation = await insertReservation(sql, 5);
      });
      for (const width of [375, 1440]) {
        await step(page, `U10-1.2: the meter at ${width}px says a call is running, and calls nothing real`, async () => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto("/brands");
          await settle(page);
          const m = meter(page);
          // Every charge in the e2e run is the mock model's, so the pill says Simulated, with no amount.
          await expect(m.locator("[data-simulated-spend]")).toHaveText("Simulated");
          await expect(m.locator("[data-calls-running]")).toHaveText(/^\d+ calls? running$/);
          await expect(m.locator("[data-spend-figure]")).toHaveText(/^(\d+\.\d{2}p|£\d+\.\d{2}|0p|under 0\.01p) of £\d+\.\d{2}$/);
          const text = ((await m.textContent()) ?? "").replace(/\s+/g, " ");
          expect(text, "the meter's text").not.toMatch(PARTLY_SIMULATED);
          const value = (await m.getByRole("meter", { name: "AI spend today" }).getAttribute("aria-valuetext")) ?? "";
          expect(value).toMatch(/, all simulated, \d+ calls? running$/);
          expect(value).not.toMatch(PARTLY_SIMULATED);
        });
      }
      // With no call in flight the running words aren't shown: tests/lib/spend-meter.test.ts. Other specs' calls
      // run beside this one, so the browser can't wait for a moment with none in flight.
    } finally {
      if (reservation) await removeReservation(sql, reservation);
      await sql.end();
    }
  },
);

test(
  "U10-1 #3: each campaign status shows on /campaigns and on the brand page, one campaign per state",
  { annotation: [{ type: "case", description: "U10-1.3" }] },
  async ({ page }) => {
    test.setTimeout(120_000);
    const sql = sqlOrSkip();
    let campaigns: Record<StatusKey, string> | null = null;
    try {
      const fernhollow = await demoBrandId(page, "Fernhollow Outfitters");
      await step(page, "One Fernhollow campaign in each state: writing, draft, waiting, signed off, launch waiting, live on simulated day 14, ended", async () => {
        campaigns = await insertStatusCampaigns(sql, fernhollow, "Status check");
      });
      for (const [where, path] of [["/campaigns", "/campaigns"], ["the brand page", `/brands/${fernhollow}`]] as const) {
        for (const width of [375, 1440]) {
          await step(page, `U10-1.3: every state's label on ${where} at ${width}px`, async () => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(path);
            await settle(page);
            const list = page.locator("[data-campaign-list]").filter({ visible: true });
            for (const key of Object.keys(STATUS_LABELS) as StatusKey[]) {
              const row = list.locator("li").filter({ has: page.locator(`a[href="/campaigns/${campaigns![key]}"]`) });
              await expect(row, key).toHaveCount(1);
              await expect(row.locator("[data-campaign-status]"), key).toHaveText(STATUS_LABELS[key]);
            }
            // BUG-13: no list says "Draft vN" any more.
            await expect(list).not.toContainText(/Draft v\d/);
            await expectNoHorizontalScroll(page, `${where} at ${width}px`);
          });
        }
      }
    } finally {
      if (campaigns) await removeCampaigns(sql, Object.values(campaigns));
      await sql.end();
    }
  },
);

test(
  "U10-1 #6: at 375 px, Save brand kit is on screen at the top and the bottom of the kit editor",
  { annotation: [{ type: "case", description: "U10-1.6" }] },
  async ({ page }) => {
    const fernhollow = await demoBrandId(page, "Fernhollow Outfitters");
    await page.setViewportSize(PHONE);
    await page.goto(`/brands/${fernhollow}/edit`);
    await settle(page);
    const save = page.getByRole("button", { name: "Save brand kit" });
    await expect(save).toHaveCount(1);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    // The form is several screens long on a phone, so being on screen means the bar stays.
    expect(height, "the kit editor is longer than one screen at 375px").toBeGreaterThan(PHONE.height * 2);
    for (const [where, y] of [["the top", 0], ["the middle", Math.round(height / 2)], ["the bottom", height]] as const) {
      await step(page, `U10-1.6: Save brand kit is on screen, uncovered, at ${where} of the kit editor`, async () => {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        await expect
          .poll(() =>
            save.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const inView = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && r.height > 0;
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return inView && !!hit && (hit === el || el.contains(hit));
            }),
          )
          .toBe(true);
        await expect(save).toBeEnabled();
      });
    }
  },
);
