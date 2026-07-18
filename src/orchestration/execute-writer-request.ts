import type { AIProviderCredential } from "../contracts/provider";
import type { AIWriterResult } from "../contracts/writer-result";
import type { ProtectedContentRegistry } from "../document/protected-content";
import {
  AIWriterError,
  createAIWriterErrorShape,
} from "../errors/writer-error";
import { OpenAIProviderAdapter } from "../providers/openai/openai-provider";
import { AIProviderRegistry } from "../providers/provider-registry";
import { assembleTrustedWriterResult } from "./assemble-writer-result";
import type { PreparedWriterRequest } from "./prepare-writer-request";

export interface ExecuteWriterRequestOptions {
  signal?: AbortSignal;
  registry?: AIProviderRegistry;
  protectedContentRegistry?: ProtectedContentRegistry;
}

export async function executeWriterRequest(
  request: PreparedWriterRequest,
  credential: AIProviderCredential,
  options: ExecuteWriterRequestOptions = {},
): Promise<AIWriterResult> {
  const registry =
    options.registry ?? new AIProviderRegistry([new OpenAIProviderAdapter()]);
  const adapter = registry.get(request.provider.id);
  if (!adapter) {
    throw new AIWriterError(
      createAIWriterErrorShape("provider_error", {
        retryable: false,
        provider: request.provider.id,
        model: request.provider.model,
        requestId: request.requestId,
        details: { reason: "provider adapter is not registered" },
      }),
    );
  }
  const execution = await adapter.execute(request, credential, {
    signal: options.signal,
    protectedContentRegistry: options.protectedContentRegistry,
  });
  return assembleTrustedWriterResult(request, execution);
}
