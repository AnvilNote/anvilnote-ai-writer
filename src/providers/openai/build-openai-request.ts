import type {
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
} from "openai/resources/responses/responses";
import type { PreparedWriterRequest } from "../../orchestration/index";
import { getModelDefinition } from "../registry";
import { getOpenAIModelPayloadFormat } from "./openai-strict-schema";
import type { OpenAIWriterOutputSchemaId } from "./openai-model-payload";
import {
  OPENAI_EDIT_OPERATIONS_SCHEMA,
  OPENAI_EDIT_OPERATIONS_SCHEMA_NAME,
} from "./openai-edit-operations-schema";

export const OPENAI_DEFAULT_REASONING_EFFORT = "low" as const;

// anvilnote.ai.edit-operations.v1 is dispatched HERE, before
// getOpenAIModelPayloadFormat is ever called, rather than inside that
// function's own ternary — openai-edit-operations-schema.ts needs to reuse
// openai-strict-schema.ts's real sanitize/validate helpers (not fork them),
// so having openai-strict-schema.ts import back from
// openai-edit-operations-schema.ts would create a circular module
// dependency. See openai-strict-schema.ts's own comment for the other half
// of this judgment call; getOpenAIModelPayloadFormat itself throws if ever
// reached with this id, so the two files stay in sync by construction.
function getModelPayloadFormatForSchema(
  outputSchemaId: OpenAIWriterOutputSchemaId,
): ResponseFormatTextJSONSchemaConfig {
  if (outputSchemaId === "anvilnote.ai.edit-operations.v1") {
    return {
      type: "json_schema",
      name: OPENAI_EDIT_OPERATIONS_SCHEMA_NAME,
      strict: true,
      schema: OPENAI_EDIT_OPERATIONS_SCHEMA,
    };
  }
  return getOpenAIModelPayloadFormat(outputSchemaId);
}

function assertOutputSchemaId(
  value: string,
): asserts value is OpenAIWriterOutputSchemaId {
  if (
    value !== "anvilnote.ai.compose-result.v1" &&
    value !== "anvilnote.ai.rewrite-result.v1" &&
    value !== "anvilnote.ai.edit-operations.v1"
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
      format: getModelPayloadFormatForSchema(request.outputSchemaId),
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
