// A browser-test fixture, not an app route: U10-1 #3's campaigns, one per
// status a list can show, written straight to the database as the tables'
// owner (CI's and local e2e's DATABASE_URL), in the dev workspace, under a demo
// brand. Building a live campaign through the UI takes minutes (creative,
// compliance, a launch, the clock); the list only reads the campaign's status,
// version and launches, so those rows are written as the app leaves them:
// a sign-off approval for the one waiting, a launch approval for each launch,
// approved for the live and ended ones, and the clock moved to day 14 on the
// live one. The launches name ad ids no gallery holds (the list never reads
// ads; a campaign page shows them as ads no longer in the gallery).
//
// The rows go with their campaigns (removeCampaigns), so other specs never
// see them for longer than the test that made them.
import type postgres from "postgres";
import { DEV_EMAIL } from "./helpers";

export type StatusKey = "writing" | "draft" | "waiting" | "signedOff" | "launchWaiting" | "live" | "ended";

/** Each state's label in lists (U10-1, the refinement's words), in the order the test makes them. */
export const STATUS_LABELS: Record<StatusKey, string> = {
  writing: "Writing the brief",
  draft: "Draft",
  waiting: "Waiting for sign-off",
  signedOff: "Signed off",
  launchWaiting: "Launch waiting",
  live: "Live (simulated day 14)",
  ended: "Ended",
};

const brief = (title: string) => ({
  title,
  summary: "Bring walkers back for the autumn range before the first cold weekend.",
  story: "Walkers come back when the kit they bought lasts the season.",
  insights: [1, 2, 3].map((n) => ({ text: `Walkers say reason ${n} matters to them.`, cites: [`note-${n}`] })),
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach lapsed walkers." }],
  kpi: { metric: "reactivation rate" },
  mustInclude: [],
  avoid: [],
});

const FAKE_AD = "a1111111-1111-4111-8111-111111111111";

/** The dev workspace and user (the owner the specs sign in as). */
export async function devMember(sql: postgres.Sql): Promise<{ userId: string; workspaceId: string }> {
  const [m] = await sql`
    select u.id as user_id, m.workspace_id from auth.users u join public.workspace_members m on m.user_id = u.id
    where u.email = ${DEV_EMAIL} limit 1`;
  if (!m) throw new Error(`${DEV_EMAIL} has no workspace yet: sign in first`);
  return { userId: m.user_id as string, workspaceId: m.workspace_id as string };
}

/**
 * One campaign per status, under `brandId`, with objectives that start with
 * `tag` so a test can find its own. Returns each campaign's id by state. The
 * live one is on simulated day 14 unless `liveDay` says otherwise (U10-2 #9
 * uses day 0, whose label is the longest: "Live (simulated, before day 1)").
 */
export async function insertStatusCampaigns(sql: postgres.Sql, brandId: string, tag: string, { liveDay = 14 }: { liveDay?: number } = {}): Promise<Record<StatusKey, string>> {
  const { userId, workspaceId } = await devMember(sql);
  const ids = {} as Record<StatusKey, string>;
  await sql.begin(async (tx) => {
    for (const key of Object.keys(STATUS_LABELS) as StatusKey[]) {
      const objective = `${tag}: ${STATUS_LABELS[key]}`;
      const version = key === "writing" ? 0 : 1;
      const [c] = await tx`
        insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
        values (${workspaceId}, ${brandId}, ${objective}, ${userId}, ${version}) returning id`;
      ids[key] = c.id as string;
      if (version === 0) continue;
      await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
        values (${workspaceId}, ${c.id}, 1, ${tx.json(brief(`${tag}: ${STATUS_LABELS[key]}`))}, 'agent', ${userId})`;
      if (key === "draft") {
        await tx`update public.campaigns set status = 'draft' where id = ${c.id}`;
        continue;
      }
      if (key === "waiting") {
        await tx`insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
          values (${workspaceId}, 'brief_signoff', ${c.id}, 1, ${`Sign off version 1: ${objective}`}, '[]'::jsonb, now() + interval '7 days')`;
        await tx`update public.campaigns set status = 'awaiting_signoff' where id = ${c.id}`;
        continue;
      }
      await tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${userId} where id = ${c.id}`;
      if (key === "signedOff") continue;
      const [ap] = await tx`
        insert into public.approvals (workspace_id, kind, campaign_id, question, options, expires_at)
        values (${workspaceId}, 'launch', ${c.id}, 'Launch (simulated)', '[]'::jsonb, now() + interval '14 days') returning id`;
      const [l] = await tx`
        insert into public.launches (workspace_id, campaign_id, ads, daily_budget_pence, days, starts_on, kpi_measure, kpi_value, seed, approval_id, created_by)
        values (${workspaceId}, ${c.id}, ${tx.json([{ variantId: FAKE_AD, sizes: ["1080x1080"], langs: ["en-GB"] }])}, 5000, 30, ${"2026-11-06"},
                'cpa', 20, 42, ${ap.id}, ${userId}) returning id`;
      if (key === "launchWaiting") continue;
      await tx`update public.approvals set status = 'approved', decided_by = ${userId}, decided_at = now() where id = ${ap.id}`;
      await tx`update public.launches set status = 'live', approved_at = now() where id = ${l.id}`;
      if (key === "live" && liveDay > 0) await tx`update public.launches set sim_day = ${liveDay} where id = ${l.id}`;
      if (key === "ended") await tx`update public.launches set status = 'ended', ended_by = ${userId}, ended_at = now() where id = ${l.id}`;
    }
  });
  return ids;
}

/** Removes campaigns (with their versions, approvals and launches), as the tables' owner. */
export async function removeCampaigns(sql: postgres.Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`delete from public.campaigns where id in ${sql(ids)}`;
}

/** Inserts a spend reservation in the dev workspace, as a model call in flight leaves one (F-21). Returns its id. */
export async function insertReservation(sql: postgres.Sql, pence = 5): Promise<string> {
  const { workspaceId } = await devMember(sql);
  const [r] = await sql`insert into public.spend_reservations (workspace_id, pence) values (${workspaceId}, ${pence}) returning id`;
  return r.id as string;
}

export async function removeReservation(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from public.spend_reservations where id = ${id}`;
}
