import type { z } from "zod";
import type { AgentKey } from "@/config/agents";

/**
 * The contract every product agent follows. An agent is data plus pure
 * functions: typed input and output, the instructions it runs under, how to
 * build its prompt, and how to summarise its output for the decision trail.
 * The framework does the rest: cost cap, model call, validation, one repair
 * attempt, and recording the step.
 */
export type AgentDefinition<I, O> = {
  key: AgentKey;
  name: string;
  version: number;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  instructions: string;
  buildPrompt: (input: I) => string;
  summarise: (output: O) => string;
  /** A short title for run lists, from the input alone. The caller may pass a better one (with the brand's name) to createRun. */
  label: (input: I) => string;
  /** Deterministic answer for the offline mock model, so demos run without keys. */
  mockAnswer?: (prompt: string) => string | null;
};

export function defineAgent<I, O>(def: AgentDefinition<I, O>): AgentDefinition<I, O> {
  return def;
}
