import { z } from "zod";
import { ProtectedContentError } from "../../document/protected-content";
import {
  AIWriterError,
  createAIWriterErrorShape,
} from "../../errors/writer-error";

interface OpenAIErrorContext {
  model: string;
  requestId?: string;
  callerAborted?: boolean;
  timedOut?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function safeDiagnosticToken(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9_.:-]+$/.test(value)
    ? value
    : undefined;
}

export function sanitizeOpenAIDiagnosticId(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !/^(?:req|resp)_[A-Za-z0-9_-]{1,250}$/.test(value) ||
    /sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value)
  ) {
    return undefined;
  }
  return value;
}

function parseRetryAfterMs(headers: unknown): number | undefined {
  if (!(headers instanceof Headers)) return undefined;
  const rawMilliseconds = headers.get("retry-after-ms");
  if (rawMilliseconds !== null) {
    const milliseconds = Number(rawMilliseconds);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      return milliseconds;
    }
  }
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

export function normalizeOpenAIError(
  rawError: unknown,
  context: OpenAIErrorContext,
): AIWriterError {
  if (rawError instanceof AIWriterError) return rawError;
  const record = asRecord(rawError);
  const status = typeof record.status === "number" ? record.status : undefined;
  const code = safeString(record.code);
  const type = safeString(record.type);
  const name = safeString(record.name) || safeString((rawError as Error)?.name);
  const message =
    safeString(record.message) || safeString((rawError as Error)?.message);
  const retryAfterMs = parseRetryAfterMs(record.headers);
  const providerRequestId = sanitizeOpenAIDiagnosticId(record.requestID);
  const providerCode = safeDiagnosticToken(record.code);
  const providerType = safeDiagnosticToken(record.type);
  const providerParam = safeDiagnosticToken(record.param);
  const validationDetails =
    rawError instanceof z.ZodError
      ? {
          validationStage: "provider-payload",
          validationIssuePaths: [
            ...new Set(
              rawError.issues.map((issue) =>
                issue.path.length > 0 ? issue.path.join(".") : "root",
              ),
            ),
          ].slice(0, 8),
        }
      : undefined;
  const safeDetails = {
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(status !== undefined && status >= 100 && status <= 599
      ? { providerStatus: status }
      : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(providerType ? { providerType } : {}),
    ...(providerParam ? { providerParam } : {}),
    ...validationDetails,
  };
  const base = {
    provider: "openai",
    model: context.model,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(Object.keys(safeDetails).length > 0 ? { details: safeDetails } : {}),
  };

  const create = (
    errorCode: Parameters<typeof createAIWriterErrorShape>[0],
    retryable: boolean,
  ) =>
    new AIWriterError(
      createAIWriterErrorShape(errorCode, { ...base, retryable }),
      retryAfterMs,
    );

  if (context.callerAborted) return create("request_cancelled", false);
  if (context.timedOut) return create("provider_timeout", true);
  if (
    rawError instanceof SyntaxError ||
    rawError instanceof z.ZodError ||
    rawError instanceof ProtectedContentError
  ) {
    return create("invalid_structured_output", true);
  }
  if (status === 401 || code === "invalid_api_key") {
    return create("invalid_api_key", false);
  }
  if (status === 403 || code === "permission_denied") {
    return create("permission_denied", false);
  }
  if (status === 404 || code === "model_not_found") {
    return create("model_unavailable", false);
  }
  if (status === 413 || code === "request_too_large") {
    return create("request_too_large", false);
  }
  if (status === 429) {
    if (
      [code, type, message].some((value) =>
        /insufficient_quota|billing|credit|quota_exceeded/.test(value),
      )
    ) {
      return create("insufficient_credit", false);
    }
    return create("rate_limited", true);
  }
  if (
    status === 400 &&
    /context_length|maximum context|too many tokens/.test(`${code} ${message}`)
  ) {
    return create("context_length_exceeded", false);
  }
  if (
    status === 400 &&
    /invalid_json_schema|invalid schema|response_format/.test(
      `${code} ${type} ${message}`,
    )
  ) {
    return create("invalid_request_schema", false);
  }
  if (/timeout/.test(name) || /timed out/.test(message)) {
    return create("provider_timeout", true);
  }
  if (
    /apiconnectionerror|fetcherror|networkerror/.test(name) ||
    /connection error|network error|fetch failed/.test(message)
  ) {
    return create("network_error", true);
  }
  if (status === 408 || status === 409 || (status !== undefined && status >= 500)) {
    return create("provider_error", true);
  }
  return create(
    status !== undefined ? "provider_error" : "unknown_error",
    false,
  );
}
