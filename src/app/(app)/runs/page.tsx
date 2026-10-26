import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listRuns, runTitle } from "@/lib/agents/runs";
import { StatusBadge, ACTIVE_STATUSES } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatCost, formatWhen } from "@/lib/format";
import { SimulatedCostNote } from "@/components/simulated-cost-note";
import { agentDisplayName, knownAgentName } from "@/lib/agents/names";

export const metadata = { title: "Agent runs" };

async function RunsPageContent() {
  const member = await requireMember();
  const runs = await listRuns(member.userId, 100);
  const anyActive = runs.some((r) => ACTIVE_STATUSES.has(r.status));
  return (
    <div>
      <AutoRefresh active={anyActive} intervalMs={3000} />
      <h1 className="text-title font-strong">Agent runs</h1>
      <p className="mt-2 text-lg text-ink-2">Every run in your workspace, newest first.</p>
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          headingLevel={2}
          className="mt-8"
          action={
            <ButtonLink href="/" variant="quiet" size="sm">
              Start a run from the home page
            </ButtonLink>
          }
        >
          Runs appear here as soon as an agent starts, with their cost and every step they take.
        </EmptyState>
      ) : (
        <div className="mt-8 overflow-hidden rounded-card bg-surface">
          <table className="w-full table-fixed text-left">
            <caption className="sr-only">Agent runs, newest first</caption>
            <thead className="border-b border-line text-sm text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold sm:px-6">
                  <span className="sm:hidden">Run</span>
                  <span className="hidden sm:inline">Input</span>
                </th>
                <th scope="col" className="hidden w-40 px-4 py-3 font-semibold md:table-cell">
                  Agent
                </th>
                <th scope="col" className="hidden w-48 px-4 py-3 font-semibold sm:table-cell">
                  Status
                </th>
                <th scope="col" className="hidden w-28 px-4 py-3 text-right font-semibold sm:table-cell">
                  Cost
                </th>
                <th scope="col" className="hidden w-36 px-4 py-3 text-right font-semibold sm:table-cell sm:pr-6">
                  Started
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-line align-top not-first:border-t hover:bg-surface-2">
                  <td className="px-4 py-3.5 sm:px-6">
                    <Link href={`/runs/${r.id}`} className="font-semibold wrap-anywhere hover:text-primary">
                      {runTitle(r, knownAgentName(r.agent))}
                    </Link>
                    {/* On narrow screens the hidden columns' facts sit under the name. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 sm:hidden">
                      <StatusBadge status={r.status} />
                      <span className="text-sm text-ink-2 tabular-nums">
                        {formatCost(r.cost_pence, r.simulated_pence)} · {formatWhen(r.created_at)}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3.5 text-ink-2 md:table-cell">
                    {agentDisplayName(r.agent)}
                  </td>
                  <td className="hidden px-4 py-3.5 sm:table-cell">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="hidden px-4 py-3.5 text-right tabular-nums sm:table-cell">
                    {formatCost(r.cost_pence, r.simulated_pence)}
                  </td>
                  <td className="hidden px-4 py-3.5 text-right text-ink-2 tabular-nums sm:table-cell sm:pr-6">
                    {formatWhen(r.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {runs.some((r) => Number(r.simulated_pence) > 0) && <SimulatedCostNote className="mt-3" />}
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RunsPageContent />
    </Suspense>
  );
}
