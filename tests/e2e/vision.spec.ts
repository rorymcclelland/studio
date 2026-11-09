// C8-2 Vision checks through the UI, with the mock models. A signed-off
// Quillmoor campaign (a finance brand) with Make creative's ads:
//
// 1. Case 4: its pictures lose their picture-check results through the
//    database, as a campaign made before Sprint 8 would be. Each ad's
//    Compliance view shows the picture items as Review, "The picture check
//    didn't run". Check pictures shows its cost before the click, checks each
//    picture once and adds the results: the face rule and the don't rules say
//    "No issues found by AI", each "Checked by AI". The button then
//    says every picture is checked, so a second click can't check (or charge
//    for) anything (the CI test runs it again to show it costs nothing).
// 2. Case 2: a don't rule about abstract shapes is added to Quillmoor's kit
//    for a moment (the mock pictures are soft shapes, so the mock says the
//    picture breaks it) and picture 1 is checked again. Every ad using it shows
//    Review with the AI's reason and "Checked by AI"; Accept clears it in each
//    ad, one at a time. The rule is taken out again in finally. Tagged
//    @brand-kit: it runs in the brand-kit project, after every other spec and
//    one at a time, as the launch pack and pre-test specs count Quillmoor's
//    don't rules.
//
// Each page at 375 px and 1440 px: nothing scrolls sideways, AA contrast.
// SHOTS_DIR=<folder> saves screenshots.
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { contrastViolations, demoBrandId, DEV_EMAIL, expectNoHorizontalScroll, makeCreative, newCampaign, openStage, saveShot, settle, signIn, signOffVersion, step, untilShown } from "./helpers";

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const bar = (page: Page) => page.locator("[data-picture-check-bar]");
const pictureRow = (page: Page, rule: "face" | "picture") => page.locator(`[data-compliance-picture] [data-rule=${rule}]`);
const SHAPES_RULE = "Show soft abstract shapes instead of real scenes";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function checkWidths(page: Page, what: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await expectNoHorizontalScroll(page, `${what} at ${width}px`);
    expect(await contrastViolations(page), `${what} at ${width}px`).toEqual([]);
    await saveShot(page, `${what}-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Presses Check pictures and waits until the bar says every picture is checked. */
async function checkPictures(page: Page, campaignPath: string, label: RegExp) {
  await openStage(page, "creative", campaignPath);
  const button = bar(page).getByRole("button", { name: label });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(toast(page, /^Checking the pictures\./)).toBeVisible({ timeout: 30_000 });
  await untilShown(page, () => expect(bar(page).locator("[data-picture-check-reason]")).toHaveText("Every picture in the campaign's ads has been checked by AI.", { timeout: 10_000 }), 180_000);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test(
  "C8-2 #2, #4: Check pictures on a campaign made before Sprint 8 shows its cost and adds results once, and a picture the AI says breaks a don't rule is Review on every ad using it until accepted",
  { tag: "@brand-kit", annotation: [{ type: "case", description: "C8-2.2" }, { type: "case", description: "C8-2.4" }] },
  async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is needed to make the pictures look as if made before Sprint 8");
    test.setTimeout(900_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const brandId = await demoBrandId(page, "Quillmoor Money");
    let campaignPath = "";
    let campaignId = "";
    let firstAd = "";
    try {
      await step(page, "A signed-off Quillmoor brief and its ads (simulated pictures)", async () => {
        campaignPath = await newCampaign(page, "Quillmoor Money", "Bring lapsed savers back to the Plus plan, every picture checked by AI");
        campaignId = campaignPath.split("/").pop()!;
        await signOffVersion(page, 1);
        await makeCreative(page, 12);
        firstAd = (await page.locator("[data-gallery] > li").first().getAttribute("data-ad"))!;
      });

      await step(page, "Make its pictures look as if made before Sprint 8 (no picture-check results)", async () => {
        await sql`update public.assets set meta = meta - 'vision' where campaign_id = ${campaignId}`;
        await page.goto(`${campaignPath}/ads/${firstAd}/compliance`);
        await settle(page);
        for (const rule of ["face", "picture"] as const) {
          await expect(pictureRow(page, rule)).toHaveAttribute("data-status", "review");
          await expect(pictureRow(page, rule)).toContainText("The picture check didn't run: the picture was made before Studio checked pictures");
          await expect(pictureRow(page, rule).locator("[data-fix]")).toHaveText("Suggested fix: Use Check pictures on the campaign.");
        }
      });

      await step(page, "C8-2.4: Check pictures shows its cost for the four pictures before the click", async () => {
        await openStage(page, "creative", campaignPath);
        await expect(bar(page).getByRole("button", { name: /^Check pictures \(about [\d.]+p a picture, [\d.]+p in all\)$/ })).toBeEnabled();
        await expect(bar(page).locator("[data-picture-check-todo]")).toContainText("4 pictures have no result yet");
        await checkWidths(page, "campaign with Check pictures");
      });

      await step(page, "C8-2.4: it checks each picture once; then the button says every picture is checked", async () => {
        await checkPictures(page, campaignPath, /^Check pictures \(/);
        await expect(bar(page).getByRole("button", { name: /^Check pictures$/ })).toBeDisabled();
        const [{ n }] = await sql`
          select count(*)::int as n from public.agent_steps s join public.agent_runs r on r.id = s.run_id
          where r.agent = 'pictureCheck' and r.input ->> 'campaignId' = ${campaignId} and s.name ~ '^Check picture [0-9]+$'`;
        expect(n).toBe(4);
      });

      await step(page, "C8-2.4: the ad's Compliance view shows the results, each Checked by AI; the face rule and the don't rules say No issues found by AI, not Pass", async () => {
        await page.goto(`${campaignPath}/ads/${firstAd}/compliance`);
        await settle(page);
        await expect(pictureRow(page, "face")).toHaveAttribute("data-status", "pass");
        await expect(pictureRow(page, "face")).toContainText("The AI check found no face in the picture.");
        // Review nit 7: the AI's "no" on the face rule is not a green Pass either.
        await expect(pictureRow(page, "face")).toContainText(/^No issues found by AI\s*Picture: face \(finance brands\)/);
        await expect(pictureRow(page, "face")).not.toContainText("Pass");
        await expect(pictureRow(page, "picture")).toHaveAttribute("data-status", "pass");
        await expect(pictureRow(page, "picture")).toContainText(/^No issues found by AI\s*Picture: don't rules/);
        await expect(pictureRow(page, "picture")).not.toContainText("Pass");
        for (const rule of ["face", "picture"] as const) await expect(pictureRow(page, rule).locator("[data-checked-by]")).toHaveText("Checked by AI (simulated: the mock model)");
        await checkWidths(page, "compliance view, picture checked");
      });

      const [{ rules: before }] = await sql`select dont_rules as rules from public.brands where id = ${brandId}`;
      try {
        let using: string[] = [];
        await step(page, "C8-2.2: add a don't rule about abstract shapes, and check picture 1 again", async () => {
          await sql`update public.brands set dont_rules = array_append(dont_rules, ${SHAPES_RULE}) where id = ${brandId}`;
          const rows = await sql`
            select v.id from public.ad_variants v join public.assets a on a.id = v.image_asset_id
            where v.campaign_id = ${campaignId} and v.discarded_at is null and (a.meta ->> 'picture')::int = 1
            order by v.created_at, v.id`;
          using = rows.map((r) => r.id as string);
          expect(using.length).toBeGreaterThan(1);
          await sql`update public.assets set meta = meta - 'vision' where campaign_id = ${campaignId} and (meta ->> 'picture')::int = 1`;
          await checkPictures(page, campaignPath, /^Check pictures \(about [\d.]+p\)$/);
        });

        await step(page, "C8-2.2: every ad using picture 1 shows the don't rules as Review, with the AI's reason and Checked by AI", async () => {
          for (const id of using) {
            await page.goto(`${campaignPath}/ads/${id}/compliance`);
            await settle(page);
            const row = pictureRow(page, "picture");
            await expect(row).toHaveAttribute("data-status", "review");
            await expect(row).toContainText(new RegExp(`The AI check says the picture may break "${escape(SHAPES_RULE)}": Simulated check: the picture is made of soft abstract shapes`));
            await expect(row.locator("[data-checked-by]")).toHaveText("Checked by AI (simulated: the mock model)");
            await expect(row.getByRole("button", { name: /^Accept/ })).toBeVisible();
          }
          await checkWidths(page, "compliance view, picture flagged by AI");
        });

        await step(page, "C8-2.2: Accept clears it in each ad, one at a time, with the name and the time", async () => {
          for (const [i, id] of using.entries()) {
            await page.goto(`${campaignPath}/ads/${id}/compliance`);
            await settle(page);
            await pictureRow(page, "picture").getByRole("button", { name: /^Accept/ }).click();
            await expect(toast(page, "Accepted: picture: don't rules.").first()).toBeVisible({ timeout: 30_000 });
            await expect(pictureRow(page, "picture")).toHaveAttribute("data-status", "accepted", { timeout: 30_000 });
            await expect(pictureRow(page, "picture").locator("[data-decision=accept]")).toHaveText(new RegExp(`^Accepted by ${escape(DEV_EMAIL)}, .*\\d{1,2}:\\d{2}`));
            // The next ad still waits for its own decision.
            if (i + 1 < using.length) {
              await page.goto(`${campaignPath}/ads/${using[i + 1]}/compliance`);
              await settle(page);
              await expect(pictureRow(page, "picture")).toHaveAttribute("data-status", "review");
            }
          }
        });
      } finally {
        await sql`update public.brands set dont_rules = ${before} where id = ${brandId}`;
      }
    } finally {
      await sql.end();
    }
  },
);
