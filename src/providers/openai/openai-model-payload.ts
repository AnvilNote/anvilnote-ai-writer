import { z } from "zod";
import {
  AnvilNoteDocumentFragmentV1Schema,
  AnvilNoteDocumentV1Schema,
} from "../../document/index";
import type {
  ComposeModelPayloadV1,
  RewriteModelPayloadV1,
  WriterModelPayloadV1,
} from "../../orchestration/model-payload";

export type OpenAIWriterOutputSchemaId =
  "anvilnote.ai.compose-result.v1" | "anvilnote.ai.rewrite-result.v1";

export type OpenAIComposePayloadV1 = ComposeModelPayloadV1;
export type OpenAIRewritePayloadV1 = RewriteModelPayloadV1;
export type OpenAIModelPayloadV1 = WriterModelPayloadV1;

const simpleMarkSchemas = ["bold", "italic", "strike", "code", "underline"].map(
  (type) => z.object({ type: z.literal(type) }).strict(),
);

const linkMarkSchema = z
  .object({
    type: z.literal("link"),
    attrs: z
      .object({
        href: z.string().min(1).max(4_096),
        title: z.string().max(1_024).nullable(),
        target: z.enum(["_blank", "_self"]).nullable(),
      })
      .strict(),
  })
  .strict();

const markSchema = z.union([...simpleMarkSchemas, linkMarkSchema]);
const textNodeSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(250_000),
    marks: z.array(markSchema).max(16).nullable(),
  })
  .strict();
const hardBreakNodeSchema = z.object({ type: z.literal("hardBreak") }).strict();
const inlineMathNodeSchema = z
  .object({
    type: z.literal("inlineMath"),
    attrs: z.object({ latex: z.string().min(1).max(50_000) }).strict(),
  })
  .strict();
const inlineNodeSchema = z.discriminatedUnion("type", [
  textNodeSchema,
  hardBreakNodeSchema,
  inlineMathNodeSchema,
]);

let blockNodeSchema: z.ZodType;
const blockReference: z.ZodType = z.lazy(() => blockNodeSchema);

const paragraphSchema = z
  .object({
    type: z.literal("paragraph"),
    content: z.array(inlineNodeSchema).max(10_000),
  })
  .strict();
const headingSchema = z
  .object({
    type: z.literal("heading"),
    attrs: z
      .object({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        id: z.string().min(1).max(256).nullable(),
      })
      .strict(),
    content: z.array(inlineNodeSchema).max(1_000),
  })
  .strict();
const listItemSchema = z
  .object({
    type: z.literal("listItem"),
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();
const bulletListSchema = z
  .object({
    type: z.literal("bulletList"),
    content: z.array(listItemSchema).min(1).max(1_000),
  })
  .strict();
const orderedListSchema = z
  .object({
    type: z.literal("orderedList"),
    attrs: z
      .object({
        start: z.number().int().positive().max(1_000_000).nullable(),
      })
      .strict()
      .nullable(),
    content: z.array(listItemSchema).min(1).max(1_000),
  })
  .strict();
const blockquoteSchema = z
  .object({
    type: z.literal("blockquote"),
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();
const codeBlockSchema = z
  .object({
    type: z.literal("codeBlock"),
    attrs: z.object({ language: z.string().min(1).max(128) }).strict(),
    content: z.array(textNodeSchema).max(1_000),
  })
  .strict();
const mathBlockSchema = z
  .object({
    type: z.literal("mathBlock"),
    attrs: z
      .object({
        latex: z.string().min(1).max(100_000),
        id: z.string().min(1).max(256).nullable(),
        equationNumber: z.string().min(1).max(64).nullable(),
        refName: z.string().min(1).max(256).nullable(),
      })
      .strict(),
  })
  .strict();
const tableCellAttributesSchema = z
  .object({
    colspan: z.number().int().min(1).max(100),
    rowspan: z.number().int().min(1).max(100),
    colwidth: z
      .array(z.number().int().min(1).max(10_000))
      .min(1)
      .max(100)
      .nullable(),
  })
  .strict();
const tableHeaderSchema = z
  .object({
    type: z.literal("tableHeader"),
    attrs: tableCellAttributesSchema,
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();
const tableCellSchema = z
  .object({
    type: z.literal("tableCell"),
    attrs: tableCellAttributesSchema,
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();
const tableRowSchema = z
  .object({
    type: z.literal("tableRow"),
    attrs: z
      .object({ rowHeight: z.number().min(17).max(2_000).nullable() })
      .strict()
      .nullable(),
    content: z.array(z.union([tableHeaderSchema, tableCellSchema])).max(1_000),
  })
  .strict();
const tableSchema = z
  .object({
    type: z.literal("table"),
    attrs: z
      .object({
        id: z.string().min(1).max(256).nullable(),
        caption: z.string().max(10_000).nullable(),
        variant: z.enum(["normal", "three-line"]).nullable(),
        align: z.enum(["left", "center", "right"]).nullable(),
      })
      .strict()
      .nullable(),
    content: z.array(tableRowSchema).min(1).max(1_000),
  })
  .strict();
const horizontalRuleSchema = z
  .object({
    type: z.literal("horizontalRule"),
    attrs: z
      .object({
        thicknessPt: z.number().positive().max(100).nullable(),
        lineStyle: z.enum(["solid", "dashed", "dotted", "dashdot"]).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

blockNodeSchema = z.discriminatedUnion("type", [
  paragraphSchema,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
  listItemSchema,
  blockquoteSchema,
  codeBlockSchema,
  mathBlockSchema,
  tableSchema,
  tableRowSchema,
  tableHeaderSchema,
  tableCellSchema,
  horizontalRuleSchema,
]);

const providerDocumentSchema = z
  .object({
    schemaVersion: z.literal("anvilnote.document.v1"),
    type: z.literal("doc"),
    content: z.array(blockNodeSchema).min(1).max(10_000),
  })
  .strict();
const providerFragmentSchema = z
  .object({
    schemaVersion: z.literal("anvilnote.fragment.v1"),
    type: z.literal("fragment"),
    content: z.array(blockNodeSchema).min(1).max(10_000),
  })
  .strict();

export const OpenAIComposePayloadV1Schema = z
  .object({
    suggestedTitle: z.string().max(1_000).nullable(),
    document: providerDocumentSchema,
    summary: z.string().max(50_000),
    warnings: z.array(z.string().max(2_000)).max(128),
  })
  .strict();

export const OpenAIRewritePayloadV1Schema = z
  .object({
    replacement: providerFragmentSchema,
    changeSummary: z.string().max(50_000),
    preservedElements: z.array(z.string().max(2_000)).max(10_000),
    warnings: z.array(z.string().max(2_000)).max(128),
  })
  .strict();

const NormalizedOpenAIComposePayloadV1Schema = z
  .object({
    suggestedTitle: z.string().max(1_000).nullable(),
    document: AnvilNoteDocumentV1Schema,
    summary: z.string().max(50_000),
    warnings: z.array(z.string().max(2_000)).max(128),
  })
  .strict();

const NormalizedOpenAIRewritePayloadV1Schema = z
  .object({
    replacement: AnvilNoteDocumentFragmentV1Schema,
    changeSummary: z.string().max(50_000),
    preservedElements: z.array(z.string().max(2_000)).max(10_000),
    warnings: z.array(z.string().max(2_000)).max(128),
  })
  .strict();

function removeNullOptionalProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeNullOptionalProperties);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== null)
      .map(([key, nested]) => [key, removeNullOptionalProperties(nested)]),
  );
}

export function parseOpenAIModelPayload(
  outputSchemaId: OpenAIWriterOutputSchemaId,
  value: unknown,
): OpenAIModelPayloadV1 {
  if (outputSchemaId === "anvilnote.ai.compose-result.v1") {
    const payload = OpenAIComposePayloadV1Schema.parse(value);
    return NormalizedOpenAIComposePayloadV1Schema.parse({
      suggestedTitle: payload.suggestedTitle,
      document: removeNullOptionalProperties(payload.document),
      summary: payload.summary,
      warnings: payload.warnings,
    });
  }

  const payload = OpenAIRewritePayloadV1Schema.parse(value);
  return NormalizedOpenAIRewritePayloadV1Schema.parse({
    replacement: removeNullOptionalProperties(payload.replacement),
    changeSummary: payload.changeSummary,
    preservedElements: payload.preservedElements,
    warnings: payload.warnings,
  });
}

export function validateNormalizedOpenAIModelPayload(
  outputSchemaId: OpenAIWriterOutputSchemaId,
  value: unknown,
): OpenAIModelPayloadV1 {
  return outputSchemaId === "anvilnote.ai.compose-result.v1"
    ? NormalizedOpenAIComposePayloadV1Schema.parse(value)
    : NormalizedOpenAIRewritePayloadV1Schema.parse(value);
}
