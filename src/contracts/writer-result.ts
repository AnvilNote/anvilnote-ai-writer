import { z } from "zod";
import {
  AnvilNoteDocumentFragmentV1Schema,
  AnvilNoteDocumentV1Schema,
  type AnvilNoteDocumentFragmentV1,
  type AnvilNoteDocumentV1,
} from "../document/index";
import { AIUsageSchema, type AIUsage } from "./usage";

export type WriterResultSchemaVersion =
  "anvilnote.ai.compose-result.v1" | "anvilnote.ai.rewrite-result.v1";

export const WRITER_POLICY_IDS = {
  factualIntegrity: "policy.factual-integrity.v1",
  protectedContent: "policy.protected-content.v1",
  styleAcademicNeutral: "policy.style.academic-neutral.v1",
  styleNaturalRestrained: "policy.style.natural-restrained.v1",
  styleNatural: "policy.style.natural.v1",
  stylePreserveSource: "policy.style.preserve-source.v1",
  humanizerCore: "policy.humanizer.core.v1",
  humanizerEnglish: "policy.humanizer.en.v1",
  humanizerTraditionalChinese: "policy.humanizer.zh-TW.v1",
} as const;

export type WriterPolicyId =
  (typeof WRITER_POLICY_IDS)[keyof typeof WRITER_POLICY_IDS];

export interface VersionedPolicyReference {
  id: WriterPolicyId;
  version: 1;
}

interface WriterExecutionMetadataBase {
  profileVersion: 1;
  promptVersion: 1;
  policyVersions: VersionedPolicyReference[];
}

export type ComposeWriterExecutionMetadata =
  | (WriterExecutionMetadataBase & {
      profileId: "compose.default.v1";
      promptTemplateId: "prompt.compose.v1";
      schemaVersion: "anvilnote.ai.compose-result.v1";
    })
  | (WriterExecutionMetadataBase & {
      profileId: "compose.from-attachments.v1";
      promptTemplateId: "prompt.compose-from-attachments.v1";
      schemaVersion: "anvilnote.ai.compose-result.v1";
    });

export type RewriteWriterExecutionMetadata = WriterExecutionMetadataBase & {
  profileId: "rewrite.selection.v1";
  promptTemplateId: "prompt.rewrite-selection.v1";
  schemaVersion: "anvilnote.ai.rewrite-result.v1";
};

export type WriterExecutionMetadata =
  ComposeWriterExecutionMetadata | RewriteWriterExecutionMetadata;

export interface ComposeResultV1 {
  schemaVersion: "anvilnote.ai.compose-result.v1";
  kind: "compose";
  suggestedTitle: string | null;
  document: AnvilNoteDocumentV1;
  summary: string;
  warnings: string[];
  metadata: ComposeWriterExecutionMetadata;
  usage: AIUsage;
}

export interface RewriteSelectionResultV1 {
  schemaVersion: "anvilnote.ai.rewrite-result.v1";
  kind: "rewrite-selection";
  replacement: AnvilNoteDocumentFragmentV1;
  changeSummary: string;
  preservedElements: string[];
  warnings: string[];
  metadata: RewriteWriterExecutionMetadata;
  usage: AIUsage;
}

export type AIWriterResult = ComposeResultV1 | RewriteSelectionResultV1;

const WRITER_POLICY_ID_VALUES = Object.values(WRITER_POLICY_IDS) as [
  WriterPolicyId,
  ...WriterPolicyId[],
];
const STYLE_POLICY_IDS = new Set<WriterPolicyId>([
  WRITER_POLICY_IDS.styleAcademicNeutral,
  WRITER_POLICY_IDS.styleNaturalRestrained,
  WRITER_POLICY_IDS.styleNatural,
  WRITER_POLICY_IDS.stylePreserveSource,
]);
const HUMANIZER_POLICY_IDS = new Set<WriterPolicyId>([
  WRITER_POLICY_IDS.humanizerCore,
  WRITER_POLICY_IDS.humanizerEnglish,
  WRITER_POLICY_IDS.humanizerTraditionalChinese,
]);

const VersionedPolicyReferenceSchema = z
  .object({
    id: z.enum(WRITER_POLICY_ID_VALUES),
    version: z.literal(1),
  })
  .strict();

const PolicyVersionsSchema = z
  .array(VersionedPolicyReferenceSchema)
  .min(3)
  .max(4)
  .superRefine((references, context) => {
    const ids = new Set<WriterPolicyId>();
    for (const [index, reference] of references.entries()) {
      if (ids.has(reference.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Policy metadata ID must be unique: ${reference.id}`,
        });
      }
      ids.add(reference.id);
    }
    for (const requiredId of [
      WRITER_POLICY_IDS.factualIntegrity,
      WRITER_POLICY_IDS.protectedContent,
    ]) {
      if (!ids.has(requiredId)) {
        context.addIssue({
          code: "custom",
          message: `Required policy metadata is missing: ${requiredId}`,
        });
      }
    }
    if ([...ids].filter((id) => STYLE_POLICY_IDS.has(id)).length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Policy metadata requires exactly one writing-style policy.",
      });
    }
    if ([...ids].filter((id) => HUMANIZER_POLICY_IDS.has(id)).length > 1) {
      context.addIssue({
        code: "custom",
        message: "Policy metadata permits at most one Humanizer policy.",
      });
    }
  });

const WriterExecutionMetadataBaseSchema = z
  .object({
    profileVersion: z.literal(1),
    promptVersion: z.literal(1),
    policyVersions: PolicyVersionsSchema,
  })
  .strict();

const ComposeDefaultExecutionMetadataSchema =
  WriterExecutionMetadataBaseSchema.extend({
    profileId: z.literal("compose.default.v1"),
    promptTemplateId: z.literal("prompt.compose.v1"),
    schemaVersion: z.literal("anvilnote.ai.compose-result.v1"),
  });

const ComposeFromAttachmentsExecutionMetadataSchema =
  WriterExecutionMetadataBaseSchema.extend({
    profileId: z.literal("compose.from-attachments.v1"),
    promptTemplateId: z.literal("prompt.compose-from-attachments.v1"),
    schemaVersion: z.literal("anvilnote.ai.compose-result.v1"),
  });

const ComposeExecutionMetadataSchema = z.discriminatedUnion("profileId", [
  ComposeDefaultExecutionMetadataSchema,
  ComposeFromAttachmentsExecutionMetadataSchema,
]) satisfies z.ZodType<ComposeWriterExecutionMetadata>;

const RewriteExecutionMetadataSchema = WriterExecutionMetadataBaseSchema.extend(
  {
    profileId: z.literal("rewrite.selection.v1"),
    promptTemplateId: z.literal("prompt.rewrite-selection.v1"),
    schemaVersion: z.literal("anvilnote.ai.rewrite-result.v1"),
  },
) satisfies z.ZodType<RewriteWriterExecutionMetadata>;

export const WriterExecutionMetadataSchema = z.discriminatedUnion("profileId", [
  ComposeDefaultExecutionMetadataSchema,
  ComposeFromAttachmentsExecutionMetadataSchema,
  RewriteExecutionMetadataSchema,
]) satisfies z.ZodType<WriterExecutionMetadata>;

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
    metadata: ComposeExecutionMetadataSchema,
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
    metadata: RewriteExecutionMetadataSchema,
    usage: AIUsageSchema,
  })
  .strict() satisfies z.ZodType<RewriteSelectionResultV1>;

export const AIWriterResultSchema = z.discriminatedUnion("kind", [
  ComposeResultV1Schema,
  RewriteSelectionResultV1Schema,
]) satisfies z.ZodType<AIWriterResult>;
