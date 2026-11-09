// P9-3: a campaign's Performance view, its last stage (U10-2: with the stage
// bar, and locked with the reason until a launch is live or ended). Linked
// from the Launch (simulated) panel too. It reads stored facts only
// (src/lib/performance/dashboard.ts, through asUser()), and every figure on it
// is simulated and says so (rule 1). Server-rendered throughout: the chart is
// SVG with no client code.
//
// U10-4: what needs action first. Top to bottom: the healthy spend share, the
// ads below their threshold or tiring now (with the alerts that flagged
// them), the alerts (newest first; seen ones folded to one line, and a Below
// threshold alert whose ad has since recovered says so, worked out from the
// stored days), the ads table, the chart and its table as two tabs, then Ask
// (the latest answer open, older questions folded). Nothing here acts on an
// ad (rule 3): the only controls mark alerts as seen and ask questions.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { performanceReads } from "@/lib/campaigns/facts";
import { campaignStages } from "@/lib/campaigns/stages";
import { formatDay } from "@/components/format-day";
import { TextLink } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Card } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatPrice, formatWhen } from "@/lib/format";
import { ALERT_NAMES, NO_ALERTS, type AlertKind } from "@/lib/performance/alerts";
import { alertOneLine, ATTENTION_HEADING, needsAttention, newestFirst, NO_ATTENTION, recoveredLine, type AttentionAd } from "@/lib/performance/attention";
import type { AlertView } from "@/lib/performance/alerts-store";
import { askPanel, questionsFor, type AskPanel, type QuestionView } from "@/lib/performance/ask";
import { ANSWER_LABEL, CANNOT_ANSWER, MEASURE_LABELS, type QueryResult } from "@/lib/performance/ask-rules";
import { TREND_NOTE, type PerformanceView } from "@/lib/performance/dashboard";
import { HEALTHY_DEFINITION, NOT_ENOUGH_DATA, recoveredOn, shareText, STATUS_NAMES, type AdHealth, type AdStatus, type DayHealth } from "@/lib/performance/health";
import { isKpiMeasure, thresholdPhrase } from "@/lib/performance/launch-rules";
import { Tabs } from "@/components/ui/tabs";
import { adName, MEASURE_SHORT, PerformanceChart, PerformanceTable } from "./chart";
import { AskForm, MarkAllSeenButton, MarkSeenButton } from "./monitor-controls";
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
  // U10-4: compact on a phone, so the share and the first ad needing action are on the first screen.
  return (
    <Card className="max-sm:p-4" data-perf-header="">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-medium text-ink-2">
        <TextLink href={`/brands/${view.brand.id}`}>{view.brand.name}</TextLink>
        <Pill tone="review">Simulated</Pill>
      </p>
      <h1 className="mt-2 text-title font-strong sm:mt-3">Performance</h1>
      <p className="mt-1 max-w-prose text-sm text-ink-2 sm:mt-2 sm:text-lg sm:wrap-anywhere max-sm:truncate" title={view.title}>
        {view.title}
      </p>
      {l && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-3">
          <Pill tone={l.status === "live" ? "good" : "neutral"} dot={l.status === "live"}>
            {l.status === "live" ? (
              <>
                Live<span className="max-sm:sr-only"> (simulated)</span>
              </>
            ) : (
              "Ended"
            )}
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
  // U10-4: the share and its day first, the trend beside it from 768 px (the chart's table has every day's share
  // on a phone); what counts as healthy is with the ads table, one click away.
  return (
    <Card as="section" aria-labelledby="perf-share-label" data-perf-headline="" data-healthy-pence={String(healthy)} data-learning-pence={String(learning)} data-total-pence={String(total)} className="max-sm:p-4">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-end">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 md:block md:space-y-1">
            <h2 id="perf-share-label" className="font-semibold text-ink-2">
              Healthy spend share
            </h2>
            <p className="text-display font-strong" data-perf-share="">
              {d ? shareText(d.share) : NOT_ENOUGH_DATA}
            </p>
          </div>
          <p className="text-sm text-ink-2 sm:text-base">
            {!d ? (
              "The simulated results start once the first simulated day has run."
            ) : (
              <>
                {`Simulated day ${d.day}`}
                <span className="max-sm:hidden">{`, ${day(d.date)}`}</span>
                {d.share === null ? ": every ad is still learning, so there is nothing to judge yet." : `: ${formatPrice(healthy)} healthy of ${formatPrice(total - learning)} judged (simulated).`}
              </>
            )}{" "}
            {/* On a phone, with nothing learning, the line says nothing new; screen readers still hear it. */}
            <span className={cx("font-medium text-ink", learning === 0 && "max-sm:sr-only")} data-perf-learning="">
              {`Learning spend ${formatPrice(learning)} (simulated), left out`}
              <span className="max-sm:hidden"> of the share</span>.
            </span>
          </p>
        </div>
        <div className="max-md:hidden">
          <Trend series={view.series} days={view.days} />
        </div>
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
        <details className="group text-sm text-ink-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full font-semibold text-primary [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
              ›
            </span>
            What counts as healthy
          </summary>
          <div className="mt-2 space-y-1">
            <p className="max-w-prose" data-perf-definition="">
              {HEALTHY_DEFINITION}
            </p>
            <p data-perf-trend-note="">{TREND_NOTE}</p>
          </div>
        </details>
      </div>
      <table className="w-full text-left max-sm:block" data-perf-ads="">
        <caption className="sr-only">{`Each ad's simulated spend, ${short.toLowerCase()} over its last three days and status`}</caption>
        <thead className="text-sm text-ink-2 max-sm:sr-only">
          <tr>
            <th scope="col" className="py-2 pr-4 pl-3 font-semibold">
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
                id={`perf-ad-${a.variantId}`}
                data-perf-ad={a.variantId}
                data-status={status}
                data-day-spend-pence={String(h?.spendPence ?? 0)}
                className="scroll-mt-6 border-t border-line align-top target:bg-primary-soft max-sm:-mx-3 max-sm:block max-sm:space-y-1 max-sm:px-3 max-sm:py-3"
              >
                <th scope="row" className="py-3 pr-4 pl-3 text-left font-normal max-sm:block max-sm:p-0">
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
                  {h && <span className="text-sm text-ink-2 max-sm:ml-1.5 sm:block">{h.kpi.from === h.kpi.to ? `Day ${h.kpi.to}` : `Days ${h.kpi.from} to ${h.kpi.to}`}</span>}
                </td>
                <td className="py-3 pr-3 pl-4 max-sm:block max-sm:p-0 max-sm:pl-17">
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

const adLabel = (n: number) => (n > 0 ? `Ad ${n}` : "An ad no longer in the gallery");

/** U10-4: the ads below their threshold or tiring now, each with the alerts that flagged it. */
function Attention({ view, items, alerts }: { view: PerformanceView; items: AttentionAd[]; alerts: AlertView[] }) {
  const byId = new Map(alerts.map((a) => [a.id, a]));
  const ads = new Map(view.ads.map((a) => [a.variantId, a]));
  return (
    <Card as="section" aria-labelledby="perf-attention-heading" tone={items.length > 0 ? "attention" : "plain"} className="space-y-2 max-sm:p-4 sm:space-y-3" data-perf-attention="">
      <h2 id="perf-attention-heading" className="text-xl font-strong tracking-tight sm:text-2xl">
        {ATTENTION_HEADING}
      </h2>
      {items.length === 0 ? (
        <p className="text-ink-2" data-perf-attention-none="">
          {NO_ATTENTION}
        </p>
      ) : (
        <ul className="max-sm:divide-y max-sm:divide-line sm:grid sm:grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] sm:gap-x-8 sm:gap-y-5">
          {items.map((item) => {
            const ad = ads.get(item.variantId);
            return (
              <li key={item.variantId} data-attention-ad={item.variantId} data-reasons={item.reasons.join(" ")} className="space-y-1 max-sm:py-1.5 max-sm:first:pt-0 max-sm:last:pb-0 sm:space-y-1.5">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a href={`#perf-ad-${item.variantId}`} className="font-semibold text-primary underline-offset-4 hover:underline" data-attention-name="">
                    {ad ? adName(ad) : adLabel(0)}
                  </a>
                  {item.reasons.map((r) => (
                    <Pill key={r} tone={ALERT_TONE[r]}>
                      <span data-attention-reason="">{ALERT_NAMES[r]}</span>
                    </Pill>
                  ))}
                </p>
                {item.alertIds.map((id) => {
                  const alert = byId.get(id);
                  return (
                    alert && (
                      // On a phone each alert is one line here, so every ad needing action is near the top; the alert is in full under Alerts.
                      <p key={id} title={alert.line} className="max-w-prose text-sm text-ink-2 max-sm:truncate sm:wrap-anywhere" data-attention-alert={id}>
                        {alert.line}
                      </p>
                    )
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** "Recovered on day N", when the alert's ad has recovered (worked out from the stored days, never stored). */
function Recovered({ day }: { day: number | null }) {
  if (day === null) return null;
  return (
    <Pill tone="good">
      <span data-alert-recovered="">{recoveredLine(day)}</span>
    </Pill>
  );
}

function AdLink({ alert }: { alert: AlertView }) {
  return (
    <a href={`#perf-ad-${alert.variantId}`} className="text-sm font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline" data-alert-ad-link="">
      {`See ${adLabel(alert.adNumber)} in the table`}
    </a>
  );
}

/**
 * P9-4: the monitor's alerts. They only tell: the controls are Mark as seen
 * and Mark all as seen (rule 3). U10-4: newest first; an unseen alert in full,
 * a seen one folded to one line that opens in place.
 */
function Alerts({ campaignId, alerts, series }: { campaignId: string; alerts: AlertView[]; series: DayHealth[] }) {
  const unseen = alerts.filter((a) => !a.seenAt).length;
  return (
    <Card as="section" aria-labelledby="perf-alerts-heading" className="space-y-4" data-perf-alerts="">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 id="perf-alerts-heading" className="text-2xl font-strong tracking-tight">
            Alerts (simulated)
          </h2>
          <p className="max-w-prose text-sm text-ink-2">
            Raised when an ad misses its threshold two simulated days in a row, tires (its three-day click-through rate 25% or more below its best) or stops passing compliance. Alerts change nothing on their own.
          </p>
        </div>
        {unseen > 0 && <MarkAllSeenButton campaignId={campaignId} />}
      </div>
      {alerts.length === 0 ? (
        <p className="text-ink-2">{NO_ALERTS}</p>
      ) : (
        <ul className="divide-y divide-line">
          {alerts.map((a) => {
            const recovered = recoveredOn(series, a);
            const seen = a.seenAt !== null;
            const facts = (
              <p id={`alert-${a.id}-facts`} className="max-w-prose wrap-anywhere" data-alert-facts="">
                {a.line}
              </p>
            );
            return (
              <li key={a.id} data-perf-alert={a.id} data-kind={a.kind} data-day={String(a.day)} data-seen={seen ? "" : undefined} className="py-3 first:pt-0 last:pb-0">
                {seen ? (
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <details className="group min-w-0 sm:flex-1">
                      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-field [&::-webkit-details-marker]:hidden">
                        <span aria-hidden className="inline-block text-ink-2 transition-transform group-open:rotate-90 motion-reduce:transition-none">
                          ›
                        </span>
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 text-ink-2" data-alert-oneline="">
                            {alertOneLine(a)}
                          </span>
                          <Recovered day={recovered} />
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1.5 pl-4">
                        {facts}
                        <p className="text-sm text-ink-2 wrap-anywhere" data-alert-seen="">{`Seen by ${a.seenByName ?? "a member of this workspace"}, ${formatWhen(a.seenAt!)}`}</p>
                      </div>
                    </details>
                    <div className="pl-4 sm:pl-0">
                      <AdLink alert={a} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)_auto] lg:items-start lg:gap-x-6 lg:gap-y-1.5 lg:space-y-0">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:row-span-2 lg:flex-col lg:items-start">
                      <span data-alert-kind="">
                        <Pill tone={ALERT_TONE[a.kind]}>{ALERT_NAMES[a.kind]}</Pill>
                      </span>
                      <span className="text-sm font-semibold text-ink-2 tabular-nums" data-alert-day="">{`Simulated day ${a.day}`}</span>
                      <Recovered day={recovered} />
                    </p>
                    <div className="lg:row-span-2">{facts}</div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 lg:contents">
                      <div className="lg:col-start-3 lg:row-start-1 lg:justify-self-end">
                        <MarkSeenButton campaignId={campaignId} alertId={a.id} describedBy={`alert-${a.id}-facts`} />
                      </div>
                      <div className="lg:col-start-3 lg:row-start-2 lg:justify-self-end">
                        <AdLink alert={a} />
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** U10-4: the chart and its table, as two tabs; the chart stays described by the table. */
function Views({ view }: { view: PerformanceView }) {
  const l = view.launch!;
  if (view.series.length === 0 || !isKpiMeasure(l.kpiMeasure)) return null;
  return (
    <Card as="section" aria-labelledby="perf-chart-heading" className="space-y-4" data-perf-views="">
      <div className="space-y-1">
        <h2 id="perf-chart-heading" className="text-2xl font-strong tracking-tight">
          Day by day
        </h2>
        <p className="max-w-prose text-sm text-ink-2">Each ad&apos;s simulated spend and its KPI over its last three simulated days, with the threshold and the days with events.</p>
      </div>
      <Tabs
        labelledBy="perf-chart-heading"
        items={[
          {
            id: "chart",
            label: "Chart",
            tabData: { "data-perf-tab": "chart" },
            panelData: { "data-perf-tabpanel": "chart" },
            panel: <PerformanceChart series={view.series} ads={view.ads} threshold={{ measure: l.kpiMeasure, value: l.kpiValue }} days={view.days} />,
          },
          {
            id: "table",
            label: "Table",
            tabData: { "data-perf-tab": "table" },
            panelData: { "data-perf-tabpanel": "table" },
            panelFocusable: false,
            panel: <PerformanceTable series={view.series} ads={view.ads} measure={l.kpiMeasure} />,
          },
        ]}
      />
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

/** A question's answer and the table it used. */
function Answer({ q }: { q: QuestionView }) {
  return (
    <>
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
    </>
  );
}

const askedBy = (q: QuestionView) => `Asked by ${q.askedByName ?? "a member of this workspace"}, ${formatWhen(q.askedAt)}`;

/** One question, as asked (plain text), with its answer and the table it used. U10-4: an older one is folded to its question. */
function Question({ q, latest }: { q: QuestionView; latest: boolean }) {
  if (!latest) {
    return (
      <li data-ask-question={q.id} data-status={q.status} className="border-t border-line pt-4">
        <details className="group" data-ask-older="">
          <summary className="flex cursor-pointer list-none items-start gap-2 rounded-field [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block text-ink-2 transition-transform group-open:rotate-90 motion-reduce:transition-none">
              ›
            </span>
            <span className="min-w-0 font-semibold wrap-anywhere whitespace-pre-wrap" data-ask-text="">
              {q.question}
            </span>
          </summary>
          <div className="mt-3 space-y-3 pl-4">
            <p className="text-sm text-ink-2 wrap-anywhere">{askedBy(q)}</p>
            <Answer q={q} />
          </div>
        </details>
      </li>
    );
  }
  return (
    <li data-ask-question={q.id} data-status={q.status} className="space-y-3 border-t border-line pt-5">
      <div className="space-y-1">
        <p className="font-semibold wrap-anywhere whitespace-pre-wrap" data-ask-text="">
          {q.question}
        </p>
        <p className="text-sm text-ink-2 wrap-anywhere">{askedBy(q)}</p>
      </div>
      <Answer q={q} />
    </li>
  );
}

/** P9-4: Ask about this campaign: the box, then the questions about the shown launch, newest first. */
function Ask({ campaignId, panel, questions }: { campaignId: string; panel: AskPanel; questions: QuestionView[] }) {
  const pending = questions.some((q) => q.status === "pending");
  return (
    <Card as="section" aria-labelledby="perf-ask-heading" className="space-y-5" data-perf-ask="">
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
        <ol className="space-y-4" aria-label="Questions asked, newest first">
          {questions.map((q, i) => (
            <Question key={q.id} q={q} latest={i === 0} />
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
  const sorted = newestFirst(alerts, view.ads);
  const attention = needsAttention(view.ads, view.latest, sorted);
  return (
    <div className="space-y-3 sm:space-y-8">
      <div className="space-y-3 sm:space-y-4">
        <div>
          <TextLink href={`/campaigns/${view.campaignId}`} data-campaign-overview="">
            <span aria-hidden>← </span>Overview
          </TextLink>
          <div className="mt-2 sm:mt-3">
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
          <Attention view={view} items={attention} alerts={alerts} />
          <Alerts campaignId={view.campaignId} alerts={sorted} series={view.series} />
          <AdsTable view={view} />
          <Views view={view} />
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
