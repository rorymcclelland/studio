import type { z } from "zod";
import type { AgentKey } from "@/config/agents";
import type { ImageInput, WebSource } from "@/lib/models/generate";
import type { PageReader } from "@/lib/web/page-text";

/** What a check gets besides the input and output: the pages a search returned, and a reader for them. */
export type CheckExtra = { sources: WebSource[]; readPage: PageReader };

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
  /** What a person may start a run with, when the workflow adds more before the model step (e.g. a brand id, then computed facts). Defaults to `input`. */
  start?: z.ZodType<unknown>;
  output: z.ZodType<O>;
  instructions: string;
  buildPrompt: (input: I) => string;
  summarise: (output: O) => string;
  /**
   * Checks in code that the schema cannot express (citations exist, numbers
   * come from the evidence). Returns problems; any problem gets one repair
   * attempt, then the step fails with them listed.
   */
  check?: (input: I, output: O, extra: CheckExtra) => string[] | Promise<string[]>;
  /**
   * After the repair attempt still fails its checks: keep the parts that pass
   * (e.g. the market notes that check out) and say what was left out, or
   * return null to fail the step.
   */
  salvage?: (input: I, output: O, extra: CheckExtra) => Promise<{ output: O; leftOut: string[] } | null>;
  /** S4-3: the agent may search the web on its first attempt, at most this many times. */
  webSearch?: { maxUses: number };
  /** S5-1: pictures the model looks at with the prompt, on every attempt (a vision check). They are not stored in the trail; the step's input holds the prompt. */
  images?: (input: I) => ImageInput[];
  /** A short title for run lists, from the input alone. The caller may pass a better one (with the brand's name) to createRun. */
  label: (input: I) => string;
  /** Deterministic answer for the offline mock model, so demos run without keys. */
  mockAnswer?: (prompt: string) => string | null;
};

export function defineAgent<I, O>(def: AgentDefinition<I, O>): AgentDefinition<I, O> {
  return def;
}
