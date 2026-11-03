import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { adSizes } from "@/lib/creative/ad-sizes";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { SizesView } from "./sizes-view";

// C7-1: one ad in every size of its channel. The sizes are drawn here (or
// recalled from the drawings cache), so the thumbnails it lists are answered
// without drawing again. Another workspace's ad, or one from another
// campaign, is a 404 (rule 7).

async function SizesPageContent(props: PageProps<"/campaigns/[id]/ads/[variantId]/sizes">) {
  const { id, variantId } = await props.params;
  const { lang } = await props.searchParams;
  const member = await requireMember();
  // C7-2: ?lang=de-DE shows the ad's German words in every size; a language it has no translation in is a 404.
  const view = await adSizes(member.userId, variantId, typeof lang === "string" ? lang : null);
  if (!view || view.campaignId !== id) notFound();
  const simulated = view.sizes.some((s) => s.ok && s.badges.some((b) => b.key === "simulated"));
  const base = `/campaigns/${id}/ads/${variantId}/sizes`;
  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <TextLink href={`/campaigns/${id}#creative`}>
            <span aria-hidden>← </span>Back to the campaign
          </TextLink>
          <TextLink href={`/campaigns/${id}/ads/${variantId}/compliance`}>Compliance of this ad</TextLink>
        </div>
        <Card size="hero" className="mt-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-medium text-ink-2">
            <span>
              {view.channel === "display" ? "Display ad" : "Paid-social ad"}, in {view.langName}
            </span>
            {simulated && <Pill tone="review">Simulated image</Pill>}
            {view.machineTranslation && <Pill tone="review">{view.machineTranslation.label}</Pill>}
          </p>
          <h1 className="mt-3 text-title font-strong wrap-anywhere" lang={view.lang}>
            {view.headline}
          </h1>
          <p className="mt-3 max-w-prose text-ink-2">
            Each size is drawn in code from the same picture, words, logo and legal lines, and checked for contrast and fit on
            its own. Open a size to see it full size.
          </p>
          {view.machineTranslation && (
            <p className="mt-3 max-w-prose rounded-field bg-review-soft px-4 py-3 text-review-ink" data-machine-translation="">
              <span className="font-semibold">{view.machineTranslation.label}.</span> {view.machineTranslation.detail}
            </p>
          )}
          {view.languages.length > 1 && (
            <nav aria-label="Languages of this ad" className="mt-4">
              <ul className="flex flex-wrap gap-2">
                {view.languages.map((l) => {
                  const current = l.lang === view.lang;
                  return (
                    <li key={l.lang}>
                      <Link
                        href={l.lang === "en-GB" ? base : `${base}?lang=${l.lang}`}
                        aria-current={current ? "page" : undefined}
                        className={cx(
                          "inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                          current ? "bg-primary text-on-primary" : "bg-surface-2 text-ink hover:bg-primary-soft",
                        )}
                      >
                        {l.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </Card>
      </div>
      <SizesView sizes={view.sizes} adLabel={`The ad "${view.headline}"${view.lang === "en-GB" ? "" : ` in ${view.langName}`}`} />
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
