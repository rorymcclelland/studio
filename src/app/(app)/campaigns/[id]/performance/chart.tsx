// P9-3: the Performance view's daily chart, server-rendered SVG with no client
// code and no hooks (so it renders anywhere, tests too). Two panels, each with
// its own single axis (never a dual axis): spend per ad per day, and the KPI
// over each ad's last three simulated days with the launch's threshold. Days
// with events are shaded and marked. Everything is simulated and says so
// (rule 1), and a table version of every day is the chart's text alternative
// (PerformanceTable; U10-4 shows it in its own tab).
//
// It stays legible on a phone: the outer SVG has no viewBox, so its text and
// markers are drawn at their real size, with x in per cent of the width and y
// in pixels; only the lines sit in an inner SVG stretched to the width (their
// strokes don't scale).
import { formatPrice } from "@/lib/format";
import { shareText, type DayHealth, type HealthThreshold } from "@/lib/performance/health";
import { formatPounds, HEALTHY_WHEN, type KpiMeasure } from "@/lib/performance/launch-rules";

export type ChartAd = { variantId: string; adNumber: number; headline: string };

/** The chart tokens, in their fixed order (globals.css). An ad keeps its colour by its place in the launch. */
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];
const SWATCH = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6", "bg-chart-7", "bg-chart-8"];
export const seriesColour = (i: number) => SERIES[i % SERIES.length];
export const seriesSwatch = (i: number) => SWATCH[i % SWATCH.length];

/** Short names for the chart's panel and table (the launch panel's longer names don't fit a phone). */
export const MEASURE_SHORT: Record<KpiMeasure, string> = {
  ctr: "Click-through rate",
  conversion_rate: "Conversion rate",
  cpa: "Cost per acquisition",
  roas: "Return on ad spend",
};

export const TABLE_ID = "perf-chart-table";
const TITLE_ID = "perf-chart-title";

const shortDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "Fri 27 Nov", from YYYY-MM-DD. */
export function dayDate(date: string): string {
  return shortDate.format(new Date(`${date}T12:00:00Z`));
}

export const adName = (a: ChartAd) => (a.adNumber > 0 ? `Ad ${a.adNumber}` : "An ad no longer in the gallery");

// ---------------------------------------------------------------- geometry (px)

const PLOTS = [
  { title: 14, top: 38, height: 108 },
  { title: 176, top: 200, height: 108 },
] as const;
const BAND_TOP = PLOTS[0].top;
const BAND_BOTTOM = PLOTS[1].top + PLOTS[1].height;
const AXIS_Y = BAND_BOTTOM + 18;
const CAPTION_Y = AXIS_Y + 20;
const HEIGHT = CAPTION_Y + 6;
const INNER_WIDTH = 1000;
/** The left gutter for the value ticks, in per cent of the width, so a day-1 marker never covers one. */
const GUTTER = 10;

/** A clean top for an axis from 0: 1, 2, 2.5 or 5 times a power of ten, so two steps reach the largest value. */
function niceTop(max: number): number {
  if (!(max > 0) || !Number.isFinite(max)) return 1;
  const half = max / 2;
  const p = 10 ** Math.floor(Math.log10(half));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= half)!;
  return step * 2;
}

function kpiTick(measure: KpiMeasure, v: number): string {
  const n = String(Number(v.toFixed(2)));
  if (measure === "cpa") return formatPounds(Math.round(v * 100));
  if (measure === "roas") return `${n}×`;
  return `${n}%`;
}

const pct = (n: number) => `${Number(n.toFixed(4))}%`;

/** A KPI that can be drawn: no conversions or no clicks leave a gap. */
const drawable = (k: DayHealth["ads"][number]["kpi"]) => Number.isFinite(k.value) && !k.shown.startsWith("No ");

type Point = { day: number; value: number };

/** The runs of consecutive drawable points, so a gap breaks the line. */
function runs(points: (Point | null)[]): Point[][] {
  const out: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) {
      out.push(run);
      run = [];
    }
  }
  if (run.length) out.push(run);
  return out;
}

export function PerformanceChart({ series, ads, threshold, days }: { series: DayHealth[]; ads: ChartAd[]; threshold: HealthThreshold; days: number }) {
  const span = Math.max(days, series.at(-1)?.day ?? 1, 1);
  const xPct = (day: number) => GUTTER + ((day - 0.5) / span) * (100 - GUTTER);
  const xInner = (day: number) => (xPct(day) / 100) * INNER_WIDTH;
  const bandX = (day: number) => pct(GUTTER + ((day - 1) / span) * (100 - GUTTER));
  const bandW = pct((100 - GUTTER) / span);
  const short = MEASURE_SHORT[threshold.measure];
  const last = series.at(-1)?.day ?? 0;

  // Each ad's points per panel, in day order.
  const adPoints = ads.map((a) => {
    const spend: (Point | null)[] = [];
    const kpi: (Point | null)[] = [];
    for (const d of series) {
      const h = d.ads.find((x) => x.variantId === a.variantId);
      spend.push(h ? { day: d.day, value: h.spendPence } : null);
      kpi.push(h && drawable(h.kpi) ? { day: d.day, value: h.kpi.value } : null);
    }
    return { spend, kpi };
  });
  const values = (k: "spend" | "kpi") => adPoints.flatMap((p) => p[k]).flatMap((p) => (p ? [p.value] : []));
  const tops = [niceTop(Math.max(0, ...values("spend"))), niceTop(Math.max(threshold.value, ...values("kpi")))];
  const yOf = (panel: 0 | 1, v: number) => PLOTS[panel].top + PLOTS[panel].height * (1 - Math.min(v, tops[panel]) / tops[panel]);
  const tickText = (panel: 0 | 1, v: number) => (panel === 0 ? formatPounds(Math.round(v)) : kpiTick(threshold.measure, v));

  // Day numbers along the bottom: day 1, then every week (every fortnight on a long launch), and the last day.
  const every = span > 35 ? 14 : 7;
  const ticks = [1];
  for (let d = 1 + every; d <= span; d += every) ticks.push(d);
  if (span - ticks.at(-1)! >= Math.ceil(every / 2)) ticks.push(span);

  const thresholdY = yOf(1, threshold.value);
  const thresholdLabel = `Threshold ${kpiTick(threshold.measure, threshold.value)} (${HEALTHY_WHEN[threshold.measure]})`;
  const title = `Daily spend and ${short.toLowerCase()} over the last three days for each ad, simulated days 1 to ${last} of ${span} (simulated)`;

  const dayTitle = (d: DayHealth) => {
    const parts = ads.flatMap((a) => {
      const h = d.ads.find((x) => x.variantId === a.variantId);
      return h ? [`${adName(a)}: ${formatPrice(h.spendPence)}, ${h.kpi.shown}`] : [];
    });
    const events = d.events.length ? ` (${d.events.join(", ")})` : "";
    return `Day ${d.day}, ${dayDate(d.date)}${events}. Healthy spend share ${shareText(d.share)}. ${parts.join("; ")}. Simulated.`;
  };

  // The simulator splits the budget evenly, so the spend lines often sit on top of one another: say so.
  const evenSpend =
    ads.length > 1 &&
    series.every((d) => {
      const spends = d.ads.map((a) => a.spendPence);
      return Math.max(...spends) - Math.min(...spends) <= 1;
    });
  const named = series.flatMap((d) => d.events.filter((e) => e !== "Weekend").map((e) => ({ name: e, day: d.day, date: d.date })));

  return (
    <div className="space-y-4" data-perf-chart-wrap="">
      <ul aria-label="Ads on the chart" className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {ads.map((a, i) => (
          <li key={a.variantId} className="flex min-w-0 items-center gap-2" data-perf-legend={a.variantId}>
            <span aria-hidden className={`h-1 w-5 shrink-0 rounded-full ${seriesSwatch(i)}`} />
            <span className="min-w-0 wrap-anywhere">
              <span className="font-semibold">{adName(a)}</span>
              {a.headline ? `: ${a.headline}` : ""}
            </span>
          </li>
        ))}
      </ul>

      <svg
        data-perf-chart=""
        role="img"
        aria-labelledby={TITLE_ID}
        aria-describedby={TABLE_ID}
        width="100%"
        height={HEIGHT}
        className="block overflow-visible font-sans"
      >
        <title id={TITLE_ID}>{title}</title>

        {/* Days with events: weekends shaded, other events shaded and marked at the top. */}
        {series
          .filter((d) => d.events.length > 0)
          .map((d) => {
            const weekendOnly = d.events.every((e) => e === "Weekend");
            return (
              <g key={d.day} data-perf-event={d.date} data-events={d.events.join(", ")}>
                <title>{`Day ${d.day}, ${dayDate(d.date)}: ${d.events.join(", ")}`}</title>
                <rect x={bandX(d.day)} width={bandW} y={BAND_TOP} height={BAND_BOTTOM - BAND_TOP} fill={weekendOnly ? "var(--surface-2)" : "var(--primary-soft)"} />
                {!weekendOnly && <rect x={bandX(d.day)} width={bandW} y={BAND_TOP - 5} height={4} rx={1} fill="var(--primary)" />}
              </g>
            );
          })}

        {/* Panel titles, the Simulated label, gridlines and ticks. */}
        <text x="0" y={PLOTS[0].title} fill="var(--ink)" fontSize="13" fontWeight="600">
          Spend per ad per day
        </text>
        <text x="100%" y={PLOTS[0].title} textAnchor="end" fill="var(--ink-2)" fontSize="12" fontWeight="600">
          Simulated
        </text>
        <text x="0" y={PLOTS[1].title} fill="var(--ink)" fontSize="13" fontWeight="600">
          {`${short}, last three days`}
        </text>
        {([0, 1] as const).map((panel) =>
          [0, 0.5, 1].map((f) => {
            const v = tops[panel] * f;
            const y = yOf(panel, v);
            return (
              <g key={`${panel}-${f}`}>
                <line x1={`${GUTTER}%`} x2="100%" y1={y} y2={y} stroke="var(--line)" strokeWidth="1" shapeRendering="crispEdges" />
                <text x="0" y={y + 4} fill="var(--ink-2)" fontSize="11" className="tabular-nums">
                  {tickText(panel, v)}
                </text>
              </g>
            );
          }),
        )}

        {/* The threshold, on the KPI panel. */}
        <line x1={`${GUTTER}%`} x2="100%" y1={thresholdY} y2={thresholdY} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="100%" y={thresholdY - 5} textAnchor="end" fill="var(--ink)" fontSize="11" fontWeight="600" stroke="var(--surface)" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">
          {thresholdLabel}
        </text>

        {/* The lines, stretched to the width; strokes keep their 2px. */}
        <svg x="0" y="0" width="100%" height={HEIGHT} viewBox={`0 0 ${INNER_WIDTH} ${HEIGHT}`} preserveAspectRatio="none" overflow="visible" aria-hidden>
          {adPoints.flatMap((p, i) =>
            (["spend", "kpi"] as const).flatMap((k) =>
              runs(p[k])
                .filter((r) => r.length > 1)
                .map((r, j) => (
                  <polyline
                    key={`${i}-${k}-${j}`}
                    points={r.map((pt) => `${xInner(pt.day).toFixed(2)},${yOf(k === "spend" ? 0 : 1, pt.value).toFixed(2)}`).join(" ")}
                    fill="none"
                    stroke={seriesColour(i)}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )),
            ),
          )}
        </svg>

        {/* Markers at their real size: each line's latest point, and any point standing alone. */}
        {adPoints.flatMap((p, i) =>
          (["spend", "kpi"] as const).flatMap((k) =>
            runs(p[k]).flatMap((r, j, all) => {
              const ends = j === all.length - 1 ? [r.at(-1)!] : r.length === 1 ? [r[0]] : [];
              return ends.map((pt) => (
                <circle
                  key={`${i}-${k}-${pt.day}`}
                  cx={pct(xPct(pt.day))}
                  cy={yOf(k === "spend" ? 0 : 1, pt.value)}
                  r={j === all.length - 1 ? 4 : 3}
                  fill={seriesColour(i)}
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
              ));
            }),
          ),
        )}

        {/* Day numbers. */}
        {ticks.map((d) => (
          <text key={d} x={pct(xPct(d))} y={AXIS_Y} textAnchor="middle" fill="var(--ink-2)" fontSize="11" className="tabular-nums">
            {String(d)}
          </text>
        ))}
        <text x="0" y={CAPTION_Y} fill="var(--ink-2)" fontSize="11">
          {`Simulated day (of ${span})`}
        </text>

        {/* Hover: each day's figures, over both panels. */}
        {series.map((d) => (
          <rect key={d.day} x={bandX(d.day)} width={bandW} y={BAND_TOP} height={BAND_BOTTOM - BAND_TOP} fill="transparent">
            <title>{dayTitle(d)}</title>
          </rect>
        ))}
      </svg>

      {evenSpend && (
        <p className="max-w-prose text-sm text-ink-2" data-perf-even-spend="">
          Every ad spends the same each simulated day (the budget is split evenly), so their spend lines sit on top of one another.
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-2" data-perf-chart-key="">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-0 w-5 border-t-2 border-dashed border-ink" />
          The launch&apos;s threshold
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm border border-line bg-surface-2" />
          Weekend
        </span>
        {named.length > 0 && (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="size-3 shrink-0 rounded-sm border-t-4 border-primary bg-primary-soft" />
            <span className="min-w-0 wrap-anywhere">{named.map((e) => `${e.name} (day ${e.day}, ${dayDate(e.date)})`).join("; ")}</span>
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * U10-4: the chart's table, every simulated day: the chart's text alternative
 * (the chart's aria-describedby points at it), shown in the Table tab and kept
 * in the page while the Chart tab is selected.
 */
export function PerformanceTable({ series, ads, measure }: { series: DayHealth[]; ads: ChartAd[]; measure: KpiMeasure }) {
  const short = MEASURE_SHORT[measure];
  return (
    <div className="max-h-112 overflow-auto rounded-field bg-bg text-sm" tabIndex={0} role="region" aria-labelledby={`${TABLE_ID}-caption`}>
      <table data-perf-chart-table="" id={TABLE_ID} className="w-full text-left">
        <caption id={`${TABLE_ID}-caption`} className="sr-only">
          {`Spend and ${short.toLowerCase()} over the last three days for each ad, with the healthy spend share and events, by simulated day (simulated)`}
        </caption>
        <thead className="text-ink-2">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
              Day
            </th>
            {ads.map((a) => [
              <th key={`${a.variantId}-spend`} scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                {`${adName(a)} spend`}
              </th>,
              <th key={`${a.variantId}-kpi`} scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                {`${adName(a)} ${short.toLowerCase()}`}
              </th>,
            ])}
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              Healthy spend share
            </th>
            <th scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
              Events
            </th>
          </tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.day} data-perf-chart-row={String(d.day)} className="border-t border-line">
              <th scope="row" className="px-3 py-1.5 font-medium whitespace-nowrap">
                {`Day ${d.day}, ${dayDate(d.date)}`}
              </th>
              {ads.map((a) => {
                const h = d.ads.find((x) => x.variantId === a.variantId);
                return [
                  <td key={`${a.variantId}-spend`} data-perf-cell-spend={a.variantId} className="px-3 py-1.5 text-right tabular-nums">
                    {h ? formatPrice(h.spendPence) : "No row"}
                  </td>,
                  <td key={`${a.variantId}-kpi`} data-perf-cell-kpi={a.variantId} className="px-3 py-1.5 text-right tabular-nums">
                    {h ? h.kpi.shown : "No row"}
                  </td>,
                ];
              })}
              <td data-perf-cell-share="" className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                {d.shareShown}
              </td>
              <td data-perf-cell-events="" className="px-3 py-1.5">
                {d.events.join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
