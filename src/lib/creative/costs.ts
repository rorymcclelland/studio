import { resolveAgentModel, resolveImageModel } from "@/config/agents";
import { IMAGE_COUNT } from "@/lib/agents/imagery";
import { costPence, imageCostPence } from "@/lib/models/cost";

// S5-4 (rule 3): what a button will cost in AI pence, shown before the click
// ("about 3p"). Worked out from prices.ts and the configured models, with
// the token counts below as estimates of a typical call (they are not
// measured per brief). The cap still decides at call time.
//
// Make creative also shows its worst case (review finding 9): every picture
// redrawn once, and every model call repaired once, each call writing its
// full output allowance (maxOutputTokens, as generate() reserves). Inputs stay
// the typical counts, so a very long brief could cost a little more.

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

/** What a repair prompt adds to the first prompt besides the previous reply: the issues and the instructions. */
export const REPAIR_OVERHEAD_TOKENS = 300;

/** Typical cost, the worst case (redraws, repairs, full output), and the label for the button. */
export type Estimate = { pence: number; worstPence: number; label: string };

type Env = Record<string, string | undefined>;

/** "about 3p", "about 14p", "under 1p": whole pence, rounded up. */
export function aboutPence(pence: number): string {
  if (pence < 1) return "under 1p";
  return `about ${Math.ceil(pence - 1e-9)}p`;
}

/** "about 14p, at most 31p": the typical and the worst case, both rounded up. */
export function aboutAndAtMost(pence: number, worstPence: number): string {
  return `${aboutPence(pence)}, at most ${Math.max(1, Math.ceil(worstPence - 1e-9))}p`;
}

const round = (p: number) => Math.round(p * 10_000) / 10_000;
/** A button that shows the typical cost only; the worst case is kept for any check against the cap. */
const est = (pence: number, worstPence: number): Estimate => ({ pence: round(pence), worstPence: round(worstPence), label: aboutPence(pence) });

type ModelAgent = "imagery" | "imageCheck" | "copy";

function modelCall(agent: ModelAgent, tokens: { input: number; output: number }, env: Env): number {
  const m = resolveAgentModel(agent, env);
  return costPence(m.provider, m.model, tokens.input, tokens.output);
}

/** A model call at its worst: its full output allowance, then one repair that also reads the previous reply. */
function worstModelCall(agent: ModelAgent, input: number, env: Env): number {
  const m = resolveAgentModel(agent, env);
  const first = costPence(m.provider, m.model, input, m.maxOutputTokens);
  const repair = costPence(m.provider, m.model, input + m.maxOutputTokens + REPAIR_OVERHEAD_TOKENS, m.maxOutputTokens);
  return first + repair;
}

function oneImage(env: Env): number {
  const m = resolveImageModel(env);
  return imageCostPence(m.provider, m.model, m.size, 1);
}

/** New picture: one image call (never redrawn) and its check for text. */
export function newPictureEstimate(env: Env = process.env): Estimate {
  const pence = oneImage(env) + modelCall("imageCheck", TYPICAL_TOKENS.imageCheck, env);
  return est(pence, oneImage(env) + worstModelCall("imageCheck", TYPICAL_TOKENS.imageCheck.input, env));
}

/** New words: one Copy call for one set. */
export function newWordsEstimate(env: Env = process.env): Estimate {
  return est(modelCall("copy", TYPICAL_TOKENS.copyOne, env), worstModelCall("copy", TYPICAL_TOKENS.copyOne.input, env));
}

/**
 * Make creative: the image prompts, four pictures with their checks, and the
 * copy (unless the version already has copy). The worst case adds a redraw and
 * a second check for every picture (up to four more images) and a repair of
 * every model call; use it for any check against the cap before starting.
 */
export function makeCreativeEstimate(opts: { writesCopy: boolean } = { writesCopy: true }, env: Env = process.env): Estimate {
  const pictures = IMAGE_COUNT * (oneImage(env) + modelCall("imageCheck", TYPICAL_TOKENS.imageCheck, env));
  const prompts = modelCall("imagery", TYPICAL_TOKENS.imagery, env);
  const copy = opts.writesCopy ? modelCall("copy", TYPICAL_TOKENS.copyAll, env) : 0;
  const pence = pictures + prompts + copy;

  const worstPictures = 2 * IMAGE_COUNT * (oneImage(env) + worstModelCall("imageCheck", TYPICAL_TOKENS.imageCheck.input, env));
  const worstPrompts = worstModelCall("imagery", TYPICAL_TOKENS.imagery.input, env);
  const worstCopy = opts.writesCopy ? worstModelCall("copy", TYPICAL_TOKENS.copyAll.input, env) : 0;
  const worstPence = worstPictures + worstPrompts + worstCopy;
  return { pence: round(pence), worstPence: round(worstPence), label: aboutAndAtMost(pence, worstPence) };
}
