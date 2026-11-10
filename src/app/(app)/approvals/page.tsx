import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listInbox, type InboxItem } from "@/lib/approvals/repo";
import { getReviews, type Reviews } from "@/lib/strategy/reviews";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatDay } from "@/components/format-day";
import { StatusBadge } from "@/components/status-badge";
import { ButtonLink, TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatWhen } from "@/lib/format";
import { hasApprove, REVIEWS_SUMMARY_LABEL, reviewsSummary, RUN_CHOICES_HEADING } from "@/lib/approvals/inbox-view";
import { stageHref } from "@/lib/campaigns/stages";
import { PersonaAverages, PLAN_NOTE, TestPlanSummary } from "../campaigns/[id]/reviews-view";
import { SignoffDecision } from "./signoff-decision";
import { LaunchDecision } from "./launch-decision";
import { LaunchAdList, startDay } from "../campaigns/[id]/launch-view";
import { formatPounds, NO_REAL_MONEY, thresholdPhrase } from "@/lib/performance/launch-rules";

export const metadata = { title: "Approvals" };

const RUNNING = new Set(["queued", "running"]);

type SignoffItem = Extract<InboxItem, { kind: "brief_signoff" }>;
type ChoiceItem = Extract<InboxItem, { kind: "run_choice" }>;
type LaunchItem = Extract<InboxItem, { kind: "launch" }>;

async function ApprovalsContent() {
  const member = await requireMember();
  const items = await listInbox(member.userId);
  // listInbox gives them in inboxOrder(): everything with an Approve button, then the run choices.
  const approve = items.filter((i): i is SignoffItem | LaunchItem => hasApprove(i.kind));
  const choices = items.filter((i): i is ChoiceItem => i.kind === "run_choice");
  // The persona review and test plan behind each brief waiting for sign-off.
  const reviews = new Map<string, Reviews>(
    await Promise.all(
      items
        .filter((i): i is SignoffItem => i.kind === "brief_signoff")
        .map(async (i) => [i.id, await getReviews(member.userId, i.campaignId)] as const),
    ),
  );
  const preparing = [...reviews.values()].some((r) => r.runs.some((x) => RUNNING.has(x.status)));

  return (
    <div className="space-y-6">
      <AutoRefresh active={preparing} />
      <div>
        <h1 className="text-title font-strong">Approvals</h1>
        <p className="mt-2 max-w-prose text-ink-2">
          Everything waiting for a person: sign-offs and launches first, then agent runs waiting for your choice, each newest
          first. Nothing that spends, publishes or replaces creative goes ahead until it is approved.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState title="Nothing is waiting for you" headingLevel={2}>
          <p>
            When a brief is sent for sign-off, a campaign asks to launch, or an agent run needs a choice, it appears here.
            Briefs are sent for sign-off, and campaigns launched, from their campaign page.
          </p>
          <p className="mt-3">
            <TextLink href="/campaigns">Go to the campaigns</TextLink>
          </p>
        </EmptyState>
      ) : (
        <>
          {/* Rory's decision (9 November 2026): what has an Approve button first, then the run choices in their own group. */}
          {approve.length > 0 && (
            <ul aria-label={`Waiting for your approval (${approve.length})`} className="space-y-4" data-inbox-approve="">
              {approve.map((item) =>
                item.kind === "brief_signoff" ? (
                  <SignoffCard key={item.id} item={item} reviews={reviews.get(item.id)!} />
                ) : (
                  <LaunchCard key={item.id} item={item} />
                ),
              )}
            </ul>
          )}
          {choices.length > 0 && (
            <section aria-labelledby="run-choices-heading" data-run-choices="" className="space-y-3">
              <div>
                <h2 id="run-choices-heading" className="text-xl font-strong tracking-tight">
                  {RUN_CHOICES_HEADING}
                </h2>
                <p className="mt-1 max-w-prose text-sm text-ink-2">Each run stops until you choose, on the run&apos;s own page.</p>
              </div>
              <ul aria-label={`${RUN_CHOICES_HEADING} (${choices.length})`} className="space-y-3">
                {choices.map((item) => (
                  <ChoiceCard key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SignoffCard({ item, reviews }: { item: SignoffItem; reviews: Reviews }) {
  const heading = `approval-${item.id}`;
  const title = item.question.replace(/^Sign off version \d+: /, "");
  const review = reviews.review?.version === item.version ? reviews.review : null;
  const plan = reviews.plan?.version === item.version ? reviews.plan : null;
  const personaRun = reviews.runs.find((r) => r.agent === "persona" && r.version === item.version) ?? null;
  const planRun = reviews.runs.find((r) => r.agent === "testPlan" && r.version === item.version) ?? null;
  const summary = reviewsSummary({
    personas: review?.data.personas.length ?? 0,
    plan: plan !== null,
    preparing: [personaRun, planRun].some((r) => r !== null && RUNNING.has(r.status)),
  });
  return (
    <Card
      as="li"
      tone="review"
      aria-labelledby={heading}
      data-inbox-item="brief_signoff"
      data-approval={item.id}
      data-campaign={item.campaignId}
      className="space-y-4"
    >
      <div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <Pill tone="review">Brief sign-off</Pill>
          <TextLink href={`/brands/${item.brand.id}`}>{item.brand.name}</TextLink>
          <span className="text-ink-2">Asked for {formatWhen(item.createdAt)}</span>
        </p>
        <h2 id={heading} className="mt-2 text-2xl font-strong tracking-tight wrap-anywhere">
          Version {item.version}: {title}
        </h2>
        <p className="mt-2 max-w-prose wrap-anywhere">
          <span className="font-semibold">Objective: </span>
          {item.objective}
        </p>
        <p className="mt-1 text-sm text-ink-2">Closes {formatDay(item.expiresAt)}. If nobody decides by then, the brief goes back to draft.</p>
      </div>

      {/* U10-5 (answer B1): the personas and test plan on request, so the decision stays near the top. */}
      <details data-signoff-reviews="" className="group/reviews">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 rounded-field bg-bg px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="mt-1 size-4 shrink-0 text-primary transition-transform group-open/reviews:rotate-90 motion-reduce:transition-none"
          >
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0 wrap-anywhere">
            {REVIEWS_SUMMARY_LABEL}: <span className="font-normal text-ink-2" data-reviews-summary="">{summary}</span>
          </span>
        </summary>
        <div className="grid gap-4 pt-3 lg:grid-cols-2">
          <div className="min-w-0 rounded-field bg-bg p-4">
            <h3 className="font-strong">Personas</h3>
            {review ? (
              <>
                <p className="mt-1 text-sm text-ink-2">
                  Averages from {review.data.personas.length} synthetic {review.data.personas.length === 1 ? "persona" : "personas"}, not
                  real customers.
                </p>
                <div className="mt-3">
                  <PersonaAverages review={review.data} compact />
                </div>
              </>
            ) : (
              <Preparing run={personaRun} what="The personas are reading the brief." none="No persona review for this version." />
            )}
          </div>
          <div className="min-w-0 rounded-field bg-bg p-4">
            <h3 className="font-strong">Test plan</h3>
            {plan ? (
              <>
                <div className="mt-2">
                  <TestPlanSummary plan={plan.data} />
                </div>
                <p className="mt-2 text-sm text-ink-2">{PLAN_NOTE}</p>
              </>
            ) : (
              <Preparing run={planRun} what="The test plan is being written." none="No test plan for this version." />
            )}
          </div>
        </div>
      </details>

      <p>
        <TextLink href={stageHref(item.campaignId, "brief")} data-inbox-campaign-link="">
          Read the brief on the campaign
        </TextLink>
      </p>
      <SignoffDecision approvalId={item.id} version={item.version} />
    </Card>
  );
}

function Preparing({ run, what, none }: { run: Reviews["runs"][number] | null; what: string; none: string }) {
  if (run && RUNNING.has(run.status)) {
    return (
      <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-ink-2">
        <StatusBadge status={run.status} /> {what}
      </p>
    );
  }
  if (run) {
    return (
      <p className="mt-2 text-attention-ink wrap-anywhere">
        It didn&apos;t finish: {run.error ?? "the agent stopped."} <TextLink href={`/runs/${run.runId}`}>See the trail</TextLink>
      </p>
    );
  }
  return <p className="mt-2 text-ink-2">{none}</p>;
}

/** P9-1: a launch into the simulation, with what the person approves: the ads, budget, length and threshold. */
function LaunchCard({ item }: { item: LaunchItem }) {
  const heading = `approval-${item.id}`;
  return (
    <Card
      as="li"
      tone="review"
      aria-labelledby={heading}
      data-inbox-item="launch"
      data-approval={item.id}
      data-campaign={item.campaignId}
      className="space-y-4"
    >
      <div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <Pill tone="review">Launch (simulated)</Pill>
          <TextLink href={`/brands/${item.brand.id}`}>{item.brand.name}</TextLink>
          <span className="text-ink-2">Asked for {formatWhen(item.createdAt)}</span>
        </p>
        <h2 id={heading} className="mt-2 text-2xl font-strong tracking-tight wrap-anywhere">
          {item.question}
        </h2>
        <p className="mt-2 max-w-prose wrap-anywhere">
          <span className="font-semibold">Objective: </span>
          {item.objective}
        </p>
        <p className="mt-2 max-w-prose font-semibold text-review-ink">{NO_REAL_MONEY}</p>
        <p className="mt-1 text-sm text-ink-2">Closes {formatDay(item.expiresAt)}. If nobody decides by then, it isn&apos;t launched.</p>
      </div>

      {/* U10-5 (answer B1): the launch and its ads in one panel, so Approve is nearer the top on a phone. */}
      <div className="grid gap-x-6 gap-y-4 rounded-field bg-bg p-4 lg:grid-cols-2">
        <div className="min-w-0">
          {/* The card's heading already says it is the launch; on wide screens this heads its column beside the ads. */}
          <h3 className="sr-only font-strong lg:not-sr-only lg:mb-2">The launch (simulated)</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-2">Budget</dt>
            <dd>{formatPounds(item.dailyBudgetPence)} a day (simulated)</dd>
            <dt className="text-ink-2">Length</dt>
            <dd>{item.days} days</dd>
            <dt className="text-ink-2">Starts</dt>
            <dd>{startDay(item.startsOn)}</dd>
            <dt className="text-ink-2">Threshold</dt>
            <dd className="wrap-anywhere">{thresholdPhrase(item.kpiMeasure, item.kpiValue)}, for every ad</dd>
          </dl>
        </div>
        <div className="min-w-0">
          <h3 className="font-strong">
            {item.ads.length === 1 ? "1 ad" : `${item.ads.length} ads`} to launch
          </h3>
          <div className="mt-2">
            <LaunchAdList ads={item.ads} label="Ads in this launch" />
          </div>
        </div>
      </div>

      <p>
        <TextLink href={stageHref(item.campaignId, "launch")} data-inbox-campaign-link="">
          See the launch on the campaign
        </TextLink>
      </p>
      <LaunchDecision approvalId={item.id} />
    </Card>
  );
}

function ChoiceCard({ item }: { item: ChoiceItem }) {
  const heading = `approval-${item.id}`;
  return (
    <Card as="li" tone="primary" aria-labelledby={heading} data-inbox-item="run_choice" data-approval={item.id} className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <Pill tone="active">Agent run choice</Pill>
        {item.runLabel && <span className="font-medium wrap-anywhere">{item.runLabel}</span>}
        <span className="text-ink-2">Asked for {formatWhen(item.createdAt)}</span>
        <span className="text-ink-2">Closes {formatWhen(item.expiresAt)}</span>
      </p>
      <h3 id={heading} className="text-lg font-strong tracking-tight wrap-anywhere">
        {item.question}
      </h3>
      <ButtonLink href={`/runs/${item.runId}`} className="self-start">
        Choose on the run page
      </ButtonLink>
    </Card>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the approvals" />}>
      <ApprovalsContent />
    </Suspense>
  );
}
