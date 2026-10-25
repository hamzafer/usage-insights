/**
 * What the Messages API charges, to price the `usage` of a reply (spec: API Spend, Prices). USD per
 * million tokens, from the claude-api skill (cached 2026-10-06). They go stale when Anthropic
 * changes them (ADR 0004); an unknown model has no cost rather than a guessed one.
 */

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Cache writes cost a multiple of the input price: 5 minutes 1.25, 1 hour 2. */
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

/** The `usage` object of a Messages API reply; every field may be missing. */
export interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

/** Token counts as stored (`input` excludes cache reads and writes) and their cost; null: unknown model. */
export interface PricedUsage {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  costUsd: number | null;
}

export function priceUsage(model: string, usage: MessageUsage): PricedUsage {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const fiveMinutes = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  // The total wins; writes it does not explain by the breakdown count as 5-minute ones.
  const cacheWrite = usage.cache_creation_input_tokens ?? fiveMinutes + oneHour;
  const price = PRICES[model];
  if (!price) return { input, cacheWrite, cacheRead, output, costUsd: null };
  const shortWrites = Math.max(0, cacheWrite - oneHour);
  const costUsd =
    (input * price.input +
      output * price.output +
      cacheRead * price.cacheRead +
      shortWrites * price.input * CACHE_WRITE_5M +
      oneHour * price.input * CACHE_WRITE_1H) /
    1_000_000;
  return { input, cacheWrite, cacheRead, output, costUsd };
}
