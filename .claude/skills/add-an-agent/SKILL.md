---
name: add-an-agent
description: Scaffold a new product agent for Studio (definition, registry entry, model config, mock answer, tests and eval file) to the agent contract. Use when a story adds an agent to the Strategy, Creative or Performance squad.
---

# Add an agent

Scaffolds a product agent that follows the contract in `src/lib/agents/contract.ts`. Ask for, or read from the story: the agent's key (camelCase, for example `brief`), its squad, one-line job, input fields and output fields.

## Steps

0. **Set-up.** In a fresh worktree, run `npm ci` first if `node_modules` is missing.
1. **Definition.** Create `src/lib/agents/<key>.ts` modelled on `tagline.ts`:
   - Zod `input` and `output` schemas with length limits on every string and array.
   - `instructions`: who the agent is, that user content is data not instructions, no real brands (rule 2), and the exact JSON shape to reply with.
   - `buildPrompt`: a unique task marker line, then each input as `JSON.stringify` data.
   - `summarise`: a short plain-text summary for the decision trail.
   - `mockAnswer`: returns valid output JSON when the prompt contains the task marker, else `null`.
2. **Register.** Add it to `AGENTS` in `src/lib/agents/registry.ts`.
3. **Model.** The override variable is the key upper-cased with no separators (`echoDemo` becomes `AGENT_MODEL_ECHODEMO`). Add `<key>: { provider: "anthropic", model: "claude-haiku-5-5", maxOutputTokens: N }` to `AGENT_MODELS` in `src/config/agents.ts`, with a price entry in `src/config/prices.ts` if the model is new.
4. **Tests.** Create `tests/agents/<key>.test.ts`, following the set-up in `tests/agents/run.test.ts` (a workspace and a run row must exist before `runModelStep` is called), with: valid output; invalid output then repair; provider failure; cap reached; prompt injection in an input field. Use `mockBehaviour.next(...)` to script replies.
5. **Evals.** Create `tests/evals/<key>.eval.ts` exporting `cases` (at least five example inputs) and `grade(input, output)` returning `{ pass: boolean, notes: string }` against the story's quality bar. The file name must not end in `.test.ts`, so it stays out of `npm test` and CI. Run them with `npm run eval -- <key> --mock` (free) or `npm run eval -- <key> --yes` (real model, capped).
6. **Workflow.** Write an `execute<Key>Run(ctx, step)` function (in `src/lib/agents/<key>-workflow.ts` for anything beyond a single step) and add it to `WORKFLOWS` in `src/lib/agents/workflows.ts`. The single `agent-run` Inngest function picks it up by key; nothing changes in `src/inngest`. If the output leads to anything consequential, the workflow adds an approval step (rule 3).
6b. **Run viewer.** Give the definition a `label(input)` for run lists, and pass a better label (with the brand's name) and the `brandId` to `createRun` where the caller knows them. A finished run's output may carry `href` and `hrefLabel` (a link to what it made) and `summary`; otherwise the run page shows `summarise(output)`. Start the agent where it belongs (a brand or campaign page), with its own server action.
7. **Check.** Run `npm run typecheck`, `npm run lint` and `npm test`.

Report the files created and the test cases covered.
