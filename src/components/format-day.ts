const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

/** A date for people, without the time: "9 November 2026". */
export function formatDay(d: Date | string): string {
  return day.format(new Date(d));
}

/** Whole days since a date. */
export function daysSince(d: Date | string, now = Date.now()): number {
  return Math.floor((now - new Date(d).getTime()) / 86_400_000);
}
