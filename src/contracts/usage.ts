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
  .strict()
  .superRefine((usage, context) => {
    if (
      usage.cachedInputTokens !== undefined &&
      (usage.inputTokens === null ||
        usage.cachedInputTokens > usage.inputTokens)
    ) {
      context.addIssue({
        code: "custom",
        path: ["cachedInputTokens"],
        message: "Cached input tokens must be a subset of input tokens.",
      });
    }
    if (
      usage.reasoningTokens !== undefined &&
      (usage.outputTokens === null ||
        usage.reasoningTokens > usage.outputTokens)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasoningTokens"],
        message: "Reasoning tokens must be a subset of output tokens.",
      });
    }
    if (
      usage.inputTokens !== null &&
      usage.outputTokens !== null &&
      usage.totalTokens !== null &&
      usage.totalTokens < usage.inputTokens + usage.outputTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "Total tokens cannot be lower than input plus output tokens.",
      });
    }
  });
