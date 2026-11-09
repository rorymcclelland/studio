// The status a campaign shows in lists (U10-1, BUG-13): the state a person
// would act on, worked out from the campaign's own status, its brief version
// and its launches. Pure, so /campaigns, the brand page and the stage bar agree.

export type CampaignStatusFacts = {
  /** campaigns.status as stored; may be a value a later migration adds. */
  status: string;
  /** campaigns.current_version: 0 before the first brief. */
  currentVersion: number;
  /** Every launch of the campaign, any order. */
  launches: { status: string; simDay: number }[];
};

export const CAMPAIGN_STATUS_LABELS = {
  writing: "Writing the brief",
  draft: "Draft",
  waiting: "Waiting for sign-off",
  signedOff: "Signed off",
  launchWaiting: "Launch waiting",
  ended: "Ended",
} as const;

/** A live launch's label: its simulated day, or that no day has been simulated yet. */
export function liveLabel(simDay: number): string {
  return simDay > 0 ? `Live (simulated day ${simDay})` : "Live (simulated, before day 1)";
}

/**
 * A live launch, else a launch waiting for approval, else an ended launch;
 * then the brief's own state. Refused launches and launch statuses this code
 * doesn't know count for nothing; an unknown campaign status reads as Draft.
 */
export function campaignStatusLabel(facts: CampaignStatusFacts): string {
  const live = facts.launches.find((l) => l.status === "live");
  if (live) return liveLabel(live.simDay);
  if (facts.launches.some((l) => l.status === "awaiting_approval")) return CAMPAIGN_STATUS_LABELS.launchWaiting;
  if (facts.launches.some((l) => l.status === "ended")) return CAMPAIGN_STATUS_LABELS.ended;
  if (facts.status === "drafting" || facts.currentVersion === 0) return CAMPAIGN_STATUS_LABELS.writing;
  switch (facts.status) {
    case "awaiting_signoff":
      return CAMPAIGN_STATUS_LABELS.waiting;
    case "approved":
      return CAMPAIGN_STATUS_LABELS.signedOff;
    default:
      return CAMPAIGN_STATUS_LABELS.draft;
  }
}
