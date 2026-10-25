import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/repo";
import { listCampaigns, OBJECTIVE_MAX, OBJECTIVE_MIN, type CampaignSummary } from "@/lib/brief/repo";
import { AutoRefresh } from "@/components/auto-refresh";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { CampaignList } from "./campaign-list";
import { NewCampaignForm } from "./new-campaign-form";

export const metadata = { title: "Campaigns" };

/**
 * A brief takes under a minute; a campaign still without one after ten has
 * stopped (its page says why), so the list stops refreshing for it.
 */
function stillDrafting(c: CampaignSummary): boolean {
  return c.currentVersion === 0 && Date.now() - new Date(c.updatedAt).getTime() < 10 * 60_000;
}

async function CampaignsPageContent() {
  const member = await requireMember();
  const [brands, campaigns] = await Promise.all([listBrands(member.userId, member.workspaceId), listCampaigns(member.userId)]);
  const drafting = campaigns.some(stillDrafting);
  return (
    <div className="space-y-10">
      {/* A brief being written moves to "Draft v1" on its own. */}
      <AutoRefresh active={drafting} intervalMs={3000} />
      <div>
        <h1 className="text-title font-strong">Campaigns</h1>
        <p className="mt-2 max-w-prose text-lg text-ink-2">
          Each campaign starts from an objective. The Brief agent writes an evidenced brief from the brand&apos;s context,
          and you edit it by hand or ask for changes.
        </p>
      </div>

      {brands.length === 0 ? (
        <EmptyState
          title="Add a brand first"
          headingLevel={2}
          action={
            <ButtonLink href="/brands" size="sm">
              Go to brands
            </ButtonLink>
          }
        >
          A campaign belongs to a brand, and the brief is written from that brand&apos;s kit, products and customers. Add
          the demo brands on the Brands page to try it.
        </EmptyState>
      ) : (
        <Card as="section" tone="primary" aria-labelledby="new-campaign">
          <h2 id="new-campaign" className="text-2xl font-strong tracking-tight">
            New campaign
          </h2>
          <p className="mt-1 max-w-prose text-ink-2">
            The Brief agent reads the brand&apos;s context store and writes the brief. This usually takes under a minute.
          </p>
          <NewCampaignForm
            brands={brands.map((b) => ({ id: b.id, name: b.name }))}
            limits={{ min: OBJECTIVE_MIN, max: OBJECTIVE_MAX }}
          />
        </Card>
      )}

      <section aria-labelledby="all-campaigns">
        <h2 id="all-campaigns" className="text-2xl font-strong tracking-tight">
          All campaigns
        </h2>
        {campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet" className="mt-4">
            {brands.length === 0
              ? "Campaigns appear here once you have a brand to write them for."
              : "Write your first brief above. It appears here as soon as the Brief agent starts."}
          </EmptyState>
        ) : (
          <>
            <p className="mt-1 text-ink-2">Newest first.</p>
            <div className="mt-4">
              <CampaignList campaigns={campaigns} label="Campaigns, newest first" />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading campaigns" />}>
      <CampaignsPageContent />
    </Suspense>
  );
}
