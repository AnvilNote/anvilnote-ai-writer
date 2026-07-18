import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateActualUsageCost,
  createTokenEstimate,
  estimateCost,
  estimateTextTokens,
  formatEstimatedCost,
  getModelPricing,
} from "../../src/pricing/index";

test("pricing registry contains the versioned Sol, Terra, and Luna rates", () => {
  assert.deepEqual(getModelPricing("openai", "gpt-5.6-sol"), {
    inputPerMillionTokens: 5,
    outputPerMillionTokens: 30,
  });
  assert.deepEqual(getModelPricing("openai", "gpt-5.6-terra"), {
    inputPerMillionTokens: 2.5,
    outputPerMillionTokens: 15,
  });
  assert.deepEqual(getModelPricing("openai", "gpt-5.6-luna"), {
    inputPerMillionTokens: 1,
    outputPerMillionTokens: 6,
  });
});

test("input and output estimates are calculated separately", () => {
  assert.deepEqual(
    estimateCost("openai", "gpt-5.6-terra", {
      inputTokens: 1_000_000,
      estimatedOutputTokensMin: 100_000,
      estimatedOutputTokensMax: 200_000,
      confidence: "low",
    }),
    {
      currency: "USD",
      minimum: 4,
      maximum: 5.5,
      pricingVersion: "2026-07-18",
      approximate: true,
    },
  );
});

test("actual usage cost uses provider counts and does not invent missing usage", () => {
  assert.deepEqual(
    calculateActualUsageCost({
      provider: "openai",
      model: "gpt-5.6-sol",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
      estimatedActualCostUsd: null,
      pricingVersion: null,
    }),
    { estimatedActualCostUsd: 35, pricingVersion: "2026-07-18" },
  );

  assert.deepEqual(
    calculateActualUsageCost({
      provider: "openai",
      model: "gpt-5.6-sol",
      inputTokens: null,
      outputTokens: 10,
      totalTokens: null,
      estimatedActualCostUsd: null,
      pricingVersion: null,
    }),
    { estimatedActualCostUsd: null, pricingVersion: "2026-07-18" },
  );
  assert.deepEqual(
    calculateActualUsageCost({
      provider: "openai",
      model: "unknown-model",
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      estimatedActualCostUsd: null,
      pricingVersion: null,
    }),
    { estimatedActualCostUsd: null, pricingVersion: null },
  );
});

test("fallback token estimator is structural and low confidence", () => {
  const prose = estimateTextTokens(
    "A short English sentence with several words.",
  );
  const code = estimateTextTokens(
    "const value = { nested: true };\nreturn value;",
    "code",
  );
  const chinese = estimateTextTokens("這是一段繁體中文測試內容。", "text");

  assert.equal(prose.confidence, "low");
  assert.ok(prose.tokens > 0);
  assert.ok(code.tokens > 0);
  assert.ok(chinese.tokens > 0);
  assert.notEqual(
    prose.tokens,
    "A short English sentence with several words.".length,
  );
  assert.equal(estimateTextTokens("").tokens, 0);
});

test("tiny estimates format below one cent", () => {
  assert.equal(formatEstimatedCost(0.00042), "< US$0.01");
  assert.equal(formatEstimatedCost(1.23456), "US$1.2346");
});

test("negative, non-finite, and inverted token ranges are rejected", () => {
  assert.throws(
    () => createTokenEstimate([], { minimum: -5, maximum: -3 }),
    RangeError,
  );
  assert.throws(
    () => createTokenEstimate([], { minimum: 10, maximum: 5 }),
    RangeError,
  );
  assert.throws(
    () =>
      estimateCost("openai", "gpt-5.6-terra", {
        inputTokens: 10,
        estimatedOutputTokensMin: Number.NaN,
        estimatedOutputTokensMax: 20,
        confidence: "low",
      }),
    RangeError,
  );
});
