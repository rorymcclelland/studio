export function formatPence(p: number | string): string {
  const n = Number(p);
  if (n === 0) return "£0.00";
  if (n < 1) return `${n.toFixed(2)}p`;
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
