// U10-2: the Launch stage. The Launch (simulated) panel, moved here from the
// Creative section as it was: what would launch, Ask to launch, the launch
// waiting in the inbox (rule 3), the simulated clock, End the launch, the link
// to Performance and the earlier launches. Locked until a launch has picked
// ads that pass compliance (or one has been asked for): the reason says what
// unlocks it.
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { campaignOr404, LockedStage, lockOf, StageHeader } from "../campaign-frame";
import { LaunchPanel } from "../launch-panel";

async function LaunchStageContent(props: PageProps<"/campaigns/[id]/launch">) {
  const { id } = await props.params;
  const { data } = await campaignOr404(id);
  const lock = lockOf(data, "launch");
  const { creative, eligibility, launches } = data;
  return (
    <div className="space-y-6">
      <StageHeader data={data} current="launch" />
      {lock ? (
        <LockedStage lock={lock} />
      ) : creative && eligibility ? (
        <LaunchPanel data={Promise.resolve({ eligibility, launches })} view={creative} />
      ) : (
        <Card tone="attention" className="bg-attention-soft">
          <p className="max-w-prose">The launch couldn&apos;t be worked out just now, so nothing is shown. Reload the page to try again.</p>
        </Card>
      )}
    </div>
  );
}

export default function LaunchStagePage(props: PageProps<"/campaigns/[id]/launch">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the launch" />}>
      <LaunchStageContent {...props} />
    </Suspense>
  );
}
