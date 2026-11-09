// U10-2: the Creative stage. The gallery and its checks (languages,
// compliance with "Accept for every picked ad", pre-test, picture checks), the
// launch pack, the words for other channels, and the discarded ads and the
// runs as one line each until opened. Moved here from the one-page campaign as
// they were. Locked until the brief is signed off: creative is made only from
// a signed-off brief. ?show= is U10-3's gallery filter; until then every ad is
// shown.
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { packSummary } from "@/lib/creative/pack";
import { campaignOr404, LockedStage, lockOf, StageHeader } from "../campaign-frame";
import { CreativeSection } from "../creative-section";

async function CreativeStageContent(props: PageProps<"/campaigns/[id]/creative">) {
  const { id } = await props.params;
  const { data } = await campaignOr404(id);
  const lock = lockOf(data, "creative");
  const { creative, plan, compliance } = data;
  const hasAds = !!creative && creative.signedOff && creative.variants.length > 0;
  return (
    <div className="space-y-6">
      <StageHeader data={data} current="creative" />
      {lock ? (
        <LockedStage lock={lock} />
      ) : (
        creative && (
          <CreativeSection
            view={creative}
            pack={hasAds && plan ? Promise.resolve(packSummary(plan)) : null}
            compliance={hasAds && compliance ? Promise.resolve(compliance) : null}
          />
        )
      )}
    </div>
  );
}

export default function CreativeStagePage(props: PageProps<"/campaigns/[id]/creative">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the creative" />}>
      <CreativeStageContent {...props} />
    </Suspense>
  );
}
