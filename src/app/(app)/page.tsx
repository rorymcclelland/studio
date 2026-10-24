import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listRuns } from "@/lib/agents/runs";
import { StatusBadge } from "@/components/status-badge";
import { formatPence, formatWhen } from "@/lib/format";
import { StartRunForm } from "./start-run-form";

async function HomePageContent() {
  const member = await requireMember();
  const runs = await listRuns(member.userId, 5);
  return (
    <div className="space-y-10">
      <section aria-labelledby="try">
        <h1 id="try" className="text-2xl font-semibold tracking-tight">Try the tagline agent</h1>
        <p className="mt-2 max-w-prose text-ink-2">
          Sprint 1&apos;s test agent. It proposes three taglines, then waits for you to choose one before it
          finishes. Every step it takes is recorded in the run&apos;s trail.
        </p>
        <StartRunForm />
      </section>

      <section aria-labelledby="recent">
        <div className="flex items-baseline justify-between">
          <h2 id="recent" className="text-lg font-semibold">Recent runs</h2>
          <Link href="/runs" className="text-sm text-accent">See all runs</Link>
        </div>
        {runs.length === 0 ? (
          <p className="mt-3 text-ink-2">No runs yet. Enter a brand name above to start one.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-bg">
                  <span className="font-medium">{String(r.input.brandName ?? r.agent)}</span>
                  <StatusBadge status={r.status} />
                  <span className="ml-auto text-sm tabular-nums text-ink-2">
                    {formatPence(r.cost_pence)} · {formatWhen(r.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
      <HomePageContent  />
    </Suspense>
  );
}
