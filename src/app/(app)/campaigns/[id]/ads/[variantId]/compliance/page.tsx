import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { adCompliance } from "@/lib/compliance/compute";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ComplianceView, CompliancePillView } from "./compliance-view";

// C8-1: one ad's compliance, beside its Sizes view. Worked out on request
// (no model, no cost) from the ad and the brand's kit as it is now. Another
// workspace's ad, one from another campaign, or a malformed id is a 404
// (rule 7).

async function CompliancePageContent(props: PageProps<"/campaigns/[id]/ads/[variantId]/compliance">) {
  const { id, variantId } = await props.params;
  const member = await requireMember();
  const ad = await adCompliance(member.userId, variantId);
  if (!ad || ad.campaignId !== id) notFound();
  const drawn = ad.items.filter((i) => !i.refused);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <TextLink href={`/campaigns/${id}/creative`}>
            <span aria-hidden>← </span>Back to Creative
          </TextLink>
          <TextLink href={`/campaigns/${id}/ads/${variantId}/sizes`}>Sizes of this ad</TextLink>
        </div>
        <Card size="hero" className="mt-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-medium text-ink-2">
            <span>{ad.channel === "display" ? "Display ad" : "Paid-social ad"}: compliance</span>
            <span data-compliance-pill="">
              <CompliancePillView pill={ad.pill} />
            </span>
          </p>
          <h1 className="mt-3 text-title font-strong wrap-anywhere">{ad.headline}</h1>
          <p className="mt-3 max-w-prose text-ink-2" data-compliance-count="">
            {plural(drawn.length, "drawn file")}: {ad.files.pass} {ad.files.pass === 1 ? "passes" : "pass"}, {ad.files.review} to review, {ad.files.fail}{" "}
            {ad.files.fail === 1 ? "fails" : "fail"}. A file goes in the launch pack only when it passes every rule, or a person has
            accepted each item that needs review.
          </p>
          <p className="mt-3 max-w-prose text-sm text-ink-2">
            Checked in code against the brand&apos;s kit as it is now, at no cost. Only the picture&apos;s items come from AI (the
            check made when the picture was drawn), and each says so. The thresholds are Studio&apos;s own defaults, not any
            platform&apos;s policy. A suggested fix is only a suggestion: nothing here changes the ad.
          </p>
        </Card>
      </div>
      <ComplianceView ad={ad} campaignId={id} />
    </div>
  );
}

export default function CompliancePage(props: PageProps<"/campaigns/[id]/ads/[variantId]/compliance">) {
  return (
    <Suspense fallback={<PageSkeleton label="Checking the ad" />}>
      <CompliancePageContent {...props} />
    </Suspense>
  );
}
