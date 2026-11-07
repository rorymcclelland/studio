// P9-4: the monitor's stored alerts, for the Performance view and Studio's
// home. The clock raises them (clock.ts); a person can only mark one as seen.
// Every read and write goes through asUser() (rule 7): another workspace's
// alert or campaign is the same refusal as one that isn't there.
import type { Member } from "@/lib/agents/runs";
import { asUser, type Tx } from "@/lib/db/scoped";
import { ALERT_KINDS, alertLine, type Alert, type AlertKind } from "./alerts";
import { launchAdsFor, type LaunchAd } from "./launch";

export const ALERT_NOT_FOUND = "That alert isn't in your workspace.";

export class AlertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertError";
  }
}

export type AlertView = {
  id: string;
  launchId: string;
  variantId: string;
  adNumber: number;
  kind: AlertKind;
  day: number;
  facts: Alert["facts"];
  line: string;
  seenBy: string | null;
  /** The person's email. */
  seenByName: string | null;
  seenAt: Date | null;
  createdAt: Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALERT_COLUMNS = (tx: Tx) => tx`
  a.id, a.launch_id, a.variant_id, a.kind, a.day, a.facts, a.seen_by, public.member_email(a.seen_by) as seen_by_name, a.seen_at, a.created_at`;

type Row = Record<string, unknown>;

/** Alerts as people see them: each ad by its gallery number, each with its line. */
function toViews(rows: Row[], numbers: Map<string, number>): AlertView[] {
  return rows.map((r) => {
    const adNumber = numbers.get(r.variant_id as string) ?? 0;
    const alert = { kind: r.kind, variantId: r.variant_id, day: r.day, facts: r.facts } as Alert;
    return {
      id: r.id as string,
      launchId: r.launch_id as string,
      variantId: r.variant_id as string,
      adNumber,
      kind: r.kind as AlertKind,
      day: r.day as number,
      facts: r.facts as Alert["facts"],
      line: alertLine(alert, adNumber),
      seenBy: (r.seen_by as string | null) ?? null,
      seenByName: r.seen_by ? ((r.seen_by_name as string | null) ?? null) : null,
      seenAt: (r.seen_at as Date | null) ?? null,
      createdAt: r.created_at as Date,
    };
  });
}

async function adNumbers(userId: string, campaignId: string, ads: LaunchAd[]): Promise<Map<string, number>> {
  const views = await launchAdsFor(userId, campaignId, ads);
  return new Map(views.map((v) => [v.variantId, v.adNumber]));
}

/**
 * The alerts of the launch the Performance view shows (live, else the newest
 * ended): by day, then the launch's ad order, then kind. [] with no launch;
 * null when the campaign is malformed, missing or another workspace's (a 404).
 */
export async function listAlerts(userId: string, campaignId: string): Promise<AlertView[] | null> {
  if (typeof campaignId !== "string" || !UUID.test(campaignId)) return null;
  const read = await asUser(userId, async (tx) => {
    const [c] = await tx`
      select c.id,
        (select json_build_object('id', l.id, 'ads', l.ads) from public.launches l
          where l.campaign_id = c.id and l.status in ('live', 'ended')
          order by (l.status = 'live') desc, l.created_at desc, l.id desc limit 1) as launch
      from public.campaigns c where c.id = ${campaignId}`;
    if (!c) return null;
    const launch = c.launch as { id: string; ads: LaunchAd[] } | null;
    if (!launch) return { launch: null, rows: [] as Row[] };
    const rows = await tx`select ${ALERT_COLUMNS(tx)} from public.performance_alerts a where a.launch_id = ${launch.id}`;
    return { launch, rows: rows as unknown as Row[] };
  });
  if (!read) return null;
  if (!read.launch || read.rows.length === 0) return [];
  const order = new Map(read.launch.ads.map((a, i) => [a.variantId, i]));
  const kindOrder = (k: unknown) => ALERT_KINDS.indexOf(k as AlertKind);
  const rows = [...read.rows].sort(
    (x, y) => (x.day as number) - (y.day as number) || (order.get(x.variant_id as string) ?? 999) - (order.get(y.variant_id as string) ?? 999) || kindOrder(x.kind) - kindOrder(y.kind),
  );
  return toViews(rows, await adNumbers(userId, campaignId, read.launch.ads));
}

/**
 * Marks an alert as seen by the member, once: marking a seen alert again
 * changes nothing and returns it as it is. A malformed, missing or another
 * workspace's alert is the same refusal.
 */
export async function markAlertSeen(member: Member, alertId: string): Promise<AlertView> {
  if (typeof alertId !== "string" || !UUID.test(alertId)) throw new AlertError(ALERT_NOT_FOUND);
  const read = await asUser(member.userId, async (tx) => {
    await tx`
      update public.performance_alerts set seen_by = ${member.userId}, seen_at = now()
      where id = ${alertId} and seen_at is null`;
    const [r] = await tx`
      select ${ALERT_COLUMNS(tx)}, l.campaign_id, l.ads
      from public.performance_alerts a join public.launches l on l.id = a.launch_id
      where a.id = ${alertId}`;
    return r ?? null;
  });
  if (!read) throw new AlertError(ALERT_NOT_FOUND);
  const [view] = toViews([read as Row], await adNumbers(member.userId, read.campaign_id as string, read.ads as LaunchAd[]));
  return view;
}

/** Unseen alerts on the workspace's live launches, for Studio's home. */
export async function unseenAlertCount(userId: string): Promise<number> {
  const [r] = await asUser(userId, (tx) => tx`
    select count(*)::int as n
    from public.performance_alerts a join public.launches l on l.id = a.launch_id
    where a.seen_at is null and l.status = 'live'`);
  return (r?.n as number) ?? 0;
}
