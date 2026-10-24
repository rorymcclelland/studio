import { asUser } from "@/lib/db/scoped";

/** Daily cap in pence (default £1). Rule 5. */
export function dailyCapPence(): number {
  const v = Number(process.env.DAILY_CAP_PENCE);
  return Number.isFinite(v) && v >= 0 ? v : 100;
}

/** App-wide spend since midnight UK time, in pence. */
export async function spendTodayPence(userId: string): Promise<number> {
  const [row] = await asUser(userId, (tx) => tx`select public.spend_today_pence('Europe/London') as p`);
  return Number(row.p);
}
