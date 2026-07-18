import type { AIWriterResult } from "../contracts/writer-result";
import { z } from "zod";
import {
  ComposeResultV1Schema,
  RewriteSelectionResultV1Schema,
} from "../contracts/writer-result";
import {
  AIWriterError,
  createAIWriterErrorShape,
} from "../errors/writer-error";
import type { AIProviderExecutionResult } from "../providers/provider-adapter";
import type { PreparedWriterRequest } from "./prepare-writer-request";

function assertExecutionMatchesRequest(
  request: PreparedWriterRequest,
  execution: AIProviderExecutionResult,
): void {
  const mismatch =
    execution.provider !== request.provider.id
      ? "provider"
      : execution.model !== request.provider.model
        ? "model"
        : execution.usage.provider !== request.provider.id
          ? "usage provider"
          : execution.usage.model !== request.provider.model
            ? "usage model"
            : null;
  if (mismatch) {
    throw new AIWriterError(
      createAIWriterErrorShape("provider_error", {
        retryable: false,
        provider: request.provider.id,
        model: request.provider.model,
        requestId: request.requestId,
        details: { reason: `${mismatch} mismatch` },
      }),
    );
  }
}

export function assembleTrustedWriterResult(
  request: PreparedWriterRequest,
  execution: AIProviderExecutionResult,
): AIWriterResult {
  assertExecutionMatchesRequest(request, execution);
  const metadata = {
    profileId: request.profile.id,
    profileVersion: request.profile.version,
    promptTemplateId: request.promptTemplate.id,
    promptVersion: request.promptTemplate.version,
    schemaVersion: request.outputSchemaId,
    policyVersions: request.policyVersions,
  };

  const normalizeValidationError = (error: unknown): never => {
    if (!(error instanceof z.ZodError)) throw error;
    throw new AIWriterError(
      createAIWriterErrorShape("invalid_structured_output", {
        retryable: false,
        provider: request.provider.id,
        model: request.provider.model,
        requestId: request.requestId,
      }),
    );
  };

  if (request.outputSchemaId === "anvilnote.ai.compose-result.v1") {
    try {
      return ComposeResultV1Schema.parse({
        schemaVersion: "anvilnote.ai.compose-result.v1",
        kind: "compose",
        ...execution.payload,
        metadata,
        usage: execution.usage,
      });
    } catch (error) {
      return normalizeValidationError(error);
    }
  }
  if (request.outputSchemaId === "anvilnote.ai.rewrite-result.v1") {
    try {
      return RewriteSelectionResultV1Schema.parse({
        schemaVersion: "anvilnote.ai.rewrite-result.v1",
        kind: "rewrite-selection",
        ...execution.payload,
        metadata,
        usage: execution.usage,
      });
    } catch (error) {
      return normalizeValidationError(error);
    }
  }
  throw new AIWriterError(
    createAIWriterErrorShape("invalid_request_schema", {
      retryable: false,
      provider: request.provider.id,
      model: request.provider.model,
      requestId: request.requestId,
    }),
  );
}
