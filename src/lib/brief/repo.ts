import { createRun, type Member, type SendEvent, StartRunError } from "@/lib/agents/runs";
import type postgres from "postgres";
import { asUser, type Tx } from "@/lib/db/scoped";
import { campaignName } from "@/lib/home/needs";
import { CAMPAIGNS_PAGE_SIZE, campaignCursor, parseCampaignCursor, type CampaignFilterKey, type CampaignFilters } from "@/lib/campaigns/list-filters";
import { changedSections, evidenceProblems, kitListsFor, type KitLists, unsourcedNumbers } from "./checks";
import { contextById, realNamesFor } from "./gather";
import { BRIEF_SECTIONS, briefCore, storedBrief, type BriefSection, type StoredBrief } from "./schema";
import { addVersion, StaleBriefError } from "./versions";

// S3-2 and S3-3: campaigns, their brief versions, and revision proposals.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CampaignError extends Error {}
export class BriefEditError extends Error {
  constructor(public problems: string[], public fieldErrors: Record<string, string> = {}) {
    super(problems[0] ?? "The brief couldn't be saved.");
  }
}
export { StaleBriefError };

export const OBJECTIVE_MIN = 10;
export const OBJECTIVE_MAX = 300;

export function checkObjective(raw: string): string | null {
  const o = raw.trim();
  if (o.length < OBJECTIVE_MIN) return `Describe the objective in at least ${OBJECTIVE_MIN} characters.`;
  if (o.length > OBJECTIVE_MAX) return `Keep the objective to ${OBJECTIVE_MAX} characters or fewer.`;
  return null;
}

async function startDraftRun(member: Member, campaignId: string, brandId: string, brandName: string, send: SendEvent) {
  const runId = await createRun(member, "brief", { mode: "draft", campaignId }, send, { brandId, label: `${brandName}: brief` });
  await asUser(member.userId, (tx) => tx`update public.campaigns set run_id = ${runId} where id = ${campaignId}`);
  return runId;
}

/** Creates a campaign and starts the Brief agent on it. */
export async function createCampaign(member: Member, brandId: string, objective: string, send: SendEvent): Promise<string> {
  const problem = checkObjective(objective);
  if (problem) throw new CampaignError(problem);
  if (!UUID.test(brandId)) throw new CampaignError("Choose a brand.");
  const [c] = await asUser(member.userId, async (tx) => {
    const [b] = await tx`select id, name from public.brands where id = ${brandId}`;
    if (!b) throw new CampaignError("That brand isn't in your workspace.");
    const [row] = await tx`
      insert into public.campaigns (workspace_id, brand_id, objective, created_by)
      values (${member.workspaceId}, ${brandId}, ${objective.trim()}, ${member.userId})
      returning id`;
    return [{ id: row.id as string, brandName: b.name as string }];
  });
  try {
    await startDraftRun(member, c.id, brandId, c.brandName, send);
  } catch (err) {
    // The campaign stays, so the page can offer to try again.
    if (!(err instanceof StartRunError)) throw err;
  }
  return c.id;
}

/** Starts the Brief agent again on a campaign that has no brief yet (its last run failed or never started). */
export async function retryDraft(member: Member, campaignId: string, send: SendEvent): Promise<void> {
  const c = await getCampaign(member.userId, campaignId);
  if (!c) throw new CampaignError("That campaign isn't in your workspace.");
  if (c.currentVersion > 0) throw new CampaignError("This campaign already has a brief.");
  if (c.run && ["queued", "running"].includes(c.run.status)) throw new CampaignError("The Brief agent is already writing this brief.");
  await startDraftRun(member, campaignId, c.brand.id, c.brand.name, send);
}

export type CampaignSummary = {
  id: string;
  objective: string;
  /** campaigns.status as stored; a value this code doesn't know shows as Draft (campaignStatusLabel). */
  status: string;
  currentVersion: number;
  /** Every launch of the campaign, any order, for the status in lists (U10-1, BUG-13). */
  launches: { status: string; simDay: number }[];
  brand: { id: string; name: string };
  title: string | null;
  updatedAt: Date;
};

/** The columns a campaigns list reads, with each campaign's current title and its launches. */
async function selectCampaigns(tx: Tx, where: postgres.Fragment, limit: number): Promise<CampaignSummary[]> {
  return (await selectCampaignRows(tx, where, limit)).map((r) => r.summary);
}

/** As selectCampaigns, with each row's position (updated_at in microseconds, exact) for the list's cursor. */
async function selectCampaignRows(tx: Tx, where: postgres.Fragment, limit: number): Promise<{ summary: CampaignSummary; micros: string }[]> {
  const rows = await tx`
    select c.id, c.objective, c.status, c.current_version, c.updated_at, b.id as brand_id, b.name as brand_name,
      (extract(epoch from c.updated_at) * 1000000)::bigint::text as updated_micros,
      (select v.brief ->> 'title' from public.brief_versions v where v.campaign_id = c.id and v.version = c.current_version) as title,
      coalesce((select jsonb_agg(jsonb_build_object('status', l.status, 'simDay', l.sim_day))
                from public.launches l where l.campaign_id = c.id), '[]'::jsonb) as launches
    from public.campaigns c join public.brands b on b.id = c.brand_id
    where ${where}
    order by c.updated_at desc, c.id desc
    limit ${limit}`;
  return rows.map((r) => ({
    micros: r.updated_micros as string,
    summary: {
      id: r.id, objective: r.objective, status: r.status, currentVersion: r.current_version,
      launches: (r.launches as { status: string; simDay: number | string }[]).map((l) => ({ status: l.status, simDay: Number(l.simDay) })),
      brand: { id: r.brand_id, name: r.brand_name }, title: r.title, updatedAt: r.updated_at,
    },
  }));
}

export async function listCampaigns(userId: string, brandId?: string): Promise<CampaignSummary[]> {
  if (brandId !== undefined && !UUID.test(brandId)) return [];
  return asUser(userId, (tx) => selectCampaigns(tx, brandId === undefined ? tx`true` : tx`c.brand_id = ${brandId}`, 100));
}

/**
 * U10-8: the reader's campaigns by name (campaignName's rule), most recently changed first, for the runs list's
 * Campaign filter. At most 1,000; `include` (the campaign the list is filtered by) is added when it is older than
 * those, so the select still shows the filter that is applied.
 */
export async function listCampaignOptions(userId: string, include: string | null = null): Promise<{ id: string; name: string }[]> {
  const extra = include !== null && UUID.test(include) ? include.toLowerCase() : null;
  const rows = await asUser(userId, async (tx) => {
    const select = (where: postgres.Fragment, limit: number) => tx`
      select c.id, c.objective,
        (select v.brief ->> 'title' from public.brief_versions v where v.campaign_id = c.id and v.version = c.current_version) as title
      from public.campaigns c
      where ${where}
      order by c.updated_at desc, c.id desc
      limit ${limit}`;
    const newest = await select(tx`true`, 1000);
    if (extra === null || newest.some((r) => r.id === extra)) return newest;
    return [...newest, ...(await select(tx`c.id = ${extra}`, 1))];
  });
  return rows.map((r) => ({ id: r.id as string, name: campaignName({ title: r.title as string | null, objective: r.objective as string }) }));
}

/** U10-8 (answer B1): a page of the campaigns list. `older` is the cursor for the next page (the last campaign's position, campaignCursor), or null. */
export type CampaignsPage = { campaigns: CampaignSummary[]; older: string | null; ignored: CampaignFilterKey[] };

/**
 * The state a campaign's row shows, in SQL, with campaignStatusKey's precedence (src/lib/campaigns/list-filters.ts),
 * so a status filter pages correctly.
 */
const statusKeySql = (tx: Tx) => tx`
  case
    when exists (select 1 from public.launches l where l.campaign_id = c.id and l.status = 'live') then 'live'
    when exists (select 1 from public.launches l where l.campaign_id = c.id and l.status = 'awaiting_approval') then 'launchWaiting'
    when exists (select 1 from public.launches l where l.campaign_id = c.id and l.status = 'ended') then 'ended'
    when c.status = 'drafting' or c.current_version = 0 then 'writing'
    when c.status = 'awaiting_signoff' then 'waiting'
    when c.status = 'approved' then 'signedOff'
    else 'draft'
  end`;

/**
 * U10-8 (answer B1): a page of campaigns, filtered by brand and status, after the position `before` (by updated_at,
 * then id), through asUser() (rule 7). A brand that isn't the reader's is not applied and is reported in `ignored`;
 * a cursor that isn't well formed gives the first page.
 */
export async function listCampaignsPage(
  userId: string,
  query: { filters: CampaignFilters; before: string | null },
  pageSize = CAMPAIGNS_PAGE_SIZE,
): Promise<CampaignsPage> {
  const brandId = query.filters.brand !== null && UUID.test(query.filters.brand) ? query.filters.brand.toLowerCase() : null;
  const cursor = parseCampaignCursor(query.before);
  const status = query.filters.status;
  const size = Math.max(1, Math.floor(pageSize));
  return asUser(userId, async (tx) => {
    const ignored: CampaignFilterKey[] = [];
    let brand: string | null = null;
    if (query.filters.brand !== null) {
      const [b] = brandId ? await tx`select id from public.brands where id = ${brandId}` : [];
      if (b) brand = b.id as string;
      else ignored.push("brand");
    }
    // The cursor is only a position (a time and an id), compared under RLS, so another workspace's id reveals nothing.
    const conditions = [
      brand ? tx`c.brand_id = ${brand}` : null,
      status !== null ? tx`${statusKeySql(tx)} = ${status}` : null,
      cursor
        ? tx`(c.updated_at, c.id) < (timestamptz 'epoch' + ${cursor.micros}::bigint * interval '1 microsecond', ${cursor.id}::uuid)`
        : null,
    ].filter((c) => c !== null);
    const where = conditions.reduce((acc, c) => tx`${acc} and ${c}`, tx`true`);
    const rows = await selectCampaignRows(tx, where, size + 1);
    const shown = rows.slice(0, size);
    const last = shown[shown.length - 1];
    return {
      campaigns: shown.map((r) => r.summary),
      older: rows.length > size ? campaignCursor({ micros: last.micros, id: last.summary.id }) : null,
      ignored,
    };
  });
}

export type Proposal = {
  runId: string;
  baseVersion: number;
  section: BriefSection | null;
  instruction: string;
  brief: StoredBrief;
  createdAt: Date;
};

export type CampaignDetail = {
  id: string;
  objective: string;
  status: "drafting" | "draft";
  currentVersion: number;
  createdAt: Date;
  brand: { id: string; name: string; isSimulated: boolean };
  brief: StoredBrief | null;
  versions: { version: number; source: string; restoredFrom: number | null; note: string | null; createdAt: Date }[];
  /** The latest brief-writing run, for progress and problems. */
  run: { id: string; status: string; error: string | null } | null;
  /** Revision runs still in flight (queued or running) and their instruction. */
  revising: { runId: string; status: string; section: string | null; instruction: string; error: string | null }[];
  proposals: Proposal[];
  /** Context items the brief refers to, by id. */
  sources: Record<string, { kind: string; title: string; text: string }>;
  /** Figures in the current brief that the context does not contain (typed by a person). */
  unsourced: { where: string; number: string }[];
};

export async function getCampaign(userId: string, campaignId: string): Promise<CampaignDetail | null> {
  if (!UUID.test(campaignId)) return null;
  return asUser(userId, async (tx) => {
    const [c] = await tx`
      select c.*, b.name as brand_name, b.is_simulated from public.campaigns c join public.brands b on b.id = c.brand_id
      where c.id = ${campaignId}`;
    if (!c) return null;
    const versions = await tx`
      select version, source, restored_from, note, created_at, case when version = ${c.current_version} then brief end as brief
      from public.brief_versions where campaign_id = ${campaignId} order by version desc`;
    const current = versions.find((v) => v.version === c.current_version);
    const brief = current ? storedBrief.parse(current.brief) : null;
    const [run] = c.run_id ? await tx`select id, status, error from public.agent_runs where id = ${c.run_id}` : [];
    const revisionRuns = await tx`
      select id, status, error, input, output, created_at from public.agent_runs
      where agent = 'brief' and input ->> 'mode' = 'revise' and input ->> 'campaignId' = ${campaignId}
        and created_at > now() - interval '7 days'
      order by created_at desc limit 20`;
    const proposals: Proposal[] = [];
    const revising: CampaignDetail["revising"] = [];
    for (const r of revisionRuns) {
      if (["queued", "running"].includes(r.status) || (r.status !== "completed" && r.input.baseVersion === c.current_version && !r.output?.dismissed)) {
        revising.push({ runId: r.id, status: r.status, section: r.input.section ?? null, instruction: r.input.instruction, error: r.error });
      }
      if (r.status === "completed" && r.output?.proposal && !r.output.resolution && r.output.baseVersion === c.current_version) {
        const parsed = storedBrief.safeParse(r.output.proposal);
        if (parsed.success) {
          proposals.push({ runId: r.id, baseVersion: r.output.baseVersion, section: r.output.section ?? null, instruction: r.output.instruction, brief: parsed.data, createdAt: r.created_at });
        }
      }
    }
    const context = await contextById(tx, c.brand_id);
    const byId = new Map(context.map((i) => [i.ref, i]));
    const cited = new Set<string>();
    for (const b of [brief, ...proposals.map((p) => p.brief)]) {
      if (!b) continue;
      b.insights.forEach((i) => i.cites.forEach((x) => cited.add(x)));
      b.audiences.forEach((a) => cited.add(a.segmentRef));
    }
    const sources: CampaignDetail["sources"] = {};
    for (const id of cited) {
      const i = byId.get(id);
      if (i) sources[id] = { kind: i.kind, title: i.title, text: i.text };
    }
    return {
      id: c.id,
      objective: c.objective,
      status: c.status,
      currentVersion: c.current_version,
      createdAt: c.created_at,
      brand: { id: c.brand_id, name: c.brand_name, isSimulated: c.is_simulated },
      brief,
      versions: versions.map((v) => ({ version: v.version, source: v.source, restoredFrom: v.restored_from, note: v.note, createdAt: v.created_at })),
      run: run ? { id: run.id, status: run.status, error: run.error } : null,
      revising,
      proposals,
      sources,
      unsourced: brief ? unsourcedNumbers(brief, context, c.objective).map(({ where, number }) => ({ where, number })) : [],
    };
  });
}

export async function getVersion(userId: string, campaignId: string, version: number): Promise<StoredBrief | null> {
  if (!UUID.test(campaignId) || !Number.isInteger(version)) return null;
  const [v] = await asUser(userId, (tx) => tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${version}`);
  return v ? storedBrief.parse(v.brief) : null;
}

/** S3-3: a person's edit becomes the next version, after the same checks as the agent (figures typed by a person are allowed, and marked). */
export async function saveBriefEdit(member: Member, campaignId: string, baseVersion: number, raw: unknown, note?: string): Promise<number> {
  const parsed = briefCore.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
    throw new BriefEditError(Object.values(fieldErrors), fieldErrors);
  }
  if (!UUID.test(campaignId)) throw new CampaignError("That campaign isn't in your workspace.");
  return asUser(member.userId, async (tx) => {
    const [c] = await tx`select c.id, c.brand_id, c.objective, b.legal_lines, b.banned_terms, b.dont_rules, b.evidence_claims
      from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
    if (!c) throw new CampaignError("That campaign isn't in your workspace.");
    const kit = { legalLines: c.legal_lines, bannedTerms: c.banned_terms, dontRules: c.dont_rules, evidenceClaims: c.evidence_claims, realNames: await realNamesFor(tx, c.brand_id) };
    const context = await contextById(tx, c.brand_id);
    // Only the parts the person changed are checked, so a source removed since can't block an edit elsewhere.
    const [base] = await tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${baseVersion}`;
    const sections = base ? changedSections(storedBrief.parse(base.brief), parsed.data) : undefined;
    const problems = evidenceProblems(parsed.data, context, kit, { objective: c.objective, allowUnsourcedNumbers: true, sections });
    if (problems.length) throw new BriefEditError(problems);
    const brief = storedBrief.parse({ ...parsed.data, ...kitListsFor(kit) });
    return addVersion(tx, member, campaignId, baseVersion, brief, "person", { note: note?.trim().slice(0, 500) || null });
  });
}

/** S3-3: asks the Brief agent to revise the whole brief or one section; the result waits as a proposal. */
export async function startRevision(
  member: Member,
  campaignId: string,
  baseVersion: number,
  section: BriefSection | null,
  instruction: string,
  send: SendEvent,
): Promise<string> {
  if (section !== null && !BRIEF_SECTIONS.includes(section)) throw new CampaignError("Choose a part of the brief to revise.");
  const c = await getCampaign(member.userId, campaignId);
  if (!c) throw new CampaignError("That campaign isn't in your workspace.");
  if (c.currentVersion !== baseVersion) throw new StaleBriefError();
  return createRun(member, "brief", { mode: "revise", campaignId, baseVersion, section, instruction }, send, {
    brandId: c.brand.id,
    label: `${c.brand.name}: revise brief${section ? ` (${section})` : ""}`,
  });
}

/** S3-3: uses a proposed revision as the next version, if the brief hasn't changed since it was asked for. */
export async function acceptProposal(member: Member, campaignId: string, runId: string): Promise<number> {
  if (!UUID.test(runId) || !UUID.test(campaignId)) throw new CampaignError("That proposal is no longer open.");
  return asUser(member.userId, async (tx) => {
    const [r] = await tx`
      select id, output from public.agent_runs
      where id = ${runId} and agent = 'brief' and status = 'completed' and input ->> 'campaignId' = ${campaignId}
      for update`;
    if (!r?.output?.proposal || r.output.resolution) throw new CampaignError("That proposal is no longer open.");
    const proposal = storedBrief.parse(r.output.proposal);
    const [base] = await tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${r.output.baseVersion}`;
    const brief = await recheck(tx, campaignId, proposal, base ? changedSections(storedBrief.parse(base.brief), proposal) : undefined);
    const version = await addVersion(tx, member, campaignId, r.output.baseVersion, brief, "revision", {
      runId,
      note: String(r.output.instruction ?? "").slice(0, 500) || null,
    });
    await tx`update public.agent_runs set output = output || ${tx.json({ resolution: "accepted", acceptedAs: version } as never)} where id = ${runId}`;
    return version;
  });
}

/** S3-3: throws a proposal away; the current version is unchanged. */
export async function discardProposal(member: Member, campaignId: string, runId: string): Promise<void> {
  if (!UUID.test(runId) || !UUID.test(campaignId)) throw new CampaignError("That proposal is no longer open.");
  const rows = await asUser(member.userId, (tx) => tx`
    update public.agent_runs set output = output || ${tx.json({ resolution: "discarded" } as never)}
    where id = ${runId} and agent = 'brief' and input ->> 'campaignId' = ${campaignId}
      and output ? 'proposal' and (output ->> 'resolution') is null
    returning id`);
  if (rows.length === 0) throw new CampaignError("That proposal is no longer open.");
}

/** Hides a failed revision's message from the campaign page. */
export async function dismissRevision(member: Member, campaignId: string, runId: string): Promise<void> {
  if (!UUID.test(runId) || !UUID.test(campaignId)) return;
  await asUser(member.userId, (tx) => tx`
    update public.agent_runs set output = coalesce(output, '{}'::jsonb) || '{"dismissed": true}'::jsonb
    where id = ${runId} and agent = 'brief' and input ->> 'campaignId' = ${campaignId} and status <> 'completed'`);
}

/**
 * Before an accepted proposal or a restored version becomes current: the
 * kit's lists as they are today, and the evidence checks against today's kit
 * and context (a term banned since, or a source removed since, is refused).
 * Figures are not re-checked: the version they come from already passed.
 */
async function recheck(tx: Tx, campaignId: string, brief: StoredBrief, sections?: BriefSection[]): Promise<StoredBrief> {
  const [b] = await tx`select c.brand_id, c.objective, b.legal_lines, b.banned_terms, b.dont_rules, b.evidence_claims
    from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`;
  if (!b) throw new CampaignError("That campaign isn't in your workspace.");
  const kit: KitLists = { legalLines: b.legal_lines, bannedTerms: b.banned_terms, dontRules: b.dont_rules, evidenceClaims: b.evidence_claims, realNames: await realNamesFor(tx, b.brand_id) };
  const problems = evidenceProblems(brief, await contextById(tx, b.brand_id), kit, { objective: b.objective, allowUnsourcedNumbers: true, sections });
  if (problems.length) throw new BriefEditError(problems);
  return storedBrief.parse({ ...brief, ...kitListsFor(kit) });
}

/** S3-3 #5: makes an old version current again, as a new version (history is never rewritten). */
export async function restoreVersion(member: Member, campaignId: string, version: number, baseVersion: number): Promise<number> {
  const old = await getVersion(member.userId, campaignId, version);
  if (!old) throw new CampaignError("That version doesn't exist.");
  return asUser(member.userId, async (tx) => {
    return addVersion(tx, member, campaignId, baseVersion, await recheck(tx, campaignId, old), "restore", { restoredFrom: version });
  });
}
