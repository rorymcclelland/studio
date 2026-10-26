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
} satisfies Record<string, AgentModelConfig>;

export type AgentKey = keyof typeof AGENT_MODELS;

type Env = Record<string, string | undefined>;

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
