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
import type { Member } from "@/lib/agents/runs";
import { asUser } from "@/lib/db/scoped";
import { isClockStep, SIM_AT_END, SIM_NOT_LIVE, SIM_STEP_NOT_VALID, stepTo, type ClockStep } from "./clock-rules";
import type { LaunchAd } from "./launch";
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
    // The row lock: a second request waits here, then sees the day the first one reached.
    const [l] = await tx`
      select l.workspace_id, l.campaign_id, l.status, l.sim_day, l.days, l.seed::text as seed, to_char(l.starts_on, 'YYYY-MM-DD') as starts_on,
        l.daily_budget_pence, l.ads, c.brand_id
      from public.launches l join public.campaigns c on c.id = l.campaign_id
      where l.id = ${launchId}
      for update of l`;
    if (!l || l.status !== "live" || (opts.campaignId !== undefined && l.campaign_id !== opts.campaignId)) throw new ClockError(SIM_NOT_LIVE);
    const simDay = l.sim_day as number;
    const days = l.days as number;
    if (simDay !== fromDay) return { simDay, days, written: 0 };
    if (simDay >= days) throw new ClockError(SIM_AT_END);

    const prices = await tx`
      select price_pence from public.products where brand_id = ${l.brand_id} and active order by price_pence`;
    const launch: SimLaunch = {
      seed: l.seed,
      startsOn: l.starts_on,
      days,
      dailyBudgetPence: l.daily_budget_pence,
      ads: l.ads as LaunchAd[],
      orderValuesPence: prices.map((p) => p.price_pence as number),
    };
    const stored = await tx`
      select variant_id, day, to_char(date, 'YYYY-MM-DD') as date, impressions, clicks, conversions, spend_pence, revenue_pence, events
      from public.sim_daily where launch_id = ${launchId} and day <= ${simDay}`;
    const history: SimRow[] = stored.map((r) => ({
      variantId: r.variant_id,
      day: r.day,
      date: r.date,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      spendPence: r.spend_pence,
      revenuePence: r.revenue_pence,
      events: r.events,
    }));

    const to = stepTo(simDay, days, by);
    const rows = simulateDays(launch, simDay + 1, to, history).map((r) => ({
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
    if (rows.length) await tx`insert into public.sim_daily ${tx(rows)}`;
    await tx`update public.launches set sim_day = ${to} where id = ${launchId}`;
    return { simDay: to, days, written: rows.length };
  });
}
