// Which model each product agent uses. Changing an agent's model is a change
// here (or an AGENT_MODEL_<NAME> environment variable), never in agent code.

export type ProviderId = "anthropic" | "google" | "mock";

export type AgentModelConfig = {
  provider: ProviderId;
  model: string;
  maxOutputTokens: number;
};

export const AGENT_MODELS = {
  tagline: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 600 },
  audience: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 2000 },
  brief: { provider: "anthropic", model: "claude-sonnet-5-5", maxOutputTokens: 3000 },
  persona: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 2500 },
  testPlan: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 2000 },
  market: { provider: "anthropic", model: "claude-sonnet-5-5", maxOutputTokens: 3000 },
  // Sonnet, not Haiku (Sprint 5, Q3): the words are the visible part of every ad, and Sonnet adds
  // about 3p a run. Up to 27 sets (three audiences, four channels) fit in 4,000 tokens.
  copy: { provider: "anthropic", model: "claude-sonnet-5-5", maxOutputTokens: 4000 },
  // S5-1 (Q3): image prompts and the picture check on Haiku.
  // 4,000 (was 1,500): four detailed prompts ran past 1,500 tokens on the first
  // production run and the reply was cut off mid-JSON (27 Oct 2026).
  imagery: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 4000 },
  // C8-2: the same call also answers the face question and each of up to 20 don't rules with
  // a short reason, so 1,000 tokens (was 200); a typical check writes about 300.
  imageCheck: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 1000 },
  // C7-2 (Sprint 7, Q5): Sonnet, not Haiku, as the Copy agent: tone matters in another
  // language, and one set is about 1 to 2p a language. One set's three fields fit in 600 tokens.
  localise: { provider: "anthropic", model: "claude-sonnet-5-5", maxOutputTokens: 600 },
  // C8-4: the pre-test panel on Haiku with vision (about 0.05p an ad). Four personas, four
  // scales each, a sentence and a quote per scale: about 800 tokens, at most about 1,800.
  pretest: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 2000 },
  // C8-3: Check an ad reads an uploaded ad on Haiku with vision (about 0.1p a check). Up to
  // 80 lines of words, each with its box, the logo, the face and up to 20 don't rules.
  readAd: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 4000 },
  // P9-4: the Monitor's two steps on Haiku (about 0.1p a question). A plan is about 100 tokens
  // of JSON; an answer is up to three sentences (the output allows 600 characters).
  monitorPlan: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 600 },
  monitorAnswer: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: 400 },
} satisfies Record<string, AgentModelConfig>;

export type AgentKey = keyof typeof AGENT_MODELS;

type Env = Record<string, string | undefined>;

export type ImageSize = "1K" | "2K";

export type ImageModelConfig = { provider: ProviderId; model: string; size: ImageSize };

/**
 * The image model: Nano Banana 2.1 (S5-1), at 2K from Sprint 7 (C7-1, Q1), so
 * a 9:16 or 1.91:1 crop of the square picture isn't enlarged (at 1K it was
 * about 1.9 times). Pictures made at 1K before still render in every size.
 * IMAGE_MODEL="provider:model" overrides it; MODEL_PROVIDER_OVERRIDE=mock uses
 * the mock image model, which draws palette shapes and spends nothing real.
 */
export const IMAGE_MODEL: ImageModelConfig = { provider: "google", model: "gemini-nano-banana-2.1", size: "2K" };

export function resolveImageModel(env: Env = process.env): ImageModelConfig {
  const base: ImageModelConfig = { ...IMAGE_MODEL };
  if (env.IMAGE_MODEL) {
    const [provider, ...rest] = env.IMAGE_MODEL.split(":");
    if (!isProvider(provider) || rest.length === 0) throw new Error('IMAGE_MODEL must look like "google:model-id"');
    base.provider = provider;
    base.model = rest.join(":");
  }
  if (env.MODEL_PROVIDER_OVERRIDE === "mock") return { ...base, provider: "mock", model: "mock-image" };
  return base;
}

/**
 * Resolves an agent's model, applying overrides in order:
 * AGENT_MODEL_<NAME>="provider:model", then MODEL_PROVIDER_OVERRIDE=mock
 * (local development and tests, so nothing is spent).
 */
export function resolveAgentModel(agent: AgentKey, env: Env = process.env): AgentModelConfig {
  const base: AgentModelConfig = { ...AGENT_MODELS[agent] };
  const specific = env[`AGENT_MODEL_${agent.toUpperCase()}`];
  if (specific) {
    const [provider, ...rest] = specific.split(":");
    if (!isProvider(provider) || rest.length === 0) {
      throw new Error(`AGENT_MODEL_${agent.toUpperCase()} must look like "anthropic:model-id"`);
    }
    base.provider = provider;
    base.model = rest.join(":");
  }
  if (env.MODEL_PROVIDER_OVERRIDE === "mock") {
    return { ...base, provider: "mock", model: "mock-model" };
  }
  return base;
}

function isProvider(p: string | undefined): p is ProviderId {
  return p === "anthropic" || p === "google" || p === "mock";
}
