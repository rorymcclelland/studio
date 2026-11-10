import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listRunsPage, runTitle } from "@/lib/agents/runs";
import { costHeading, filterNote, parseRunFilters, RUN_STATUSES, runCostText, runsHref } from "@/lib/agents/run-list";
import { AGENTS } from "@/lib/agents/registry";
import { WORKFLOW_NAMES } from "@/lib/agents/workflows";
import { listCampaignOptions } from "@/lib/brief/repo";
import { NO_CAMPAIGN } from "@/lib/home/needs";
import { StatusBadge, ACTIVE_STATUSES, statusText } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { ListFilters } from "@/components/list-filters";
import { ButtonLink, TextLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatWhen } from "@/lib/format";
import { SimulatedCostNote } from "@/components/simulated-cost-note";
import { agentDisplayName, knownAgentName } from "@/lib/agents/names";

export const metadata = { title: "Agent runs" };

/** Every agent and workflow key a run can have, for the Agent filter. */
const AGENT_KEYS = [...Object.keys(AGENTS), ...Object.keys(WORKFLOW_NAMES)];

async function RunsPageContent({ searchParams }: { searchParams: PageProps<"/runs">["searchParams"] }) {
  const parsed = parseRunFilters(await searchParams, AGENT_KEYS);
  const member = await requireMember();
  const [page, campaigns] = await Promise.all([
    listRunsPage(member.userId, { filters: parsed.filters, before: parsed.before }),
    listCampaignOptions(member.userId, parsed.filters.campaign),
  ]);
  const { runs, older } = page;
  // The page's own check (a campaign that isn't the reader's) joins the address's.
  const ignored = [...new Set([...parsed.ignored, ...page.ignored])].sort((a, b) => order(a) - order(b));
  const filters = { ...parsed.filters, campaign: page.ignored.includes("campaign") ? null : parsed.filters.campaign };
  const filtered = filters.campaign !== null || filters.agent !== null || filters.status !== null;
  const note = filterNote(ignored);
  const heading = costHeading(runs);
  const anyActive = runs.some((r) => ACTIVE_STATUSES.has(r.status));

  return (
    <div>
      <AutoRefresh active={anyActive} intervalMs={3000} />
      <h1 className="text-title font-strong">Agent runs</h1>
      <p className="mt-2 text-lg text-ink-2">Every run in your workspace, newest first. Filter by campaign, agent or status.</p>

      <ListFilters
        action="/runs"
        label="Filter runs"
        data-run-filters=""
        className="mt-6"
        gridClass="grid-cols-2 sm:grid-cols-[2fr_1fr_1fr]"
        // With no run matching, Clear filters is the empty state's own action instead.
        clearHref={filtered && runs.length > 0 ? "/runs" : null}
        selects={[
          { name: "campaign", label: "Campaign", all: "All campaigns", options: campaigns.map((c) => ({ value: c.id, label: c.name })), value: filters.campaign ?? "", wide: true },
          { name: "agent", label: "Agent", all: "All agents", options: AGENT_KEYS.map((k) => ({ value: k, label: agentDisplayName(k) })), value: filters.agent ?? "" },
          { name: "status", label: "Status", all: "All statuses", options: RUN_STATUSES.map((s) => ({ value: s, label: statusText(s) })), value: filters.status ?? "" },
        ]}
      />
      {note && (
        <p className="mt-3 text-sm font-medium text-ink" role="status" data-runs-filter-note="">
          {note}
        </p>
      )}

      {runs.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No runs match these filters"
            headingLevel={2}
            className="mt-6"
            action={
              <ButtonLink href="/runs" variant="quiet" size="sm">
                Clear filters
              </ButtonLink>
            }
          >
            Try another campaign, agent or status, or clear the filters to see every run.
          </EmptyState>
        ) : (
          <EmptyState
            title="No runs yet"
            headingLevel={2}
            className="mt-6"
            action={
              <ButtonLink href="/" variant="quiet" size="sm">
                Start a run from the home page
              </ButtonLink>
            }
          >
            Runs appear here as soon as an agent starts, with their cost and every step they take.
          </EmptyState>
        )
      ) : (
        <div className="mt-6 overflow-hidden rounded-card bg-surface" data-runs-table="">
          <table className="w-full table-fixed text-left">
            <caption className="sr-only">Agent runs, newest first</caption>
            <thead className="border-b border-line text-sm text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold sm:pr-3 sm:pl-6">
                  {/* On a phone the other columns are hidden, so the cost's heading sits here. */}
                  <span className="flex justify-between gap-3 sm:hidden">
                    <span>Run and campaign</span>
                    <span data-cost-heading="">{heading}</span>
                  </span>
                  <span className="hidden sm:inline">Run and campaign</span>
                </th>
                <th scope="col" className="hidden w-32 px-3 py-3 font-semibold md:table-cell">
                  Agent
                </th>
                <th scope="col" className="hidden w-48 px-3 py-3 font-semibold sm:table-cell">
                  Status
                </th>
                <th scope="col" className="hidden w-36 px-3 py-3 text-right font-semibold whitespace-nowrap sm:table-cell">
                  <span data-cost-heading="">{heading}</span>
                </th>
                <th scope="col" className="hidden w-32 py-3 pr-6 pl-3 text-right font-semibold sm:table-cell">
                  Started
                </th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {runs.map((r) => {
                const campaign = r.campaign?.name ?? NO_CAMPAIGN;
                const cost = runCostText(r, heading);
                return (
                  <tr key={r.id} data-run={r.id} className="border-line align-top not-first:border-t hover:bg-surface-2">
                    <td className="px-4 py-2.5 sm:py-2 sm:pr-3 sm:pl-6">
                      <Link href={`/runs/${r.id}`} className="font-semibold wrap-anywhere hover:text-primary">
                        {runTitle(r, knownAgentName(r.agent))}
                      </Link>
                      {/* From sm up the campaign sits under the run's name; on a phone, beside its status and cost. */}
                      <span className="hidden text-ink-2 wrap-anywhere sm:line-clamp-2" data-run-campaign="">
                        {campaign}
                      </span>
                      <div className="mt-1.5 flex items-center gap-3 sm:hidden">
                        <StatusBadge status={r.status} />
                        <span className="min-w-0 flex-1 truncate text-ink-2" data-run-campaign="">
                          {campaign}
                        </span>
                        <span className="shrink-0 tabular-nums" data-run-cost="">
                          {cost}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 text-ink-2 md:table-cell">{agentDisplayName(r.agent)}</td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                      <span data-run-cost="">{cost}</span>
                    </td>
                    <td className="hidden py-2 pr-6 pl-3 text-right whitespace-nowrap text-ink-2 tabular-nums sm:table-cell">
                      {formatWhen(r.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(older || parsed.before) && (
        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          {older && (
            <ButtonLink href={runsHref(filters, older)} variant="quiet" data-older-runs="">
              Older runs
            </ButtonLink>
          )}
          {parsed.before && <TextLink href={runsHref(filters)}>Back to the newest runs</TextLink>}
        </p>
      )}
      {runs.some((r) => Number(r.simulated_pence) > 0) && <SimulatedCostNote className="mt-3" />}
    </div>
  );
}

const order = (key: string) => ["campaign", "agent", "status"].indexOf(key);

export default function RunsPage(props: PageProps<"/runs">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RunsPageContent searchParams={props.searchParams} />
    </Suspense>
  );
}
