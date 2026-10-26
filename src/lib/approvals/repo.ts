import { asUser, type Tx } from "@/lib/db/scoped";
import type { Member, SendEvent } from "@/lib/agents/runs";
import { BriefEditError, CampaignError } from "@/lib/brief/repo";
import { evidenceProblems, type KitLists } from "@/lib/brief/checks";
import { contextById } from "@/lib/brief/gather";
import { storedBrief } from "@/lib/brief/schema";

// S4-1: the approvals inbox, with brief sign-off as the first gate (rule 3).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SIGNOFF_DAYS = 14;

export class SignoffError extends Error {}

/** Hook for what else runs when a brief is sent for sign-off (personas and test plan, S4-2 and S4-4). */
export type OnSignoffRequested = (member: Member, campaignId: string, version: number, send: SendEvent) => Promise<void>;

/**
 * Closes sign-offs left open past their date: the approval expires and the
 * campaign goes back to draft with a note. Runs whenever the inbox or a
 * campaign is read, so there is no scheduled job.
 */
export async function expireStaleSignoffs(tx: Tx): Promise<void> {
  const expired = await tx`
    update public.approvals set status = 'expired', reason = 'No decision before the sign-off request expired', decided_at = now()
    where kind = 'brief_signoff' and status = 'pending' and expires_at <= now()
    returning campaign_id`;
  for (const e of expired) {
    await tx`update public.campaigns set status = 'draft', signoff_note = ${`The sign-off request expired after ${SIGNOFF_DAYS} days without a decision.`}
      where id = ${e.campaign_id} and status = 'awaiting_signoff'`;
  }
}

/** S4-1: asks for sign-off of the current version, after the evidence checks against today's kit and context. */
export async function requestSignoff(
  member: Member,
  campaignId: string,
  baseVersion: number,
  send: SendEvent,
  onRequested?: OnSignoffRequested,
): Promise<string> {
  if (!UUID.test(campaignId)) throw new CampaignError("That campaign isn't in your workspace.");
  const id = await asUser(member.userId, async (tx) => {
    await expireStaleSignoffs(tx);
    const [c] = await tx`
      select c.id, c.brand_id, c.objective, c.current_version, c.status, c.approved_version,
        b.legal_lines, b.banned_terms, b.dont_rules, b.evidence_claims
      from public.campaigns c join public.brands b on b.id = c.brand_id
      where c.id = ${campaignId} for update of c`;
    if (!c) throw new CampaignError("That campaign isn't in your workspace.");
    if (c.current_version !== baseVersion) throw new SignoffError("This brief changed since you opened it. Reload to see the latest version, then try again.");
    if (c.current_version === 0) throw new SignoffError("There is no brief to sign off yet.");
    if (c.status === "awaiting_signoff") throw new SignoffError("This version is already waiting for sign-off.");
    if (c.approved_version === c.current_version) throw new SignoffError("This version is already signed off.");
    const [v] = await tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${baseVersion}`;
    const brief = storedBrief.parse(v.brief);
    const kit: KitLists = { legalLines: c.legal_lines, bannedTerms: c.banned_terms, dontRules: c.dont_rules, evidenceClaims: c.evidence_claims };
    const problems = evidenceProblems(brief, await contextById(tx, c.brand_id), kit, { objective: c.objective, allowUnsourcedNumbers: true });
    if (problems.length) throw new BriefEditError(problems);
    const [a] = await tx`
      insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
      values (${member.workspaceId}, 'brief_signoff', ${campaignId}, ${baseVersion},
              ${`Sign off version ${baseVersion}: ${brief.title}`}, '[]'::jsonb, now() + ${`${SIGNOFF_DAYS} days`}::interval)
      returning id`;
    await tx`update public.campaigns set status = 'awaiting_signoff', signoff_note = null where id = ${campaignId}`;
    return a.id as string;
  });
  if (onRequested) await onRequested(member, campaignId, baseVersion, send);
  return id;
}

/** S4-1: approves or rejects a sign-off. An approval already decided, expired or about an older version changes nothing. */
export async function decideSignoff(
  member: Member,
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<{ campaignId: string; version: number }> {
  if (!UUID.test(approvalId)) throw new SignoffError("This sign-off is no longer open.");
  const note = reason?.trim().slice(0, 500) || null;
  if (decision === "rejected" && !note) throw new SignoffError("Say why, so the brief can be fixed.");
  return asUser(member.userId, async (tx) => {
    await expireStaleSignoffs(tx);
    const [a] = await tx`
      select id, campaign_id, brief_version from public.approvals
      where id = ${approvalId} and kind = 'brief_signoff' and status = 'pending' and expires_at > now()
      for update`;
    if (!a) throw new SignoffError("This sign-off is no longer open.");
    const [c] = await tx`select current_version from public.campaigns where id = ${a.campaign_id} for update`;
    if (!c || c.current_version !== a.brief_version) throw new SignoffError("The brief changed since this sign-off was asked for.");
    await tx`
      update public.approvals set status = ${decision}, reason = ${note}, decided_by = ${member.userId}, decided_at = now()
      where id = ${approvalId}`;
    if (decision === "approved") {
      await tx`update public.campaigns set status = 'approved', approved_version = ${a.brief_version}, approved_at = now(),
                 approved_by = ${member.userId}, signoff_note = ${note} where id = ${a.campaign_id}`;
    } else {
      await tx`update public.campaigns set status = 'draft', signoff_note = ${`Not signed off: ${note}`} where id = ${a.campaign_id}`;
    }
    return { campaignId: a.campaign_id as string, version: a.brief_version as number };
  });
}

/** Withdraws an open sign-off request, back to draft. */
export async function withdrawSignoff(member: Member, campaignId: string): Promise<void> {
  if (!UUID.test(campaignId)) throw new CampaignError("That campaign isn't in your workspace.");
  await asUser(member.userId, async (tx) => {
    const rows = await tx`
      update public.approvals set status = 'expired', reason = 'Withdrawn', decided_by = ${member.userId}, decided_at = now()
      where campaign_id = ${campaignId} and kind = 'brief_signoff' and status = 'pending' returning id`;
    if (rows.length === 0) throw new SignoffError("There is no open sign-off to withdraw.");
    await tx`update public.campaigns set status = 'draft', signoff_note = null where id = ${campaignId}`;
  });
}

export type InboxItem =
  | {
      kind: "brief_signoff";
      id: string;
      question: string;
      createdAt: Date;
      expiresAt: Date;
      campaignId: string;
      version: number;
      brand: { id: string; name: string };
      objective: string;
    }
  | { kind: "run_choice"; id: string; question: string; createdAt: Date; expiresAt: Date; runId: string; runLabel: string | null; agent: string };

/** Everything waiting for a person, newest first. */
export async function listInbox(userId: string): Promise<InboxItem[]> {
  return asUser(userId, async (tx) => {
    await expireStaleSignoffs(tx);
    const rows = await tx`
      select a.id, a.kind, a.question, a.created_at, a.expires_at, a.campaign_id, a.brief_version, a.run_id,
        r.label as run_label, r.agent, c.objective, b.id as brand_id, b.name as brand_name
      from public.approvals a
      left join public.agent_runs r on r.id = a.run_id
      left join public.campaigns c on c.id = a.campaign_id
      left join public.brands b on b.id = c.brand_id
      where a.status = 'pending' and a.expires_at > now()
      order by a.created_at desc
      limit 100`;
    return rows.map((r): InboxItem =>
      r.kind === "brief_signoff"
        ? {
            kind: "brief_signoff", id: r.id, question: r.question, createdAt: r.created_at, expiresAt: r.expires_at,
            campaignId: r.campaign_id, version: r.brief_version, brand: { id: r.brand_id, name: r.brand_name }, objective: r.objective,
          }
        : { kind: "run_choice", id: r.id, question: r.question, createdAt: r.created_at, expiresAt: r.expires_at, runId: r.run_id, runLabel: r.run_label, agent: r.agent },
    );
  });
}

export async function inboxCount(userId: string): Promise<number> {
  const [r] = await asUser(userId, (tx) => tx`
    select count(*)::int as n from public.approvals where status = 'pending' and expires_at > now()`);
  return r.n as number;
}

export type SignoffState = {
  status: "drafting" | "draft" | "awaiting_signoff" | "approved";
  approvedVersion: number | null;
  approvedAt: Date | null;
  note: string | null;
  open: { id: string; version: number; expiresAt: Date } | null;
  history: { id: string; version: number; status: string; reason: string | null; decidedAt: Date | null; createdAt: Date }[];
};

export async function getSignoffState(userId: string, campaignId: string): Promise<SignoffState | null> {
  if (!UUID.test(campaignId)) return null;
  return asUser(userId, async (tx) => {
    await expireStaleSignoffs(tx);
    const [c] = await tx`select status, approved_version, approved_at, signoff_note from public.campaigns where id = ${campaignId}`;
    if (!c) return null;
    const rows = await tx`
      select id, brief_version, status, reason, decided_at, created_at, expires_at from public.approvals
      where campaign_id = ${campaignId} and kind = 'brief_signoff' order by created_at desc limit 20`;
    const open = rows.find((r) => r.status === "pending");
    return {
      status: c.status,
      approvedVersion: c.approved_version,
      approvedAt: c.approved_at,
      note: c.signoff_note,
      open: open ? { id: open.id, version: open.brief_version, expiresAt: open.expires_at } : null,
      history: rows.map((r) => ({ id: r.id, version: r.brief_version, status: r.status, reason: r.reason, decidedAt: r.decided_at, createdAt: r.created_at })),
    };
  });
}
