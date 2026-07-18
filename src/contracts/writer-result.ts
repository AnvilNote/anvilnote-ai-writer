import type {
  AnvilNoteDocumentFragmentV1,
  AnvilNoteDocumentV1,
} from "../document/index";
import type { AIUsage } from "./usage";

export interface WriterExecutionMetadata {
  profileId: string;
  profileVersion: number;
  promptTemplateId?: string;
  promptVersion?: number;
  schemaVersion?: string;
  policyIds?: string[];
}

export interface ComposeResultV1 {
  schemaVersion: "anvilnote.ai.compose-result.v1";
  kind: "compose";
  suggestedTitle: string | null;
  document: AnvilNoteDocumentV1;
  summary: string;
  warnings: string[];
  metadata: WriterExecutionMetadata;
  usage: AIUsage;
}

export interface RewriteSelectionResultV1 {
  schemaVersion: "anvilnote.ai.rewrite-result.v1";
  kind: "rewrite-selection";
  replacement: AnvilNoteDocumentFragmentV1;
  changeSummary: string;
  preservedElements: string[];
  warnings: string[];
  metadata: WriterExecutionMetadata;
  usage: AIUsage;
}

export type AIWriterResult = ComposeResultV1 | RewriteSelectionResultV1;
