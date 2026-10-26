import { generateText } from "ai";
import { resolveAgentModel, type AgentKey } from "@/config/agents";
import { asUser } from "@/lib/db/scoped";
import { isOwnerEmail, workspaceCapPence } from "@/lib/env";
import { dailyCapPence, spendTodayPence } from "./cap";
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

async function workspaceSpend(userId: string, workspaceId: string): Promise<{ owner: boolean; spent: number }> {
  return asUser(userId, async (tx) => {
    const [r] = await tx`select public.current_user_email() as email, public.workspace_spend_today_pence(${workspaceId}) as spent`;
    return { owner: isOwnerEmail(r.email), spent: Number(r.spent) };
  });
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
  const cap = dailyCapPence();
  const spent = await spendTodayPence(input.userId);
  if (spent + estimate > cap) throw new CapExceededError(spent, cap, estimate);
  // F-3: each workspace but the owner's has its own, smaller daily limit.
  const ws = await workspaceSpend(input.userId, input.workspaceId);
  if (!ws.owner && ws.spent + estimate > workspaceCapPence()) {
    throw new CapExceededError(ws.spent, workspaceCapPence(), estimate, "workspace");
  }

  const model = getLanguageModel(cfg.provider, cfg.model);
  const tools = input.webSearch ? { web_search: getWebSearchTool(cfg.provider, input.webSearch.maxUses) } : undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = Date.now();
    try {
      const result = await generateText({
        model,
        instructions: input.instructions,
        prompt: input.prompt,
        maxOutputTokens: cfg.maxOutputTokens,
        ...(tools ? { tools } : {}),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
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
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new ProviderError(`${cfg.provider} failed after ${ATTEMPTS} attempts: ${message}`);
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

