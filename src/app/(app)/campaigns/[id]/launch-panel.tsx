// P9-1 in the Creative section, after the launch pack: Launch (simulated).
// P9-2 adds the simulated clock to a live launch, and P9-3 the link to the
// campaign's Performance view while a launch is live or ended.
// The ads that would launch (the pack's rule), the ones left out with the
// pack's reason, the settings and Ask to launch; then the launch itself:
// waiting for approval in the inbox (rule 3), Live (simulated), Ended or
// Refused. Nothing real is spent or published, and everything says it is
// simulated (rule 1). It streams in on its own, as the pack does.
import { TextLink } from "@/components/ui/button";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { formatWhen } from "@/lib/format";
import type { CreativeView } from "@/lib/creative/gallery";
import {
  describeLaunchAds,
  launchSummary,
  NO_REAL_MONEY,
  thresholdPhrase,
  type LaunchEligibility,
  type LaunchStatus,
  type LaunchView,
} from "@/lib/performance/launch";
import { EndLaunchButton, LaunchForm, SimClock } from "./launch-controls";
import { LaunchAdList, LaunchRefusal, startDay } from "./launch-view";

export type LaunchPanelData = { eligibility: LaunchEligibility | { refused: string }; launches: LaunchView[] };

const STATUS: Record<LaunchStatus, { label: string; tone: PillTone }> = {
  awaiting_approval: { label: "Waiting for approval", tone: "review" },
  live: { label: "Live (simulated)", tone: "good" },
  ended: { label: "Ended", tone: "neutral" },
  refused: { label: "Refused", tone: "attention" },
};

const HEADING = "launch-panel-heading";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby={HEADING} className="space-y-4 rounded-field bg-surface px-4 py-4" data-launch-panel="">
      <div className="space-y-1">
        <h3 id={HEADING} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-semibold">
          Launch (simulated) <Pill tone="review">Simulated</Pill>
        </h3>
        <p className="max-w-prose text-sm text-ink-2">
          A rehearsal of a real launch: Studio simulates how the ads would do. {NO_REAL_MONEY}
        </p>
      </div>
      {children}
    </section>
  );
}

export function LaunchPanelSkeleton() {
  return (
    <div className="rounded-field bg-surface px-4 py-4" aria-hidden>
      <p className="font-semibold">Launch (simulated)</p>
      <Skeleton className="mt-2 h-5 w-2/3" />
    </div>
  );
}

/** The latest launch: its status, terms and ads, and what can be done with it. */
function CurrentLaunch({ launch, view }: { launch: LaunchView; view: CreativeView }) {
  const s = STATUS[launch.status];
  const showAds = launch.status === "awaiting_approval" || launch.status === "live";
  return (
    <div className="space-y-3" data-launch-current="">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span data-launch-status="">
          <Pill tone={s.tone} dot={launch.status === "live"}>
            {s.label}
          </Pill>
        </span>
        <span className="text-ink-2">
          {launch.status === "awaiting_approval"
            ? `Asked for ${formatWhen(launch.createdAt)}`
            : launch.approvedAt
              ? `Approved ${formatWhen(launch.approvedAt)}`
              : `Asked for ${formatWhen(launch.createdAt)}`}
        </span>
      </p>
      <p className="wrap-anywhere" data-launch-summary="">
        {launchSummary(launch.ads.length, launch.dailyBudgetPence, launch.days, startDay(launch.startsOn))}
      </p>
      <p className="text-sm wrap-anywhere">
        <span className="font-semibold">Threshold for every ad: </span>
        {thresholdPhrase(launch.kpiMeasure, launch.kpiValue)}
      </p>
      {showAds && <LaunchAdList ads={describeLaunchAds(view, launch.ads)} label="Ads in this launch" />}
      {launch.status === "awaiting_approval" && (
        <p className="text-sm text-ink-2">
          It waits in the <TextLink href="/approvals">approvals inbox</TextLink>. If nobody decides within 14 days, the request closes.
        </p>
      )}
      {launch.status === "live" && (
        <>
          <SimClock campaignId={launch.campaignId} launchId={launch.id} simDay={launch.simDay} days={launch.days} />
          {launch.simDay === 0 && <p className="text-sm text-ink-2">The simulated results start once its first simulated day has run.</p>}
          <EndLaunchButton campaignId={launch.campaignId} launchId={launch.id} />
        </>
      )}
      {launch.status === "ended" && (
        <p className="text-sm" data-launch-ended="">
          Ended by {launch.endedByName ?? "a member of this workspace"}{" "}
          {launch.simDay > 0 ? `on simulated day ${launch.simDay} of ${launch.days}.` : "before its first simulated day."}
        </p>
      )}
      {launch.status === "refused" && launch.decision.reason && (
        <LaunchRefusal reason={launch.decision.reason} by={launch.decision.decidedByName} at={launch.decision.decidedAt} expired={launch.decision.status === "expired"} />
      )}
    </div>
  );
}

/** What would launch now, and the form to ask for it (or why it can't be asked for). */
function AskToLaunch({ eligibility, hasHistory }: { eligibility: LaunchPanelData["eligibility"]; hasHistory: boolean }) {
  if ("refused" in eligibility) {
    return (
      <p className="max-w-prose text-sm" data-launch-reason="">
        {eligibility.refused}
      </p>
    );
  }
  const e = eligibility;
  return (
    <div className="space-y-4" data-launch-ask="">
      {hasHistory && <h4 className="font-semibold">Ask to launch again</h4>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold">Would launch</p>
          {e.ads.length > 0 ? (
            <LaunchAdList ads={e.ads} label="Ads that would launch" />
          ) : (
            <p className="text-sm" data-launch-reason="">
              {e.reason}
            </p>
          )}
          <p className="text-sm text-ink-2">The picked ads that pass compliance or were accepted: the same rule as the launch pack.</p>
        </div>
        {e.leftOut.length > 0 && (
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-semibold">Left out</p>
            <ul aria-label="Picked ads left out of the launch" className="space-y-1.5 text-sm">
              {e.leftOut.map((l) => (
                <li key={l.variantId} data-launch-left-out="" className="wrap-anywhere">
                  <span className="font-semibold">Ad {l.adNumber}:</span> {l.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <LaunchForm key={e.defaults.startsOn} campaignId={e.campaignId} defaults={e.defaults} variantIds={e.ads.map((a) => a.variantId)} canAsk={e.canAsk} />
    </div>
  );
}

export async function LaunchPanel({ data, view }: { data: Promise<LaunchPanelData | null>; view: CreativeView }) {
  const d = await data;
  if (!d) return null;
  const [latest, ...earlier] = d.launches;
  const open = latest && (latest.status === "awaiting_approval" || latest.status === "live");
  // The Performance view shows the live launch, else the newest ended one.
  const results = d.launches.some((l) => l.status === "live" || l.status === "ended");
  return (
    <Shell>
      {latest && <CurrentLaunch launch={latest} view={view} />}
      {results && (
        <p data-launch-performance="">
          <TextLink href={`/campaigns/${view.campaignId}/performance`}>See performance (simulated)</TextLink>
        </p>
      )}
      {!open && <AskToLaunch eligibility={d.eligibility} hasHistory={!!latest} />}
      {earlier.length > 0 && (
        <details className="group text-sm" data-launch-history="">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold text-primary">
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
              ›
            </span>
            Earlier launches ({earlier.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {earlier.map((l) => (
              <li key={l.id} className="wrap-anywhere">
                <span className="font-semibold">{STATUS[l.status].label}</span>, asked for {formatWhen(l.createdAt)}:{" "}
                {launchSummary(l.ads.length, l.dailyBudgetPence, l.days, startDay(l.startsOn))}
                {l.status === "refused" && l.decision.reason ? `. Reason: ${l.decision.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Shell>
  );
}
