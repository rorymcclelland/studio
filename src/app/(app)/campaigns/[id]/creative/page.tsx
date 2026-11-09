// U10-2: the Creative stage. The gallery and its checks (languages,
// compliance with "Accept for every picked ad", pre-test, picture checks), the
// launch pack, the words for other channels, and the discarded ads and the
// runs as one line each until opened. Locked until the brief is signed off:
// creative is made only from a signed-off brief. U10-3: ?show= (All, Picked,
// Needs a decision, Launched) and ?audience= choose what the gallery shows, so
// a reload or a shared link opens the same view and the overview's "Decide
// compliance" link (?show=decide) opens on the ads that need it.
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { factsFor, parseAudience, parseShow } from "@/lib/creative/gallery-filter";
import { packSummary } from "@/lib/creative/pack";
import { campaignOr404, LockedStage, lockOf, StageHeader } from "../campaign-frame";
import { CreativeSection } from "../creative-section";

async function CreativeStageContent(props: PageProps<"/campaigns/[id]/creative">) {
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  const { data } = await campaignOr404(id);
  const lock = lockOf(data, "creative");
  const { creative, plan, compliance } = data;
  const hasAds = !!creative && creative.signedOff && creative.variants.length > 0;
  // An audience can be chosen only when there are several; anything else reads as every audience.
  const refs = creative && creative.audiences.length > 1 ? creative.audiences.flatMap((g) => (g.segmentRef ? [g.segmentRef] : [])) : [];
  const gallery = creative
    ? { show: parseShow(query.show), audience: parseAudience(query.audience, refs), facts: factsFor(creative.variants, creative.version, compliance?.pills ?? {}) }
    : null;
  return (
    <div className="space-y-6">
      <StageHeader data={data} current="creative" />
      {lock ? (
        <LockedStage lock={lock} />
      ) : (
        creative &&
        gallery && (
          <CreativeSection
            view={creative}
            pack={hasAds && plan ? Promise.resolve(packSummary(plan)) : null}
            compliance={hasAds && compliance ? Promise.resolve(compliance) : null}
            gallery={gallery}
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
