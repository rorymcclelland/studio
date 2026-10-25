import type { Member } from "@/lib/agents/runs";

// The shape of an agent's eval file, tests/evals/<key>.eval.ts (F-5).

export type EvalEnv = {
  member: Member;
  /** Demo brand ids by short name (fernhollow, quillmoor), loaded with the shipped seed. */
  brands: Record<string, string>;
};

export type EvalCase<I> = { name: string; input: I };

export type Grade = { pass: boolean; notes: string };

export type EvalModule<I = unknown, O = unknown, C = unknown> = {
  agent: string;
  cases: EvalCase<I>[];
  /** Runs one case through the agent's real workflow step and returns what it produced. */
  execute: (env: EvalEnv, input: I) => Promise<{ runId: string; output: O; context: C }>;
  /** Deterministic checks against the story's quality bar (Sprint 3, Q6). */
  grade: (input: I, output: O, context: C) => Grade;
};
