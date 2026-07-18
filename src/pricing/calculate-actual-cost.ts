import type { AIUsage } from "../contracts/usage";
import { getModelPricing, PRICING_VERSION } from "./pricing-registry";

export interface ActualUsageCost {
  estimatedActualCostUsd: number | null;
  pricingVersion: string | null;
}

export function calculateActualUsageCost(usage: AIUsage): ActualUsageCost {
  const pricing = getModelPricing(usage.provider, usage.model);
  if (!pricing) return { estimatedActualCostUsd: null, pricingVersion: null };
  if (usage.inputTokens === null || usage.outputTokens === null) {
    return { estimatedActualCostUsd: null, pricingVersion: PRICING_VERSION };
  }
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const counts = [
    usage.inputTokens,
    cachedInputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.reasoningTokens,
  ].filter((value): value is number => value !== null && value !== undefined);
  if (
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    cachedInputTokens > usage.inputTokens ||
    (usage.totalTokens !== null &&
      usage.totalTokens < usage.inputTokens + usage.outputTokens) ||
    (usage.reasoningTokens !== undefined &&
      usage.reasoningTokens > usage.outputTokens) ||
    usage.inputTokens > pricing.standardInputTokenLimit
  ) {
    return { estimatedActualCostUsd: null, pricingVersion: PRICING_VERSION };
  }
  const uncachedInputTokens = usage.inputTokens - cachedInputTokens;
  const calculatedCost =
    (uncachedInputTokens / 1_000_000) * pricing.inputPerMillionTokens +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillionTokens +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillionTokens;
  return {
    estimatedActualCostUsd: Number(calculatedCost.toFixed(12)),
    pricingVersion: PRICING_VERSION,
  };
}
