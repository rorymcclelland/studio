import { resolveAgentModel, resolveImageModel } from "@/config/agents";
import { IMAGE_COUNT } from "@/lib/agents/imagery";
import { costPence, imageCostPence } from "@/lib/models/cost";

// S5-4 (rule 3): what a button will cost in AI pence, shown before the click
// ("about 4p"). Worked out from prices.ts and the configured models, with
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
  /**
   * One picture check: the three questions, the kit's don't rules and one picture (1,600 tokens
   * estimated, as generate() does); the reply answers text, faces and each rule (C8-2).
   */
  imageCheck: { input: 2_100, output: 300 },
  /** The Copy agent writing every set for a brief (two audiences, two channels). */
  copyAll: { input: 4_000, output: 3_000 },
  /** New words for one set. */
  copyOne: { input: 4_000, output: 300 },
  /** C7-2: one set's words into one language (the prompt is the kit's lists and the English words). */
  localiseOne: { input: 1_800, output: 250 },
  /**
   * C8-4: one ad pre-tested: the ad's square PNG (1,600 tokens estimated, as generate() does), the
   * instructions, the brand's voice, the ad's words and up to four personas; four personas' scores
   * on four scales, each with a sentence and a quote.
   */
  pretestOne: { input: 2_800, output: 800 },
  /**
   * C8-3: one uploaded ad read: the ad (1,600 tokens estimated, as generate() does), the instructions
   * and the kit's don't rules; about twenty lines of words with their boxes, the logo, the face and
   * an answer per don't rule.
   */
  readAdOne: { input: 3_000, output: 2_000 },
  /**
   * P9-4: Ask about this campaign's plan step: the instructions (the plan's shape and the measure
   * keys), the question and the campaign's ads by number and headline; a plan of about 100 tokens,
   * rounded up for a repair-free reply with a long reason.
   */
  monitorPlan: { input: 3_000, output: 300 },
  /**
   * P9-4: the answer step: the instructions, the question and the query's result, which can be up
   * to 30 rows (a day-by-day table) with each measure's value and how it is shown; up to three
   * sentences back.
   */
  monitorAnswer: { input: 7_000, output: 300 },
} as const;

/** What a repair prompt adds to the first prompt besides the previous reply: the issues and the instructions. */
export const REPAIR_OVERHEAD_TOKENS = 300;

/** Typical cost, the worst case (redraws, repairs, full output), and the label for the button. */
export type Estimate = { pence: number; worstPence: number; label: string };

type Env = Record<string, string | undefined>;

/** "about 4p", "about 20p", "under 1p": whole pence, rounded up. */
export function aboutPence(pence: number): string {
  if (pence < 1) return "under 1p";
  return `about ${Math.ceil(pence - 1e-9)}p`;
}

/** "about 20p, at most 41p": the typical and the worst case, both rounded up (2K pictures from C7-1; 14p and 31p at 1K). */
export function aboutAndAtMost(pence: number, worstPence: number): string {
  return `${aboutPence(pence)}, at most ${Math.max(1, Math.ceil(worstPence - 1e-9))}p`;
}

const round = (p: number) => Math.round(p * 10_000) / 10_000;
/** A button that shows the typical cost only; the worst case is kept for any check against the cap. */
const est = (pence: number, worstPence: number): Estimate => ({ pence: round(pence), worstPence: round(worstPence), label: aboutPence(pence) });

type ModelAgent = "imagery" | "imageCheck" | "copy" | "localise" | "pretest" | "readAd" | "monitorPlan" | "monitorAnswer";

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

/**
 * C7-2: Translate, for a number of sets and languages: one Localise call per
 * set and language. The worst case repairs every one once (a field too long
 * for a size, or a rule broken), each call writing its full output allowance.
 */
export function translateEstimate(translations: number, env: Env = process.env): Estimate {
  const n = Math.max(0, translations);
  const pence = n * modelCall("localise", TYPICAL_TOKENS.localiseOne, env);
  const worstPence = n * worstModelCall("localise", TYPICAL_TOKENS.localiseOne.input, env);
  return { pence: round(pence), worstPence: round(worstPence), label: n === 0 ? "nothing to translate" : aboutAndAtMost(pence, worstPence) };
}

/** "0.05p", "0.2p", "2.1p", "12p": small costs to one or two places, so a cost under a penny isn't shown as nothing. */
export function smallPence(pence: number): string {
  if (pence >= 10) return `${Math.ceil(pence - 1e-9)}p`;
  if (pence >= 0.1) return `${Math.round(pence * 10) / 10}p`;
  if (pence >= 0.01) return `${Math.round(pence * 100) / 100}p`;
  return "under 0.01p";
}

/**
 * C8-4: Pre-test picked ads: one Haiku vision call per ad still to score
 * (about 0.05p an ad). The worst case repairs every call once (a quote not in
 * the ad, a figure in a reason), each writing its full output allowance. The
 * label gives the total and the price of one ad, both before the click.
 */
export function pretestEstimate(ads: number, env: Env = process.env): Estimate & { perAdPence: number } {
  const n = Math.max(0, ads);
  const perAd = modelCall("pretest", TYPICAL_TOKENS.pretestOne, env);
  const pence = n * perAd;
  const worstPence = n * worstModelCall("pretest", TYPICAL_TOKENS.pretestOne.input, env);
  const label = n === 0 ? "nothing to pre-test" : n === 1 ? `about ${smallPence(perAd)}` : `about ${smallPence(perAd)} an ad, ${smallPence(pence)} in all`;
  return { pence: round(pence), worstPence: round(worstPence), perAdPence: round(perAd), label };
}

/**
 * C8-3: Check an ad: one Haiku vision call that reads the uploaded ad (about
 * 0.1p). The checks after it are code and cost nothing. The worst case
 * repairs the reply once (a don't rule left unanswered, a box off the
 * picture), each call writing its full output allowance.
 */
export function readAdEstimate(env: Env = process.env): Estimate {
  const pence = modelCall("readAd", TYPICAL_TOKENS.readAdOne, env);
  const worstPence = worstModelCall("readAd", TYPICAL_TOKENS.readAdOne.input, env);
  return { pence: round(pence), worstPence: round(worstPence), label: `about ${smallPence(pence)}` };
}

/**
 * C8-2: Check pictures: one Haiku vision call per picture still without a
 * result (about 0.03p a picture). The worst case repairs every call once, each
 * writing its full output allowance. The label gives the price of one picture
 * and the total, both before the click.
 */
export function pictureCheckEstimate(pictures: number, env: Env = process.env): Estimate & { perPicturePence: number } {
  const n = Math.max(0, pictures);
  const each = modelCall("imageCheck", TYPICAL_TOKENS.imageCheck, env);
  const pence = n * each;
  const worstPence = n * worstModelCall("imageCheck", TYPICAL_TOKENS.imageCheck.input, env);
  const label = n === 0 ? "nothing to check" : n === 1 ? `about ${smallPence(each)}` : `about ${smallPence(each)} a picture, ${smallPence(pence)} in all`;
  return { pence: round(pence), worstPence: round(worstPence), perPicturePence: round(each), label };
}

/**
 * P9-4: Ask about this campaign: one Haiku call to plan the query and one to
 * word the answer (about 0.1p a question); the query itself is code. The
 * worst case repairs each call once (a plan that names an ad the campaign
 * hasn't, an answer with a figure not in the result), each writing its full
 * output allowance.
 */
export function askEstimate(env: Env = process.env): Estimate {
  const pence = modelCall("monitorPlan", TYPICAL_TOKENS.monitorPlan, env) + modelCall("monitorAnswer", TYPICAL_TOKENS.monitorAnswer, env);
  const worstPence = worstModelCall("monitorPlan", TYPICAL_TOKENS.monitorPlan.input, env) + worstModelCall("monitorAnswer", TYPICAL_TOKENS.monitorAnswer.input, env);
  return { pence: round(pence), worstPence: round(worstPence), label: `about ${smallPence(pence)}` };
}
