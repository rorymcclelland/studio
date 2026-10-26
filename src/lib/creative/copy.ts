import { createRun, type Member, type SendEvent } from "@/lib/agents/runs";
import { asUser, type Tx } from "@/lib/db/scoped";
import { loadCopyContext, NOT_SIGNED_OFF, rulesFor } from "./copy-context";
import { CHANNEL_LIMITS, EDIT_COPY, figuresAddedByPerson, setProblems, type AnyCopy, type CopyByChannel, type CopyChannel } from "./copy-rules";

// S5-2: a campaign's copy sets. Reading them, a person's hand edit (a new
// row, after the same checks as the agent's words), discarding and restoring,
// and starting the Copy agent: for the whole signed-off brief, or for new
// words on one set. Server actions and the UI call these (S5-4).

export { CHANNEL_LIMITS, NOT_SIGNED_OFF };
export type { AnyCopy, CopyByChannel, CopyChannel };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CopyError extends Error {}
export class CopyEditError extends Error {
  constructor(
    public problems: string[],
    /** By field ("headline", "headlines.0"), for the editor's inline messages. */
    public fieldErrors: Record<string, string> = {},
  ) {
    super(problems[0] ?? "The words couldn't be saved.");
  }
}

export type CopySetView = {
  id: string;
  campaignId: string;
  briefVersion: number;
  channel: CopyChannel;
  /** The brief's audience; segmentRef is null when the brief names none. */
  audience: { segmentRef: string | null; title: string };
  copy: AnyCopy;
  /** The kit's legal lines, attached by code when the set was saved. */
  legalLines: string[];
  source: "agent" | "person";
  /** The run that wrote it (null for a hand edit). */
  runId: string | null;
  /** The set this one was made from (a hand edit, or new words). */
  basedOn: string | null;
  /** New words waiting beside the set they would replace: that set's id, while it is still current. */
  replaces: string | null;
  /** Figures a person typed that the brief's evidence doesn't hold, so the page can mark them. */
  addedByPerson: { field: string; figure: string }[];
  discardedAt: Date | null;
  createdAt: Date;
  createdBy: string;
};

export type CopyRun = { runId: string; status: string; mode: "all" | "replace"; setId: string | null; error: string | null; createdAt: Date };

export type CampaignCopy = {
  campaignId: string;
  /** The signed-off version the sets are for; null until the brief is signed off. */
  version: number | null;
  /** True while the campaign is signed off at that version (an edit since makes it a draft again). */
  signedOff: boolean;
  /** Current sets, in the order they were written. */
  sets: CopySetView[];
  /** Discarded and replaced sets for the same version, newest first, for undo. */
  discarded: CopySetView[];
  /** Copy runs for this campaign in the last seven days, newest first. */
  runs: CopyRun[];
};

const empty = (campaignId: string): CampaignCopy => ({ campaignId, version: null, signedOff: false, sets: [], discarded: [], runs: [] });

/** A campaign's copy for its signed-off brief version: current sets, discarded ones and recent runs. */
export async function listCopySets(userId: string, campaignId: string): Promise<CampaignCopy> {
  if (!UUID.test(campaignId)) return empty(campaignId);
  return asUser(userId, async (tx) => {
    const ctx = await loadCopyContext(tx, campaignId);
    const runs = await tx`
      select id, status, error, input, created_at from public.agent_runs
      where agent = 'copy' and input ->> 'campaignId' = ${campaignId} and created_at > now() - interval '7 days'
      order by created_at desc limit 20`;
    const runList: CopyRun[] = runs.map((r) => ({ runId: r.id, status: r.status, mode: r.input.mode, setId: r.input.setId ?? null, error: r.error, createdAt: r.created_at }));
    if (!ctx) return { ...empty(campaignId), runs: runList };
    const rows = await tx`
      select * from public.copy_sets where campaign_id = ${campaignId} and brief_version = ${ctx.version}
      order by created_at, id`;
    const pool = rulesFor(ctx).pool;
    const current = new Set(rows.filter((r) => !r.discarded_at).map((r) => r.id as string));
    const views: CopySetView[] = rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      briefVersion: r.brief_version,
      channel: r.channel,
      audience: { segmentRef: r.segment_ref, title: r.segment_title },
      copy: r.set,
      legalLines: r.legal_lines,
      source: r.source,
      runId: r.run_id,
      basedOn: r.based_on,
      replaces: r.source === "agent" && r.based_on && current.has(r.based_on) ? r.based_on : null,
      addedByPerson: r.source === "person" ? figuresAddedByPerson(r.channel, r.set, pool) : [],
      discardedAt: r.discarded_at,
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
    return {
      campaignId,
      version: ctx.version,
      signedOff: ctx.status === "approved" && ctx.approvedVersion === ctx.version,
      sets: views.filter((v) => !v.discardedAt),
      discarded: views.filter((v) => v.discardedAt).sort((x, y) => y.discardedAt!.getTime() - x.discardedAt!.getTime()),
      runs: runList,
    };
  });
}

/** Starts the Copy agent on a campaign's signed-off brief. Refused for a draft, while a run is writing, or when the version already has copy. */
export async function startCopyRun(member: Member, campaignId: string, send: SendEvent): Promise<string> {
  if (!UUID.test(campaignId)) throw new CopyError("That campaign isn't in your workspace.");
  const [c] = await asUser(member.userId, (tx) => tx`
    select c.id, c.brand_id, c.status, c.approved_version, b.name,
      (select count(*)::int from public.copy_sets s where s.campaign_id = c.id and s.brief_version = c.approved_version and s.discarded_at is null) as sets,
      (select count(*)::int from public.agent_runs r where r.agent = 'copy' and r.status in ('queued', 'running')
         and r.input ->> 'campaignId' = ${campaignId} and r.input ->> 'mode' = 'all') as running
    from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${campaignId}`);
  if (!c) throw new CopyError("That campaign isn't in your workspace.");
  if (c.status !== "approved" || !c.approved_version) throw new CopyError(NOT_SIGNED_OFF);
  if (c.running > 0) throw new CopyError("The Copy agent is already writing copy for this brief.");
  if (c.sets > 0) throw new CopyError("This signed-off brief already has copy. Use New words on a set, or discard the sets first.");
  return createRun(member, "copy", { mode: "all", campaignId }, send, { brandId: c.brand_id, label: `${c.name}: copy (v${c.approved_version})` });
}

/** The set and its campaign's sign-off state, for edits and new words. */
async function setFor(member: Member, setId: string) {
  return asUser(member.userId, (tx) => setIn(tx, setId));
}

async function setIn(tx: Tx, setId: string) {
  if (!UUID.test(setId)) throw new CopyError("That copy set isn't in your workspace.");
  const [s] = await tx`
    select s.*, c.status, c.approved_version, c.brand_id, b.name as brand_name
    from public.copy_sets s join public.campaigns c on c.id = s.campaign_id join public.brands b on b.id = c.brand_id
    where s.id = ${setId}`;
  if (!s) throw new CopyError("That copy set isn't in your workspace.");
  return s;
}

/**
 * Discards the agent's new words still waiting to replace a set, once that set
 * is edited or discarded (review finding 7): they would otherwise become a
 * current set shown nowhere. They stay in the history, discarded.
 */
async function discardWaitingReplacements(tx: Tx, setId: string): Promise<number> {
  const rows = await tx`
    update public.copy_sets set discarded_at = now()
    where based_on = ${setId} and source = 'agent' and discarded_at is null
    returning id`;
  return rows.length;
}

function gate(s: Record<string, unknown>) {
  if (s.status !== "approved" || !s.approved_version) throw new CopyError(NOT_SIGNED_OFF);
  if (s.approved_version !== s.brief_version) throw new CopyError(`That set was written for version ${s.brief_version}; the signed-off brief is now version ${s.approved_version}.`);
}

/** New words for one set: a Copy run limited to its channel and audience, writing one replacement that waits beside it. */
export async function startNewWords(member: Member, setId: string, send: SendEvent): Promise<string> {
  const s = await setFor(member, setId);
  if (s.discarded_at) throw new CopyError("That set was discarded. Restore it first, or choose a current set.");
  gate(s);
  const [busy] = await asUser(member.userId, (tx) => tx`
    select count(*)::int as n from public.agent_runs
    where agent = 'copy' and status in ('queued', 'running') and input ->> 'setId' = ${setId}`);
  if (busy.n > 0) throw new CopyError("New words are already being written for this set.");
  return createRun(member, "copy", { mode: "replace", campaignId: s.campaign_id, setId }, send, {
    brandId: s.brand_id,
    label: `${s.brand_name}: new words (${s.channel}, ${s.segment_title})`.slice(0, 200),
  });
}

/**
 * S5-2: a person's edit becomes a new set based on the old one, which is
 * discarded (the person chose to replace it). The same checks as the agent's
 * words, except that a typed figure is allowed and marked as added by a person.
 */
export async function saveCopyEdit(member: Member, setId: string, raw: unknown): Promise<string> {
  return asUser(member.userId, (tx) => saveCopyEditIn(tx, member, setId, raw));
}

/**
 * saveCopyEdit inside a transaction the caller holds, so Edit words can save
 * the set and move its ads in one transaction (review finding 6). New words
 * waiting to replace the old set are discarded with it (review finding 7).
 */
export async function saveCopyEditIn(tx: Tx, member: Member, setId: string, raw: unknown): Promise<string> {
  const s = await setIn(tx, setId);
  const channel = s.channel as CopyChannel;
  const parsed = EDIT_COPY[channel].safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
    throw new CopyEditError(Object.entries(fieldErrors).map(([f, m]) => `${f}: ${m}`), fieldErrors);
  }
  const [locked] = await tx`select discarded_at from public.copy_sets where id = ${setId} for update`;
  if (!locked || locked.discarded_at) throw new CopyError("This set was discarded or replaced. Open the current set to edit it.");
  gate(s);
  const ctx = await loadCopyContext(tx, s.campaign_id, s.brief_version);
  if (!ctx) throw new CopyError("The signed-off brief version no longer exists.");
  const problems = setProblems(channel, parsed.data as AnyCopy, rulesFor(ctx), { where: "the", allowFigures: true });
  if (problems.length) throw new CopyEditError(problems);
  const [row] = await tx`
    insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_ref, segment_title, set, legal_lines, source, based_on, created_by)
    values (${s.workspace_id}, ${s.campaign_id}, ${s.brief_version}, null, ${channel}, ${s.segment_ref}, ${s.segment_title},
            ${tx.json(parsed.data as never)}, ${ctx.kit.legalLines}, 'person', ${setId}, ${member.userId})
    returning id`;
  await tx`update public.copy_sets set discarded_at = now() where id = ${setId}`;
  await discardWaitingReplacements(tx, setId);
  return row.id as string;
}

/**
 * Marks a set discarded. It stays in the history and can be restored. New
 * words waiting to replace it are discarded too (review finding 7); restoring
 * the set doesn't bring them back.
 */
export async function discardCopySet(member: Member, setId: string): Promise<void> {
  if (!UUID.test(setId)) throw new CopyError("That copy set isn't in your workspace.");
  await asUser(member.userId, async (tx) => {
    const rows = await tx`update public.copy_sets set discarded_at = now() where id = ${setId} and discarded_at is null returning id`;
    if (rows.length === 0) throw new CopyError("That copy set isn't in your workspace, or is already discarded.");
    await discardWaitingReplacements(tx, setId);
  });
}

/** Undoes a discard. */
export async function restoreCopySet(member: Member, setId: string): Promise<void> {
  if (!UUID.test(setId)) throw new CopyError("That copy set isn't in your workspace.");
  const rows = await asUser(member.userId, (tx) => tx`
    update public.copy_sets set discarded_at = null where id = ${setId} and discarded_at is not null returning id`);
  if (rows.length === 0) throw new CopyError("That copy set isn't in your workspace, or isn't discarded.");
}
