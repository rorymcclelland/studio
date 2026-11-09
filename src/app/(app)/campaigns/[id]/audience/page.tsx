// U10-2: the Audience stage. The persona review and the test plan, moved here
// from the one-page campaign as they were. Locked while the brief is being
// written: there is nothing for the personas to read yet.
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { campaignOr404, LockedStage, lockOf, StageHeader } from "../campaign-frame";
import { PersonasSection, TestPlanSection } from "../review-sections";

async function AudienceStageContent(props: PageProps<"/campaigns/[id]/audience">) {
  const { id } = await props.params;
  const { data } = await campaignOr404(id);
  const lock = lockOf(data, "audience");
  const { campaign, reviews } = data;
  return (
    <div className="space-y-6">
      <StageHeader data={data} current="audience" />
      {lock ? (
        <LockedStage lock={lock} />
      ) : (
        <>
          <PersonasSection campaignId={campaign.id} currentVersion={campaign.currentVersion} reviews={reviews} />
          <TestPlanSection campaignId={campaign.id} currentVersion={campaign.currentVersion} reviews={reviews} />
        </>
      )}
    </div>
  );
}

export default function AudienceStagePage(props: PageProps<"/campaigns/[id]/audience">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the audience" />}>
      <AudienceStageContent {...props} />
    </Suspense>
  );
}
