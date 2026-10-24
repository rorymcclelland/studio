import { DEFAULT_USD_TO_GBP, PRICES } from "@/config/prices";

export function usdToGbp(): number {
  const v = Number(process.env.USD_TO_GBP);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_USD_TO_GBP;
}

/** Cost of one call in pence. Unknown models are refused, not guessed. */
export function costPence(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICES[`${provider}:${model}`];
  if (!price) throw new Error(`No price configured for ${provider}:${model}`);
  const long = price.longPrompt && inputTokens > price.longPrompt.overInputTokens;
  const inRate = long ? price.longPrompt!.inputPerMTok : price.inputPerMTok;
  const outRate = long ? price.longPrompt!.outputPerMTok : price.outputPerMTok;
  const usd = (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
  return usd * usdToGbp() * 100;
}

/**
 * A deliberately pessimistic token estimate (about 3 characters a token, where
 * English usually runs nearer 4), so the cap check errs towards refusing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}
