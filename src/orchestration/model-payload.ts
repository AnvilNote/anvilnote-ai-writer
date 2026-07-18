import type {
  AnvilNoteDocumentFragmentV1,
  AnvilNoteDocumentV1,
} from "../document/index";

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

export type WriterModelPayloadV1 =
  ComposeModelPayloadV1 | RewriteModelPayloadV1;
