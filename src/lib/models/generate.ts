import { generateText } from "ai";
import { resolveAgentModel, type AgentKey } from "@/config/agents";
import { asUser } from "@/lib/db/scoped";
import { dailyCapPence, spendTodayPence } from "./cap";
import { costPence, estimateTokens } from "./cost";
import { getLanguageModel, MissingKeyError } from "./registry";

export class CapExceededError extends Error {
  constructor(public spentPence: number, public capPence: number, public estimatePence: number) {
    super(
      `Daily AI cap reached: £${(spentPence / 100).toFixed(2)} spent of £${(capPence / 100).toFixed(2)}; ` +
        `this call could cost up to £${(estimatePence / 100).toFixed(2)}.`,
    );
  }
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
};

export type GenerateResult = {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costPence: number;
  durationMs: number;
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
  const estimate = costPence(cfg.provider, cfg.model, estimateTokens(fullText), cfg.maxOutputTokens);
  const cap = dailyCapPence();
  const spent = await spendTodayPence(input.userId);
  if (spent + estimate > cap) throw new CapExceededError(spent, cap, estimate);

  const model = getLanguageModel(cfg.provider, cfg.model);
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = Date.now();
    try {
      const result = await generateText({
        model,
        instructions: input.instructions,
        prompt: input.prompt,
        maxOutputTokens: cfg.maxOutputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      const cost = costPence(cfg.provider, cfg.model, inputTokens, outputTokens);
      if (inputTokens + outputTokens > 0) {
        await asUser(input.userId, (tx) => tx`
          insert into public.usage_ledger
            (workspace_id, run_id, step_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
          values (${input.workspaceId}, ${input.runId ?? null}, ${input.stepId ?? null}, ${input.agent},
                  ${cfg.provider}, ${cfg.model}, ${inputTokens}, ${outputTokens}, ${cost})`);
      }
      return {
        text: result.text,
        provider: cfg.provider,
        model: cfg.model,
        inputTokens,
        outputTokens,
        costPence: cost,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof MissingKeyError) throw err;
      lastError = err;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new ProviderError(`${cfg.provider} failed after ${ATTEMPTS} attempts: ${message}`);
}
