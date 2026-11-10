// U10-2 The campaign in stages: each stage's state in the stage bar, the
// locked stages' reasons, the overview's "Needs you" list, old links'
// fragments and the below-threshold line, worked out from a campaign's facts.
// Pure (it imports only ./status), so the overview, the stage pages and the
// stage bar say the same thing, and CI checks every combination
// (tests/lib/campaign-stages.test.ts). The facts are read once per page by
// campaignFacts() in ./facts.
import { CAMPAIGN_STATUS_LABELS, liveLabel } from "./status";

export type StageId = "brief" | "audience" | "creative" | "launch" | "performance";

export const STAGES: { id: StageId; name: string }[] = [
  { id: "brief", name: "Brief" },
  { id: "audience", name: "Audience" },
  { id: "creative", name: "Creative" },
  { id: "launch", name: "Launch" },
  { id: "performance", name: "Performance" },
];

export function stageHref(campaignId: string, stage: StageId): string {
  return `/campaigns/${campaignId}/${stage}`;
}

/** A campaign's facts; it satisfies U10-1's CampaignStatusFacts (./status), so campaignStatusLabel(facts) is the overview's state. */
export type CampaignFacts = {
  campaignId: string;
  /** campaigns.status as stored; maybe one this code doesn't know. */
  status: string;
  /** 0 before the first brief. */
  currentVersion: number;
  approvedVersion: number | null;
  /** The latest brief-writing run's status, null if none. */
  briefRun: string | null;
  /** The pending sign-off's brief version. */
  signoffOpen: number | null;
  /** Brief versions kept. */
  versions: number;
  /** Personas in the latest review (any version), a test plan exists, a persona or test plan run in progress. */
  audience: { personas: number; testPlan: boolean; running: boolean };
  /** Current ads, picked ones, Make creative running, discarded ads and word sets, creative runs, their total cost. */
  creative: { ads: number; picked: number; running: boolean; discarded: number; runs: number; costPence: number };
  /** Picked ads of the signed-off version whose compliance waits for a person. */
  toDecide: number;
  /** The ads a launch would hold now (0 when it refuses). */
  launchable: number;
  /** Every launch, newest first. */
  launches: { status: string; simDay: number; days: number }[];
  /** For the launch the Performance page shows (live, else the newest ended): unseen alerts and the ads below the threshold. */
  performance: { unseenAlerts: number; belowThreshold: number[] } | null;
};

export type StageLock = { reason: string; href: string; link: string };

export type StageView = {
  id: StageId;
  name: string;
  href: string;
  /** The stage's state in a word or a count (at most 30 characters). */
  label: string;
  locked: StageLock | null;
};

export type NeedView = {
  id: "send-signoff" | "decide-signoff" | "compliance" | "approve-launch" | "alerts" | "clock";
  text: string;
  href: string;
};

export const NOTHING_NEEDS_YOU = "Nothing needs you right now.";

const KNOWN_LAUNCH = new Set(["awaiting_approval", "live", "ended", "refused"]);
const WRITING_RUN = new Set(["queued", "running", "completed"]);

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Launches of a status this code knows, in the order given. */
const knownLaunches = (f: CampaignFacts) => f.launches.filter((l) => KNOWN_LAUNCH.has(l.status));

const isWriting = (f: CampaignFacts) => f.status === "drafting" || f.currentVersion === 0;
const isSignedOff = (f: CampaignFacts) => f.status === "approved" && f.approvedVersion !== null;

/** Whether the Performance page has a launch to show: one live or ended. */
const hasResults = (f: CampaignFacts) => knownLaunches(f).some((l) => l.status === "live" || l.status === "ended");

function briefStage(f: CampaignFacts): Pick<StageView, "label" | "locked"> {
  if (isWriting(f)) return { label: f.briefRun && WRITING_RUN.has(f.briefRun) ? CAMPAIGN_STATUS_LABELS.writing : "Not written", locked: null };
  if (f.status === "awaiting_signoff") return { label: CAMPAIGN_STATUS_LABELS.waiting, locked: null };
  if (isSignedOff(f)) return { label: CAMPAIGN_STATUS_LABELS.signedOff, locked: null };
  return { label: CAMPAIGN_STATUS_LABELS.draft, locked: null };
}

function audienceStage(f: CampaignFacts): Pick<StageView, "label" | "locked"> {
  if (isWriting(f)) {
    return {
      label: "After the brief",
      locked: { reason: "Personas and the test plan come once the brief is written.", href: stageHref(f.campaignId, "brief"), link: "Go to the brief" },
    };
  }
  const a = f.audience;
  if (a.running) return { label: "Being written", locked: null };
  if (a.personas === 0 && !a.testPlan) return { label: "Not run yet", locked: null };
  if (a.personas === 0) return { label: "Test plan", locked: null };
  return { label: `${count(a.personas, "persona")}${a.testPlan ? ", test plan" : ""}`, locked: null };
}

function creativeStage(f: CampaignFacts): Pick<StageView, "label" | "locked"> {
  if (!isSignedOff(f)) {
    return {
      label: "After sign-off",
      locked: { reason: "Creative is made only from a signed-off brief.", href: stageHref(f.campaignId, "brief"), link: "Sign off the brief" },
    };
  }
  const c = f.creative;
  if (c.running) return { label: "Making ads", locked: null };
  if (c.ads === 0) return { label: "No ads yet", locked: null };
  return { label: `${count(c.ads, "ad")}, ${c.picked} picked`, locked: null };
}

function launchStage(f: CampaignFacts): Pick<StageView, "label" | "locked"> {
  const known = knownLaunches(f);
  const live = known.find((l) => l.status === "live");
  if (live) return { label: liveLabel(live.simDay), locked: null };
  if (known.some((l) => l.status === "awaiting_approval")) return { label: "Waiting for approval", locked: null };
  if (known.some((l) => l.status === "ended")) return { label: "Ended", locked: null };
  const signedOff = isSignedOff(f);
  if (signedOff && f.launchable > 0) return { label: `${count(f.launchable, "ad")} ready`, locked: null };
  if (known.some((l) => l.status === "refused")) return { label: "Refused", locked: null };
  const creative = stageHref(f.campaignId, "creative");
  return {
    label: "No ads ready",
    locked: !signedOff
      ? { reason: "A launch needs a signed-off brief and picked ads that pass compliance.", href: stageHref(f.campaignId, "brief"), link: "Sign off the brief" }
      : f.toDecide > 0
        ? { reason: "A launch needs picked ads that pass compliance or were accepted.", href: `${creative}?show=decide`, link: "Decide compliance" }
        : { reason: "A launch needs picked ads that pass compliance or were accepted.", href: creative, link: "Pick ads in Creative" },
  };
}

function performanceStage(f: CampaignFacts): Pick<StageView, "label" | "locked"> {
  if (!hasResults(f)) {
    return {
      label: "After launch",
      locked: { reason: "Performance shows once a launch is live (simulated).", href: stageHref(f.campaignId, "launch"), link: "Go to Launch" },
    };
  }
  const n = f.performance?.unseenAlerts ?? 0;
  return { label: n === 0 ? "No new alerts" : `${count(n, "new alert")}`, locked: null };
}

const STAGE_STATE: Record<StageId, (f: CampaignFacts) => Pick<StageView, "label" | "locked">> = {
  brief: briefStage,
  audience: audienceStage,
  creative: creativeStage,
  launch: launchStage,
  performance: performanceStage,
};

/** Each stage, in order, with its state and, when it can't be used yet, why and what unlocks it. */
export function campaignStages(f: CampaignFacts): StageView[] {
  return STAGES.map((s) => ({ id: s.id, name: s.name, href: stageHref(f.campaignId, s.id), ...STAGE_STATE[s.id](f) }));
}

/** What needs a person on this campaign, in the refinement's order; each links to where it is done. */
export function needsYou(f: CampaignFacts): NeedView[] {
  const out: NeedView[] = [];
  const brief = stageHref(f.campaignId, "brief");
  if (f.status === "draft" && f.currentVersion > 0 && f.signoffOpen === null) {
    out.push({ id: "send-signoff", text: `Send version ${f.currentVersion} for sign-off`, href: brief });
  }
  if (f.signoffOpen !== null) out.push({ id: "decide-signoff", text: `Decide the sign-off of version ${f.signoffOpen}`, href: brief });
  if (isSignedOff(f) && f.toDecide > 0) {
    out.push({ id: "compliance", text: `Decide compliance for ${count(f.toDecide, "picked ad")}`, href: `${stageHref(f.campaignId, "creative")}?show=decide` });
  }
  const known = knownLaunches(f);
  if (known.some((l) => l.status === "awaiting_approval")) out.push({ id: "approve-launch", text: "Approve or refuse the launch (simulated)", href: "/approvals" });
  const live = known.find((l) => l.status === "live");
  if (live) {
    const unseen = f.performance?.unseenAlerts ?? 0;
    if (unseen > 0) out.push({ id: "alerts", text: `${count(unseen, "unseen alert")} (simulated)`, href: stageHref(f.campaignId, "performance") });
    if (live.simDay < live.days) {
      out.push({
        id: "clock",
        text: live.simDay === 0 ? `Run the first simulated day of ${live.days}` : `Move the simulated clock on from day ${live.simDay} of ${live.days}`,
        href: stageHref(f.campaignId, "launch"),
      });
    }
  }
  return out;
}

/** "Ad 3 is below the threshold (simulated).", for the ads below it on the latest simulated day; null for none. */
export function belowThresholdLine(adNumbers: number[]): string | null {
  if (adNumbers.length === 0) return null;
  if (adNumbers.length === 1) return `Ad ${adNumbers[0]} is below the threshold (simulated).`;
  const list = `${adNumbers.slice(0, -1).join(", ")} and ${adNumbers.at(-1)}`;
  return `Ads ${list} are below the threshold (simulated).`;
}

const HASH_STAGE: Record<string, StageId> = {
  brief: "brief",
  signoff: "brief",
  history: "brief",
  personas: "audience",
  "test-plan": "audience",
  creative: "creative",
  discarded: "creative",
  "creative-runs": "creative",
  launch: "launch",
  performance: "performance",
};

/** The stage an old link's fragment (a section of the one-page campaign) is on now; null for anything else. */
export function stageForHash(hash: string): StageId | null {
  const key = hash.startsWith("#") ? hash.slice(1) : hash;
  return Object.hasOwn(HASH_STAGE, key) ? HASH_STAGE[key] : null;
}
