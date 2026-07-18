export type AIWriterErrorCode =
  | "invalid_api_key"
  | "permission_denied"
  | "insufficient_credit"
  | "model_unavailable"
  | "rate_limited"
  | "request_too_large"
  | "context_length_exceeded"
  | "invalid_structured_output"
  | "provider_timeout"
  | "request_cancelled"
  | "network_error"
  | "attachment_parse_failed"
  | "unsupported_attachment"
  | "selection_conflict"
  | "provider_error"
  | "unknown_error";

export interface AIWriterErrorShape {
  code: AIWriterErrorCode;
  message: string;
  retryable: boolean;
  provider?: string;
  model?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}
