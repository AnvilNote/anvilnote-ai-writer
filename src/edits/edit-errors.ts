// AI edit errors — the apply engine's own stable error-code taxonomy.
//
// Judgment call: AIWriterErrorCode (contracts/errors.ts) / AIWriterError
// (errors/writer-error.ts) is a PROVIDER-facing contract — every one of its
// members describes something that went wrong talking to an AI provider
// (invalid_api_key, rate_limited, provider_timeout, ...). The three new
// codes this task needs (invalid_edit_operation, invalid_reference,
// unsupported_image_edit) describe local, structural validation failures
// inside applyEditOperations — they can occur with ZERO network activity,
// before any provider is ever involved, and "retrying" one (in the
// provider sense of backing off and re-sending the same request) never
// helps, since the same operations against the same snapshot always fail
// the same way. The plan text itself already frames these as "a NEW,
// separate error domain", which settles it: rather than widening
// AIWriterErrorCode's union (and forcing every provider-error switch/lookup
// table in this package to grow arms it can never actually produce), this
// defines a sibling AiEditErrorCode + AiEditError, following the exact same
// class/lookup-table/toJSON() shape as AIWriterError for consistency.
//
// request_too_large is the one exception: it already exists on
// AIWriterErrorCode, and the plan explicitly says to reuse it rather than
// invent a differently-named duplicate (e.g. "edit_too_large") — so the
// exact same string literal "request_too_large" is deliberately a member of
// BOTH AIWriterErrorCode and AiEditErrorCode. They're just string literal
// types, not exclusive class hierarchies, so a caller checking
// `error.code === "request_too_large"` behaves consistently regardless of
// which domain actually produced the error.
export type AiEditErrorCode =
  | "invalid_edit_operation"
  | "invalid_reference"
  | "unsupported_image_edit"
  | "request_too_large";

export interface AiEditErrorShape {
  code: AiEditErrorCode;
  message: string;
  messageKey?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

const AI_EDIT_ERROR_MESSAGES: Record<AiEditErrorCode, string> = {
  invalid_edit_operation:
    "One or more AI edit operations were structurally invalid for the document they targeted.",
  invalid_reference:
    "An AI edit operation referenced a node that could not be resolved in the document.",
  unsupported_image_edit:
    "AI edit operations can never create, replace, move, or otherwise directly manipulate protected image content.",
  request_too_large: "The AI edit request exceeds the configured safety limits.",
};

export function createAiEditErrorShape(
  code: AiEditErrorCode,
  options?: { details?: Record<string, unknown> },
): AiEditErrorShape {
  return {
    code,
    message: AI_EDIT_ERROR_MESSAGES[code],
    messageKey: `ai.edits.errors.${code}`,
    retryable: false,
    ...(options?.details ? { details: options.details } : {}),
  };
}

export class AiEditError extends Error {
  readonly code: AiEditErrorCode;
  readonly retryable: boolean;
  readonly messageKey?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: AiEditErrorCode, details?: Record<string, unknown>) {
    const shape = createAiEditErrorShape(code, { details });
    super(shape.message);
    this.name = "AiEditError";
    this.code = shape.code;
    this.retryable = shape.retryable;
    this.messageKey = shape.messageKey;
    this.details = shape.details;
  }

  toJSON(): AiEditErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.messageKey ? { messageKey: this.messageKey } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
