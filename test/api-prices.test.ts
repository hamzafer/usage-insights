import { expect, test } from "bun:test";
import { priceUsage } from "../src/api-prices.ts";

test("prices a plain reply from the table, per million tokens", () => {
  const spend = priceUsage("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 });
  expect(spend).toEqual({ input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 100_000, costUsd: 3 });
});

test("cache reads cost the cache-read price and cache writes 1.25 x input", () => {
  const spend = priceUsage("claude-opus-5-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  });
  expect(spend.cacheRead).toBe(1_000_000);
  expect(spend.cacheWrite).toBe(1_000_000);
  expect(spend.costUsd).toBeCloseTo(0.2 + 5, 10);
});

test("1-hour cache writes cost 2 x input; the rest of the writes count as 5-minute", () => {
  const spend = priceUsage("claude-haiku-5-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 3_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
  });
  // 1M at 0.125 + 1M at 0.2 + 1M unexplained at 0.125
  expect(spend.cacheWrite).toBe(3_000_000);
  expect(spend.costUsd).toBeCloseTo(0.125 + 0.2 + 0.125, 10);
});

test("missing token fields count as zero", () => {
  expect(priceUsage("claude-haiku-5-5", {})).toEqual({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, costUsd: 0 });
});

test("an unknown model keeps its tokens and has no cost", () => {
  const spend = priceUsage("claude-future-9", { input_tokens: 5, output_tokens: 7 });
  expect(spend).toEqual({ input: 5, cacheWrite: 0, cacheRead: 0, output: 7, costUsd: null });
});

test("a dated model id is priced as its base model", () => {
  const dated = priceUsage("claude-sonnet-5-5-20261001", { input_tokens: 1_000_000, output_tokens: 100_000 });
  expect(dated).toEqual(priceUsage("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }));
  expect(dated.costUsd).toBe(3);
  expect(priceUsage("claude-mystery-9-20261001", { input_tokens: 1 }).costUsd).toBeNull();
});
