import { generateText } from "ai";
import { resolveAgentModel, type AgentKey } from "@/config/agents";
import { asUser } from "@/lib/db/scoped";
import { isOwnerEmail, ownerEmail, ownerReservePence, workspaceCapPence } from "@/lib/env";
import { dailyCapPence } from "./cap";
import { costPence, estimateTokens, searchCostPence } from "./cost";
import { getLanguageModel, getWebSearchTool, MissingKeyError } from "./registry";

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
  /** This workspace today. */
  workspace: number;
  /** The whole app today, and the owner's part of it. */
  total: number;
  ownerSpent: number;
  /** What this user's runs may still spend today, all limits considered. */
  limit: number;
  scope: "app" | "workspace";
};

/** Where a user stands against the caps (rule 5): the owner may use the whole daily cap; others get their workspace's limit, and never the owner's reserve. */
export async function spendPosition(userId: string, workspaceId: string): Promise<SpendPosition> {
  const r = await asUser(userId, async (tx) => {
    const [x] = await tx`
      select public.current_user_email() as email, public.workspace_spend_today_pence(${workspaceId}) as ws,
        s.owner_pence, s.total_pence
      from public.spend_split_today(${ownerEmail()}) s`;
    return x;
  });
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

async function checkCaps(userId: string, workspaceId: string, estimate: number): Promise<void> {
  const p = await spendPosition(userId, workspaceId);
  const spent = p.scope === "workspace" ? p.workspace : p.total;
  if (spent + estimate > p.limit) throw new CapExceededError(spent, Math.max(0, p.limit), estimate, p.scope);
}

export class ProviderError extends Error {}

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

/**
 * The only way the app calls a model. Checks the cap first (rule 5), retries
 * once, and records every call that returned tokens in the usage ledger
 * (rule 4). API keys never enter the prompt: they live in the provider client.
 */
export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const cfg = resolveAgentModel(input.agent);
  const fullText = `${input.instructions ?? ""}\n${input.prompt}`;
  // Search results come back into the prompt, so a search call is estimated generously.
  const searchTokens = input.webSearch ? input.webSearch.maxUses * 6000 : 0;
  const estimate =
    costPence(cfg.provider, cfg.model, estimateTokens(fullText) + searchTokens, cfg.maxOutputTokens) +
    (input.webSearch ? searchCostPence(cfg.provider, input.webSearch.maxUses) : 0);
  await checkCaps(input.userId, input.workspaceId, estimate);

  const model = getLanguageModel(cfg.provider, cfg.model);
  const tools = input.webSearch ? { web_search: getWebSearchTool(cfg.provider, input.webSearch.maxUses) } : undefined;
  let lastError: unknown;
  // A search call is not retried here (the searches may already have been charged), and gets longer.
  const attemptsAllowed = input.webSearch ? 1 : ATTEMPTS;
  const timeout = input.webSearch ? SEARCH_TIMEOUT_MS : TIMEOUT_MS;
  for (let attempt = 1; attempt <= attemptsAllowed; attempt++) {
    const started = Date.now();
    try {
      const result = await generateText({
        model,
        instructions: input.instructions,
        prompt: input.prompt,
        maxOutputTokens: cfg.maxOutputTokens,
        ...(tools ? { tools } : {}),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeout),
      });
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      const { searches, sources } = input.webSearch ? readSearch(result, input.webSearch.maxUses) : { searches: 0, sources: [] };
      const cost = costPence(cfg.provider, cfg.model, inputTokens, outputTokens) + searchCostPence(cfg.provider, searches);
      if (inputTokens + outputTokens > 0 || searches > 0) {
        await asUser(input.userId, (tx) => tx`
          insert into public.usage_ledger
            (workspace_id, run_id, step_id, agent, provider, model, input_tokens, output_tokens, search_requests, cost_pence)
          values (${input.workspaceId}, ${input.runId ?? null}, ${input.stepId ?? null}, ${input.agent},
                  ${cfg.provider}, ${cfg.model}, ${inputTokens}, ${outputTokens}, ${searches}, ${cost})`);
      }
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
    } catch (err) {
      if (err instanceof MissingKeyError) throw err;
      lastError = err;
      if (input.webSearch) {
        // The provider may have run and charged the searches before failing: record the full allowance, so the meter never under-counts.
        const uses = input.webSearch.maxUses;
        const cost = searchCostPence(cfg.provider, uses);
        await asUser(input.userId, (tx) => tx`
          insert into public.usage_ledger
            (workspace_id, run_id, step_id, agent, provider, model, input_tokens, output_tokens, search_requests, cost_pence)
          values (${input.workspaceId}, ${input.runId ?? null}, ${input.stepId ?? null}, ${input.agent},
                  ${cfg.provider}, ${cfg.model}, 0, 0, ${uses}, ${cost})`);
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new ProviderError(`${cfg.provider} failed after ${attemptsAllowed} attempt${attemptsAllowed === 1 ? "" : "s"}: ${message}`);
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

