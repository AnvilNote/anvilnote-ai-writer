import type { ResponseUsage } from "openai/resources/responses/responses";
import type { AIUsage } from "../../contracts/usage";
import { calculateActualUsageCost } from "../../pricing/calculate-actual-cost";
import { PRICING_VERSION } from "../../pricing/pricing-registry";

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function normalizeOpenAIUsage(
  usage: ResponseUsage | null | undefined,
  model: string,
): AIUsage {
  if (!usage) {
    return {
      provider: "openai",
      model,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedActualCostUsd: null,
      pricingVersion: null,
    };
  }

  const inputTokens = isTokenCount(usage.input_tokens)
    ? usage.input_tokens
    : null;
  const outputTokens = isTokenCount(usage.output_tokens)
    ? usage.output_tokens
    : null;
  const rawTotalTokens = usage.total_tokens;
  const totalTokens =
    isTokenCount(rawTotalTokens) &&
    (inputTokens === null ||
      outputTokens === null ||
      rawTotalTokens >= inputTokens + outputTokens)
      ? rawTotalTokens
      : null;
  const rawCachedInputTokens = usage.input_tokens_details?.cached_tokens;
  const cachedInputTokens =
    isTokenCount(rawCachedInputTokens) &&
    inputTokens !== null &&
    rawCachedInputTokens <= inputTokens
      ? rawCachedInputTokens
      : undefined;
  const rawReasoningTokens = usage.output_tokens_details?.reasoning_tokens;
  const reasoningTokens =
    isTokenCount(rawReasoningTokens) &&
    outputTokens !== null &&
    rawReasoningTokens <= outputTokens
      ? rawReasoningTokens
      : undefined;
  const cacheWriteTokens = usage.input_tokens_details?.cache_write_tokens;
  const usageIsConsistent =
    inputTokens !== null &&
    outputTokens !== null &&
    totalTokens !== null &&
    (rawCachedInputTokens === undefined || cachedInputTokens !== undefined) &&
    (rawReasoningTokens === undefined || reasoningTokens !== undefined) &&
    (cacheWriteTokens === undefined || isTokenCount(cacheWriteTokens));

  const normalized: AIUsage = {
    provider: "openai",
    model,
    inputTokens,
    ...(cachedInputTokens !== undefined && cachedInputTokens > 0
      ? { cachedInputTokens }
      : {}),
    outputTokens,
    ...(reasoningTokens !== undefined && reasoningTokens > 0
      ? { reasoningTokens }
      : {}),
    totalTokens,
    estimatedActualCostUsd: null,
    pricingVersion: null,
  };
  if (!usageIsConsistent) return normalized;
  if (cacheWriteTokens === undefined || cacheWriteTokens > 0) {
    return { ...normalized, pricingVersion: PRICING_VERSION };
  }
  return { ...normalized, ...calculateActualUsageCost(normalized) };
}
