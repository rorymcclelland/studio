import { APICallError, generateImage as sdkGenerateImage, generateText, type ModelMessage } from "ai";
import { resolveAgentModel, resolveImageModel, type AgentKey } from "@/config/agents";
import { asUser, type Tx } from "@/lib/db/scoped";
import { isOwnerEmail, ownerEmail, ownerReservePence, workspaceCapPence } from "@/lib/env";
import { dailyCapPence } from "./cap";
import { costPence, estimateTokens, imageCostPence, searchCostPence } from "./cost";
import { getImageModel, getLanguageModel, getWebSearchTool, MissingKeyError } from "./registry";

export class CapExceededError extends Error {
  constructor(public spentPence: number, public capPence: number, public estimatePence: number, public scope: "app" | "workspace" = "app") {
    super(
      scope === "workspace"
        ? `Daily AI cap reached: today's limit for this workspace is reached (£${(spentPence / 100).toFixed(2)} spent of £${(capPence / 100).toFixed(2)}; ` +
            `this call could cost up to £${(estimatePence / 100).toFixed(2)}). It resets at midnight UK time.`
        : `Daily AI cap reached: £${(spentPence / 100).toFixed(2)} spent of £${(capPence / 100).toFixed(2)}; ` +
            `this call could cost up to £${(estimatePence / 100).toFixed(2)}.`,
    );
  }
}

export type SpendPosition = {
  owner: boolean;
  /** This workspace today: charged plus live reservations (F-21). */
  workspace: number;
  /** The whole app today, and the owner's part of it, reservations included. */
  total: number;
  ownerSpent: number;
  /** What this user's runs may still spend today, all limits considered. */
  limit: number;
  scope: "app" | "workspace";
};

async function positionIn(tx: Tx, workspaceId: string): Promise<SpendPosition> {
  const [r] = await tx`
    select public.current_user_email() as email, public.workspace_spend_today_pence(${workspaceId}) as ws,
      s.owner_pence, s.total_pence
    from public.spend_split_today(${ownerEmail()}) s`;
  const owner = isOwnerEmail(r.email);
  const total = Number(r.total_pence);
  const ownerSpent = Number(r.owner_pence);
  const workspace = Number(r.ws);
  const cap = dailyCapPence();
  if (owner) return { owner, workspace, total, ownerSpent, limit: cap, scope: "app" };
  const appRoom = cap - Math.max(0, ownerReservePence() - ownerSpent);
  const wsCap = workspaceCapPence();
  // Whichever runs out first: the workspace's own limit or the guests' share of the app cap.
  return wsCap - workspace <= appRoom - total
    ? { owner, workspace, total, ownerSpent, limit: wsCap, scope: "workspace" }
    : { owner, workspace, total, ownerSpent, limit: appRoom, scope: "app" };
}

/** Where a user stands against the caps (rule 5): the owner may use the whole daily cap; others get their workspace's limit, and never the owner's reserve. */
export async function spendPosition(userId: string, workspaceId: string): Promise<SpendPosition> {
  return asUser(userId, (tx) => positionIn(tx, workspaceId));
}

/**
 * Today's simulated spend (rule 1, review finding 4): ledger rows from the mock
 * models, for this workspace and across the app. It never enters the cap
 * arithmetic, which counts simulated pence like any others.
 */
export async function simulatedSpendToday(userId: string, workspaceId: string): Promise<{ workspace: number; total: number }> {
  return asUser(userId, async (tx) => {
    const [r] = await tx`
      select coalesce((select sum(l.cost_pence) from public.usage_ledger l
                        where l.workspace_id = ${workspaceId} and l.provider = 'mock'
                          and l.created_at >= (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')), 0) as ws,
             public.simulated_spend_today_pence() as total`;
    return { workspace: Number(r.ws), total: Number(r.total) };
  });
}

/** Reservations left by crashed calls stop counting after this long (F-21). */
const RESERVATION_LIFETIME = "10 minutes";

/** What the header's spend meter shows (U10-1): charged today, its simulated part and the calls in flight. */
export type SpendMeterReading = {
  owner: boolean;
  /** Charged today (usage_ledger), without live reservations: a reservation is an estimate, never shown as spend. */
  chargedPence: number;
  /** The mock models' part of it (rule 1, review finding 4). */
  simulatedPence: number;
  /** Live reservations (under 10 minutes old): one per model call in flight. */
  callsInFlight: number;
  /** The cap this person is measured against: the daily cap for the owner, the workspace's limit for others. */
  capPence: number;
};

/**
 * The spend meter's facts: app-wide for the owner, this workspace's for
 * everyone else (as the cap figures are). Reservations still count against the
 * cap in reserve(); here they are only counted as calls running.
 */
export async function spendMeterReading(userId: string, workspaceId: string): Promise<SpendMeterReading> {
  return asUser(userId, async (tx) => {
    // The app-wide figures are read only for the owner, so a guest's page never asks for them.
    const [who] = await tx`select public.current_user_email() as email`;
    const owner = isOwnerEmail(who.email);
    const [r] = await tx`
      select
        coalesce((select sum(l.cost_pence) from public.usage_ledger l
                  where l.workspace_id = ${workspaceId}
                    and l.created_at >= (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')), 0) as ws_charged,
        coalesce((select sum(l.cost_pence) from public.usage_ledger l
                  where l.workspace_id = ${workspaceId} and l.provider = 'mock'
                    and l.created_at >= (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')), 0) as ws_simulated,
        (select count(*)::integer from public.spend_reservations s
         where s.workspace_id = ${workspaceId} and s.created_at > now() - ${RESERVATION_LIFETIME}::interval) as ws_running,
        ${owner ? tx`m.charged_pence, m.simulated_pence, m.calls_running` : tx`null as charged_pence, null as simulated_pence, null as calls_running`}
      ${owner ? tx`from public.spend_meter_today() m` : tx``}`;
    return owner
      ? { owner, chargedPence: Number(r.charged_pence), simulatedPence: Number(r.simulated_pence), callsInFlight: Number(r.calls_running), capPence: dailyCapPence() }
      : { owner, chargedPence: Number(r.ws_charged), simulatedPence: Number(r.ws_simulated), callsInFlight: Number(r.ws_running), capPence: workspaceCapPence() };
  });
}

// F-21: every cap check takes the app-wide lock, then the workspace's, always in
// that order (so two checks never deadlock). The app-wide lock is what keeps
// the owner and guest split consistent, since a guest's room depends on what
// every workspace has spent; the workspace lock keeps the per-workspace limit
// serialised on its own if the app-wide one is ever relaxed.
const APP_LOCK = "studio:spend:app";

/**
 * Checks the caps and reserves the call's estimate in one transaction, under
 * the locks, so calls started together can't all pass a cap only some fit.
 * Returns the reservation's id; the caller must release it.
 */
async function reserve(userId: string, workspaceId: string, estimate: number, ids: { runId?: string; stepId?: string }): Promise<string> {
  return asUser(userId, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${APP_LOCK}, 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`studio:spend:${workspaceId}`}, 0))`;
    // Reservations left by crashed calls stop counting after 10 minutes; tidy this workspace's.
    await tx`delete from public.spend_reservations
             where workspace_id = ${workspaceId} and created_at <= now() - ${RESERVATION_LIFETIME}::interval`;
    const p = await positionIn(tx, workspaceId);
    const spent = p.scope === "workspace" ? p.workspace : p.total;
    if (spent + estimate > p.limit) throw new CapExceededError(spent, Math.max(0, p.limit), estimate, p.scope);
    const [r] = await tx`
      insert into public.spend_reservations (workspace_id, run_id, step_id, pence)
      values (${workspaceId}, ${ids.runId ?? null}, ${ids.stepId ?? null}, ${estimate})
      returning id`;
    return r.id as string;
  });
}

type LedgerRow = {
  agent: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  searches?: number;
  images?: number;
  cost: number;
};

/** Charges the real cost (if any) and drops the reservation in one transaction, so the spend is never counted twice or not at all. */
async function settle(
  userId: string,
  workspaceId: string,
  reservationId: string,
  ids: { runId?: string; stepId?: string },
  row: LedgerRow | null,
): Promise<void> {
  await asUser(userId, async (tx) => {
    if (row) {
      await tx`
        insert into public.usage_ledger
          (workspace_id, run_id, step_id, agent, provider, model, input_tokens, output_tokens, search_requests, images, cost_pence)
        values (${workspaceId}, ${ids.runId ?? null}, ${ids.stepId ?? null}, ${row.agent}, ${row.provider}, ${row.model},
                ${row.inputTokens}, ${row.outputTokens}, ${row.searches ?? 0}, ${row.images ?? 0}, ${row.cost})`;
    }
    await tx`delete from public.spend_reservations where id = ${reservationId}`;
  });
}

export class ProviderError extends Error {}

/** The provider refused for quota or billing (HTTP 429): nothing was drawn or charged, and trying again now won't help. */
export class QuotaError extends ProviderError {}

/**
 * A plain message for a quota refusal (production, 27 Oct: Google's free tier
 * has no image quota at all, and its raw message ran to a paragraph a picture).
 */
export function quotaMessage(provider: string, raw: string): string | null {
  if (!/quota|rate.?limit|RESOURCE_EXHAUSTED|\b429\b/i.test(raw)) return null;
  const who = provider === "google" ? "Google" : provider;
  if (/free.?tier/i.test(raw)) {
    return `${who} refused the picture: the API key's ${who} project is on the free tier, which has no image quota. Turn on billing for that project (in Google AI Studio, Get API key, then Set up billing), then try again. Nothing was charged.`;
  }
  return `${who} refused the picture: the API key's project is over its quota or rate limit. Try again in a few minutes, or check the project's limits. Nothing was charged.`;
}

/** A picture sent with a text call, for a vision check (S5-1). */
export type ImageInput = { data: Uint8Array; mediaType: "image/webp" | "image/png" | "image/jpeg" };

export type GenerateInput = {
  agent: AgentKey;
  userId: string;
  workspaceId: string;
  runId?: string;
  stepId?: string;
  instructions?: string;
  prompt: string;
  /** S4-3: let the model search the web, at most `maxUses` times (counted against the cap). */
  webSearch?: { maxUses: number };
  /** S5-1: pictures for the model to look at, sent after the prompt's text. */
  images?: ImageInput[];
};

/** A page the model's search returned or cited, with the passages it cited. */
export type WebSource = { url: string; title: string | null; citedText: string[] };

export type GenerateResult = {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costPence: number;
  durationMs: number;
  /** Web searches made, and the pages they returned or the reply cited (S4-3). */
  searches: number;
  sources: WebSource[];
};

const ATTEMPTS = 2; // one retry (S1-4 #5)
const TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 180_000;
const IMAGE_TIMEOUT_MS = 120_000;
// A 1K picture is about 1,400 input tokens to Claude (width x height / 750); estimated generously. A 2K
// picture (C7-1) is reduced by the API to about 1.15 megapixels first, so it costs about the same.
const TOKENS_PER_IMAGE_INPUT = 1_600;

/**
 * The only way the app calls a text model. Checks the cap and reserves the
 * estimate first (rule 5, F-21), retries once, and records every call that
 * returned tokens in the usage ledger (rule 4). API keys never enter the
 * prompt: they live in the provider client.
 */
export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const cfg = resolveAgentModel(input.agent);
  const fullText = `${input.instructions ?? ""}\n${input.prompt}`;
  // Search results come back into the prompt and are re-read on each search, so
  // a search call is estimated generously (production: 5 searches read 140k tokens).
  const searchTokens = input.webSearch ? input.webSearch.maxUses * 30000 : 0;
  const imageTokens = (input.images?.length ?? 0) * TOKENS_PER_IMAGE_INPUT;
  const estimate =
    costPence(cfg.provider, cfg.model, estimateTokens(fullText) + searchTokens + imageTokens, cfg.maxOutputTokens) +
    (input.webSearch ? searchCostPence(cfg.provider, input.webSearch.maxUses) : 0);
  const ids = { runId: input.runId, stepId: input.stepId };
  const reservation = await reserve(input.userId, input.workspaceId, estimate, ids);
  const row = (inputTokens: number, outputTokens: number, searches: number, cost: number): LedgerRow =>
    ({ agent: input.agent, provider: cfg.provider, model: cfg.model, inputTokens, outputTokens, searches, cost });

  // Only the provider call is inside the retry (review finding 1): a ledger
  // write that fails must not look like a model failure and call the model
  // again. Settling happens once, after the loop.
  let result: ({ text: string; usage: { inputTokens?: number; outputTokens?: number } } & SearchResultShape) | null = null;
  let lastError: unknown;
  let started = Date.now();
  // A search call is not retried here (the searches may already have been charged), and gets longer.
  const attemptsAllowed = input.webSearch ? 1 : ATTEMPTS;
  try {
    const model = getLanguageModel(cfg.provider, cfg.model);
    const tools = input.webSearch ? { web_search: getWebSearchTool(cfg.provider, input.webSearch.maxUses) } : undefined;
    const messages: ModelMessage[] | null = input.images?.length
      ? [{ role: "user", content: [{ type: "text", text: input.prompt }, ...input.images.map((i) => ({ type: "file" as const, data: i.data, mediaType: i.mediaType }))] }]
      : null;
    const timeout = input.webSearch ? SEARCH_TIMEOUT_MS : TIMEOUT_MS;
    for (let attempt = 1; attempt <= attemptsAllowed && !result; attempt++) {
      started = Date.now();
      try {
        result = await generateText({
          model,
          instructions: input.instructions,
          ...(messages ? { messages } : { prompt: input.prompt }),
          maxOutputTokens: cfg.maxOutputTokens,
          ...(tools ? { tools } : {}),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(timeout),
        });
      } catch (err) {
        if (err instanceof MissingKeyError) throw err;
        lastError = err;
      }
    }
  } catch (err) {
    // Nothing reached the provider (a missing key): drop the reservation.
    await dropReservation(input.userId, input.workspaceId, reservation, ids);
    throw err;
  }

  if (!result) {
    if (input.webSearch) {
      // The provider may have run and charged the searches before failing: record the full allowance, so the meter never under-counts.
      // If this write fails, the reservation stays (spend still counts for 10 minutes) and the write's error is thrown.
      const uses = input.webSearch.maxUses;
      await settle(input.userId, input.workspaceId, reservation, ids, row(0, 0, uses, searchCostPence(cfg.provider, uses)));
    } else {
      await dropReservation(input.userId, input.workspaceId, reservation, ids);
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ProviderError(`${cfg.provider} failed after ${attemptsAllowed} attempt${attemptsAllowed === 1 ? "" : "s"}: ${message}`);
  }

  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const { searches, sources } = input.webSearch ? readSearch(result, input.webSearch.maxUses) : { searches: 0, sources: [] };
  const cost = costPence(cfg.provider, cfg.model, inputTokens, outputTokens) + searchCostPence(cfg.provider, searches);
  // The call was paid for. If the charge can't be written, the reservation is
  // left in place (its transaction rolls back), so the spend still counts until
  // it expires, and the error is thrown rather than the call made again.
  await settle(
    input.userId,
    input.workspaceId,
    reservation,
    ids,
    inputTokens + outputTokens > 0 || searches > 0 ? row(inputTokens, outputTokens, searches, cost) : null,
  );
  return {
    text: result.text,
    provider: cfg.provider,
    model: cfg.model,
    inputTokens,
    outputTokens,
    costPence: cost,
    durationMs: Date.now() - started,
    searches,
    sources,
  };
}

/**
 * Drops a reservation for a call that was never charged. A failure here is
 * logged, not thrown: the reservation then only over-counts until it expires,
 * and the caller's own error is the one worth reporting.
 */
async function dropReservation(userId: string, workspaceId: string, reservationId: string, ids: { runId?: string; stepId?: string }): Promise<void> {
  try {
    await settle(userId, workspaceId, reservationId, ids, null);
  } catch (err) {
    console.error("Could not drop a spend reservation; it expires in 10 minutes", err);
  }
}

export type GenerateImageInput = {
  /** The agent the picture is for, as named in the ledger. */
  agent: AgentKey;
  userId: string;
  workspaceId: string;
  runId?: string;
  stepId?: string;
  prompt: string;
  aspect: "1:1";
  /** Varies a redraw. The mock uses it; providers that don't support it ignore it with a warning. */
  seed?: number;
  /** Hex colours for the mock image model to paint with (it has no imagination). Real models get the colours in words, in the prompt. */
  palette?: string[];
};

export type GenerateImageResult = {
  bytes: Uint8Array;
  mediaType: string;
  provider: string;
  model: string;
  size: "1K" | "2K";
  inputTokens: number;
  costPence: number;
  durationMs: number;
  /** True when the mock model drew it (rule 1: labelled wherever shown). */
  simulated: boolean;
};

/**
 * Whether a failed image call may have been billed. A 4xx answer (bad request,
 * no key, rate limit, refused prompt) means Google turned the request away
 * before drawing, so nothing was charged. Anything else (a timeout, a dropped
 * connection, a 5xx, a reply without a picture) may have come after the
 * picture was made and billed, so it is charged in full, as failed search calls
 * are: the meter may over-count a failure, but never under-counts one.
 */
export function imageFailureMayBeBilled(err: unknown): boolean {
  if (APICallError.isInstance(err) && typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) return false;
  return true;
}

/**
 * The only way the app draws a picture (rule 5, S5-1). Checks the cap and
 * reserves the price of one image first (F-21), makes one attempt with a
 * timeout and no retry (a retry could pay for a second picture), and records
 * the image in the usage ledger. The caller's step records it in the trail.
 */
export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const cfg = resolveImageModel();
  const estimate = imageCostPence(cfg.provider, cfg.model, cfg.size, 1);
  const ids = { runId: input.runId, stepId: input.stepId };
  const reservation = await reserve(input.userId, input.workspaceId, estimate, ids);
  const started = Date.now();
  const charge = (inputTokens: number, outputTokens: number): LedgerRow =>
    ({ agent: input.agent, provider: cfg.provider, model: cfg.model, inputTokens, outputTokens, images: 1, cost: estimate });

  // Only the provider call is inside the try (review finding 1); settling comes
  // after it, so a failed ledger write is never mistaken for a failed picture.
  let image: { uint8Array: Uint8Array; mediaType: string };
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    const model = getImageModel(cfg.provider, cfg.model);
    const result = await sdkGenerateImage({
      model,
      prompt: input.prompt,
      n: 1,
      aspectRatio: input.aspect,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      providerOptions: {
        google: { imageConfig: { imageSize: cfg.size } },
        ...(cfg.provider === "mock" ? { mock: { palette: input.palette ?? [], size: cfg.size } } : {}),
      },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!result.images[0]) throw new Error("The image model returned no picture.");
    image = result.images[0];
    usage = result.usage;
  } catch (err) {
    if (err instanceof MissingKeyError) {
      await dropReservation(input.userId, input.workspaceId, reservation, ids);
      throw err;
    }
    // A failure that may have been billed is charged in full. If that write
    // fails, the reservation stays and the write's error is thrown.
    // A quota refusal (429 or RESOURCE_EXHAUSTED) drew nothing, so it is never charged.
    const message = err instanceof Error ? err.message : String(err);
    const status = APICallError.isInstance(err) ? err.statusCode : undefined;
    const quota = status === 429 || /RESOURCE_EXHAUSTED/.test(message) ? quotaMessage(cfg.provider, message) : null;
    if (!quota && imageFailureMayBeBilled(err)) await settle(input.userId, input.workspaceId, reservation, ids, charge(0, 0));
    else await dropReservation(input.userId, input.workspaceId, reservation, ids);
    if (quota) throw new QuotaError(quota);
    throw new ProviderError(`${cfg.provider} image call failed (not retried): ${message}`);
  }

  const inputTokens = usage.inputTokens ?? 0;
  // The picture was paid for: if the charge can't be written, the reservation
  // stays in place (spend still counts for 10 minutes) and the error is thrown.
  await settle(input.userId, input.workspaceId, reservation, ids, charge(inputTokens, usage.outputTokens ?? 0));
  return {
    bytes: image.uint8Array,
    mediaType: image.mediaType,
    provider: cfg.provider,
    model: cfg.model,
    size: cfg.size,
    inputTokens,
    costPence: estimate,
    durationMs: Date.now() - started,
    simulated: cfg.provider === "mock",
  };
}

type SearchResultShape = {
  sources?: { sourceType: string; url?: string; title?: string; providerMetadata?: { anthropic?: { citedText?: unknown } } }[];
  content?: { type: string; toolName?: string }[];
  providerMetadata?: { anthropic?: { usage?: { server_tool_use?: { web_search_requests?: number } } } };
};

/**
 * Searches made and pages seen. The count comes from the provider's usage,
 * else the search calls in the reply; if neither says but pages came back,
 * the full allowance is charged, so the meter never under-counts.
 */
export function readSearch(result: SearchResultShape, maxUses: number): { searches: number; sources: WebSource[] } {
  const byUrl = new Map<string, WebSource>();
  for (const s of result.sources ?? []) {
    if (s.sourceType !== "url" || !s.url) continue;
    const entry = byUrl.get(s.url) ?? { url: s.url, title: s.title ?? null, citedText: [] };
    if (!entry.title && s.title) entry.title = s.title;
    const cited = s.providerMetadata?.anthropic?.citedText;
    if (typeof cited === "string" && cited.trim() && !entry.citedText.includes(cited)) entry.citedText.push(cited);
    byUrl.set(s.url, entry);
  }
  const reported = result.providerMetadata?.anthropic?.usage?.server_tool_use?.web_search_requests;
  const calls = (result.content ?? []).filter((p) => p.type === "tool-call" && p.toolName === "web_search").length;
  const searches = typeof reported === "number" ? reported : calls > 0 ? calls : byUrl.size > 0 ? maxUses : 0;
  return { searches: Math.min(searches, maxUses), sources: [...byUrl.values()] };
}
