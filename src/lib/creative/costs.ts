import { resolveAgentModel, resolveImageModel } from "@/config/agents";
import { IMAGE_COUNT } from "@/lib/agents/imagery";
import { costPence, imageCostPence } from "@/lib/models/cost";

// S5-4 (rule 3): what a button will cost in AI pence, shown before the click
// ("about 3p"). Worked out from prices.ts and the configured models, with
// the token counts below as estimates of a typical call (they are not
// measured per brief). The cap still decides at call time.

/** Typical tokens per call, rounded up from Sprint 5's mock and real runs' prompts. */
export const TYPICAL_TOKENS = {
  /** The Imagery agent's prompt-writing call. */
  imagery: { input: 2_000, output: 1_200 },
  /** One picture check: the question plus one picture (1,600 tokens estimated, as generate() does). */
  imageCheck: { input: 1_900, output: 80 },
  /** The Copy agent writing every set for a brief (two audiences, two channels). */
  copyAll: { input: 4_000, output: 3_000 },
  /** New words for one set. */
  copyOne: { input: 4_000, output: 300 },
} as const;

export type Estimate = { pence: number; label: string };

type Env = Record<string, string | undefined>;

/** "about 3p", "about 14p", "under 1p": whole pence, rounded up. */
export function aboutPence(pence: number): string {
  if (pence < 1) return "under 1p";
  return `about ${Math.ceil(pence - 1e-9)}p`;
}

const est = (pence: number): Estimate => ({ pence: Math.round(pence * 10_000) / 10_000, label: aboutPence(pence) });

function modelCall(agent: "imagery" | "imageCheck" | "copy", tokens: { input: number; output: number }, env: Env): number {
  const m = resolveAgentModel(agent, env);
  return costPence(m.provider, m.model, tokens.input, tokens.output);
}

function oneImage(env: Env): number {
  const m = resolveImageModel(env);
  return imageCostPence(m.provider, m.model, m.size, 1);
}

/** New picture: one image call and its check for text. */
export function newPictureEstimate(env: Env = process.env): Estimate {
  return est(oneImage(env) + modelCall("imageCheck", TYPICAL_TOKENS.imageCheck, env));
}

/** New words: one Copy call for one set. */
export function newWordsEstimate(env: Env = process.env): Estimate {
  return est(modelCall("copy", TYPICAL_TOKENS.copyOne, env));
}

/** Make creative: the image prompts, four pictures with their checks, and the copy (unless the version already has copy). */
export function makeCreativeEstimate(opts: { writesCopy: boolean } = { writesCopy: true }, env: Env = process.env): Estimate {
  const pictures = IMAGE_COUNT * (oneImage(env) + modelCall("imageCheck", TYPICAL_TOKENS.imageCheck, env));
  const prompts = modelCall("imagery", TYPICAL_TOKENS.imagery, env);
  const copy = opts.writesCopy ? modelCall("copy", TYPICAL_TOKENS.copyAll, env) : 0;
  return est(pictures + prompts + copy);
}
