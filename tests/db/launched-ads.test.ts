// Sprint 9 review fix: a launched ad can't be deleted on its own. A launch
// holds its ads as jsonb, and its simulated days and alerts reference them, so
// a launched ad deleted on its own would leave the clock stopped for good at
// the missing ad. The database refuses it, for any role, at the end of the
// transaction (the deferred ad_variants_launched constraint trigger), while a
// whole campaign, brand or workspace, which takes the launch with it, still
// deletes in one go. A refused launch never ran, so it doesn't hold its ads.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteBrand } from "@/lib/brands/repo";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { advance } from "@/lib/performance/clock";
import { createMember, truncateAll } from "../helpers/db";
import { brandFor, builder, campaignFor, EN, rawLaunch, type Member } from "../helpers/launch";

let a: Member;

/** A brand with a signed-off campaign of two ads (one picture), the first launched live; returns the ids. */
async function launchedCampaign(m: Member, slug: string, status: "live" | "refused" = "live") {
  const brand = await brandFor(m, slug);
  const campaign = await campaignFor(m, brand, "signed off", `Launched ads stay put (${slug})`);
  const mk = builder(m, brand, campaign);
  const image = await mk.image(`launched ads ${slug}`);
  const launched = await mk.ad(image, await mk.words(EN.headline), "card", true);
  const spare = await mk.ad(image, await mk.words("Kit for wet weekends"), "split", true);
  const { launchId } = await rawLaunch(m, campaign, [launched], { status, days: 7 });
  return { brand, campaign, image, launched, spare, launchId };
}

const variantExists = async (id: string) => (await getSql()`select 1 from public.ad_variants where id = ${id}`).length === 1;

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
}, 120_000);
afterAll(closeSql);

describe("Sprint 9 review fix: a launched ad stays while its launch does", () => {
  it("a launched ad can't be deleted on its own, nor through its picture, by any role; the clock still moves; an unlaunched ad can go", async () => {
    const c = await launchedCampaign(a, "launched-alone");
    await advance(a, c.launchId, 1, 0);
    const refused = { code: "23503", message: "A launched ad can't be deleted on its own; it goes only with its campaign" };
    // As the tables' owner, straight to the database.
    await expect(getSql()`delete from public.ad_variants where id = ${c.launched}`).rejects.toMatchObject(refused);
    // Through a cascade from its picture (the other ad on that picture is refused with it: one statement).
    await expect(getSql()`delete from public.assets where id = ${c.image}`).rejects.toMatchObject(refused);
    // Inside a longer transaction it is refused at the commit.
    await expect(
      getSql().begin(async (tx) => {
        await tx`delete from public.ad_variants where id = ${c.launched}`;
      }),
    ).rejects.toMatchObject(refused);
    expect(await variantExists(c.launched)).toBe(true);
    // Members have no delete on ads at all.
    await expect(asUser(a.userId, (tx) => tx`delete from public.ad_variants where id = ${c.launched}`)).rejects.toThrow(/permission denied/);
    // The clock moves on with every launched ad in place.
    expect(await advance(a, c.launchId, 1, 1)).toMatchObject({ simDay: 2, written: 1 });
    // The unlaunched ad can go.
    await getSql()`delete from public.ad_variants where id = ${c.spare}`;
    expect(await variantExists(c.spare)).toBe(false);
    // An ended launch keeps its ads too: its results stay in the history.
    await getSql()`update public.launches set status = 'ended', ended_by = ${a.userId}, ended_at = now() where id = ${c.launchId}`;
    await expect(getSql()`delete from public.ad_variants where id = ${c.launched}`).rejects.toMatchObject(refused);
  });

  it("a refused launch doesn't hold its ads", async () => {
    const c = await launchedCampaign(a, "launched-refused", "refused");
    await getSql()`delete from public.ad_variants where id = ${c.launched}`;
    expect(await variantExists(c.launched)).toBe(false);
  });

  it("a brand delete (the app's own) still takes the campaign, its live launch, results, alerts and ads with it", async () => {
    const c = await launchedCampaign(a, "launched-brand");
    await advance(a, c.launchId, "end", 0);
    await getSql()`insert into public.performance_alerts (workspace_id, launch_id, variant_id, day, kind, facts)
      values (${a.workspaceId}, ${c.launchId}, ${c.launched}, 3, 'tiring', '{}'::jsonb)`;
    expect(await deleteBrand(a.userId, c.brand)).toBe(true);
    for (const [table, column, id] of [
      ["launches", "id", c.launchId],
      ["sim_daily", "launch_id", c.launchId],
      ["performance_alerts", "launch_id", c.launchId],
      ["ad_variants", "campaign_id", c.campaign],
      ["campaigns", "id", c.campaign],
    ]) {
      const [{ n }] = await getSql().unsafe(`select count(*)::int as n from public.${table} where ${column} = $1`, [id]);
      expect(n, table).toBe(0);
    }
  });

  it("a whole workspace still deletes, with a live launch and an answered question whose run goes with it", async () => {
    const m = await createMember();
    const c = await launchedCampaign(m, "launched-workspace");
    await advance(m, c.launchId, 7, 0);
    await asUser(m.userId, async (tx) => {
      const [r] = await tx`insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by) values (${m.workspaceId}, 'monitorPlan', 1, '{}', ${m.userId}) returning id`;
      await tx`insert into public.performance_questions (workspace_id, launch_id, question, answer, run_id, created_by)
        values (${m.workspaceId}, ${c.launchId}, 'Which ad had the most clicks?', 'Ad 1 did.', ${r.id}, ${m.userId})`;
    });
    await getSql()`delete from public.workspaces where id = ${m.workspaceId}`;
    for (const table of ["launches", "sim_daily", "performance_questions", "ad_variants", "campaigns", "agent_runs"]) {
      const [{ n }] = await getSql().unsafe(`select count(*)::int as n from public.${table} where workspace_id = $1`, [m.workspaceId]);
      expect(n, table).toBe(0);
    }
  });
});
