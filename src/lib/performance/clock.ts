// P9-2: the simulated clock. A person moves a live launch on by a day, a week
// or to its end (Q2); each step writes that many days' results for every
// launched ad, from the pure simulator (simulate.ts), and moves
// launches.sim_day on. Pure code: no model call and no cost (rule 5).
//
// A step runs in one transaction that holds the launch's row lock, and it
// carries the day the page showed (fromDay): when the clock has already moved
// on from that day (a double click, or another tab), it writes nothing and
// returns where the clock is now, so two clicks never move it twice. Every
// read and write goes through asUser() (rule 7): another workspace's launch is
// the same refusal as one that isn't there.
//
// P9-4: in the same transaction, after the step's rows are written, the
// monitor's alerts are worked out in code (alerts.ts) from every stored row of
// the launch and compliance worked out again now, and stored once per ad and
// kind. Alerts only tell; nothing here acts on them (rule 3).
import type { Member } from "@/lib/agents/runs";
import { asUser } from "@/lib/db/scoped";
import { alertsFor, type AlertKind } from "./alerts";
import { isClockStep, SIM_AT_END, SIM_NOT_LIVE, SIM_STEP_NOT_VALID, stepTo, type ClockStep } from "./clock-rules";
import { COMPLIANCE_GONE, complianceTodayIn } from "./dashboard";
import { isKpiMeasure, type LaunchAd } from "./launch";
import { simulateDays, type SimLaunch, type SimRow } from "./simulate";

export * from "./clock-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClockError";
  }
}

export type ClockResult = { simDay: number; days: number; written: number };

/**
 * Moves a live launch on from `fromDay` (the day the page showed) by a day, a
 * week or to its last day, writing each new day's rows for every launched ad.
 * `written` is the number of rows written: 0 when the clock had already moved
 * on from `fromDay`. With `campaignId`, a launch of another campaign is
 * refused as not live. Reaching the last day leaves the launch live (a person
 * ends it).
 */
export async function advance(member: Member, launchId: string, by: ClockStep, fromDay: number, opts: { campaignId?: string } = {}): Promise<ClockResult> {
  if (!isClockStep(by) || !Number.isInteger(fromDay) || fromDay < 0) throw new ClockError(SIM_STEP_NOT_VALID);
  if (typeof launchId !== "string" || !UUID.test(launchId)) throw new ClockError(SIM_NOT_LIVE);
  if (opts.campaignId !== undefined && (typeof opts.campaignId !== "string" || !UUID.test(opts.campaignId))) throw new ClockError(SIM_NOT_LIVE);

  return asUser(member.userId, async (tx) => {
    // The row lock: a second request waits here, then sees the day the first one reached. The brand's
    // prices, the stored days and the alerts already raised come with it, so a step is a fixed few queries.
    const [l] = await tx`
      select l.workspace_id, l.campaign_id, l.status, l.sim_day, l.days, l.seed::text as seed, to_char(l.starts_on, 'YYYY-MM-DD') as starts_on,
        l.daily_budget_pence, l.ads, l.kpi_measure, l.kpi_value::text as kpi_value,
        (select coalesce(json_agg(p.price_pence order by p.price_pence), '[]'::json)
          from public.products p where p.brand_id = c.brand_id and p.active) as prices,
        (select coalesce(json_agg(json_build_object(
            'variantId', d.variant_id, 'day', d.day, 'date', to_char(d.date, 'YYYY-MM-DD'), 'impressions', d.impressions, 'clicks', d.clicks,
            'conversions', d.conversions, 'spendPence', d.spend_pence, 'revenuePence', d.revenue_pence, 'events', d.events)), '[]'::json)
          from public.sim_daily d where d.launch_id = l.id and d.day <= l.sim_day) as history,
        (select coalesce(json_agg(json_build_object('variantId', a.variant_id, 'kind', a.kind)), '[]'::json)
          from public.performance_alerts a where a.launch_id = l.id) as raised
      from public.launches l join public.campaigns c on c.id = l.campaign_id
      where l.id = ${launchId}
      for update of l`;
    if (!l || l.status !== "live" || (opts.campaignId !== undefined && l.campaign_id !== opts.campaignId)) throw new ClockError(SIM_NOT_LIVE);
    const simDay = l.sim_day as number;
    const days = l.days as number;
    if (simDay !== fromDay) return { simDay, days, written: 0 };
    if (simDay >= days) throw new ClockError(SIM_AT_END);
    if (!isKpiMeasure(l.kpi_measure)) throw new Error(`A launch has an unknown KPI measure: ${l.kpi_measure}`);

    const ads = l.ads as LaunchAd[];
    const launch: SimLaunch = {
      seed: l.seed,
      startsOn: l.starts_on,
      days,
      dailyBudgetPence: l.daily_budget_pence,
      ads,
      orderValuesPence: l.prices as number[],
    };
    const history = l.history as SimRow[];
    const to = stepTo(simDay, days, by);
    const simulated = simulateDays(launch, simDay + 1, to, history);
    const rows = simulated.map((r) => ({
      workspace_id: l.workspace_id as string,
      launch_id: launchId,
      variant_id: r.variantId,
      day: r.day,
      date: r.date,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      spend_pence: r.spendPence,
      revenue_pence: r.revenuePence,
      events: r.events,
    }));

    // The monitor (P9-4): compliance as it is now, once for every ad, then the alerts due on the new days.
    const compliance = await complianceTodayIn(tx, ads);
    const alerts = alertsFor(
      {
        threshold: { measure: l.kpi_measure, value: Number(l.kpi_value) },
        ads: ads.map((a) => ({ variantId: a.variantId, compliance: compliance.get(a.variantId) ?? { compliant: false, reason: COMPLIANCE_GONE } })),
        rows: [...history, ...simulated],
        raised: l.raised as { variantId: string; kind: AlertKind }[],
      },
      simDay + 1,
      to,
    );
    const alertRows = alerts.map((a) => ({
      workspace_id: l.workspace_id as string,
      launch_id: launchId,
      variant_id: a.variantId,
      day: a.day,
      kind: a.kind,
      facts: tx.json(a.facts as never),
    }));

    // The days, their alerts (each once, so a second step can't raise one twice) and the clock, in one statement.
    await tx`
      with ${rows.length ? tx`days_in as (insert into public.sim_daily ${tx(rows)} returning 1),` : tx``}
        ${alertRows.length ? tx`alerts_in as (insert into public.performance_alerts ${tx(alertRows as never)} on conflict (launch_id, variant_id, kind) do nothing returning 1),` : tx``}
        moved as (update public.launches set sim_day = ${to} where id = ${launchId} returning 1)
      select (select count(*) from moved) as moved`;
    return { simDay: to, days, written: rows.length };
  });
}
