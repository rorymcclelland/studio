import { createHash } from "node:crypto";
import { readAdAgent } from "@/lib/agents/read-ad";
import { createRun, StartRunError, type Member, type SendEvent } from "@/lib/agents/runs";
import type { UploadFinding, UploadOutcome } from "@/lib/compliance/upload-rules";
import { ENGLISH, LANG_NAMES, brandLanguagesIn } from "@/lib/creative/languages";
import { asUser } from "@/lib/db/scoped";
import { readAdUpload, UploadError, type UploadFile } from "./file";

// C8-3: a brand's uploaded ads and their checks. An upload is an asset of
// kind 'upload' (made by a person, never simulated, in no campaign or run);
// each check is a Read ad run, whose findings are kept in uploaded_ad_checks.
// Every read and write goes through asUser (rule 7): another workspace's
// brand or upload is "isn't in your workspace" or nothing, alike.

export { UploadError };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CHANNELS = ["paid social", "display"] as const;
export type UploadChannel = (typeof CHANNELS)[number];

export const NOT_YOURS = "That brand isn't in your workspace.";
export const CHECK_BUSY = "This ad is being checked already. Wait for that check to finish.";

export type CheckOptions = { channel: string; lang: string };

/** The channel and language, as the brand has them, or an UploadError with the reason. */
async function checkOptions(userId: string, brandId: string, opts: CheckOptions): Promise<{ channel: UploadChannel; lang: string; brandName: string; workspaceId: string }> {
  if (!UUID.test(brandId)) throw new UploadError(NOT_YOURS);
  return asUser(userId, async (tx) => {
    const [b] = await tx`select name, workspace_id from public.brands where id = ${brandId}`;
    if (!b) throw new UploadError(NOT_YOURS);
    if (!(CHANNELS as readonly string[]).includes(opts.channel)) throw new UploadError("Choose the channel the ad is for: paid social or display.");
    if (opts.lang !== ENGLISH) {
      const langs = await brandLanguagesIn(tx, brandId);
      if (!langs.some((l) => l.lang === opts.lang)) throw new UploadError("Choose one of the brand's languages for the ad.");
    }
    return { channel: opts.channel as UploadChannel, lang: opts.lang, brandName: b.name as string, workspaceId: b.workspace_id as string };
  });
}

/** A file name fit to show: letters, digits, spaces and a few marks, at most 100 characters. */
export function cleanName(name: string): string {
  return (name ?? "").replace(/[^\p{L}\p{N} ._()-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 100) || "Uploaded ad";
}

async function startCheck(member: Member, brandId: string, brandName: string, assetId: string, channel: UploadChannel, lang: string, send: SendEvent): Promise<string> {
  return createRun(member, readAdAgent.key, { brandId, assetId, channel, lang }, send, { brandId, label: `${brandName}: check an uploaded ad` });
}

/**
 * Checks and stores an uploaded ad for a brand, then starts its check (the
 * click that sent it showed the cost). A refused file throws UploadError with
 * the reason, and nothing is stored. If the check can't start, the upload is
 * kept and the error says so: it can be checked again from its page.
 */
export async function uploadAd(member: Member, brandId: string, file: UploadFile, opts: CheckOptions, send: SendEvent): Promise<{ assetId: string; runId: string | null; error: string | null }> {
  const o = await checkOptions(member.userId, brandId, opts);
  const read = await readAdUpload(file);
  const sha256 = createHash("sha256").update(read.bytes).digest("hex");
  const assetId = await asUser(member.userId, async (tx) => {
    const [a] = await tx`
      insert into public.assets (workspace_id, kind, brand_id, campaign_id, run_id, mime, width, height, bytes, sha256, simulated, meta, created_by, created_by_kind)
      values (${o.workspaceId}, 'upload', ${brandId}, null, null, ${read.mime}, ${read.width}, ${read.height}, ${read.bytes}, ${sha256}, false,
              ${tx.json({ name: cleanName(file.name), original: read.original } as never)}, ${member.userId}, 'person')
      returning id`;
    return a.id as string;
  });
  try {
    return { assetId, runId: await startCheck(member, brandId, o.brandName, assetId, o.channel, o.lang, send), error: null };
  } catch (err) {
    if (err instanceof StartRunError) return { assetId, runId: null, error: `The ad was uploaded, but its check didn't start: ${err.message}` };
    throw err;
  }
}

/** Checks an upload again (after a failure, or with another channel or language). Refused while a check of it runs. */
export async function checkAgain(member: Member, brandId: string, assetId: string, opts: CheckOptions, send: SendEvent): Promise<string> {
  const o = await checkOptions(member.userId, brandId, opts);
  if (!UUID.test(assetId)) throw new UploadError("That upload isn't in your workspace.");
  const busy = await asUser(member.userId, async (tx) => {
    const [a] = await tx`select id from public.assets where id = ${assetId} and brand_id = ${brandId} and kind = 'upload' and discarded_at is null`;
    if (!a) throw new UploadError("That upload isn't in your workspace.");
    const [r] = await tx`
      select count(*)::int as n from public.agent_runs
      where agent = 'readAd' and status in ('queued', 'running') and input ->> 'assetId' = ${assetId}`;
    return r.n > 0;
  });
  if (busy) throw new UploadError(CHECK_BUSY);
  try {
    return await startCheck(member, brandId, o.brandName, assetId, o.channel, o.lang, send);
  } catch (err) {
    if (err instanceof StartRunError) throw new UploadError(err.message);
    throw err;
  }
}

export type StoredWord = { text: string; part: "headline" | "body" | "button" | "legal" | "other" };

export type UploadCheck = {
  id: string;
  channel: UploadChannel;
  lang: string;
  langName: string;
  words: StoredWord[];
  findings: UploadFinding[];
  outcome: UploadOutcome;
  simulated: boolean;
  runId: string | null;
  createdAt: Date;
};

export type UploadRun = { id: string; status: string; error: string | null; channel: string; lang: string; createdAt: Date };

export type Upload = {
  id: string;
  brandId: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  src: string;
  createdAt: Date;
  /** The newest check, if any finished. */
  check: UploadCheck | null;
  /** The newest run, whatever its state (it may be newer than the check). */
  run: UploadRun | null;
};

const langName = (lang: string) => (LANG_NAMES as Record<string, string>)[lang] ?? lang;

function toCheck(r: Record<string, unknown>): UploadCheck {
  return {
    id: r.id as string,
    channel: r.channel as UploadChannel,
    lang: r.lang as string,
    langName: langName(r.lang as string),
    words: (r.words as StoredWord[]) ?? [],
    findings: (r.findings as UploadFinding[]) ?? [],
    outcome: r.outcome as UploadOutcome,
    simulated: r.simulated === true,
    runId: (r.run_id as string | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

/** A brand's uploads, newest first, each with its newest check and run. */
export async function listUploads(userId: string, brandId: string, opts: { id?: string; limit?: number } = {}): Promise<Upload[]> {
  if (!UUID.test(brandId) || (opts.id !== undefined && !UUID.test(opts.id))) return [];
  return asUser(userId, async (tx) => {
    const assets = await tx`
      select id, brand_id, mime, width, height, meta, created_at from public.assets
      where brand_id = ${brandId} and kind = 'upload' and discarded_at is null
        and ${opts.id ? tx`id = ${opts.id}` : tx`true`}
      order by created_at desc, id
      limit ${opts.limit ?? 50}`;
    if (assets.length === 0) return [];
    const ids = assets.map((a) => a.id as string);
    const checks = await tx`
      select distinct on (asset_id) id, asset_id, channel, lang, words, findings, outcome, simulated, run_id, created_at
      from public.uploaded_ad_checks where asset_id = any(${ids}::uuid[])
      order by asset_id, created_at desc, id`;
    const runs = await tx`
      select distinct on (input ->> 'assetId') id, input, status, error, created_at
      from public.agent_runs where agent = 'readAd' and input ->> 'assetId' = any(${ids}::text[])
      order by input ->> 'assetId', created_at desc, id`;
    return assets.map((a) => {
      const c = checks.find((x) => x.asset_id === a.id);
      const r = runs.find((x) => (x.input as { assetId?: string }).assetId === a.id);
      const input = (r?.input ?? {}) as { channel?: string; lang?: string };
      return {
        id: a.id as string,
        brandId: a.brand_id as string,
        name: ((a.meta as { name?: string }).name ?? "Uploaded ad") || "Uploaded ad",
        mime: a.mime as string,
        width: a.width as number,
        height: a.height as number,
        src: `/assets/${a.id}`,
        createdAt: a.created_at as Date,
        check: c ? toCheck(c) : null,
        run: r ? { id: r.id as string, status: r.status as string, error: (r.error as string | null) ?? null, channel: input.channel ?? "", lang: input.lang ?? ENGLISH, createdAt: r.created_at as Date } : null,
      };
    });
  });
}

/** One upload of a brand, with its newest check and run, or null (another workspace's, another brand's, or not an id). */
export async function getUpload(userId: string, brandId: string, assetId: string): Promise<Upload | null> {
  if (!UUID.test(assetId)) return null;
  const [u] = await listUploads(userId, brandId, { id: assetId, limit: 1 });
  return u ?? null;
}

/** Whether a run is still going (the page follows it). */
export const isActive = (run: UploadRun | null) => !!run && (run.status === "queued" || run.status === "running");
