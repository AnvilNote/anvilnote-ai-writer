import OpenAI from "openai";
import { z } from "zod";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseUsage,
} from "openai/resources/responses/responses";
import type { AIProviderCredential } from "../../contracts/provider";
import { AIProviderCredentialSchema } from "../../contracts/writer-request";
import type {
  ConnectionTestOptions,
  ConnectionTestResult,
} from "../../contracts/connection-test";
import {
  AIWriterError,
  createAIWriterErrorShape,
} from "../../errors/writer-error";
import type { PreparedWriterRequest } from "../../orchestration/index";
import type { ProtectedContentRegistry } from "../../document/protected-content";
import type {
  AIProviderAdapter,
  AIProviderExecutionResult,
} from "../provider-adapter";
import { OPENAI_PROVIDER_DEFINITION } from "./index";
import { buildOpenAIResponsesRequest } from "./build-openai-request";
import {
  buildOpenAIConnectionTestRequest,
  OpenAIConnectionTestPayloadSchema,
} from "./openai-connection-test";
import {
  normalizeOpenAIError,
  sanitizeOpenAIDiagnosticId,
} from "./openai-errors";
import {
  parseOpenAIModelPayload,
  getSafeOpenAITextMarksShape,
  type SafeOpenAITextMarksShape,
  validateNormalizedOpenAIModelPayload,
} from "./openai-model-payload";
import { normalizeOpenAIUsage } from "./openai-usage";

export const AI_TIMEOUTS = {
  connectionTestMs: 20_000,
  writerRequestMs: 120_000,
} as const;

export interface OpenAIParsedResponseLike {
  id: string;
  _request_id?: string | null;
  status: string | null;
  incomplete_details: { reason?: string } | null;
  output: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  output_parsed?: unknown;
  usage?: ResponseUsage | null;
}

interface OpenAIParseOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

export interface OpenAIClientLike {
  responses: {
    parse(
      body: ResponseCreateParamsNonStreaming,
      options?: OpenAIParseOptions,
    ): Promise<OpenAIParsedResponseLike>;
  };
}

export type OpenAIClientFactory = (
  credential: AIProviderCredential,
) => OpenAIClientLike;

export interface SafeOpenAIExecutionLogMetadata {
  requestId: string;
  provider: "openai";
  model: string;
  profileId: string;
  attempt: number;
  durationMs?: number;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
  providerStatus?: number;
  providerCode?: string;
  providerType?: string;
  providerParam?: string;
  validationIssuePaths?: string[];
  marksShape?: SafeOpenAITextMarksShape;
}

export function toSafeOpenAIExecutionLogMetadata(
  request: PreparedWriterRequest,
  values: Omit<
    SafeOpenAIExecutionLogMetadata,
    "requestId" | "provider" | "model" | "profileId"
  >,
): SafeOpenAIExecutionLogMetadata {
  return {
    requestId: request.requestId,
    provider: "openai",
    model: request.provider.model,
    profileId: request.profile.id,
    ...values,
  };
}

type AbortContext = {
  signal: AbortSignal;
  callerAborted: () => boolean;
  timedOut: () => boolean;
  cleanup: () => void;
};

function createAbortContext(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortContext {
  const controller = new AbortController();
  let callerAborted = callerSignal?.aborted ?? false;
  let timedOut = false;
  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort();
  };
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    callerAborted: () => callerAborted,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

function defaultClientFactory(
  credential: AIProviderCredential,
): OpenAIClientLike {
  const client = new OpenAI({ apiKey: credential.apiKey, maxRetries: 0 });
  return {
    responses: {
      async parse(body, options) {
        const response = await client.responses.parse(body, options);
        return response as unknown as OpenAIParsedResponseLike;
      },
    },
  };
}

async function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new Error("aborted");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseCompletedPayload(
  response: OpenAIParsedResponseLike,
  request: PreparedWriterRequest,
) {
  const refusal = response.output
    .flatMap((item) => item.content ?? [])
    .find((content) => content.type === "refusal");
  if (refusal) {
    throw new AIWriterError(
      createAIWriterErrorShape("provider_refusal", {
        retryable: false,
        provider: "openai",
        model: request.provider.model,
        requestId: request.requestId,
      }),
    );
  }
  if (response.status === "incomplete") {
    throw new AIWriterError(
      createAIWriterErrorShape("incomplete_response", {
        retryable: false,
        provider: "openai",
        model: request.provider.model,
        requestId: request.requestId,
        details: {
          reason: response.incomplete_details?.reason ?? "unknown",
        },
      }),
    );
  }
  if (response.status !== "completed") {
    throw new AIWriterError(
      createAIWriterErrorShape("provider_error", {
        retryable: false,
        provider: "openai",
        model: request.provider.model,
        requestId: request.requestId,
      }),
    );
  }
  const outputTextCount = response.output
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text").length;
  if (outputTextCount !== 1 || response.output_parsed == null) {
    throw new AIWriterError(
      createAIWriterErrorShape("invalid_structured_output", {
        retryable: true,
        provider: "openai",
        model: request.provider.model,
        requestId: request.requestId,
      }),
    );
  }
  try {
    if (request.outputSchemaId === "anvilnote.ai.compose-result.v1") {
      return parseOpenAIModelPayload(
        "anvilnote.ai.compose-result.v1",
        response.output_parsed,
      );
    }
    if (request.outputSchemaId === "anvilnote.ai.rewrite-result.v1") {
      return parseOpenAIModelPayload(
        "anvilnote.ai.rewrite-result.v1",
        response.output_parsed,
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationIssuePaths = [
        ...new Set(
          error.issues.map((issue) =>
            issue.path.length > 0 ? issue.path.join(".") : "root",
          ),
        ),
      ].slice(0, 8);
      const hasMarksIssue = error.issues.some(
        (issue) => issue.path.at(-1) === "marks",
      );
      throw new AIWriterError(
        createAIWriterErrorShape("invalid_structured_output", {
          retryable: true,
          provider: "openai",
          model: request.provider.model,
          requestId: request.requestId,
          details: {
            validationStage: "provider-payload",
            validationIssuePaths,
            ...(hasMarksIssue
              ? (() => {
                  const marksShape = getSafeOpenAITextMarksShape(
                    response.output_parsed,
                  );
                  return marksShape ? { marksShape } : {};
                })()
              : {}),
          },
        }),
      );
    }
    throw error;
  }
  throw new AIWriterError(
    createAIWriterErrorShape("invalid_request_schema", {
      retryable: false,
      provider: "openai",
      model: request.provider.model,
      requestId: request.requestId,
    }),
  );
}

export interface OpenAIProviderDependencies {
  clientFactory?: OpenAIClientFactory;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  writerTimeoutMs?: number;
  connectionTimeoutMs?: number;
  logger?: (metadata: SafeOpenAIExecutionLogMetadata) => void;
}

export class OpenAIProviderAdapter implements AIProviderAdapter {
  readonly definition = OPENAI_PROVIDER_DEFINITION;
  private readonly clientFactory: OpenAIClientFactory;
  private readonly sleep: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly writerTimeoutMs: number;
  private readonly connectionTimeoutMs: number;
  private readonly logger?: (metadata: SafeOpenAIExecutionLogMetadata) => void;

  constructor(dependencies: OpenAIProviderDependencies = {}) {
    this.clientFactory = dependencies.clientFactory ?? defaultClientFactory;
    this.sleep = dependencies.sleep ?? abortableSleep;
    this.random = dependencies.random ?? Math.random;
    this.now = dependencies.now ?? Date.now;
    this.writerTimeoutMs =
      dependencies.writerTimeoutMs ?? AI_TIMEOUTS.writerRequestMs;
    this.connectionTimeoutMs =
      dependencies.connectionTimeoutMs ?? AI_TIMEOUTS.connectionTestMs;
    this.logger = dependencies.logger;
  }

  async execute(
    request: PreparedWriterRequest,
    untrustedCredential: AIProviderCredential,
    options: {
      signal?: AbortSignal;
      protectedContentRegistry?: ProtectedContentRegistry;
    } = {},
  ): Promise<AIProviderExecutionResult> {
    let credential: AIProviderCredential;
    try {
      credential = AIProviderCredentialSchema.parse(untrustedCredential);
    } catch {
      throw new AIWriterError(
        createAIWriterErrorShape("invalid_api_key", {
          retryable: false,
          provider: "openai",
          model: request.provider.model,
          requestId: request.requestId,
        }),
      );
    }
    const body = buildOpenAIResponsesRequest(request);
    const client = this.clientFactory(credential);
    const abortContext = createAbortContext(
      options.signal,
      this.writerTimeoutMs,
    );
    const startedAt = this.now();
    let attempt = 0;
    let usageReliable = true;
    try {
      while (attempt < 2) {
        attempt += 1;
        try {
          if (abortContext.signal.aborted) {
            throw new Error("request aborted before provider execution");
          }
          const response = await client.responses.parse(body, {
            signal: abortContext.signal,
            timeout: this.writerTimeoutMs,
            maxRetries: 0,
          });
          if (abortContext.signal.aborted) {
            throw new Error("provider response arrived after cancellation");
          }
          let payload = parseCompletedPayload(response, request);
          if (options.protectedContentRegistry) {
            const restored =
              options.protectedContentRegistry.validateAndRestoreStructured(
                payload,
              );
            if (request.outputSchemaId === "anvilnote.ai.compose-result.v1") {
              payload = validateNormalizedOpenAIModelPayload(
                "anvilnote.ai.compose-result.v1",
                restored,
              );
            } else if (
              request.outputSchemaId === "anvilnote.ai.rewrite-result.v1"
            ) {
              payload = validateNormalizedOpenAIModelPayload(
                "anvilnote.ai.rewrite-result.v1",
                restored,
              );
            }
          }
          const usage = normalizeOpenAIUsage(
            usageReliable ? response.usage : undefined,
            request.provider.model,
          );
          const providerRequestId = sanitizeOpenAIDiagnosticId(
            response._request_id,
          );
          const durationMs = Math.max(0, this.now() - startedAt);
          this.logger?.(
            toSafeOpenAIExecutionLogMetadata(request, {
              attempt,
              durationMs,
              ...(providerRequestId ? { providerRequestId } : {}),
              ...(usage.inputTokens !== null
                ? { inputTokens: usage.inputTokens }
                : {}),
              ...(usage.outputTokens !== null
                ? { outputTokens: usage.outputTokens }
                : {}),
            }),
          );
          return {
            provider: "openai",
            model: request.provider.model,
            ...(providerRequestId ? { providerRequestId } : {}),
            payload,
            usage,
            durationMs,
            attempts: attempt,
          };
        } catch (rawError) {
          const error = normalizeOpenAIError(rawError, {
            model: request.provider.model,
            requestId: request.requestId,
            callerAborted: abortContext.callerAborted(),
            timedOut: abortContext.timedOut(),
          });
          this.logger?.(
            toSafeOpenAIExecutionLogMetadata(request, {
              attempt,
              durationMs: Math.max(0, this.now() - startedAt),
              errorCode: error.code,
              ...(typeof error.details?.providerStatus === "number"
                ? { providerStatus: error.details.providerStatus }
                : {}),
              ...(typeof error.details?.providerCode === "string"
                ? { providerCode: error.details.providerCode }
                : {}),
              ...(typeof error.details?.providerType === "string"
                ? { providerType: error.details.providerType }
                : {}),
              ...(typeof error.details?.providerParam === "string"
                ? { providerParam: error.details.providerParam }
                : {}),
              ...(Array.isArray(error.details?.validationIssuePaths)
                ? {
                    validationIssuePaths:
                      error.details.validationIssuePaths.filter(
                        (path): path is string => typeof path === "string",
                      ),
                }
                : {}),
              ...(
                (["missing", "null", "array", "object"] as const).includes(
                  error.details?.marksShape as SafeOpenAITextMarksShape,
                )
                  ? {
                      marksShape:
                        error.details?.marksShape as SafeOpenAITextMarksShape,
                    }
                  : {}
              ),
            }),
          );
          if (attempt >= 2 || !error.retryable || abortContext.signal.aborted) {
            throw error;
          }
          if (
            error.code === "invalid_structured_output" ||
            error.code === "provider_timeout" ||
            error.code === "network_error"
          ) {
            usageReliable = false;
          }
          const backoffMs =
            error.retryAfterMs ??
            250 * 2 ** (attempt - 1) + this.random() * 100;
          try {
            await this.sleep(backoffMs, abortContext.signal);
          } catch (sleepError) {
            throw normalizeOpenAIError(sleepError, {
              model: request.provider.model,
              requestId: request.requestId,
              callerAborted: abortContext.callerAborted(),
              timedOut: abortContext.timedOut(),
            });
          }
        }
      }
      throw new Error("OpenAI retry loop exhausted unexpectedly.");
    } finally {
      abortContext.cleanup();
    }
  }

  async testConnection(
    untrustedCredential: AIProviderCredential,
    options: ConnectionTestOptions,
  ): Promise<ConnectionTestResult> {
    const model = options.model;
    const modelDefinition = OPENAI_PROVIDER_DEFINITION.models.find(
      (candidate) => candidate.id === model && candidate.enabled,
    );
    if (!modelDefinition) {
      return {
        status: "model-unavailable",
        provider: "openai",
        model,
        messageKey: "ai.connection.model_unavailable",
      };
    }

    let credential: AIProviderCredential;
    try {
      credential = AIProviderCredentialSchema.parse(untrustedCredential);
    } catch {
      return {
        status: "invalid-key",
        provider: "openai",
        model,
        messageKey: "ai.connection.invalid_key",
      };
    }
    const timeoutMs = Math.min(
      options.timeoutMs ?? this.connectionTimeoutMs,
      this.connectionTimeoutMs,
    );
    const abortContext = createAbortContext(options.signal, timeoutMs);
    const startedAt = this.now();
    try {
      if (abortContext.signal.aborted) {
        throw new Error("connection test aborted before provider execution");
      }
      const client = this.clientFactory(credential);
      const response = await client.responses.parse(
        buildOpenAIConnectionTestRequest(model),
        {
          signal: abortContext.signal,
          timeout: timeoutMs,
          maxRetries: 0,
        },
      );
      if (abortContext.signal.aborted) {
        throw new Error("connection test response arrived after cancellation");
      }
      const refusalPresent = response.output
        .flatMap((item) => item.content ?? [])
        .some((content) => content.type === "refusal");
      const outputTextCount = response.output
        .flatMap((item) => item.content ?? [])
        .filter((content) => content.type === "output_text").length;
      if (
        refusalPresent ||
        response.status !== "completed" ||
        outputTextCount !== 1 ||
        response.output_parsed == null
      ) {
        throw new SyntaxError("Invalid connection test structured output.");
      }
      OpenAIConnectionTestPayloadSchema.parse(response.output_parsed);
      return {
        status: "success",
        provider: "openai",
        model,
        messageKey: "ai.connection.success",
        latencyMs: Math.max(0, this.now() - startedAt),
      };
    } catch (rawError) {
      const normalized = normalizeOpenAIError(rawError, {
        model,
        callerAborted: abortContext.callerAborted(),
        timedOut: abortContext.timedOut(),
      });
      const statusMap: Record<string, ConnectionTestResult["status"]> = {
        invalid_api_key: "invalid-key",
        permission_denied: "permission-denied",
        insufficient_credit: "insufficient-credit",
        model_unavailable: "model-unavailable",
        rate_limited: "rate-limited",
        network_error: "network-error",
        provider_timeout: "timeout",
        request_cancelled: "cancelled",
      };
      const status = statusMap[normalized.code] ?? "unknown-error";
      return {
        status,
        provider: "openai",
        model,
        messageKey: `ai.connection.${status.replaceAll("-", "_")}`,
      };
    } finally {
      abortContext.cleanup();
    }
  }
}
