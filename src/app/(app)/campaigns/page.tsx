import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/repo";
import { listCampaignsPage, OBJECTIVE_MAX, OBJECTIVE_MIN, type CampaignSummary } from "@/lib/brief/repo";
import { CAMPAIGN_STATUS_FILTERS, campaignFilterNote, campaignsHref, parseCampaignFilters } from "@/lib/campaigns/list-filters";
import { AutoRefresh } from "@/components/auto-refresh";
import { ListFilters } from "@/components/list-filters";
import { ButtonLink, TextLink } from "@/components/ui/button";
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

async function CampaignsPageContent({ searchParams }: { searchParams: PageProps<"/campaigns">["searchParams"] }) {
  const parsed = parseCampaignFilters(await searchParams);
  const member = await requireMember();
  const [brands, page] = await Promise.all([
    listBrands(member.userId, member.workspaceId),
    listCampaignsPage(member.userId, { filters: parsed.filters, before: parsed.before }),
  ]);
  const { campaigns, older } = page;
  // The page's own check (a brand that isn't the reader's) joins the address's.
  const ignored = (["brand", "status"] as const).filter((k) => parsed.ignored.includes(k) || page.ignored.includes(k));
  const filters = { ...parsed.filters, brand: page.ignored.includes("brand") ? null : parsed.filters.brand };
  const filtered = filters.brand !== null || filters.status !== null;
  const note = campaignFilterNote(ignored);
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
        <p className="mt-1 text-ink-2">Most recently changed first.</p>
        {(campaigns.length > 0 || filtered || note) && (
          <ListFilters
            action="/campaigns"
            label="Filter campaigns"
            data-campaign-filters=""
            className="mt-4"
            gridClass="grid-cols-2 sm:max-w-xl"
            // With no campaign matching, Clear filters is the empty state's own action instead.
            clearHref={filtered && campaigns.length > 0 ? "/campaigns" : null}
            selects={[
              { name: "brand", label: "Brand", all: "All brands", options: brands.map((b) => ({ value: b.id, label: b.name })), value: filters.brand ?? "" },
              { name: "status", label: "Status", all: "All statuses", options: CAMPAIGN_STATUS_FILTERS.map((st) => ({ value: st.id, label: st.label })), value: filters.status ?? "" },
            ]}
          />
        )}
        {note && (
          <p className="mt-3 text-sm font-medium text-ink" role="status" data-campaigns-filter-note="">
            {note}
          </p>
        )}
        {campaigns.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No campaigns match these filters"
              className="mt-4"
              action={
                <ButtonLink href="/campaigns" variant="quiet" size="sm">
                  Clear filters
                </ButtonLink>
              }
            >
              Try another brand or status, or clear the filters to see every campaign.
            </EmptyState>
          ) : (
            <EmptyState title="No campaigns yet" className="mt-4">
              {brands.length === 0
                ? "Campaigns appear here once you have a brand to write them for."
                : "Write your first brief above. It appears here as soon as the Brief agent starts."}
            </EmptyState>
          )
        ) : (
          <div className="mt-4">
            <CampaignList campaigns={campaigns} label="Campaigns, most recently changed first" />
          </div>
        )}
        {(older || parsed.before) && (
          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            {older && (
              <ButtonLink href={campaignsHref(filters, older)} variant="quiet" data-older-campaigns="">
                Older campaigns
              </ButtonLink>
            )}
            {parsed.before && <TextLink href={campaignsHref(filters)}>Back to the newest campaigns</TextLink>}
          </p>
        )}
      </section>
    </div>
  );
}

export default function CampaignsPage(props: PageProps<"/campaigns">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading campaigns" />}>
      <CampaignsPageContent searchParams={props.searchParams} />
    </Suspense>
  );
}
