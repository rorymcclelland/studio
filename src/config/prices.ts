// Model prices in US dollars per million tokens, as published by each provider.
// Checked 24 October 2026: Anthropic (Haiku 5.5, Sonnet 5.5) and Google AI
// for Developers (Gemini 3.1 Flash-Lite, Gemini 3.8 Flash, standard tier).
// Re-check before relying on the cost meter for anything but the cap.
// Gemini 3.8 Flash's price rises on 1 January 2027 ($1.50 in, $7.50 out).

export type Price = {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Some models charge more for every token once a prompt passes a size. */
  longPrompt?: { overInputTokens: number; inputPerMTok: number; outputPerMTok: number };
};

export const PRICES_CHECKED_ON = "2026-10-24";

export const PRICES: Record<string, Price> = {
  "anthropic:claude-haiku-5-5": {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    longPrompt: { overInputTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5 },
  },
  "anthropic:claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "google:gemini-3.1-flash-lite": { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  "google:gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  // Test and offline model: priced so tests can check the arithmetic.
  "mock:mock-model": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Approximate rate; set USD_TO_GBP to update it without a release. */
export const DEFAULT_USD_TO_GBP = 0.79;

/**
 * Server-side tool prices in US dollars per use. Anthropic launched web search
 * at $10 per 1,000 searches (May 2025); re-check before relying on the meter.
 */
export const SEARCH_PRICES: Record<string, { usdPerSearch: number }> = {
  anthropic: { usdPerSearch: 0.01 },
  mock: { usdPerSearch: 0.01 },
};

/**
 * Image prices in US dollars per image, by size. Checked 26 October 2026 on
 * the Google AI for Developers pricing page (standard tier, no free tier):
 * Nano Banana 2.1 is $0.0336 per 1K image and $0.0504 per 2K. The prompt's few
 * hundred input tokens are not priced here, as no input price was checked for
 * this model; they are recorded in the ledger.
 */
export const IMAGE_PRICES: Record<string, Partial<Record<"1K" | "2K", number>>> = {
  "google:gemini-nano-banana-2.1": { "1K": 0.0336, "2K": 0.0504 },
  // Test and offline model: priced like the real one, so cap tests mean something.
  "mock:mock-image": { "1K": 0.0336, "2K": 0.0504 },
};

