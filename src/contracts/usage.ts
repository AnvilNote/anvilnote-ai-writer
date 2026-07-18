export interface AIUsage {
  provider: string;
  model: string;
  inputTokens: number | null;
  cachedInputTokens?: number;
  outputTokens: number | null;
  reasoningTokens?: number;
  totalTokens: number | null;
  estimatedActualCostUsd: number | null;
  pricingVersion: string | null;
}
