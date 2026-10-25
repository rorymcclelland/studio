/**
 * A cost in pence, for people. Fractions of a penny are real (a model call can
 * cost 0.0032p), so anything above zero never reads as free (BUG-1):
 * 0 → "0p", under 0.01p → "under 0.01p", under £1 → "1.23p", otherwise "£1.23".
 */
export function formatPence(p: number | string): string {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return "0p";
  if (n < 0.01) return "under 0.01p";
  if (Math.round(n * 100) < 100 * 100) return `${n.toFixed(2)}p`;
  return `£${(n / 100).toFixed(2)}`;
}

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

export function formatWhen(d: Date | string): string {
  return dt.format(new Date(d));
}

export function formatMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
