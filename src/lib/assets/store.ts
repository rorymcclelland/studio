import { createHash } from "node:crypto";
import sharp from "sharp";
import { asUser, type Tx } from "@/lib/db/scoped";

// S5-1 (Q2): pictures kept in Postgres, with row-level security like every
// other table. Drawn pictures are stored as WebP. Assets are append-only: only
// the discarded mark changes, so a picture's URL can be cached for good.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WEBP_QUALITY = 82;

export type AssetRow = {
  id: string;
  kind: "image" | "logo";
  brandId: string;
  campaignId: string | null;
  runId: string | null;
  mime: "image/webp" | "image/png";
  width: number;
  height: number;
  size: number;
  sha256: string;
  simulated: boolean;
  meta: Record<string, unknown>;
  createdByKind: "agent" | "person";
  discardedAt: Date | null;
  createdAt: Date;
};

/** Re-encodes a picture as WebP (metadata is not carried over) and measures it. */
export async function toWebp(bytes: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(bytes).webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export type NewImage = {
  workspaceId: string;
  userId: string;
  brandId: string;
  campaignId: string | null;
  runId: string | null;
  /** Already WebP (see toWebp). */
  webp: { data: Buffer; width: number; height: number };
  simulated: boolean;
  createdByKind: "agent" | "person";
  meta: Record<string, unknown>;
};

/** Stores a drawn picture in a transaction the caller holds; returns its id. */
export async function insertImage(tx: Tx, a: NewImage): Promise<string> {
  const sha256 = createHash("sha256").update(a.webp.data).digest("hex");
  const [r] = await tx`
    insert into public.assets (workspace_id, kind, brand_id, campaign_id, run_id, mime, width, height, bytes, sha256,
                               simulated, meta, created_by, created_by_kind)
    values (${a.workspaceId}, 'image', ${a.brandId}, ${a.campaignId}, ${a.runId}, 'image/webp', ${a.webp.width}, ${a.webp.height},
            ${a.webp.data}, ${sha256}, ${a.simulated}, ${tx.json(a.meta as never)}, ${a.userId}, ${a.createdByKind})
    returning id`;
  return r.id as string;
}

function toRow(r: Record<string, unknown>): AssetRow {
  return {
    id: r.id as string,
    kind: r.kind as AssetRow["kind"],
    brandId: r.brand_id as string,
    campaignId: (r.campaign_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    mime: r.mime as AssetRow["mime"],
    width: r.width as number,
    height: r.height as number,
    size: Number(r.size),
    sha256: r.sha256 as string,
    simulated: r.simulated as boolean,
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdByKind: r.created_by_kind as AssetRow["createdByKind"],
    discardedAt: (r.discarded_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

const COLUMNS = (tx: Tx) =>
  tx`id, kind, brand_id, campaign_id, run_id, mime, width, height, octet_length(bytes) as size, sha256, simulated, meta, created_by_kind, discarded_at, created_at`;

/** An asset's bytes, or null if it isn't in the user's workspace (or the id can't be an id). */
export async function readAsset(userId: string, id: string): Promise<{ mime: string; bytes: Buffer; sha256: string; simulated: boolean } | null> {
  if (!UUID.test(id)) return null;
  const [r] = await asUser(userId, (tx) => tx`select mime, bytes, sha256, simulated from public.assets where id = ${id}`);
  return r ? { mime: r.mime as string, bytes: r.bytes as Buffer, sha256: r.sha256 as string, simulated: r.simulated as boolean } : null;
}

/** A workspace's assets without their bytes, newest first: for a campaign, a run, or everything. */
export async function listAssets(
  userId: string,
  opts: { campaignId?: string; runId?: string; includeDiscarded?: boolean } = {},
): Promise<AssetRow[]> {
  if ((opts.campaignId && !UUID.test(opts.campaignId)) || (opts.runId && !UUID.test(opts.runId))) return [];
  const rows = await asUser(userId, (tx) => tx`
    select ${COLUMNS(tx)} from public.assets
    where ${opts.campaignId ? tx`campaign_id = ${opts.campaignId}` : tx`true`}
      and ${opts.runId ? tx`run_id = ${opts.runId}` : tx`true`}
      and ${opts.includeDiscarded ? tx`true` : tx`discarded_at is null`}
    order by created_at desc, id
    limit 200`);
  return rows.map(toRow);
}

/** Marks an asset discarded (or not); its bytes stay, so the trail can still show it. */
export async function setDiscarded(userId: string, id: string, discarded: boolean): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const res = await asUser(userId, (tx) => tx`
    update public.assets set discarded_at = ${discarded ? tx`now()` : null}
    where id = ${id} and (discarded_at is null) = ${discarded}`);
  return res.count === 1;
}

/** Discards an asset inside a transaction the caller holds. */
export async function discardIn(tx: Tx, id: string): Promise<void> {
  await tx`update public.assets set discarded_at = now() where id = ${id} and discarded_at is null`;
}
