import { z } from "zod";

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

const nullableTokenCountSchema = z.number().int().nonnegative().nullable();

export const AIUsageSchema: z.ZodType<AIUsage> = z
  .object({
    provider: z.string().trim().min(1).max(64),
    model: z.string().trim().min(1).max(128),
    inputTokens: nullableTokenCountSchema,
    cachedInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: nullableTokenCountSchema,
    reasoningTokens: z.number().int().nonnegative().optional(),
    totalTokens: nullableTokenCountSchema,
    estimatedActualCostUsd: z.number().finite().nonnegative().nullable(),
    pricingVersion: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();
