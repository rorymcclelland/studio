// U10-5 Home leads with work: what waits for a person across the workspace,
// read through asUser() (rule 7), and shaped by the pure ./needs. The
// approvals are the ones the inbox lists (listInbox in @/lib/approvals/repo,
// whose filter this mirrors, closing stale sign-offs and launches first); the
// alerts are the unseen ones on live launches, as unseenAlertCount counts them.
import { expireStaleSignoffs } from "@/lib/approvals/repo";
import { asUser } from "@/lib/db/scoped";
import { expireStaleLaunches } from "@/lib/performance/launch";
import { campaignName, homeNeeds, type CampaignAlerts, type HomeApproval, type HomeNeed } from "./needs";

export async function homeNeedsFor(userId: string): Promise<HomeNeed[]> {
  const { approvals, alerts } = await asUser(userId, async (tx) => {
    await expireStaleSignoffs(tx);
    await expireStaleLaunches(tx);
    const approvals = await tx`
      select a.id, a.kind, a.question, a.campaign_id, a.brief_version, a.run_id, r.label as run_label,
        c.objective, v.brief ->> 'title' as title
      from public.approvals a
      left join public.agent_runs r on r.id = a.run_id
      left join public.campaigns c on c.id = a.campaign_id
      left join public.brief_versions v on v.campaign_id = c.id and v.version = c.current_version
      where a.status = 'pending' and a.expires_at > now() and (a.kind in ('brief_signoff', 'launch') or r.status = 'awaiting_approval')
      order by a.created_at desc
      limit 100`;
    const alerts = await tx`
      select l.campaign_id, c.objective, v.brief ->> 'title' as title, count(*)::int as unseen, max(a.created_at) as newest_at
      from public.performance_alerts a
      join public.launches l on l.id = a.launch_id
      join public.campaigns c on c.id = l.campaign_id
      left join public.brief_versions v on v.campaign_id = c.id and v.version = c.current_version
      where a.seen_at is null and l.status = 'live'
      group by l.campaign_id, c.objective, v.brief ->> 'title'`;
    return { approvals, alerts };
  });

  type Named = { campaign_id: string; title: string | null; objective: string };
  const ref = (r: Named) => ({ id: r.campaign_id, name: campaignName(r) });
  const waiting = approvals.map((a): HomeApproval => {
    if (a.kind === "brief_signoff") return { kind: "brief_signoff", approvalId: a.id, campaign: ref(a as unknown as Named), version: a.brief_version };
    if (a.kind === "launch") return { kind: "launch", approvalId: a.id, campaign: ref(a as unknown as Named) };
    return { kind: "run_choice", approvalId: a.id, runId: a.run_id, runLabel: a.run_label, question: a.question };
  });
  const perCampaign = alerts.map((r): CampaignAlerts => ({ campaign: ref(r as unknown as Named), unseen: r.unseen, newestAt: new Date(r.newest_at) }));
  return homeNeeds(waiting, perCampaign);
}
