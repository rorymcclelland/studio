import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listRuns, runTitle, type RunSummary } from "@/lib/agents/runs";
import { knownAgentName } from "@/lib/agents/names";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { TextLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatCost, formatWhen } from "@/lib/format";
import { liveLabel } from "@/lib/campaigns/status";
import { HOME_TITLE, LIVE_HEADING, liveShareLine, NO_CAMPAIGN, NOTHING_NEEDS_YOU, type HomeNeed } from "@/lib/home/needs";
import { homeNeedsFor } from "@/lib/home/work";
import { homeHealth, type HomeHealth } from "@/lib/performance/dashboard";
import { alertsLine } from "@/lib/performance/alerts";
import { unseenAlertCount } from "@/lib/performance/alerts-store";
import { SimulatedCostNote } from "@/components/simulated-cost-note";
import { StartRunForm } from "./start-run-form";

const RECENT = 5;

// U10-5 Home leads with work: what needs a person across every campaign first,
// then the live campaigns, the recent runs, and the Sprint 1 tagline demo last.
async function HomePageContent() {
  const member = await requireMember();
  const [needs, runs, health, unseen] = await Promise.all([
    homeNeedsFor(member.userId),
    listRuns(member.userId, RECENT),
    homeHealth(member.userId),
    unseenAlertCount(member.userId),
  ]);
  return (
    <div className="space-y-10">
      <h1 className="text-title font-strong">{HOME_TITLE}</h1>
      <NeedsYou items={needs} />
      {health && <LiveCampaigns health={health} unseen={unseen} />}
      <RecentRuns runs={runs} />
      <TaglineDemo />
    </div>
  );
}

/** Everything waiting for a person, each item linking to where it is decided (Approve stays there; rule 3). */
function NeedsYou({ items }: { items: HomeNeed[] }) {
  return (
    <Card as="section" aria-labelledby="needs-you" tone={items.length > 0 ? "primary" : "plain"} data-needs-you="" className="space-y-3">
      <h2 id="needs-you" className="text-xl font-strong tracking-tight">
        Needs you
      </h2>
      {items.length === 0 ? (
        <p className="text-ink-2" data-nothing-needs-you="">
          {NOTHING_NEEDS_YOU}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((n) => (
            <li key={n.key} data-need={n.kind} data-need-key={n.key} data-campaign={n.campaignId ?? undefined}>
              <Link
                href={n.href}
                className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline wrap-anywhere"
              >
                {n.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** P9-3's pooled line and P9-4's unseen alerts, then each live campaign with its own day and share (all simulated; rule 1). */
function LiveCampaigns({ health, unseen }: { health: HomeHealth; unseen: number }) {
  return (
    <section aria-labelledby="live" data-home-live="" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="live" className="text-2xl font-strong tracking-tight">
          {LIVE_HEADING}
        </h2>
        <TextLink href="/campaigns">See the campaigns</TextLink>
      </div>
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Pill tone="review">Simulated</Pill>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold wrap-anywhere" data-home-health="">
            {health.line}
          </p>
          {unseen > 0 && (
            <p className="font-medium text-attention-ink wrap-anywhere" data-home-alerts="">
              {alertsLine(unseen)}
            </p>
          )}
        </div>
      </Card>
      <ul className="overflow-hidden rounded-card bg-surface">
        {health.live.map((l) => (
          <li
            key={l.launchId}
            data-live-campaign={l.campaignId}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-line px-5 py-4 not-first:border-t sm:px-6"
          >
            <Link
              href={`/campaigns/${l.campaignId}`}
              className="min-w-0 basis-full font-semibold text-primary underline-offset-4 hover:underline wrap-anywhere sm:flex-1 sm:basis-auto"
            >
              {l.name}
            </Link>
            <span className="text-sm text-ink-2" data-live-day="">
              {liveLabel(l.simDay)}
            </span>
            <span className="text-sm text-ink-2 tabular-nums" data-live-share="">
              {liveShareLine(l.share)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentRuns({ runs }: { runs: RunSummary[] }) {
  return (
    <section aria-labelledby="recent">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="recent" className="text-2xl font-strong tracking-tight">
          Recent runs
        </h2>
        {runs.length > 0 && <TextLink href="/runs">See all runs</TextLink>}
      </div>
      {runs.length === 0 ? (
        <EmptyState title="No runs yet" className="mt-4">
          Agents record a run each time they work on a campaign. To try one now, enter a brand name in the tagline card below.
        </EmptyState>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-card bg-surface">
          {runs.map((r) => (
            <li key={r.id} data-run={r.id} className="border-line not-first:border-t">
              <Link
                href={`/runs/${r.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-surface-2 sm:px-6"
              >
                <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                  <span className="block font-semibold wrap-anywhere">{runTitle(r, knownAgentName(r.agent))}</span>
                  <span className="block text-sm text-ink-2 wrap-anywhere" data-run-campaign="">
                    {r.campaign?.name ?? NO_CAMPAIGN}
                  </span>
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
  );
}

/** Answer Q4: the Sprint 1 tagline demo, now a small card at the bottom; it still shows the approval flow. */
function TaglineDemo() {
  return (
    <Card as="section" aria-labelledby="try" data-tagline-demo="">
      <p className="text-sm font-medium text-ink-2">Sprint 1 test agent</p>
      <h2 id="try" className="mt-1 text-xl font-strong tracking-tight">
        Try the tagline agent
      </h2>
      <p className="mt-2 max-w-prose text-ink-2">
        It proposes three taglines, then waits for you to choose one before it finishes. Every step it takes is recorded in
        the run&apos;s trail.
      </p>
      <StartRunForm />
    </Card>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HomePageContent />
    </Suspense>
  );
}
