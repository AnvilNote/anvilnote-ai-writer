import type {
  ConnectionTestOptions,
  ConnectionTestResult,
} from "../contracts/connection-test";
import type {
  AIProviderCredential,
  AIProviderDefinition,
} from "../contracts/provider";
import type { AIUsage } from "../contracts/usage";
import type { ProtectedContentRegistry } from "../document/protected-content";
import type { PreparedWriterRequest } from "../orchestration/index";
import type { WriterModelPayloadV1 } from "../orchestration/model-payload";

export interface AIProviderExecutionResult {
  provider: string;
  model: string;
  providerRequestId?: string;
  payload: WriterModelPayloadV1;
  usage: AIUsage;
  durationMs: number;
  attempts: number;
}

export interface AIProviderAdapter {
  readonly definition: AIProviderDefinition;

  testConnection(
    credential: AIProviderCredential,
    options: ConnectionTestOptions,
  ): Promise<ConnectionTestResult>;

  execute(
    request: PreparedWriterRequest,
    credential: AIProviderCredential,
    options?: {
      signal?: AbortSignal;
      protectedContentRegistry?: ProtectedContentRegistry;
    },
  ): Promise<AIProviderExecutionResult>;
}
