import type { Tx } from "@/lib/db/scoped";

// U10-3: which ads a live launch, or one waiting for approval, holds. An ad
// held by one is locked: nothing that changes what it shows (rule 3). Read
// inside a transaction the caller holds as the user (rule 7), so another
// workspace's launch never locks an ad here.

/** The launch holding an ad: live, or waiting for its approval. */
export type LaunchHoldView = { launchId: string; status: "live" | "awaiting_approval" };

/**
 * The live or waiting launches of a campaign that hold each of the given ads,
 * by ad id. A waiting launch whose approval was refused or has expired holds
 * nothing, as expireStaleLaunches would record it.
 */
export async function launchHolds(tx: Tx, campaignId: string, variantIds: string[]): Promise<Map<string, LaunchHoldView>> {
  const holds = new Map<string, LaunchHoldView>();
  if (variantIds.length === 0) return holds;
  const rows = await tx`
    select l.id, l.status, e.value ->> 'variantId' as variant_id
    from public.launches l
    join public.approvals a on a.id = l.approval_id
    cross join lateral jsonb_array_elements(l.ads) e
    where l.campaign_id = ${campaignId}
      and (l.status = 'live'
        or (l.status = 'awaiting_approval' and a.status not in ('rejected', 'expired') and not (a.status = 'pending' and a.expires_at <= now())))
      and e.value ->> 'variantId' = any(${variantIds}::text[])
    order by l.status = 'live' desc`;
  for (const r of rows) if (!holds.has(r.variant_id as string)) holds.set(r.variant_id as string, { launchId: r.id as string, status: r.status as LaunchHoldView["status"] });
  return holds;
}

/** The launch holding any current ad on a set of words (a live one first), or null. */
export async function holdOnWords(tx: Tx, campaignId: string, setId: string): Promise<LaunchHoldView | null> {
  const ads = await tx`select id from public.ad_variants where copy_set_id = ${setId} and discarded_at is null`;
  const holds = [...(await launchHolds(tx, campaignId, ads.map((a) => a.id as string))).values()];
  return holds.find((h) => h.status === "live") ?? holds[0] ?? null;
}
