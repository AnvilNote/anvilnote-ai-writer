import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { getModelDefinition } from "../registry";
import {
  sanitizeOpenAIStrictSchema,
  validateOpenAIStrictSchema,
} from "./openai-strict-schema";

export const OpenAIConnectionTestPayloadSchema = z
  .object({ status: z.literal("ok") })
  .strict();

export function buildOpenAIConnectionTestRequest(
  modelId: string,
): ResponseCreateParamsNonStreaming {
  const model = getModelDefinition("openai", modelId);
  if (!model?.enabled || !model.capabilities.structuredOutputs) {
    throw new Error(`Unsupported OpenAI model: ${modelId}`);
  }
  const format = zodTextFormat(
    OpenAIConnectionTestPayloadSchema,
    "anvilnote_connection_test_v1",
  );
  format.schema = sanitizeOpenAIStrictSchema(format.schema);
  validateOpenAIStrictSchema(format.schema);
  return {
    model: model.id,
    input: [
      {
        type: "message",
        role: "developer",
        content: "Return the required connection status object.",
      },
    ],
    text: { format, verbosity: "low" },
    reasoning: { effort: "none" },
    max_output_tokens: 32,
    store: false,
    background: false,
    stream: false,
    truncation: "disabled",
    tools: [],
  };
}
