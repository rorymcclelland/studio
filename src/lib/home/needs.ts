// U10-5 Home leads with work: what home's "Needs you" lists, in what order,
// each item's words and where it links, worked out from the facts
// src/lib/home/work.ts reads. Pure (it imports only the stage and health
// modules), so CI checks every combination (tests/lib/home-work.test.ts).
// Home only links to where a decision is made; Approve stays in the inbox and
// on its stage (rule 3). Every figure keeps its simulated label (rule 1).
import { NOTHING_NEEDS_YOU } from "@/lib/campaigns/stages";
import { shareText } from "@/lib/performance/health";

export { NOTHING_NEEDS_YOU };

export const NO_CAMPAIGN = "No campaign";
export const HOME_TITLE = "Home";
export const LIVE_HEADING = "Live campaigns";

export type CampaignRef = { id: string; name: string };

/** A campaign's name, as the campaigns list gives it: its brief's title, else its objective. */
export function campaignName(c: { title: string | null; objective: string }): string {
  return c.title?.trim() || c.objective;
}

export type HomeApproval =
  | { kind: "brief_signoff"; approvalId: string; campaign: CampaignRef; version: number }
  | { kind: "launch"; approvalId: string; campaign: CampaignRef }
  | { kind: "run_choice"; approvalId: string; runId: string; runLabel: string | null; question: string };

export type CampaignAlerts = { campaign: CampaignRef; unseen: number; newestAt: Date };

export type HomeNeedKind = "decide-signoff" | "approve-launch" | "run-choice" | "alerts";

export type HomeNeed = { key: string; kind: HomeNeedKind; text: string; href: string; campaignId: string | null };

function approvalNeed(a: HomeApproval): HomeNeed {
  switch (a.kind) {
    case "brief_signoff":
      return {
        key: `decide-signoff:${a.approvalId}`,
        kind: "decide-signoff",
        text: `Decide the sign-off of version ${a.version}: ${a.campaign.name}`,
        href: `/campaigns/${a.campaign.id}/brief`,
        campaignId: a.campaign.id,
      };
    case "launch":
      return {
        key: `approve-launch:${a.approvalId}`,
        kind: "approve-launch",
        text: `Approve or refuse the launch (simulated): ${a.campaign.name}`,
        href: `/approvals#approval-${a.approvalId}`,
        campaignId: a.campaign.id,
      };
    case "run_choice":
      return {
        key: `run-choice:${a.approvalId}`,
        kind: "run-choice",
        text: `Choose on the run: ${a.runLabel?.trim() || a.question}`,
        href: `/runs/${a.runId}`,
        campaignId: null,
      };
  }
}

function alertsNeed(a: CampaignAlerts): HomeNeed {
  return {
    key: `alerts:${a.campaign.id}`,
    kind: "alerts",
    text: `${a.unseen} unseen ${a.unseen === 1 ? "alert" : "alerts"} (simulated): ${a.campaign.name}`,
    href: `/campaigns/${a.campaign.id}/performance`,
    campaignId: a.campaign.id,
  };
}

/**
 * Every approval in the order given (the inbox's: newest first), then one item
 * per campaign with unseen alerts, newest alert first, then by campaign id.
 */
export function homeNeeds(approvals: readonly HomeApproval[], alerts: readonly CampaignAlerts[]): HomeNeed[] {
  const withAlerts = alerts
    .filter((a) => a.unseen > 0)
    .sort((x, y) => y.newestAt.getTime() - x.newestAt.getTime() || (x.campaign.id < y.campaign.id ? -1 : x.campaign.id > y.campaign.id ? 1 : 0));
  return [...approvals.map(approvalNeed), ...withAlerts.map(alertsNeed)];
}

/** "Healthy spend share: 84% (simulated)", a live campaign's own share on home. */
export function liveShareLine(share: number | null): string {
  return `Healthy spend share: ${shareText(share)} (simulated)`;
}
