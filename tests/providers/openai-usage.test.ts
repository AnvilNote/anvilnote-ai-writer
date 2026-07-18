import assert from "node:assert/strict";
import test from "node:test";
import { AIUsageSchema } from "../../src/contracts/index";
import {
  calculateActualUsageCost,
  normalizeOpenAIUsage,
} from "../../src/server/index";

test("Responses usage normalizes cached and reasoning tokens without double counting", () => {
  assert.deepEqual(
    normalizeOpenAIUsage(
      {
        input_tokens: 1_000_000,
        input_tokens_details: {
          cached_tokens: 400_000,
          cache_write_tokens: 0,
        },
        output_tokens: 100_000,
        output_tokens_details: { reasoning_tokens: 20_000 },
        total_tokens: 1_100_000,
      },
      "gpt-5.6-terra",
    ),
    {
      provider: "openai",
      model: "gpt-5.6-terra",
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 100_000,
      reasoningTokens: 20_000,
      totalTokens: 1_100_000,
      estimatedActualCostUsd: null,
      pricingVersion: "2026-07-18",
    },
  );
});

test("cached input uses its own rate and is not billed again as ordinary input", () => {
  assert.deepEqual(
    calculateActualUsageCost({
      provider: "openai",
      model: "gpt-5.6-terra",
      inputTokens: 200_000,
      cachedInputTokens: 100_000,
      outputTokens: 10_000,
      totalTokens: 210_000,
      estimatedActualCostUsd: null,
      pricingVersion: null,
    }),
    { estimatedActualCostUsd: 0.425, pricingVersion: "2026-07-18" },
  );
});

test("cache writes fail closed until their separate billing tier is represented", () => {
  const usage = normalizeOpenAIUsage(
    {
      input_tokens: 100,
      input_tokens_details: {
        cached_tokens: 20,
        cache_write_tokens: 10,
      },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 150,
    },
    "gpt-5.6-terra",
  );
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.cachedInputTokens, 20);
  assert.equal(usage.estimatedActualCostUsd, null);
  assert.equal(usage.pricingVersion, "2026-07-18");
});

test("standard pricing fails closed above the long-context threshold", () => {
  assert.deepEqual(
    calculateActualUsageCost({
      provider: "openai",
      model: "gpt-5.6-sol",
      inputTokens: 272_001,
      outputTokens: 1,
      totalTokens: 272_002,
      estimatedActualCostUsd: null,
      pricingVersion: null,
    }),
    { estimatedActualCostUsd: null, pricingVersion: "2026-07-18" },
  );
});

test("missing or inconsistent provider usage never fabricates cost", () => {
  assert.deepEqual(normalizeOpenAIUsage(null, "gpt-5.6-luna"), {
    provider: "openai",
    model: "gpt-5.6-luna",
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedActualCostUsd: null,
    pricingVersion: null,
  });

  const invalid = normalizeOpenAIUsage(
    {
      input_tokens: 10,
      input_tokens_details: {
        cached_tokens: 11,
        cache_write_tokens: 0,
      },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 1 },
      total_tokens: 2,
    },
    "gpt-5.6-luna",
  );
  assert.equal(invalid.estimatedActualCostUsd, null);
  assert.equal(invalid.cachedInputTokens, undefined);
  assert.equal(invalid.pricingVersion, null);
});

test("public usage validation rejects internally inconsistent counts", () => {
  const base = {
    provider: "openai",
    model: "gpt-5.6-terra",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimatedActualCostUsd: null,
    pricingVersion: null,
  };
  assert.equal(
    AIUsageSchema.safeParse({ ...base, cachedInputTokens: 11 }).success,
    false,
  );
  assert.equal(
    AIUsageSchema.safeParse({ ...base, reasoningTokens: 6 }).success,
    false,
  );
  assert.equal(
    AIUsageSchema.safeParse({ ...base, totalTokens: 2 }).success,
    false,
  );
});
