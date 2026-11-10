// U10-4: what needs action first on the Performance page, as pure code. No
// database, no model, no clock: it orders what the page already read (the
// latest simulated day's health and the launch's stored alerts) and words it.
// Nothing here acts on an ad (rule 3): it only says which ads need a person.
import { ALERT_KINDS, ALERT_NAMES, type AlertKind } from "./alerts";
import type { DayHealth } from "./health";

export const ATTENTION_HEADING = "Needs action now";
export const NO_ATTENTION = "No ad is below its threshold or tiring now (simulated).";
export const MARK_ALL_LABEL = "Mark all as seen";

export type AttentionReason = "below_threshold" | "tiring";

/** What the ordering needs of an alert (AlertView satisfies it). */
export type AlertRef = { id: string; variantId: string; kind: AlertKind; day: number };

export type AttentionAd = { variantId: string; reasons: AttentionReason[]; alertIds: string[] };

/**
 * Alerts newest first, in a new array: by day descending, then the launch's ad
 * order (an ad no longer in `ads` after the launch's own), then the alert kinds' order.
 */
export function newestFirst<T extends AlertRef>(alerts: readonly T[], ads: readonly { variantId: string }[]): T[] {
  const order = new Map(ads.map((a, i) => [a.variantId, i]));
  const place = (id: string) => order.get(id) ?? ads.length;
  return [...alerts].sort((x, y) => y.day - x.day || place(x.variantId) - place(y.variantId) || ALERT_KINDS.indexOf(x.kind) - ALERT_KINDS.indexOf(y.kind));
}

/**
 * The ads that need action now: below the threshold on the latest simulated
 * day, or with a Tiring alert (the simulator's fatigue doesn't reverse, so a
 * tiring ad stays tiring). A Not compliant or learning ad isn't listed as
 * below the threshold, and a Below threshold alert alone doesn't list an ad
 * that is no longer below it. Ads below the threshold first, then the rest,
 * each in launch order; each with its alerts of those kinds, newest first.
 */
export function needsAttention(ads: readonly { variantId: string }[], latest: DayHealth | null, alerts: readonly AlertRef[]): AttentionAd[] {
  if (!latest) return [];
  const sorted = newestFirst(alerts, ads);
  const out: AttentionAd[] = [];
  for (const { variantId } of ads) {
    const reasons: AttentionReason[] = [];
    if (latest.ads.some((a) => a.variantId === variantId && a.status === "below_threshold")) reasons.push("below_threshold");
    if (alerts.some((a) => a.variantId === variantId && a.kind === "tiring")) reasons.push("tiring");
    if (reasons.length === 0) continue;
    const alertIds = sorted.filter((a) => a.variantId === variantId && (reasons as string[]).includes(a.kind)).map((a) => a.id);
    out.push({ variantId, reasons, alertIds });
  }
  const below = out.filter((a) => a.reasons.includes("below_threshold"));
  return [...below, ...out.filter((a) => !a.reasons.includes("below_threshold"))];
}

/** R1 (10 November): how many unseen alerts the Performance page shows in full. */
export const ALERTS_IN_FULL = 3;

/** "Show all 5 alerts": the control that reveals the alerts past the first few. */
export function showAllAlertsLabel(n: number): string {
  return `Show all ${n} ${n === 1 ? "alert" : "alerts"}`;
}

/**
 * R1 (10 November): which alerts the Performance page shows, from the alerts
 * already newest first. `inFull`: the newest ALERTS_IN_FULL unseen ones; every
 * other alert is one line. `shown`: the alerts shown before "Show all N alerts",
 * the ones in full, made up to ALERTS_IN_FULL with the newest of the rest when
 * fewer are unseen; the rest wait behind the control. Ids, in the given order.
 */
export function alertsShown(sorted: readonly { id: string; seenAt: Date | string | null }[]): { inFull: string[]; shown: string[] } {
  const inFull = sorted.filter((a) => a.seenAt === null).slice(0, ALERTS_IN_FULL).map((a) => a.id);
  const extra = sorted.filter((a) => !inFull.includes(a.id)).slice(0, Math.max(0, ALERTS_IN_FULL - inFull.length)).map((a) => a.id);
  const shown = sorted.filter((a) => inFull.includes(a.id) || extra.includes(a.id)).map((a) => a.id);
  return { inFull, shown };
}

/** A seen alert's one line: "Ad 1: Below threshold on simulated day 6". */
export function alertOneLine({ kind, adNumber, day }: { kind: AlertKind; adNumber: number; day: number }): string {
  const ad = adNumber > 0 ? `Ad ${adNumber}` : "An ad no longer in the gallery";
  return `${ad}: ${ALERT_NAMES[kind]} on simulated day ${day}`;
}

/** "Recovered on day 9". */
export function recoveredLine(day: number): string {
  return `Recovered on day ${day}`;
}

/** What Mark all as seen says it did. */
export function markedAllLine(n: number): string {
  if (n === 0) return "No unseen alerts to mark.";
  return `Marked ${n} ${n === 1 ? "alert" : "alerts"} as seen.`;
}

