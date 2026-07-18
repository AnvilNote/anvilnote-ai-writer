import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { PreparedWriterRequest } from "../../orchestration/index";
import { getModelDefinition } from "../registry";
import { getOpenAIModelPayloadFormat } from "./openai-strict-schema";
import type { OpenAIWriterOutputSchemaId } from "./openai-model-payload";

export const OPENAI_DEFAULT_REASONING_EFFORT = "low" as const;

function assertOutputSchemaId(
  value: string,
): asserts value is OpenAIWriterOutputSchemaId {
  if (
    value !== "anvilnote.ai.compose-result.v1" &&
    value !== "anvilnote.ai.rewrite-result.v1"
  ) {
    throw new Error(`Unsupported OpenAI output schema: ${value}`);
  }
}

export function buildOpenAIResponsesRequest(
  request: PreparedWriterRequest,
): ResponseCreateParamsNonStreaming {
  if (request.provider.id !== "openai") {
    throw new Error(
      `OpenAI request builder cannot execute provider: ${request.provider.id}`,
    );
  }
  const model = getModelDefinition("openai", request.provider.model);
  if (!model?.enabled || !model.capabilities.structuredOutputs) {
    throw new Error(`Unsupported OpenAI model: ${request.provider.model}`);
  }
  assertOutputSchemaId(request.outputSchemaId);

  const modelMaximum = model.limits.maxOutputTokens;
  if (modelMaximum !== undefined && request.maxOutputTokens > modelMaximum) {
    throw new RangeError(
      `Requested output tokens exceed ${model.id}'s supported maximum.`,
    );
  }

  return {
    model: model.id,
    input: request.sections.map((section) => ({
      type: "message" as const,
      role: section.role,
      content: section.content,
    })),
    text: {
      format: getOpenAIModelPayloadFormat(request.outputSchemaId),
      verbosity: "medium",
    },
    reasoning: { effort: OPENAI_DEFAULT_REASONING_EFFORT },
    max_output_tokens: request.maxOutputTokens,
    store: false,
    background: false,
    stream: false,
    truncation: "disabled",
    tools: [],
  };
}
