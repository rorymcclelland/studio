import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ImageModel, LanguageModel } from "ai";
import { AGENT_MODELS, resolveAgentModel, resolveImageModel, type AgentKey, type ProviderId } from "@/config/agents";
import { createMockImageModel, createMockModel } from "./mock";

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

/** Builds the image model client (S5-1). Only Google draws pictures; the mock draws palette shapes. */
export function getImageModel(provider: ProviderId, model: string): ImageModel {
  if (provider === "mock") return createMockImageModel();
  if (provider !== "google") throw new Error(`The "${provider}" provider has no image model configured.`);
  const envVar = KEY_VARS.google;
  const apiKey = process.env[envVar];
  if (!apiKey) throw new MissingKeyError(provider, envVar);
  return createGoogleGenerativeAI({ apiKey }).image(model);
}

/**
 * Anthropic's web search tool (S4-3), limited to `maxUses` searches and the UK.
 * The mock provider gets the same tool definition; the mock model answers it
 * with fixed pages.
 */
export function getWebSearchTool(provider: ProviderId, maxUses: number) {
  const apiKey = provider === "anthropic" ? process.env[KEY_VARS.anthropic] : "mock-no-key";
  if (provider === "google") throw new Error("Web search is only configured for the Anthropic provider.");
  if (!apiKey) throw new MissingKeyError(provider, KEY_VARS.anthropic);
  return createAnthropic({ apiKey }).tools.webSearch_20260318({
    maxUses,
    userLocation: { type: "approximate", country: "GB" },
  });
}

/** Every configured provider that has no key, for the startup check (S1-4 #6). */
export function missingProviderKeys(
  env: Record<string, string | undefined> = process.env,
): { provider: string; envVar: string }[] {
  const providers = new Set([
    ...(Object.keys(AGENT_MODELS) as AgentKey[]).map((a) => resolveAgentModel(a, env).provider),
    resolveImageModel(env).provider,
  ]);
  const missing: { provider: string; envVar: string }[] = [];
  for (const p of providers) {
    if (p === "mock") continue;
    const envVar = KEY_VARS[p];
    if (!env[envVar]) missing.push({ provider: p, envVar });
  }
  return missing;
}
