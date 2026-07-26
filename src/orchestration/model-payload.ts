import type {
  AnvilNoteDocumentFragmentV1,
  AnvilNoteDocumentV1,
} from "../document/index";
import type { AiEditOperationsResultV1 } from "../edits/edit-operations-v1";

export interface ComposeModelPayloadV1 {
  suggestedTitle: string | null;
  document: AnvilNoteDocumentV1;
  summary: string;
  warnings: string[];
}

export interface RewriteModelPayloadV1 {
  replacement: AnvilNoteDocumentFragmentV1;
  changeSummary: string;
  preservedElements: string[];
  warnings: string[];
}

// AiEditOperationsResultV1 (Task 21.1, edits/edit-operations-v1.ts) is added
// here as a third member for Task 22's new anvilnote.ai.edit-operations.v1
// output schema — see openai-provider.ts's parseCompletedPayload and
// openai-edit-operations-normalizer.ts's normalizeOpenAiEditOperations for
// where a provider response is actually produced/normalized into this
// shape. This file is not in Task 22.1's own listed file set, but widening
// this union is the minimal, necessary change to let
// AIProviderAdapter.execute()'s existing, shared return type
// (AIProviderExecutionResult.payload: WriterModelPayloadV1) legitimately
// carry an edit-operations result without an unsafe cast at the call site —
// the same category of "required gatekeeper, not explicitly named" change
// as build-openai-request.ts's assertOutputSchemaId.
export type WriterModelPayloadV1 =
  ComposeModelPayloadV1 | RewriteModelPayloadV1 | AiEditOperationsResultV1;
