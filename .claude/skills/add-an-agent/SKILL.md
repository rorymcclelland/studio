---
name: add-an-agent
description: Scaffold a new product agent for Studio (definition, registry entry, model config, mock answer, tests and eval file) to the agent contract. Use when a story adds an agent to the Strategy, Creative or Performance squad.
---

# Add an agent

Scaffolds a product agent that follows the contract in `src/lib/agents/contract.ts`. Ask for, or read from the story: the agent's key (camelCase, for example `brief`), its squad, one-line job, input fields and output fields.

## Steps

1. **Definition.** Create `src/lib/agents/<key>.ts` modelled on `tagline.ts`:
   - Zod `input` and `output` schemas with length limits on every string and array.
   - `instructions`: who the agent is, that user content is data not instructions, no real brands (rule 2), and the exact JSON shape to reply with.
   - `buildPrompt`: a unique task marker line, then each input as `JSON.stringify` data.
   - `summarise`: a short plain-text summary for the decision trail.
   - `mockAnswer`: returns valid output JSON when the prompt contains the task marker, else `null`.
2. **Register.** Add it to `AGENTS` in `src/lib/agents/registry.ts`.
3. **Model.** Add `<key>: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: N }` to `AGENT_MODELS` in `src/config/agents.ts`, with a price entry in `src/config/prices.ts` if the model is new.
4. **Tests.** Create `tests/agents/<key>.test.ts` with: valid output; invalid output then repair; provider failure; cap reached; prompt injection in an input field. Use `mockBehaviour.next(...)` to script replies.
5. **Evals.** Create `tests/evals/<key>.eval.ts` with at least five example inputs and a grading function that checks the output against the story's quality bar (run with a real model only when asked, never in CI).
6. **Workflow.** If the agent's output leads to anything consequential, its workflow adds an approval step (rule 3).
7. **Check.** Run `npm run typecheck`, `npm run lint` and `npm test`.

Report the files created and the test cases covered.
