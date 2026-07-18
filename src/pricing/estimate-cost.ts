import { getModelPricing, PRICING_VERSION } from "./pricing-registry";
import type { TokenEstimate } from "./token-estimator";

export interface CostEstimate {
  currency: "USD";
  minimum: number;
  maximum: number;
  pricingVersion: string;
  approximate: true;
}

export function estimateCost(
  providerId: string,
  pricingId: string,
  estimate: TokenEstimate,
): CostEstimate | null {
  const pricing = getModelPricing(providerId, pricingId);
  if (!pricing) return null;

  const inputCost =
    (estimate.inputTokens / 1_000_000) * pricing.inputPerMillionTokens;
  return {
    currency: "USD",
    minimum:
      inputCost +
      (estimate.estimatedOutputTokensMin / 1_000_000) *
        pricing.outputPerMillionTokens,
    maximum:
      inputCost +
      (estimate.estimatedOutputTokensMax / 1_000_000) *
        pricing.outputPerMillionTokens,
    pricingVersion: PRICING_VERSION,
    approximate: true,
  };
}
