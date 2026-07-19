import { z } from "zod";
import {
  AI_DOCUMENT_LIMITS,
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
export type SafeOpenAITextMarksShapeCounts = Partial<
  Record<SafeOpenAITextMarksShape, number>
>;

export interface OpenAIMissingTextMarksNormalizationResult {
  value: unknown;
  normalizedMissingMarksCount: number;
}

export interface ParsedOpenAIModelPayload {
  payload: OpenAIModelPayloadV1;
  normalizedMissingMarksCount: number;
}

const SAFE_OPENAI_TEXT_MARKS_SHAPES: SafeOpenAITextMarksShape[] = [
  "missing",
  "null",
  "array",
  "object",
];

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface MissingMarksNormalizationState {
  visitedNodes: number;
  normalizedMissingMarksCount: number;
  exceededLimits: boolean;
}

function visitKnownNode(
  depth: number,
  state: MissingMarksNormalizationState,
): boolean {
  state.visitedNodes += 1;
  if (
    state.visitedNodes > AI_DOCUMENT_LIMITS.maxNodes ||
    depth > AI_DOCUMENT_LIMITS.maxDepth
  ) {
    state.exceededLimits = true;
    return false;
  }
  return true;
}

function normalizeInlineContent(
  value: unknown,
  depth: number,
  state: MissingMarksNormalizationState,
): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const normalized = value.map((entry) => {
    const next = normalizeInlineNode(entry, depth, state);
    changed ||= next !== entry;
    return next;
  });
  return changed ? normalized : value;
}

function normalizeInlineNode(
  value: unknown,
  depth: number,
  state: MissingMarksNormalizationState,
): unknown {
  if (state.exceededLimits || !isPlainRecord(value)) return value;
  if (!visitKnownNode(depth, state)) return value;
  if (value.type !== "text") return value;
  if (typeof value.text !== "string" || Object.hasOwn(value, "marks")) {
    return value;
  }
  state.normalizedMissingMarksCount += 1;
  return { ...value, marks: null };
}

function normalizeBlockContent(
  value: unknown,
  depth: number,
  state: MissingMarksNormalizationState,
): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const normalized = value.map((entry) => {
    const next = normalizeBlockNode(entry, depth, state);
    changed ||= next !== entry;
    return next;
  });
  return changed ? normalized : value;
}

function normalizeBlockNode(
  value: unknown,
  depth: number,
  state: MissingMarksNormalizationState,
): unknown {
  if (state.exceededLimits || !isPlainRecord(value)) return value;
  if (!visitKnownNode(depth, state)) return value;

  const isInlineContainer =
    value.type === "paragraph" ||
    value.type === "heading" ||
    value.type === "codeBlock";
  if (isInlineContainer) {
    const content = normalizeInlineContent(value.content, depth + 1, state);
    return content === value.content ? value : { ...value, content };
  }

  const isBlockContainer =
    value.type === "bulletList" ||
    value.type === "orderedList" ||
    value.type === "listItem" ||
    value.type === "blockquote" ||
    value.type === "table" ||
    value.type === "tableRow" ||
    value.type === "tableHeader" ||
    value.type === "tableCell";
  if (!isBlockContainer) return value;
  const content = normalizeBlockContent(value.content, depth + 1, state);
  return content === value.content ? value : { ...value, content };
}

function normalizeStructuredRoot(
  value: unknown,
  schemaVersion: "anvilnote.document.v1" | "anvilnote.fragment.v1",
  type: "doc" | "fragment",
  state: MissingMarksNormalizationState,
): unknown {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== schemaVersion ||
    value.type !== type
  ) {
    return value;
  }
  const content = normalizeBlockContent(value.content, 1, state);
  return content === value.content ? value : { ...value, content };
}

/**
 * Repairs only OpenAI's observed omission of `marks` on otherwise valid text
 * nodes. This does not relax the provider schema: all other malformed values
 * continue into the existing fail-closed Zod and public AST validation.
 */
export function normalizeMissingOpenAITextMarks(
  value: unknown,
): OpenAIMissingTextMarksNormalizationResult {
  if (!isPlainRecord(value)) {
    return { value, normalizedMissingMarksCount: 0 };
  }

  const hasDocument = Object.hasOwn(value, "document");
  const hasReplacement = Object.hasOwn(value, "replacement");
  if (hasDocument === hasReplacement) {
    return { value, normalizedMissingMarksCount: 0 };
  }

  const state: MissingMarksNormalizationState = {
    visitedNodes: 0,
    normalizedMissingMarksCount: 0,
    exceededLimits: false,
  };
  const rootKey = hasDocument ? "document" : "replacement";
  const root = normalizeStructuredRoot(
    value[rootKey],
    hasDocument ? "anvilnote.document.v1" : "anvilnote.fragment.v1",
    hasDocument ? "doc" : "fragment",
    state,
  );
  if (state.exceededLimits || root === value[rootKey]) {
    return { value, normalizedMissingMarksCount: 0 };
  }
  return {
    value: { ...value, [rootKey]: root },
    normalizedMissingMarksCount: state.normalizedMissingMarksCount,
  };
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
  const counts = getSafeOpenAITextMarksShapeCounts(value);
  const shapes = SAFE_OPENAI_TEXT_MARKS_SHAPES.filter(
    (shape) => counts?.[shape] !== undefined,
  );
  return shapes.length === 1 ? shapes[0] : undefined;
}

/**
 * Aggregates only the structural marks representation found on text nodes.
 * It deliberately excludes all model-authored text and mark attribute values.
 */
export function getSafeOpenAITextMarksShapeCounts(
  value: unknown,
): SafeOpenAITextMarksShapeCounts | undefined {
  const counts: SafeOpenAITextMarksShapeCounts = {};

  const visit = (nested: unknown): void => {
    if (Array.isArray(nested)) {
      for (const entry of nested) visit(entry);
      return;
    }
    if (nested === null || typeof nested !== "object") return;
    const record = nested as Record<string, unknown>;
    if (record.type === "text") {
      const shape: SafeOpenAITextMarksShape | undefined = !Object.hasOwn(
        record,
        "marks",
      )
        ? "missing"
        : record.marks === null
          ? "null"
          : Array.isArray(record.marks)
            ? "array"
            : typeof record.marks === "object"
              ? "object"
              : undefined;
      if (shape) counts[shape] = (counts[shape] ?? 0) + 1;
    }
    for (const nestedValue of Object.values(record)) visit(nestedValue);
  };

  visit(value);
  return Object.keys(counts).length > 0 ? counts : undefined;
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

export function parseOpenAIModelPayloadWithNormalization(
  outputSchemaId: OpenAIWriterOutputSchemaId,
  value: unknown,
): ParsedOpenAIModelPayload {
  const missingMarksNormalized = normalizeMissingOpenAITextMarks(value);
  const normalizedProviderValue = normalizeEmptyNullableIdentifiers(
    missingMarksNormalized.value,
  );
  if (outputSchemaId === "anvilnote.ai.compose-result.v1") {
    const payload = OpenAIComposePayloadV1Schema.parse(normalizedProviderValue);
    return {
      payload: NormalizedOpenAIComposePayloadV1Schema.parse({
        suggestedTitle: payload.suggestedTitle,
        document: removeNullOptionalProperties(payload.document),
        summary: payload.summary,
        warnings: payload.warnings,
      }),
      normalizedMissingMarksCount:
        missingMarksNormalized.normalizedMissingMarksCount,
    };
  }

  const payload = OpenAIRewritePayloadV1Schema.parse(normalizedProviderValue);
  return {
    payload: NormalizedOpenAIRewritePayloadV1Schema.parse({
      replacement: removeNullOptionalProperties(payload.replacement),
      changeSummary: payload.changeSummary,
      preservedElements: payload.preservedElements,
      warnings: payload.warnings,
    }),
    normalizedMissingMarksCount:
      missingMarksNormalized.normalizedMissingMarksCount,
  };
}

export function parseOpenAIModelPayload(
  outputSchemaId: OpenAIWriterOutputSchemaId,
  value: unknown,
): OpenAIModelPayloadV1 {
  return parseOpenAIModelPayloadWithNormalization(outputSchemaId, value).payload;
}

export function validateNormalizedOpenAIModelPayload(
  outputSchemaId: OpenAIWriterOutputSchemaId,
  value: unknown,
): OpenAIModelPayloadV1 {
  return outputSchemaId === "anvilnote.ai.compose-result.v1"
    ? NormalizedOpenAIComposePayloadV1Schema.parse(value)
    : NormalizedOpenAIRewritePayloadV1Schema.parse(value);
}
