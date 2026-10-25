import type { Member } from "@/lib/agents/runs";
import type { Tx } from "@/lib/db/scoped";
import type { StoredBrief } from "./schema";

export class StaleBriefError extends Error {
  constructor() {
    super("This brief changed since you opened it. Reload to see the latest version, then try again.");
  }
}

export type VersionSource = "agent" | "person" | "revision" | "restore";

/**
 * Adds the next version of a campaign's brief, but only if the current version
 * is still `baseVersion` (S3-3 #7). History is append-only.
 */
export async function addVersion(
  tx: Tx,
  member: Member,
  campaignId: string,
  baseVersion: number,
  brief: StoredBrief,
  source: VersionSource,
  extra: { runId?: string | null; restoredFrom?: number | null; note?: string | null } = {},
): Promise<number> {
  const [c] = await tx`
    update public.campaigns set current_version = current_version + 1, status = 'draft'
    where id = ${campaignId} and current_version = ${baseVersion}
    returning current_version, workspace_id`;
  if (!c) throw new StaleBriefError();
  await tx`
    insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, restored_from, note, run_id, created_by)
    values (${c.workspace_id}, ${campaignId}, ${c.current_version}, ${tx.json(brief as never)}, ${source},
            ${extra.restoredFrom ?? null}, ${extra.note ?? null}, ${extra.runId ?? null}, ${member.userId})`;
  return c.current_version as number;
}
