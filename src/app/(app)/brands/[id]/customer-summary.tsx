import type { CustomerSummary as Summary } from "@/lib/brands/summary";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { formatCount, formatMonth, formatShare } from "@/lib/format";

function formatDay(iso: string | undefined): string {
  if (!iso) return "the date it was made";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}


export function CustomerSummary({ summary, simulated }: { summary: Summary | null; simulated: boolean }) {
  return (
    <section aria-labelledby="customers" className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 id="customers" className="text-2xl font-strong tracking-tight">
            Customers and orders
          </h2>
          {/* Rule 1: once for the section, which every figure in it shares (U10-7), not on each figure. */}
          {simulated && <Pill tone="review">Simulated data</Pill>}
        </div>
        <p className="mt-1 max-w-prose text-ink-2">
          {simulated
            ? `Generated for the demo as of ${formatDay(summary?.asOf)}, not real people or sales. Customers carry no names or contact details.`
            : "From this brand's customers and orders. Customers carry no names or contact details."}
        </p>
      </div>

      {!summary || summary.customers === 0 ? (
        <EmptyState title="No customers or orders yet">
          The demo brands come with simulated customers and orders. Importing your own is a later step.
        </EmptyState>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 min-[30rem]:grid-cols-2 lg:grid-cols-4">
            <Stat label="Customers" value={formatCount(summary.customers)} />
            <Stat label="Orders" value={formatCount(summary.orders)} note={simulated ? "in the 24 months to the data date" : "in the last 24 months"} />
            <Stat
              label="Repeat-purchase rate"
              value={formatShare(summary.repeatRate)}
              note="of customers ordered twice or more"
            />
            <Stat
              label="Lapsed customers"
              value={formatCount(summary.lapsed)}
              note={`no order in 12 months (${formatShare(summary.lapsed / summary.customers)})`}
            />
          </dl>

          <Card data-figure="Orders by month">
            <OrdersByMonth months={summary.ordersByMonth} simulated={simulated} />
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card data-figure="Customers by region">
              <BarList title="Customers by region" id="by-region" items={summary.byRegion} total={summary.customers} />
            </Card>
            <Card data-figure="Customers by age band">
              <BarList title="Customers by age band" id="by-age" items={summary.byAgeBand} total={summary.customers} />
            </Card>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div data-figure={label} className="flex min-w-0 flex-col gap-2 rounded-card bg-surface p-5">
      <dt className="font-medium text-ink-2">{label}</dt>
      <dd className="text-3xl font-strong tracking-tight tabular-nums">{value}</dd>
      {note && <dd className="text-sm text-ink-2">{note}</dd>}
    </div>
  );
}

function FigureHeading({ id, title }: { id: string; title: string }) {
  return (
    <h3 id={id} className="text-lg font-strong">
      {title}
    </h3>
  );
}

function BarList({
  title,
  id,
  items,
  total,
}: {
  title: string;
  id: string;
  items: { label: string; count: number }[];
  total: number;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div>
      <FigureHeading id={id} title={title} />
      <ul aria-labelledby={id} className="mt-4 space-y-3">
        {items.map((i) => (
          <li key={i.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 wrap-anywhere">{i.label}</span>
              <span className="shrink-0 text-ink-2 tabular-nums">
                {formatCount(i.count)} · {formatShare(i.count / total)}
              </span>
            </div>
            <span aria-hidden className="mt-1 block h-2 rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(100 * i.count) / max}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrdersByMonth({ months, simulated }: { months: { month: string; count: number }[]; simulated: boolean }) {
  if (months.length === 0) return null;
  const max = Math.max(1, ...months.map((m) => m.count));
  const busiest = months.reduce((a, b) => (b.count > a.count ? b : a));
  const quietest = months.reduce((a, b) => (b.count < a.count ? b : a));
  const first = months[0].month;
  const last = months[months.length - 1].month;
  const label =
    `Bar chart of orders in each of the ${months.length} months from ${formatMonth(first, "long")} to ${formatMonth(last, "long")}` +
    `${simulated ? ", simulated data" : ""}. Busiest: ${formatMonth(busiest.month, "long")}, ${formatCount(busiest.count)} orders. ` +
    `Quietest: ${formatMonth(quietest.month, "long")}, ${formatCount(quietest.count)} orders. Every month is in the table that follows.`;
  return (
    <div>
      <FigureHeading id="by-month" title="Orders by month" />
      <div role="img" aria-label={label} className="mt-5">
        <div className="flex h-40 items-end gap-[3px] border-b border-line sm:gap-1.5">
          {months.map((m) => (
            <span
              key={m.month}
              title={`${formatMonth(m.month)}: ${formatCount(m.count)} orders`}
              className="block min-w-0 flex-1 rounded-t-md bg-primary"
              style={{ height: `${Math.max(1, (100 * m.count) / max)}%` }}
            />
          ))}
        </div>
        <div aria-hidden className="mt-2 flex justify-between text-sm text-ink-2">
          <span>{formatMonth(first)}</span>
          <span>{formatMonth(last)}</span>
        </div>
      </div>
      <details className="group mt-4 text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold text-primary">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          Show orders by month as a table
        </summary>
        <div className="mt-3 max-h-80 overflow-auto rounded-field bg-bg" tabIndex={0} aria-labelledby="by-month-caption">
          <table className="w-full text-left">
            <caption id="by-month-caption" className="sr-only">
              Orders by month{simulated ? " (simulated data)" : ""}
            </caption>
            <thead className="text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Month
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Orders
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 font-medium">
                    {formatMonth(m.month, "long")}
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(m.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
