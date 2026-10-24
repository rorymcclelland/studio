import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { AGENT_MODELS, resolveAgentModel, type AgentKey, type ProviderId } from "@/config/agents";
import { createMockModel } from "./mock";

const KEY_VARS: Record<Exclude<ProviderId, "mock">, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

export class MissingKeyError extends Error {
  constructor(public provider: string, public envVar: string) {
    super(`Missing ${envVar}: the "${provider}" provider is configured but has no API key.`);
  }
}

/** Builds the model client. Keys are read here and nowhere else. */
export function getLanguageModel(provider: ProviderId, model: string): LanguageModel {
  if (provider === "mock") return createMockModel();
  const envVar = KEY_VARS[provider];
  const apiKey = process.env[envVar];
  if (!apiKey) throw new MissingKeyError(provider, envVar);
  if (provider === "anthropic") return createAnthropic({ apiKey })(model);
  return createGoogleGenerativeAI({ apiKey })(model);
}

/** Every configured provider that has no key, for the startup check (S1-4 #6). */
export function missingProviderKeys(
  env: Record<string, string | undefined> = process.env,
): { provider: string; envVar: string }[] {
  const providers = new Set(
    (Object.keys(AGENT_MODELS) as AgentKey[]).map((a) => resolveAgentModel(a, env).provider),
  );
  const missing: { provider: string; envVar: string }[] = [];
  for (const p of providers) {
    if (p === "mock") continue;
    const envVar = KEY_VARS[p];
    if (!env[envVar]) missing.push({ provider: p, envVar });
  }
  return missing;
}
