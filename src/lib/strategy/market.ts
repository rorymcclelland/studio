import { createRun, type Member, type SendEvent, StartRunError } from "@/lib/agents/runs";
import { asUser } from "@/lib/db/scoped";

// S4-3: starting the Market agent, and reading a brand's market notes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REFRESH_GUARD_HOURS = 24;
export const STALE_DAYS = 7;

export class RecentlyRefreshedError extends Error {}

export type MarketNote = {
  id: string;
  title: string;
  text: string;
  kind: string;
  sources: { url: string; title: string | null; citedText: string[] }[];
  names: string[];
  checkedAt: Date;
};

export async function listMarketNotes(userId: string, brandId: string): Promise<MarketNote[]> {
  if (!UUID.test(brandId)) return [];
  const rows = await asUser(userId, (tx) => tx`
    select id, title, body, meta from public.context_items
    where brand_id = ${brandId} and kind = 'result' and source_ref like 'market:%' order by source_ref`);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    text: String(r.body).replace(/ Sources: .*$/, ""),
    kind: r.meta?.kind ?? "trend",
    sources: r.meta?.sources ?? [],
    names: r.meta?.names ?? [],
    checkedAt: new Date(r.meta?.checkedAt ?? 0),
  }));
}

/** Starts the Market agent. Within a day of the last refresh it needs `confirm`, since each run costs money. */
export async function startMarketRun(member: Member, brandId: string, send: SendEvent, opts: { confirm?: boolean } = {}): Promise<string> {
  if (!UUID.test(brandId)) throw new StartRunError("That brand isn't in your workspace.");
  const [b] = await asUser(member.userId, (tx) => tx`
    select b.id, b.name,
      (select max((meta ->> 'checkedAt')::timestamptz) from public.context_items i where i.brand_id = b.id and i.kind = 'result' and i.source_ref like 'market:%') as last,
      (select count(*)::int from public.agent_runs r where r.agent = 'market' and r.brand_id = b.id and r.status in ('queued', 'running')) as running
    from public.brands b where b.id = ${brandId}`);
  if (!b) throw new StartRunError("That brand isn't in your workspace.");
  if (b.running > 0) throw new StartRunError("The Market agent is already researching this brand.");
  if (!opts.confirm && b.last && Date.now() - new Date(b.last).getTime() < REFRESH_GUARD_HOURS * 3_600_000) {
    throw new RecentlyRefreshedError(`The market notes were refreshed less than ${REFRESH_GUARD_HOURS} hours ago. Each refresh costs up to about 10p; confirm to run it again.`);
  }
  return createRun(member, "market", { brandId }, send, { brandId, label: `${b.name}: market notes` });
}
