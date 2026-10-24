import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listRuns } from "@/lib/agents/runs";
import { StatusBadge, ACTIVE_STATUSES } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatPence, formatWhen } from "@/lib/format";
import { AGENTS } from "@/lib/agents/registry";

export const metadata = { title: "Agent runs" };

async function RunsPageContent() {
  const member = await requireMember();
  const runs = await listRuns(member.userId, 100);
  const anyActive = runs.some((r) => ACTIVE_STATUSES.has(r.status));
  return (
    <div>
      <AutoRefresh active={anyActive} intervalMs={3000} />
      <h1 className="text-2xl font-semibold tracking-tight">Agent runs</h1>
      <p className="mt-2 text-ink-2">Every run in your workspace, newest first.</p>
      {runs.length === 0 ? (
        <p className="mt-6 text-ink-2">
          No runs yet. <Link href="/" className="text-accent">Start one from the home page.</Link>
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Input</th>
                <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Cost</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-bg">
                  <td className="px-4 py-2.5">
                    <Link href={`/runs/${r.id}`} className="font-medium hover:text-accent">
                      {String(r.input.brandName ?? "(no input)")}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">
                    {AGENTS[r.agent as keyof typeof AGENTS]?.name ?? r.agent}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPence(r.cost_pence)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{formatWhen(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
      <RunsPageContent  />
    </Suspense>
  );
}
