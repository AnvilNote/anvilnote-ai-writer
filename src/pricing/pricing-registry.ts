import pricing from "./pricing.json";

export interface ModelPricing {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
}

export const PRICING_VERSION = pricing.version;
export const PRICING_CURRENCY = pricing.currency;
export const PRICING_SOURCE = pricing.source;

export function getModelPricing(
  providerId: string,
  pricingId: string,
): ModelPricing | null {
  const provider =
    pricing.providers[providerId as keyof typeof pricing.providers];
  if (!provider) return null;
  const model = provider.models[pricingId as keyof typeof provider.models];
  return model ?? null;
}
