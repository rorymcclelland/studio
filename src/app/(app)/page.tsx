import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listRuns, runTitle } from "@/lib/agents/runs";
import { knownAgentName } from "@/lib/agents/names";
import { StatusBadge, statusRingTone } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { TextLink } from "@/components/ui/button";
import { Ring, countTones } from "@/components/ui/ring";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatCost, formatWhen } from "@/lib/format";
import { homeHealth } from "@/lib/performance/dashboard";
import { SimulatedCostNote } from "@/components/simulated-cost-note";
import { StartRunForm } from "./start-run-form";

const RECENT = 5;

async function HomePageContent() {
  const member = await requireMember();
  const [runs, health] = await Promise.all([listRuns(member.userId, RECENT), homeHealth(member.userId)]);
  const tones = runs.map((r) => statusRingTone(r.status));
  const counts = countTones(tones);
  return (
    <div className="space-y-12">
      {/* P9-3: the healthy spend share across the live simulated campaigns; nothing when none are live. */}
      {health && (
        <Card as="section" aria-label="Healthy spend share (simulated)" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Pill tone="review">Simulated</Pill>
          <p className="min-w-0 font-semibold wrap-anywhere" data-home-health="">
            {health.line}
          </p>
          <TextLink href="/campaigns" className="text-sm sm:ml-auto">
            See the campaigns
          </TextLink>
        </Card>
      )}
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
                    {runTitle(r, knownAgentName(r.agent))}
                  </span>
                  <StatusBadge status={r.status} />
                  <span className="ml-auto text-sm text-ink-2 tabular-nums">
                    {formatCost(r.cost_pence, r.simulated_pence)} · {formatWhen(r.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {runs.some((r) => Number(r.simulated_pence) > 0) && <SimulatedCostNote className="mt-3" />}
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
