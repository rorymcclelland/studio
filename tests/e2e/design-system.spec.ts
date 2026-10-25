// S2-1 test cases 1-4 and 7-9: the Soft machine design system on every screen.
// Test case 5 is run-flow.spec.ts; test case 6 is tests/lib/format.test.ts.
//
// The configuration page only shows when the server is misconfigured, so it is
// checked here through the same component on /design (its "Configuration page"
// section), which is rendered by ConfigProblems exactly as the real page is.
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import {
  DEV_EMAIL,
  contrastViolations,
  expectNoHorizontalScroll,
  settle,
  signIn,
  startRunAwaitingApproval,
} from "./helpers";

const WIDTHS = [375, 1440];

let awaitingRun = "";

type Screen = { name: string; path: () => string; signedIn: boolean };
const SCREENS: Screen[] = [
  { name: "sign-in", path: () => "/signin", signedIn: false },
  { name: "home", path: () => "/", signedIn: true },
  { name: "runs", path: () => "/runs", signedIn: true },
  { name: "run detail with approval form", path: () => awaitingRun, signedIn: true },
  { name: "components (/design)", path: () => "/design", signedIn: true },
  { name: "not found in the app", path: () => "/runs/11111111-1111-4111-8111-111111111111", signedIn: true },
  { name: "not found (no such address)", path: () => "/no-such-page", signedIn: false },
  { name: "design direction index", path: () => "/directions", signedIn: false },
];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  awaitingRun = await startRunAwaitingApproval(page, "Fernhollow Outfitters");
  await page.close();
});

async function visit(page: Page, s: Screen) {
  await page.goto(s.path());
  await settle(page);
}

test.describe("S2-1 #1 and #2: layout and contrast on every screen", () => {
  for (const width of WIDTHS) {
    test(`every screen fits ${width}px with no sideways scroll and passes AA contrast`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const signedIn of [false, true]) {
        if (signedIn) await signIn(page);
        for (const s of SCREENS.filter((x) => x.signedIn === signedIn)) {
          await visit(page, s);
          await expectNoHorizontalScroll(page, `${s.name} at ${width}px`);
          expect(await contrastViolations(page), `${s.name} at ${width}px`).toEqual([]);
        }
      }
    });
  }
});

test.describe("S2-1 #3: a dark operating system still gets the light theme", () => {
  test.use({ reducedMotion: "reduce" });

  test("every screen looks the same with the system set to dark", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const signedIn of [false, true]) {
      if (signedIn) await signIn(page);
      for (const s of SCREENS.filter((x) => x.signedIn === signedIn)) {
        await page.emulateMedia({ colorScheme: "light" });
        await visit(page, s);
        const light = await page.screenshot({ fullPage: true });

        await page.emulateMedia({ colorScheme: "dark" });
        await visit(page, s);
        const colours = await page.evaluate(() => {
          const body = getComputedStyle(document.body);
          return {
            background: body.backgroundColor,
            text: body.color,
            scheme: getComputedStyle(document.documentElement).colorScheme,
          };
        });
        // Soft machine light: --bg #f3f5fb and --ink #22244a.
        expect(colours.background, s.name).toBe("rgb(243, 245, 251)");
        expect(colours.text, s.name).toBe("rgb(34, 36, 74)");
        expect(colours.scheme, s.name).toContain("light");
        expect(await contrastViolations(page), `${s.name}, system dark`).toEqual([]);
        const dark = await page.screenshot({ fullPage: true });
        expect(dark.equals(light), `${s.name} changes when the system is dark`).toBe(true);
      }
    }
  });
});

/** Tabs through the page and returns what took focus, with whether its focus ring shows. */
async function tabThrough(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const seen: { key: string; ring: boolean }[] = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      if (!el.dataset.kb) el.dataset.kb = String(document.querySelectorAll("[data-kb]").length);
      const cs = getComputedStyle(el);
      const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
      return { key: el.dataset.kb, ring };
    });
    if (!info) break;
    if (seen.some((x) => x.key === info.key)) break;
    seen.push(info);
  }
  return seen;
}

/** Every control a keyboard user should reach: one stop per radio group. */
async function expectedStops(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sel = "a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, summary, [tabindex='0']";
    const radioGroups = new Set<string>();
    let n = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.getClientRects().length === 0) continue; // not rendered
      const closed = el.closest("details:not([open])");
      if (closed && el.tagName !== "SUMMARY") continue;
      if (el.closest("[popover]:not(:popover-open)")) continue;
      if (el instanceof HTMLInputElement && el.type === "radio") {
        if (radioGroups.has(el.name)) continue;
        radioGroups.add(el.name);
      }
      n++;
    }
    return n;
  });
}

test.describe("S2-1 #4: keyboard", () => {
  test("every control on home, runs and run detail is reachable with Tab and shows a focus ring", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    for (const path of ["/", "/runs", awaitingRun]) {
      await page.goto(path);
      await settle(page);
      const stops = await tabThrough(page);
      const expected = await expectedStops(page);
      expect(expected, `${path}: controls found`).toBeGreaterThan(5);
      expect(stops.length, `${path}: controls reached with Tab`).toBe(expected);
      for (const s of stops) expect(s.ring, `${path}: control ${s.key} has no visible focus ring`).toBe(true);
    }
  });

  test("controls work with Enter and Space", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);

    // Enter on a nav link goes there; it is then marked as the current page.
    await page.getByRole("link", { name: "Agent runs", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Agent runs", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Agent runs", exact: true })).toHaveAttribute("aria-current", "page");

    // The account menu opens with Space and closes with Escape.
    await page.getByRole("button", { name: "Account" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByText(DEV_EMAIL)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(DEV_EMAIL)).toBeHidden();

    // Enter in the brand name field starts a run.
    await page.goto("/");
    await settle(page);
    await page.getByLabel("Brand name").focus();
    await page.keyboard.type("Kestrel Lane");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Which tagline should we use?" })).toBeVisible({ timeout: 30_000 });

    // Space opens a step's inputs and outputs.
    const summary = page.getByText("Inputs and outputs").first();
    await summary.focus();
    await page.keyboard.press("Space");
    await expect(page.locator("details").first()).toHaveAttribute("open", "");

    // Space chooses a tagline, arrows move between them, Enter approves.
    await page.getByRole("radio").first().focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio").nth(1)).toBeChecked();
    await page.getByRole("button", { name: "Approve tagline" }).focus();
    await page.keyboard.press("Enter");
    // The result is confirmed in a toast, which Enter on Dismiss closes.
    const toast = page.locator("[data-toast]").filter({ hasText: "Tagline approved" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Dismiss" }).focus();
    await page.keyboard.press("Enter");
    await expect(toast).toHaveCount(0);
    await expect(page.getByText("Chosen tagline")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("S2-1 #7: reduced motion", () => {
  test("with reduced motion the ring and toasts do not animate", async ({ browser }) => {
    for (const motion of ["no-preference", "reduce"] as const) {
      const ctx = await browser.newContext({ reducedMotion: motion, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await signIn(page);
      await page.goto("/design");
      await settle(page);
      const ring = await page.locator("[data-ring-segment]").evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).animationName),
      );
      expect(ring.length).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Show a sample result toast" }).click();
      const toast = page.locator("[role=status] [data-toast]").first();
      await expect(toast).toBeVisible();
      const toastAnim = await toast.evaluate((el) => getComputedStyle(el).animationName);
      if (motion === "reduce") {
        expect(new Set(ring), "ring animates under reduced motion").toEqual(new Set(["none"]));
        expect(toastAnim, "toast animates under reduced motion").toBe("none");
      } else {
        // Proves the check above means something: without the preference, both animate.
        expect(ring.every((a) => a !== "none")).toBe(true);
        expect(toastAnim).not.toBe("none");
      }
      await ctx.close();
    }
  });
});

test.describe("S2-1 #8: hostile names", () => {
  const LONG = `Fernhollow ${"Outfitters ".repeat(30)}`.slice(0, 300);
  const SCRIPT = "<script>window.__pwned = 1</script>Fernhollow";

  test("a 300-character name and a <script> name render as wrapped plain text", async ({ page }) => {
    let dialog = false;
    page.on("dialog", async (d) => {
      dialog = true;
      await d.dismiss();
    });
    // A 300-character name cannot be entered through the form (80 at most), so
    // it goes straight into the database, as a later import or agent might write it.
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to seed a 300-character run name");
    await signIn(page);

    // A <script> name through the real form (it is within the 80-character limit).
    const scriptRun = await startRunAwaitingApproval(page, SCRIPT);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let longRun: string;
    try {
      const [r] = await sql`
        insert into public.agent_runs (workspace_id, agent, agent_version, status, input, error, created_by, completed_at)
        select m.workspace_id, 'tagline', 1, 'failed', ${sql.json({ brandName: LONG })},
               ${`Sample hostile error: ${LONG}`}, u.id, now()
        from auth.users u join public.workspace_members m on m.user_id = u.id
        where u.email = ${DEV_EMAIL}
        limit 1
        returning id`;
      longRun = `/runs/${r.id}`;
    } finally {
      await sql.end();
    }

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/", "/runs", longRun, scriptRun, "/design"]) {
        await page.goto(path);
        await settle(page);
        await expectNoHorizontalScroll(page, `${path} at ${width}px`);
        // Nothing sticks out of the viewport, however long the name.
        const overflow = await page.evaluate(() =>
          Array.from(document.querySelectorAll("h1, a, p, td, span"))
            .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
            .map((el) => el.textContent?.slice(0, 40)),
        );
        expect(overflow, `${path} at ${width}px`).toEqual([]);
      }
    }

    await page.goto(longRun);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(LONG.trim());
    const lines = await page.getByRole("heading", { level: 1 }).evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return el.getBoundingClientRect().height / lh;
    });
    expect(lines, "the long name wraps onto several lines").toBeGreaterThan(1.5);

    await page.goto(scriptRun);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCRIPT);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialog).toBe(false);
  });
});

test.describe("S2-1 #9: no real brands", () => {
  // Well-known consumer, retail, outdoor and finance brands that a marketing
  // demo might reach for. Model provider names in a run's trail are factual
  // attribution, not brand content, and the e2e suite uses the mock model.
  const DENY = [
    "Nike", "Adidas", "Puma", "Patagonia", "North Face", "Arc'teryx", "Columbia Sportswear", "Berghaus",
    "Coca-Cola", "Pepsi", "Starbucks", "McDonald's", "Unilever", "Nestlé", "Procter", "L'Oréal",
    "Amazon", "Apple", "Netflix", "Spotify", "Tesco", "Sainsbury's", "John Lewis", "Marks & Spencer",
    "Monzo", "Revolut", "Starling", "Barclays", "HSBC", "Lloyds", "NatWest", "Santander", "Klarna", "PayPal",
    "Visa", "Mastercard",
  ];
  const pattern = new RegExp(`\\b(${DENY.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

  test("no real brand or trademark appears on any screen or the component page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const signedIn of [false, true]) {
      if (signedIn) await signIn(page);
      for (const s of [...SCREENS, { name: "Soft machine prototype", path: () => "/directions/soft-machine", signedIn: false }].filter(
        (x) => x.signedIn === signedIn,
      )) {
        await visit(page, s);
        const text = await page.locator("body").innerText();
        expect(text, s.name).not.toMatch(/[®™©]/);
        expect(text.match(pattern)?.[0] ?? null, `${s.name} names a real brand`).toBeNull();
      }
    }
  });

  test("sample figures on the component page are labelled", async ({ page }) => {
    await signIn(page);
    await page.goto("/design");
    await expect(page.getByText("Sample values")).toBeVisible();
    await expect(page.getByText(/none of them are real/)).toBeVisible();
    await expect(page.getByRole("img", { name: /^Sample: 24 live variants/ })).toBeVisible();
  });
});
