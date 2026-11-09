// U10-2: what the campaign's overview and stage pages share. Each page loads
// the campaign once (loadCampaign, through asUser(): another workspace's or a
// malformed id is the not-found page), shows the same header with the title as
// its h1, and the stage bar under it. A stage that can't be used yet says why
// in one line, with a link to the step that unlocks it.
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { loadCampaign, type CampaignData } from "@/lib/campaigns/facts";
import { campaignStages, type StageId, type StageLock } from "@/lib/campaigns/stages";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { StageBar } from "./stage-bar";

/** The signed-in member and the campaign, or the not-found page. */
export async function campaignOr404(id: string) {
  const member = await requireMember();
  const data = await loadCampaign(member.userId, id);
  if (!data) notFound();
  return { member, data };
}

/** The campaign's title: the brief's, else its objective while the brief is being written. */
export const campaignTitle = (data: CampaignData) => data.campaign.brief?.title ?? data.campaign.objective;

/** The brand line above a campaign's title, with the simulated-data label (rule 1). */
export function BrandLine({ data }: { data: CampaignData }) {
  const brand = data.campaign.brand;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-medium text-ink-2">
      <TextLink href={`/brands/${brand.id}`}>{brand.name}</TextLink>
      {brand.isSimulated && <Pill tone="review">Simulated data</Pill>}
    </p>
  );
}

/** A stage page's top: the way back to the overview, the header card and the stage bar with this stage current. */
export function StageHeader({ data, current, children }: { data: CampaignData; current: StageId; children?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <TextLink href={`/campaigns/${data.campaign.id}`} data-campaign-overview="">
          <span aria-hidden>← </span>Overview
        </TextLink>
        <Card className="mt-3">
          <BrandLine data={data} />
          <h1 className="mt-2 text-title font-strong wrap-anywhere">{campaignTitle(data)}</h1>
          {children}
        </Card>
      </div>
      <StageBar stages={campaignStages(data.facts)} current={current} />
    </div>
  );
}

/** The lock of a stage, or null when it can be used. */
export function lockOf(data: CampaignData, stage: StageId): StageLock | null {
  return campaignStages(data.facts).find((s) => s.id === stage)?.locked ?? null;
}

/** A stage that isn't reachable yet: why, in one sentence, and the step that unlocks it. Not an error. */
export function LockedStage({ lock }: { lock: StageLock }) {
  return (
    <Card data-stage-locked="">
      <p className="max-w-prose">
        {lock.reason} <TextLink href={lock.href}>{lock.link}</TextLink>
      </p>
    </Card>
  );
}
