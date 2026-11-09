// S4-2 and S4-4 on the campaign's Audience stage (U10-2): the persona review and the test plan,
// each with its button, in-flight state and failure.
import type { Reviews } from "@/lib/strategy/reviews";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatWhen } from "@/lib/format";
import { PersonaAverages, PersonaCards, PLAN_NOTE, TestPlanCards } from "./reviews-view";
import { AskPersonasButton, MakeTestPlanButton } from "./signoff-actions";

const RUNNING = new Set(["queued", "running"]);

type Run = Reviews["runs"][number];

/** "For version n": shown when a review or plan was made for an older version than the current one. */
function OlderVersionNote({ version, current, what }: { version: number; current: number; what: string }) {
  if (version === current) return null;
  return (
    <p className="rounded-field bg-review-soft px-4 py-3 text-review-ink" data-older-version="">
      <span className="font-semibold">For version {version}.</span> The brief is now on version {current}, so this {what}{" "}
      may not match it. Ask again for the current version.
    </p>
  );
}

function InFlight({ run, children }: { run: Run; children: React.ReactNode }) {
  return (
    <Card tone="primary" className="space-y-4">
      <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusBadge status={run.status} />
        <span>{children}</span>
        <TextLink href={`/runs/${run.runId}`} className="text-sm">
          See the run
        </TextLink>
      </p>
      <div aria-hidden className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </Card>
  );
}

function Failed({ run, what }: { run: Run; what: string }) {
  return (
    <Card tone="attention" className="bg-attention-soft">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-semibold text-attention-ink">{what} for version {run.version} didn&apos;t finish</p>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-1 max-w-prose wrap-anywhere">{run.error ?? "The agent stopped before it finished."}</p>
      <p className="mt-1 text-sm">
        {run.status === "stopped_cap" ? "Nothing more was charged. Try again tomorrow. " : "Nothing was saved. Try again. "}
        <TextLink href={`/runs/${run.runId}`}>See what happened in the trail</TextLink>
      </p>
    </Card>
  );
}

export function PersonasSection({ campaignId, currentVersion, reviews }: { campaignId: string; currentVersion: number; reviews: Reviews }) {
  const run = reviews.runs.find((r) => r.agent === "persona") ?? null;
  const active = !!run && RUNNING.has(run.status);
  const review = reviews.review;
  return (
    <section aria-labelledby="personas" className="scroll-mt-6 space-y-4">
      <AutoRefresh active={active} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="personas" className="scroll-mt-6 text-2xl font-strong tracking-tight">
            Personas
          </h2>
          <p className="mt-1 max-w-prose text-ink-2">
            Up to four synthetic customers, built from the brand&apos;s segments, score the brief and say what puts them off.
            A quick check before money is spent, not research with real people.
          </p>
        </div>
        <AskPersonasButton campaignId={campaignId} running={active} />
      </div>

      {active && run && <InFlight run={run}>The Persona agent is reading version {run.version} of the brief.</InFlight>}
      {run && !active && <Failed run={run} what="The persona review" />}

      {review ? (
        <div className="space-y-4" data-persona-review="">
          <OlderVersionNote version={review.version} current={currentVersion} what="review" />
          <Card>
            <h3 className="text-lg font-strong">Average across the personas</h3>
            <p className="mt-1 text-sm text-ink-2">
              Version {review.version}, {formatWhen(review.createdAt)}. Worked out from the personas&apos; scores; each score
              is from 1 to 5.
              {review.data.simulatedData && " The segments behind them come from simulated customer data."}
            </p>
            <div className="mt-4">
              <PersonaAverages review={review.data} />
            </div>
          </Card>
          <PersonaCards review={review.data} />
          <p className="text-sm text-ink-2">
            <TextLink href={`/runs/${review.runId}`}>See the Persona agent&apos;s trail</TextLink>
          </p>
        </div>
      ) : (
        !active &&
        !run && (
          <Card>
            <p className="max-w-prose text-ink-2">
              No persona review yet. Ask the personas, or send the brief for sign-off and they will review it then.
            </p>
          </Card>
        )
      )}
    </section>
  );
}

export function TestPlanSection({ campaignId, currentVersion, reviews }: { campaignId: string; currentVersion: number; reviews: Reviews }) {
  const run = reviews.runs.find((r) => r.agent === "testPlan") ?? null;
  const active = !!run && RUNNING.has(run.status);
  const plan = reviews.plan;
  return (
    <section aria-labelledby="test-plan" className="scroll-mt-6 space-y-4">
      <AutoRefresh active={active} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="test-plan" className="scroll-mt-6 text-2xl font-strong tracking-tight">
            Test plan
          </h2>
          <p className="mt-1 max-w-prose text-ink-2">
            What to test once there is creative: one hypothesis for each insight in the brief.
          </p>
        </div>
        <MakeTestPlanButton campaignId={campaignId} running={active} />
      </div>

      {active && run && <InFlight run={run}>Writing the test plan for version {run.version}.</InFlight>}
      {run && !active && <Failed run={run} what="The test plan" />}

      {plan ? (
        <div className="space-y-4" data-test-plan="">
          <OlderVersionNote version={plan.version} current={currentVersion} what="plan" />
          <p className="text-sm text-ink-2">
            Version {plan.version}, {formatWhen(plan.createdAt)}. {PLAN_NOTE}{" "}
            <TextLink href={`/runs/${plan.runId}`}>See the trail</TextLink>
          </p>
          <TestPlanCards plan={plan.data} />
        </div>
      ) : (
        !active &&
        !run && (
          <Card>
            <p className="max-w-prose text-ink-2">
              No test plan yet. Make one, or send the brief for sign-off and it will be written then.
            </p>
          </Card>
        )
      )}
    </section>
  );
}
