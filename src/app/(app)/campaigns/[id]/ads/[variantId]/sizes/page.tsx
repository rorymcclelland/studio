import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { adSizes } from "@/lib/creative/ad-sizes";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { SizesView } from "./sizes-view";

// C7-1: one ad in every size of its channel. The sizes are drawn here (or
// recalled from the drawings cache), so the thumbnails it lists are answered
// without drawing again. Another workspace's ad, or one from another
// campaign, is a 404 (rule 7).

async function SizesPageContent(props: PageProps<"/campaigns/[id]/ads/[variantId]/sizes">) {
  const { id, variantId } = await props.params;
  const member = await requireMember();
  const view = await adSizes(member.userId, variantId);
  if (!view || view.campaignId !== id) notFound();
  const simulated = view.sizes.some((s) => s.ok && s.badges.some((b) => b.key === "simulated"));
  return (
    <div className="space-y-8">
      <div>
        <TextLink href={`/campaigns/${id}#creative`}>
          <span aria-hidden>← </span>Back to the campaign
        </TextLink>
        <Card size="hero" className="mt-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-medium text-ink-2">
            <span>{view.channel === "display" ? "Display ad" : "Paid-social ad"}</span>
            {simulated && <Pill tone="review">Simulated image</Pill>}
          </p>
          <h1 className="mt-3 text-title font-strong wrap-anywhere">{view.headline}</h1>
          <p className="mt-3 max-w-prose text-ink-2">
            Each size is drawn in code from the same picture, words, logo and legal lines, and checked for contrast and fit on
            its own. Open a size to see it full size.
          </p>
        </Card>
      </div>
      <SizesView sizes={view.sizes} adLabel={`The ad "${view.headline}"`} />
    </div>
  );
}

export default function SizesPage(props: PageProps<"/campaigns/[id]/ads/[variantId]/sizes">) {
  return (
    <Suspense fallback={<PageSkeleton label="Drawing the sizes" />}>
      <SizesPageContent {...props} />
    </Suspense>
  );
}
