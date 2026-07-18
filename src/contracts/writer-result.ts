import { z } from "zod";
import {
  AnvilNoteDocumentFragmentV1Schema,
  AnvilNoteDocumentV1Schema,
  type AnvilNoteDocumentFragmentV1,
  type AnvilNoteDocumentV1,
} from "../document/index";
import { AIUsageSchema, type AIUsage } from "./usage";

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

export const WriterExecutionMetadataSchema: z.ZodType<WriterExecutionMetadata> =
  z
    .object({
      profileId: z.string().trim().min(1).max(128),
      profileVersion: z.number().int().positive(),
      promptTemplateId: z.string().trim().min(1).max(128).optional(),
      promptVersion: z.number().int().positive().optional(),
      schemaVersion: z.string().trim().min(1).max(128).optional(),
      policyIds: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
    })
    .strict();

const resultTextSchema = z.string().max(50_000);
const warningsSchema = z.array(z.string().max(2_000)).max(128);

export const ComposeResultV1Schema = z
  .object({
    schemaVersion: z.literal("anvilnote.ai.compose-result.v1"),
    kind: z.literal("compose"),
    suggestedTitle: z.string().max(1_000).nullable(),
    document: AnvilNoteDocumentV1Schema,
    summary: resultTextSchema,
    warnings: warningsSchema,
    metadata: WriterExecutionMetadataSchema,
    usage: AIUsageSchema,
  })
  .strict() satisfies z.ZodType<ComposeResultV1>;

export const RewriteSelectionResultV1Schema = z
  .object({
    schemaVersion: z.literal("anvilnote.ai.rewrite-result.v1"),
    kind: z.literal("rewrite-selection"),
    replacement: AnvilNoteDocumentFragmentV1Schema,
    changeSummary: resultTextSchema,
    preservedElements: z.array(z.string().max(2_000)).max(10_000),
    warnings: warningsSchema,
    metadata: WriterExecutionMetadataSchema,
    usage: AIUsageSchema,
  })
  .strict() satisfies z.ZodType<RewriteSelectionResultV1>;

export const AIWriterResultSchema = z.discriminatedUnion("kind", [
  ComposeResultV1Schema,
  RewriteSelectionResultV1Schema,
]) satisfies z.ZodType<AIWriterResult>;
