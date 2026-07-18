import type {
  AIWriterErrorCode,
  AIWriterErrorShape,
} from "../contracts/errors";

const ERROR_MESSAGES: Record<AIWriterErrorCode, string> = {
  invalid_api_key: "The OpenAI API key is invalid.",
  permission_denied: "The API key does not have permission for this request.",
  insufficient_credit: "The OpenAI account has insufficient API credit.",
  model_unavailable: "The selected model is unavailable.",
  rate_limited: "OpenAI is rate limiting requests. Try again shortly.",
  request_too_large: "The AI request is too large.",
  context_length_exceeded: "The AI request exceeds the model context limit.",
  invalid_structured_output: "The provider returned invalid structured output.",
  invalid_request_schema: "The provider rejected the structured output schema.",
  provider_refusal: "The provider declined to produce this result.",
  incomplete_response: "The provider response was incomplete.",
  provider_timeout: "The provider request timed out.",
  request_cancelled: "The AI request was cancelled.",
  network_error: "The provider could not be reached.",
  attachment_parse_failed: "The attachment could not be read.",
  unsupported_attachment: "The attachment type is unsupported.",
  selection_conflict:
    "The selected content changed before the result was applied.",
  provider_error: "The provider could not complete the request.",
  unknown_error: "The AI request failed unexpectedly.",
};

export function createAIWriterErrorShape(
  code: AIWriterErrorCode,
  options: Omit<
    Partial<AIWriterErrorShape>,
    "code" | "message" | "retryable"
  > & {
    retryable: boolean;
  },
): AIWriterErrorShape {
  return {
    code,
    message: ERROR_MESSAGES[code],
    messageKey: `ai.errors.${code}`,
    retryable: options.retryable,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.details ? { details: options.details } : {}),
  };
}

export class AIWriterError extends Error {
  readonly code: AIWriterErrorCode;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly requestId?: string;
  readonly messageKey?: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfterMs?: number;

  constructor(shape: AIWriterErrorShape, retryAfterMs?: number) {
    super(shape.message);
    this.name = "AIWriterError";
    this.code = shape.code;
    this.retryable = shape.retryable;
    this.provider = shape.provider;
    this.model = shape.model;
    this.requestId = shape.requestId;
    this.messageKey = shape.messageKey;
    this.details = shape.details;
    this.retryAfterMs = retryAfterMs;
  }

  toJSON(): AIWriterErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.messageKey ? { messageKey: this.messageKey } : {}),
      ...(this.provider ? { provider: this.provider } : {}),
      ...(this.model ? { model: this.model } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
