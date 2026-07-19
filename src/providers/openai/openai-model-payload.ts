import { z } from "zod";
import {
  ANVIL_NOTE_SIMPLE_MARK_TYPES,
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

export type SafeOpenAITextMarksShape = "missing" | "null" | "array" | "object";

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

const simpleMarkSchemas = ANVIL_NOTE_SIMPLE_MARK_TYPES.map(
  (type) => z.object({ type: z.literal(type) }).strict(),
);

/**
 * This mirrors the public AnvilNote mark union. The only wire adaptation is
 * that link `title` and `target` are required nullable values so the emitted
 * JSON Schema complies with OpenAI strict Structured Outputs requirements.
 * `removeNullOptionalProperties()` restores the public optional shape before
 * the public AST schema performs the final semantic validation.
 */
const providerTextMarkSchema = z.union([...simpleMarkSchemas, linkMarkSchema]);
const providerTextMarksSchema = z
  .array(providerTextMarkSchema)
  .max(16)
  .nullable();
const textNodeSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(250_000),
    marks: providerTextMarksSchema,
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
    content: z
      .array(
        z
          .object({
            type: z.literal("text"),
            text: z.string().min(1).max(250_000),
            marks: z.null(),
          })
          .strict(),
      )
      .max(1_000),
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
  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== null)
      .map(([key, nested]) => [key, removeNullOptionalProperties(nested)]),
  );
  if (
    normalized.type === "text" &&
    Array.isArray(normalized.marks) &&
    normalized.marks.length === 0
  ) {
    return Object.fromEntries(
      Object.entries(normalized).filter(([key]) => key !== "marks"),
    );
  }
  return normalized;
}

const NULLABLE_IDENTIFIER_KEYS = new Set(["id", "equationNumber", "refName"]);

/**
 * Returns only an aggregate structural category for text-node marks. It never
 * reads text, URLs, titles, or unknown values and is used only in the
 * invalid-output logging path.
 */
export function getSafeOpenAITextMarksShape(
  value: unknown,
): SafeOpenAITextMarksShape | undefined {
  const shapes = new Set<SafeOpenAITextMarksShape>();

  const visit = (nested: unknown): void => {
    if (Array.isArray(nested)) {
      for (const entry of nested) visit(entry);
      return;
    }
    if (nested === null || typeof nested !== "object") return;
    const record = nested as Record<string, unknown>;
    if (record.type === "text") {
      if (!("marks" in record)) shapes.add("missing");
      else if (record.marks === null) shapes.add("null");
      else if (Array.isArray(record.marks)) shapes.add("array");
      else if (typeof record.marks === "object") shapes.add("object");
    }
    for (const nestedValue of Object.values(record)) visit(nestedValue);
  };

  visit(value);
  return shapes.size === 1 ? [...shapes][0] : undefined;
}

/**
 * OpenAI strict Structured Outputs does not support minLength. It can
 * therefore legally return an empty string for a nullable identifier even
 * though the domain contract requires a non-empty identifier when present.
 * Empty optional identifiers carry no information, so normalize only those
 * allowlisted fields to null before provider-shape validation. Required text,
 * URLs, code languages, and LaTeX remain fail-closed.
 */
function normalizeEmptyNullableIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeEmptyNullableIdentifiers);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      NULLABLE_IDENTIFIER_KEYS.has(key) &&
      typeof nested === "string" &&
      nested.trim().length === 0
        ? null
        : normalizeEmptyNullableIdentifiers(nested),
    ]),
  );
}

export function parseOpenAIModelPayload(
  outputSchemaId: OpenAIWriterOutputSchemaId,
  value: unknown,
): OpenAIModelPayloadV1 {
  const normalizedProviderValue = normalizeEmptyNullableIdentifiers(value);
  if (outputSchemaId === "anvilnote.ai.compose-result.v1") {
    const payload = OpenAIComposePayloadV1Schema.parse(normalizedProviderValue);
    return NormalizedOpenAIComposePayloadV1Schema.parse({
      suggestedTitle: payload.suggestedTitle,
      document: removeNullOptionalProperties(payload.document),
      summary: payload.summary,
      warnings: payload.warnings,
    });
  }

  const payload = OpenAIRewritePayloadV1Schema.parse(normalizedProviderValue);
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
