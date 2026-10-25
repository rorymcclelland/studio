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

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** A product price, stored in whole pence: 18900 → "£189.00". */
export function formatPrice(pence: number): string {
  return gbp.format(pence / 100);
}

/** A count for people: 2000 → "2,000". */
export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}

/** A share between 0 and 1, to one decimal place: 0.3846 → "38.5%". */
export function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A month key such as "2026-03" as "Mar 2026", or "March 2026" in the long style. */
export function formatMonth(key: string, style: "short" | "long" = "short"): string {
  const [y, m] = key.split("-").map(Number);
  const names = style === "long" ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[m - 1] ?? key} ${y}`;
}
