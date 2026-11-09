// P9-3: a campaign's Performance view, its last stage (U10-2: with the stage
// bar, and locked with the reason until a launch is live or ended). Linked
// from the Launch (simulated) panel too. It reads stored facts only
// (src/lib/performance/dashboard.ts, through asUser()), and every figure on it
// is simulated and says so (rule 1). Server-rendered throughout: the chart is
// SVG with no client code.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { performanceReads } from "@/lib/campaigns/facts";
import { campaignStages } from "@/lib/campaigns/stages";
import { formatDay } from "@/components/format-day";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatPrice, formatWhen } from "@/lib/format";
import { ALERT_NAMES, NO_ALERTS, type AlertKind } from "@/lib/performance/alerts";
import type { AlertView } from "@/lib/performance/alerts-store";
import { askPanel, questionsFor, type AskPanel, type QuestionView } from "@/lib/performance/ask";
import { ANSWER_LABEL, CANNOT_ANSWER, MEASURE_LABELS, type QueryResult } from "@/lib/performance/ask-rules";
import { TREND_NOTE, type PerformanceView } from "@/lib/performance/dashboard";
import { HEALTHY_DEFINITION, NOT_ENOUGH_DATA, shareText, STATUS_NAMES, type AdHealth, type AdStatus, type DayHealth } from "@/lib/performance/health";
import { isKpiMeasure, thresholdPhrase } from "@/lib/performance/launch-rules";
import { adName, MEASURE_SHORT, PerformanceChart } from "./chart";
import { AskForm, MarkSeenButton } from "./monitor-controls";
import { campaignOr404, LockedStage, lockOf } from "../campaign-frame";
import { StageBar } from "../stage-bar";

const STATUS_TONE: Record<AdStatus, PillTone> = {
  healthy: "good",
  below_threshold: "attention",
  not_compliant: "attention",
  learning: "neutral",
};

const day = (date: string) => formatDay(`${date}T12:00:00Z`);

function Header({ view }: { view: PerformanceView }) {
  const l = view.launch;
  return (
    <Card size="hero" data-perf-header="">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-medium text-ink-2">
        <TextLink href={`/brands/${view.brand.id}`}>{view.brand.name}</TextLink>
        <Pill tone="review">Simulated</Pill>
      </p>
      <h1 className="mt-3 text-title font-strong">Performance</h1>
      <p className="mt-2 max-w-prose text-lg text-ink-2 wrap-anywhere">{view.title}</p>
      {l && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Pill tone={l.status === "live" ? "good" : "neutral"} dot={l.status === "live"}>
            {l.status === "live" ? "Live (simulated)" : "Ended"}
          </Pill>
          <span className="font-semibold tabular-nums" data-perf-clock="">
            {view.clock}
          </span>
        </p>
      )}
    </Card>
  );
}

/** The share by day, as thin columns from 0 to 100%; a day that is all learning has none. */
function Trend({ series, days }: { series: DayHealth[]; days: number }) {
  if (series.length === 0) return null;
  const span = Math.max(days, series.at(-1)!.day);
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-semibold">{`By simulated day, ${series.length} of ${span} so far`}</p>
      <ol aria-label="Healthy spend share by simulated day (simulated)" className="grid h-14 items-end gap-0.5 border-b border-line" style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }} data-perf-trend="">
        {series.map((d) => (
          <li key={d.day} data-trend-day={String(d.day)} data-share={d.share === null ? "" : String(d.share)} className="flex h-full min-w-0 items-end">
            <span className="sr-only">{`Day ${d.day}: ${d.shareShown}`}</span>
            <span
              aria-hidden
              title={`Day ${d.day}: ${d.shareShown}`}
              className={d.share === null ? "h-0.5 w-full rounded-t-sm bg-field-line" : "w-full rounded-t-sm bg-primary"}
              style={d.share === null ? undefined : { height: `${Math.max(d.share * 100, 2)}%` }}
            />
          </li>
        ))}
      </ol>
      <p className="flex justify-between gap-4 text-xs text-ink-2 tabular-nums" aria-hidden>
        <span>Day 1</span>
        <span>{`Day ${span}`}</span>
      </p>
    </div>
  );
}

function Headline({ view }: { view: PerformanceView }) {
  const d = view.latest;
  const healthy = d?.healthyPence ?? 0;
  const learning = d?.learningPence ?? 0;
  const total = d?.totalPence ?? 0;
  return (
    <Card as="section" aria-labelledby="perf-share-label" data-perf-headline="" data-healthy-pence={String(healthy)} data-learning-pence={String(learning)} data-total-pence={String(total)} className="space-y-6">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-end">
        <div className="min-w-0 space-y-2">
          <h2 id="perf-share-label" className="font-semibold text-ink-2">
            Healthy spend share
          </h2>
          <p className="text-display font-strong" data-perf-share="">
            {d ? shareText(d.share) : NOT_ENOUGH_DATA}
          </p>
          <p className="text-ink-2">
            {!d
              ? "The simulated results start once the first simulated day has run."
              : d.share === null
                ? `Simulated day ${d.day}, ${day(d.date)}: every ad is still learning, so there is nothing to judge yet.`
                : `Simulated day ${d.day}, ${day(d.date)}: ${formatPrice(healthy)} healthy of ${formatPrice(total - learning)} judged (simulated).`}
          </p>
          <p className="font-medium" data-perf-learning="">
            {`Learning spend ${formatPrice(learning)} (simulated), left out of the share`}
          </p>
        </div>
        <Trend series={view.series} days={view.days} />
      </div>
      <div className="space-y-1 border-t border-line pt-4 text-sm text-ink-2">
        <p className="max-w-prose" data-perf-definition="">
          {HEALTHY_DEFINITION}
        </p>
        <p data-perf-trend-note="">{TREND_NOTE}</p>
      </div>
    </Card>
  );
}

function AdsTable({ view }: { view: PerformanceView }) {
  const l = view.launch!;
  const byId = new Map<string, AdHealth>((view.latest?.ads ?? []).map((a) => [a.variantId, a]));
  const short = isKpiMeasure(l.kpiMeasure) ? MEASURE_SHORT[l.kpiMeasure] : l.kpiMeasure;
  const label = "text-ink-2 sm:hidden";
  return (
    <Card as="section" aria-labelledby="perf-ads-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="perf-ads-heading" className="text-2xl font-strong tracking-tight">
          Ads
        </h2>
        <p className="text-sm text-ink-2 wrap-anywhere">
          <span className="font-semibold text-ink">Threshold for every ad: </span>
          {thresholdPhrase(l.kpiMeasure, l.kpiValue)}. {view.latest ? `As of simulated day ${view.latest.day}.` : ""}
        </p>
      </div>
      <table className="w-full text-left max-sm:block" data-perf-ads="">
        <caption className="sr-only">{`Each ad's simulated spend, ${short.toLowerCase()} over its last three days and status`}</caption>
        <thead className="text-sm text-ink-2 max-sm:sr-only">
          <tr>
            <th scope="col" className="py-2 pr-4 font-semibold">
              Ad
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold whitespace-nowrap">
              Spend to date
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {`${short}, last three days`}
            </th>
            <th scope="col" className="py-2 pl-4 font-semibold">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {view.ads.map((a) => {
            const h = byId.get(a.variantId);
            const status: AdStatus = h?.status ?? "learning";
            return (
              <tr
                key={a.variantId}
                data-perf-ad={a.variantId}
                data-status={status}
                data-day-spend-pence={String(h?.spendPence ?? 0)}
                className="border-t border-line align-top max-sm:block max-sm:space-y-1.5 max-sm:py-4"
              >
                <th scope="row" className="py-3 pr-4 text-left font-normal max-sm:block max-sm:p-0">
                  <span className="flex min-w-0 items-start gap-3">
                    {a.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the ad is drawn per user by /ads, so it isn't optimised
                      <img data-perf-thumb="" src={a.thumb} width={56} height={56} loading="lazy" alt="" className="size-14 shrink-0 rounded-field bg-surface-2 object-cover" />
                    ) : (
                      <span aria-hidden className="size-14 shrink-0 rounded-field bg-surface-2" />
                    )}
                    <span className="min-w-0">
                      <span className="block font-semibold">{adName(a)}</span>
                      <span className="block wrap-anywhere" data-perf-words="">
                        {a.headline}
                      </span>
                    </span>
                  </span>
                </th>
                <td className="px-4 py-3 text-right tabular-nums max-sm:block max-sm:p-0 max-sm:pl-17 max-sm:text-left">
                  <span className={label}>Spend to date: </span>
                  <span data-perf-spend-to-date="">{formatPrice(h?.spendToDatePence ?? 0)}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums max-sm:block max-sm:p-0 max-sm:pl-17 max-sm:text-left">
                  <span className={label}>{`${short}, last three days: `}</span>
                  <span data-perf-kpi="">{h ? h.kpi.shown : "No simulated days yet"}</span>
                  {h && <span className="block text-sm text-ink-2">{h.kpi.from === h.kpi.to ? `Day ${h.kpi.to}` : `Days ${h.kpi.from} to ${h.kpi.to}`}</span>}
                </td>
                <td className="py-3 pl-4 max-sm:block max-sm:p-0 max-sm:pl-17">
                  <span data-perf-status="">
                    <Pill tone={STATUS_TONE[status]}>{STATUS_NAMES[status]}</Pill>
                  </span>
                  {h && !h.compliant && h.reason && (
                    <p className="mt-1.5 max-w-xs text-sm text-attention-ink wrap-anywhere max-sm:max-w-none" data-perf-reason="">
                      {h.reason}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

const ALERT_TONE: Record<AlertKind, PillTone> = { below_threshold: "attention", tiring: "review", not_compliant: "attention" };

/** P9-4: the monitor's alerts. They only tell: the one control is Mark as seen (rule 3). */
function Alerts({ campaignId, alerts }: { campaignId: string; alerts: AlertView[] }) {
  return (
    <Card as="section" aria-labelledby="perf-alerts-heading" className="space-y-4" data-perf-alerts="">
      <div className="space-y-1">
        <h2 id="perf-alerts-heading" className="text-2xl font-strong tracking-tight">
          Alerts (simulated)
        </h2>
        <p className="max-w-prose text-sm text-ink-2">
          Raised after each simulated day when an ad misses its threshold two days in a row, tires (its three-day click-through rate 25% or more below its best), or stops passing compliance. Alerts change nothing on their own.
        </p>
      </div>
      {alerts.length === 0 ? (
        <p className="text-ink-2">{NO_ALERTS}</p>
      ) : (
        <ul className="divide-y divide-line">
          {alerts.map((a) => (
            <li key={a.id} data-perf-alert={a.id} data-kind={a.kind} data-day={String(a.day)} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span data-alert-kind="">
                    <Pill tone={ALERT_TONE[a.kind]}>{ALERT_NAMES[a.kind]}</Pill>
                  </span>
                  <span className="text-sm font-semibold text-ink-2 tabular-nums" data-alert-day="">{`Simulated day ${a.day}`}</span>
                </p>
                <p id={`alert-${a.id}-facts`} className="max-w-prose wrap-anywhere" data-alert-facts="">
                  {a.line}
                </p>
              </div>
              <div className="shrink-0">
                {a.seenAt ? (
                  <p className="text-sm text-ink-2 wrap-anywhere" data-alert-seen="">{`Seen by ${a.seenByName ?? "a member of this workspace"}, ${formatWhen(a.seenAt)}`}</p>
                ) : (
                  <MarkSeenButton campaignId={campaignId} alertId={a.id} describedBy={`alert-${a.id}-facts`} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  const span = result.from === result.to ? `Simulated day ${result.from}` : `Simulated days ${result.from} to ${result.to}`;
  const first = result.groupBy === "ad" ? "Ad" : result.groupBy === "day" ? "Day" : "Ads";
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="The query result (simulated)">
      <table className="w-full min-w-max text-left text-sm" data-ask-result="">
        <caption className="pb-2 text-left font-semibold text-ink-2">{`${span} (simulated)`}</caption>
        <thead className="text-ink-2">
          <tr>
            <th scope="col" className="py-2 pr-4 font-semibold">
              {first}
            </th>
            {result.measures.map((m) => (
              <th key={m} scope="col" className="px-3 py-2 text-right font-semibold">
                {MEASURE_LABELS[m]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {r.adNumber !== null ? (
                  <>
                    <span className="font-semibold whitespace-nowrap">{`Ad ${r.adNumber}`}</span>
                    {r.headline && <span className="hidden max-w-56 text-ink-2 wrap-anywhere sm:block">{r.headline}</span>}
                  </>
                ) : r.day !== null ? (
                  <span className="font-semibold whitespace-nowrap">{`Day ${r.day}`}</span>
                ) : (
                  <span className="font-semibold">{result.ads.length === 1 ? `Ad ${result.ads[0]}` : result.ads.length > 1 ? `Ads ${result.ads.join(", ")}` : "All ads"}</span>
                )}
              </th>
              {result.measures.map((m) => (
                <td key={m} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {r.shown[m]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One question, as asked (plain text), with its answer and the table it used. */
function Question({ q }: { q: QuestionView }) {
  return (
    <li data-ask-question={q.id} data-status={q.status} className="space-y-3 border-t border-line pt-5">
      <div className="space-y-1">
        <p className="font-semibold wrap-anywhere whitespace-pre-wrap" data-ask-text="">
          {q.question}
        </p>
        <p className="text-sm text-ink-2 wrap-anywhere">{`Asked by ${q.askedByName ?? "a member of this workspace"}, ${formatWhen(q.askedAt)}`}</p>
      </div>
      {q.status === "pending" ? (
        <p className="text-ink-2" role="status" data-ask-pending="">
          Working out the answer from the simulated results…
        </p>
      ) : q.status === "refused" ? (
        <p className="max-w-prose font-medium text-attention-ink wrap-anywhere" data-ask-answer="">
          {q.refused}
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="max-w-prose text-lg wrap-anywhere" data-ask-answer="">
            {q.status === "cannot_answer" ? CANNOT_ANSWER : q.answer}
          </p>
          {q.status === "answered" && (
            <p data-ask-label="">
              <Pill tone="review">{ANSWER_LABEL}</Pill>
            </p>
          )}
        </div>
      )}
      {q.result && q.status !== "cannot_answer" && <ResultTable result={q.result} />}
    </li>
  );
}

/** P9-4: Ask about this campaign: the box, then the questions about the shown launch, newest first. */
function Ask({ campaignId, panel, questions }: { campaignId: string; panel: AskPanel; questions: QuestionView[] }) {
  const pending = questions.some((q) => q.status === "pending");
  return (
    <Card as="section" aria-labelledby="perf-ask-heading" className="space-y-5">
      <AutoRefresh active={pending} intervalMs={2000} />
      <div className="space-y-1">
        <h2 id="perf-ask-heading" className="text-2xl font-strong tracking-tight">
          Ask about this campaign
        </h2>
        <p className="max-w-prose text-sm text-ink-2">
          AI plans a query of the stored simulated results and words the answer; code runs the query and checks every figure in the answer against the table shown under it.
        </p>
      </div>
      <AskForm campaignId={campaignId} cost={panel.estimate.label} reason={panel.reason} maxLength={panel.maxLength} />
      {questions.length > 0 && (
        <ol className="space-y-5" aria-label="Questions asked, newest first">
          {questions.map((q) => (
            <Question key={q.id} q={q} />
          ))}
        </ol>
      )}
    </Card>
  );
}

async function PerformancePageContent(props: PageProps<"/campaigns/[id]/performance">) {
  const { id } = await props.params;
  const { member, data } = await campaignOr404(id);
  const [{ view, alerts }, panel, questions] = await Promise.all([performanceReads(member.userId, id), askPanel(member, id), questionsFor(member.userId, id)]);
  if (!view || !alerts || !panel || !questions) notFound();
  const l = view.launch;
  const lock = lockOf(data, "performance");
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div>
          <TextLink href={`/campaigns/${view.campaignId}`} data-campaign-overview="">
            <span aria-hidden>← </span>Overview
          </TextLink>
          <div className="mt-3">
            <Header view={view} />
          </div>
        </div>
        <StageBar stages={campaignStages(data.facts)} current="performance" />
      </div>
      {lock || !l ? (
        lock && <LockedStage lock={lock} />
      ) : (
        <>
          <Headline view={view} />
          <Alerts campaignId={view.campaignId} alerts={alerts} />
          {view.series.length > 0 && isKpiMeasure(l.kpiMeasure) && (
            <Card as="section" aria-labelledby="perf-chart-heading" className="space-y-4">
              <div className="space-y-1">
                <h2 id="perf-chart-heading" className="text-2xl font-strong tracking-tight">
                  Day by day
                </h2>
                <p className="max-w-prose text-sm text-ink-2">Each ad&apos;s simulated spend and its KPI over its last three simulated days, with the threshold and the days with events.</p>
              </div>
              <PerformanceChart series={view.series} ads={view.ads} threshold={{ measure: l.kpiMeasure, value: l.kpiValue }} days={view.days} />
            </Card>
          )}
          <AdsTable view={view} />
          <Ask campaignId={view.campaignId} panel={panel} questions={questions.filter((q) => q.launchId === l.id)} />
        </>
      )}
    </div>
  );
}

export default function PerformancePage(props: PageProps<"/campaigns/[id]/performance">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the campaign's performance" />}>
      <PerformancePageContent {...props} />
    </Suspense>
  );
}
