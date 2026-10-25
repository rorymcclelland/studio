import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listRuns } from "@/lib/agents/runs";
import { StatusBadge, statusRingTone } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TextLink } from "@/components/ui/button";
import { Ring, countTones } from "@/components/ui/ring";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatPence, formatWhen } from "@/lib/format";
import { StartRunForm } from "./start-run-form";

const RECENT = 5;

async function HomePageContent() {
  const member = await requireMember();
  const runs = await listRuns(member.userId, RECENT);
  const tones = runs.map((r) => statusRingTone(r.status));
  const counts = countTones(tones);
  return (
    <div className="space-y-12">
      <Card as="section" size="hero" aria-labelledby="try" className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <p className="font-medium text-ink-2">Sprint 1 test agent</p>
          <h1 id="try" className="mt-2 text-display font-strong">
            Try the tagline agent
          </h1>
          <p className="mt-4 max-w-prose text-lg text-ink-2">
            It proposes three taglines, then waits for you to choose one before it finishes. Every step it takes is
            recorded in the run&apos;s trail.
          </p>
          <StartRunForm />
        </div>
        {runs.length > 0 && (
          <Ring
            segments={tones}
            value={`${counts.good}/${runs.length}`}
            caption="recent runs done"
            label={`Your last ${runs.length} ${runs.length === 1 ? "run" : "runs"}: ${counts.good} completed, ${counts.review} waiting or stopped, ${counts.attention} failed`}
            className="justify-self-center max-md:hidden"
          />
        )}
      </Card>

      <section aria-labelledby="recent">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="recent" className="text-2xl font-strong tracking-tight">
            Recent runs
          </h2>
          {runs.length > 0 && <TextLink href="/runs">See all runs</TextLink>}
        </div>
        {runs.length === 0 ? (
          <EmptyState title="No runs yet" className="mt-4">
            Enter a brand name above to start one. The agent stops and waits for your choice before it finishes.
          </EmptyState>
        ) : (
          <ul className="mt-4 overflow-hidden rounded-card bg-surface">
            {runs.map((r) => (
              <li key={r.id} className="border-line not-first:border-t">
                <Link
                  href={`/runs/${r.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-surface-2 sm:px-6"
                >
                  <span className="min-w-0 basis-full font-semibold wrap-anywhere sm:flex-1 sm:basis-auto">
                    {String(r.input.brandName ?? r.agent)}
                  </span>
                  <StatusBadge status={r.status} />
                  <span className="ml-auto text-sm text-ink-2 tabular-nums">
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
    <Suspense fallback={<PageSkeleton />}>
      <HomePageContent />
    </Suspense>
  );
}
