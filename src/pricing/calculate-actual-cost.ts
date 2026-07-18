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
  return {
    estimatedActualCostUsd:
      (usage.inputTokens / 1_000_000) * pricing.inputPerMillionTokens +
      (usage.outputTokens / 1_000_000) * pricing.outputPerMillionTokens,
    pricingVersion: PRICING_VERSION,
  };
}
