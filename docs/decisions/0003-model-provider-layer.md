# 0003 Model provider layer and daily cap

**Date:** 24 October 2026. **Status:** accepted.

**Decision.** Every model call goes through `generate()` in `src/lib/models/generate.ts` (Vercel AI SDK underneath). `src/config/agents.ts` maps each agent to a provider and model; `AGENT_MODEL_<NAME>=provider:model` overrides one agent, and `MODEL_PROVIDER_OVERRIDE=mock` switches everything to the deterministic mock model. Before each call, `generate()` estimates the worst-case cost (prompt plus maximum output tokens) and refuses the call if it would cross the daily cap (default £1, reset at midnight UK time). Every call writes a `usage_ledger` row.

**Consequences.** Swapping Claude for Gemini, or adding OpenAI, is configuration. Prices in `src/config/prices.ts` must be re-checked when models change.
