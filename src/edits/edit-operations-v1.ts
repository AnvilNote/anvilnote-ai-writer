import { z } from "zod";
import {
  blockNodeV2Reference,
  inlineNodeV2Reference,
  type AiBlockNodeV2,
  type AiInlineNodeV2,
} from "../document/v2/document";
import { aiMarkV2Schema, type AiMarkV2 } from "../document/v2/marks";
import { AI_NODE_CAPABILITIES } from "../document/v2/capability-manifest";
import { AI_EDIT_LIMITS } from "../document/v2/limits";
import { coreBlockSchemasV2, coreInlineSchemasV2 } from "../document/v2/core-nodes";
import type {
  AiHeadingNodeV2,
  AiOrderedListNodeV2,
  AiBlockquoteNodeV2,
  AiCodeBlockNodeV2,
  AiBlockMathNodeV2,
  AiHorizontalRuleNodeV2,
  AiInlineMathNodeV2,
} from "../document/v2/core-nodes";
import { structuredBlockSchemasV2 } from "../document/v2/structured-nodes";
import type {
  AiCalloutNodeV2,
  AiQuestionItemAttrsV2,
  AiTableNodeV2,
  AiTableRowNodeV2,
  AiTableCellAttributesV2,
  AiFootnoteNodeV2,
} from "../document/v2/structured-nodes";
import { visualBlockSchemasV2 } from "../document/v2/visual-nodes";
import type {
  AiMermaidNodeV2,
  AiFunctionPlotNodeV2,
  AiStatsChartSpecV2,
} from "../document/v2/visual-nodes";
import { referenceInlineSchemasV2 } from "../document/v2/reference-nodes";
import type {
  AiCrossRefNodeV2,
  AiFootnoteReferenceNodeV2,
  AiQuestionBlankNodeV2,
} from "../document/v2/reference-nodes";

// AI edit operations v1 — the typed edit surface a model emits on top of the
// canonical AI document AST v2 (see document/v2/document.ts's header comment
// for the AST itself). Deliberately NOT arbitrary JSON Patch and NOT a full
// document rewrite: every operation is one of exactly six shapes
// (insertNode/replaceNode/deleteNode/moveNode/updateAttrs/replaceText), each
// embedding a real v2 node/attrs/mark schema wherever it carries content, so
// every protection those schemas already enforce (strict unknown-key
// rejection, no caller-authored stable ids, no svg payloads, images entirely
// absent from the v2 union) is inherited for free rather than re-implemented
// here. This module is schema-only: it has no notion of an actual document
// to resolve targetRef/parentRef against (that's applyEditOperations in
// apply-edit-operations.ts, Task 21.3) — refs here are opaque non-empty
// strings.
//
// --- Deliberate deviation from the plan's own illustrative snippet --------
// The plan's Step 1 example writes updateAttrs as
// `{ type: "updateAttrs", targetRef, attrs: { caption: "Updated" } }` with no
// way to know which node type's attrs schema should validate `attrs` — Task
// 21.1 has no document yet to resolve targetRef against, so there is no way
// to look up "what kind of node does targetRef point to" at parse time. This
// module resolves that ambiguity (per the plan's own instruction to
// re-derive the exact shape when its shorthand omits necessary detail) by
// having the operation itself carry an explicit `nodeType` discriminant
// alongside `attrs`:
//   { type: "updateAttrs", targetRef, nodeType: "statsChart", attrs: {...} }
// `nodeType` picks which per-node-type PARTIAL attrs schema validates
// `attrs` against (see attrsPatchSchemaByNodeType below). Task 21.3's apply
// engine cross-checks this claimed nodeType against what targetRef actually
// resolves to in the real document, and rejects a mismatch.

export type AiNodeV2 = AiBlockNodeV2 | AiInlineNodeV2;

// Every per-attrs-field patch is the SAME shape as the full node's attrs,
// with every key made optional (a model may patch a subset), still
// rejecting unknown keys (each per-node-type schema below is derived via
// `.partial()` from the REAL v2 node schema, which stays `.strict()`).
// statsChart is the one exception: its attrs is itself a `chartType`-keyed
// discriminated union (see visual-nodes.ts), so a patch must still name a
// chartType (there is no way to know which per-chartType shape the rest of
// `attrs` belongs to otherwise) while every other field becomes optional.
type DistributivePatch<T, DiscriminantKey extends keyof T> = T extends unknown
  ? { readonly [K in DiscriminantKey]: T[K] } & Partial<Omit<T, DiscriminantKey>>
  : never;

export type AiStatsChartAttrsPatchV2 = DistributivePatch<AiStatsChartSpecV2, "chartType">;

export type AiNodeAttrsPatchV2 =
  | { readonly nodeType: "heading"; readonly attrs: Partial<AiHeadingNodeV2["attrs"]> }
  | {
      readonly nodeType: "orderedList";
      readonly attrs: Partial<NonNullable<AiOrderedListNodeV2["attrs"]>>;
    }
  | {
      readonly nodeType: "blockquote";
      readonly attrs: Partial<NonNullable<AiBlockquoteNodeV2["attrs"]>>;
    }
  | { readonly nodeType: "codeBlock"; readonly attrs: Partial<AiCodeBlockNodeV2["attrs"]> }
  | { readonly nodeType: "blockMath"; readonly attrs: Partial<AiBlockMathNodeV2["attrs"]> }
  | {
      readonly nodeType: "horizontalRule";
      readonly attrs: Partial<NonNullable<AiHorizontalRuleNodeV2["attrs"]>>;
    }
  | { readonly nodeType: "inlineMath"; readonly attrs: Partial<AiInlineMathNodeV2["attrs"]> }
  | { readonly nodeType: "callout"; readonly attrs: Partial<AiCalloutNodeV2["attrs"]> }
  | { readonly nodeType: "questionItem"; readonly attrs: Partial<AiQuestionItemAttrsV2> }
  | { readonly nodeType: "table"; readonly attrs: Partial<NonNullable<AiTableNodeV2["attrs"]>> }
  | {
      readonly nodeType: "tableRow";
      readonly attrs: Partial<NonNullable<AiTableRowNodeV2["attrs"]>>;
    }
  | { readonly nodeType: "tableHeader"; readonly attrs: Partial<AiTableCellAttributesV2> }
  | { readonly nodeType: "tableCell"; readonly attrs: Partial<AiTableCellAttributesV2> }
  | { readonly nodeType: "footnote"; readonly attrs: Partial<AiFootnoteNodeV2["attrs"]> }
  | { readonly nodeType: "crossRef"; readonly attrs: Partial<AiCrossRefNodeV2["attrs"]> }
  | {
      readonly nodeType: "footnoteReference";
      readonly attrs: Partial<AiFootnoteReferenceNodeV2["attrs"]>;
    }
  | { readonly nodeType: "questionBlank"; readonly attrs: Partial<AiQuestionBlankNodeV2["attrs"]> }
  | { readonly nodeType: "mermaid"; readonly attrs: Partial<AiMermaidNodeV2["attrs"]> }
  | { readonly nodeType: "functionPlot"; readonly attrs: Partial<AiFunctionPlotNodeV2["attrs"]> }
  | { readonly nodeType: "statsChart"; readonly attrs: AiStatsChartAttrsPatchV2 };

export type AiEditOperationV1 =
  | {
      readonly type: "insertNode";
      readonly parentRef: string;
      readonly index: number;
      readonly node: AiNodeV2;
      readonly localRef?: string;
    }
  | { readonly type: "replaceNode"; readonly targetRef: string; readonly node: AiNodeV2 }
  | { readonly type: "deleteNode"; readonly targetRef: string }
  | {
      readonly type: "moveNode";
      readonly targetRef: string;
      readonly newParentRef: string;
      readonly index: number;
    }
  | ({ readonly type: "updateAttrs"; readonly targetRef: string } & AiNodeAttrsPatchV2)
  | {
      readonly type: "replaceText";
      readonly targetRef: string;
      readonly text: string;
      readonly marks: readonly AiMarkV2[];
    };

export const AI_EDIT_OPERATIONS_V1_VERSION = "anvilnote.ai.edit-operations.v1" as const;

export interface AiEditOperationsResultV1 {
  readonly version: typeof AI_EDIT_OPERATIONS_V1_VERSION;
  readonly operations: readonly AiEditOperationV1[];
}

// --- Deriving per-node-type attrs patch schemas from the REAL v2 schemas --
//
// Rather than re-declaring each node type's attrs shape a second time here
// (which would drift the moment document/v2's own schemas change), every
// patch schema below is derived at module-load time directly from the same
// schema objects core-nodes.ts/structured-nodes.ts/visual-nodes.ts/
// reference-nodes.ts already register — `.partial()`'d so a model may
// supply a SUBSET of a node's attrs, but still `.strict()` (unknown keys
// keep failing) since Zod's `.partial()` only relaxes required-ness, not
// unknown-key handling.
type AnyZodObjectLike = z.ZodObject<z.ZodRawShape>;

function isZodObject(value: unknown): value is AnyZodObjectLike {
  return value instanceof z.ZodObject;
}

function findNodeSchemaByType(
  schemas: readonly z.ZodTypeAny[],
  nodeType: string,
): AnyZodObjectLike {
  const found = schemas.find((schema) => {
    if (!isZodObject(schema)) return false;
    const typeField = schema.shape.type as z.ZodTypeAny | undefined;
    return typeField ? typeField.safeParse(nodeType).success : false;
  });
  if (!found || !isZodObject(found)) {
    throw new Error(
      `AI edit operations: no v2 node schema is registered for type "${nodeType}" — cannot derive an attrs-patch schema for it.`,
    );
  }
  return found;
}

function partialAttrsObjectSchema(nodeSchema: AnyZodObjectLike): AnyZodObjectLike {
  const attrsField = nodeSchema.shape.attrs as z.ZodTypeAny | undefined;
  if (!attrsField) {
    throw new Error("AI edit operations: node schema has no attrs field to patch.");
  }
  const unwrapped = attrsField instanceof z.ZodOptional ? attrsField.unwrap() : attrsField;
  if (!isZodObject(unwrapped)) {
    throw new Error("AI edit operations: attrs field is not a plain object schema.");
  }
  // Some attrs schemas carry an object-level cross-field refinement (e.g.
  // structured-nodes.ts's tableCellAttributesSchema checks colwidth.length
  // against colspan; visual-nodes.ts's functionPlot attrs checks xMin <
  // xMax) — Zod's own `.partial()` refuses to run on a schema with attached
  // refinements at all. Rebuilding a fresh object from just the field SHAPE
  // (bypassing the refinement) before calling `.partial()` sidesteps that,
  // and is also the semantically correct choice here regardless: a
  // cross-field invariant can't be meaningfully checked against a possibly
  // partial patch (the other field's final, post-merge value isn't known
  // until apply-time), so patch schemas never re-run these checks.
  return z.object(unwrapped.shape).strict().partial();
}

const ALL_NODE_SCHEMAS_V2: readonly z.ZodTypeAny[] = [
  ...coreBlockSchemasV2,
  ...structuredBlockSchemasV2,
  ...visualBlockSchemasV2,
  ...coreInlineSchemasV2,
  ...referenceInlineSchemasV2,
];

// Every editable v2 node type that carries a plain-object `attrs` shape a
// model could patch a subset of. Nodes with no `attrs` field at all
// (paragraph/text/bulletList/listItem/choiceList/choiceItem/footnotes/
// question/proof/hardBreak/inlineBlank) have nothing to patch and are
// deliberately absent — updateAttrs only ever targets a node kind that
// actually declares attrs. statsChart is handled separately below (its
// attrs is a chartType-discriminated union, not a plain object).
const SIMPLE_ATTRS_PATCH_NODE_TYPES = [
  "heading",
  "orderedList",
  "blockquote",
  "codeBlock",
  "blockMath",
  "horizontalRule",
  "inlineMath",
  "callout",
  "questionItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "footnote",
  "crossRef",
  "footnoteReference",
  "questionBlank",
  "mermaid",
  "functionPlot",
] as const;

const attrsPatchSchemaByNodeType = new Map<string, z.ZodTypeAny>();
for (const nodeType of SIMPLE_ATTRS_PATCH_NODE_TYPES) {
  const nodeSchema = findNodeSchemaByType(ALL_NODE_SCHEMAS_V2, nodeType);
  attrsPatchSchemaByNodeType.set(nodeType, partialAttrsObjectSchema(nodeSchema));
}

const statsChartNodeSchema = findNodeSchemaByType(ALL_NODE_SCHEMAS_V2, "statsChart");
const statsChartAttrsUnion = statsChartNodeSchema.shape.attrs;
if (!(statsChartAttrsUnion instanceof z.ZodDiscriminatedUnion)) {
  throw new Error("AI edit operations: expected statsChart attrs to be a discriminated union.");
}
const statsChartPatchVariants = statsChartAttrsUnion.options.map((variant) => {
  if (!isZodObject(variant)) {
    throw new Error(
      "AI edit operations: expected every statsChart chartType variant to be an object schema.",
    );
  }
  return variant.partial().extend({ chartType: variant.shape.chartType });
});
attrsPatchSchemaByNodeType.set(
  "statsChart",
  z.discriminatedUnion(
    "chartType",
    statsChartPatchVariants as unknown as [AnyZodObjectLike, ...AnyZodObjectLike[]],
  ),
);

const ATTRS_PATCH_NODE_TYPE_NAMES = [...SIMPLE_ATTRS_PATCH_NODE_TYPES, "statsChart"] as const;

// Defensive, cheap cross-check against the single source of truth for which
// node types are protected images (capability-manifest.ts) — if that
// manifest ever grew a new protected-image entry that collided with this
// list (it never should, by construction), fail loudly at module load
// rather than silently allowing an updateAttrs patch onto a protected node.
for (const nodeType of ATTRS_PATCH_NODE_TYPE_NAMES) {
  if (AI_NODE_CAPABILITIES[nodeType] === "protected-image") {
    throw new Error(
      `AI edit operations: "${nodeType}" is a protected-image node and must never be an updateAttrs target.`,
    );
  }
}

const refStringSchema = z.string().trim().min(1).max(512);

const anyNodeV2Schema: z.ZodType<AiNodeV2> = z.union([
  blockNodeV2Reference,
  inlineNodeV2Reference,
]) as z.ZodType<AiNodeV2>;

function isProtectedImageNodeType(nodeType: unknown): nodeType is string {
  return typeof nodeType === "string" && AI_NODE_CAPABILITIES[nodeType] === "protected-image";
}

// Reused by insertNode/replaceNode: images are 100% AI-untouchable, so
// rejecting a `node` of type "image"/"imageRow" is checked EXPLICITLY here
// (cross-checked against AI_NODE_CAPABILITIES, not hardcoded) rather than
// relying only on the fact that the v2 block/inline unions simply don't
// register an image schema at all (which would already reject it, just
// with a generic "invalid union discriminator" message instead of a clear
// unsupported_image_edit one).
function validateNodePayload(
  node: unknown,
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  const rawType = (node as { type?: unknown } | null)?.type;
  if (isProtectedImageNodeType(rawType)) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "type"],
      message: `unsupported_image_edit: "${String(rawType)}" nodes can never be a typed edit-operation payload — images are 100% AI-untouchable.`,
    });
    return;
  }
  const result = anyNodeV2Schema.safeParse(node);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: "custom", path: [...path, ...issue.path], message: issue.message });
    }
  }
}

const insertNodeOpSchema = z
  .object({
    type: z.literal("insertNode"),
    parentRef: refStringSchema,
    index: z.number().int().min(0),
    node: z.unknown(),
    localRef: refStringSchema.optional(),
  })
  .strict()
  .superRefine((op, ctx) => validateNodePayload(op.node, ctx, ["node"]));

const replaceNodeOpSchema = z
  .object({
    type: z.literal("replaceNode"),
    targetRef: refStringSchema,
    node: z.unknown(),
  })
  .strict()
  .superRefine((op, ctx) => validateNodePayload(op.node, ctx, ["node"]));

const deleteNodeOpSchema = z
  .object({
    type: z.literal("deleteNode"),
    targetRef: refStringSchema,
  })
  .strict();

const moveNodeOpSchema = z
  .object({
    type: z.literal("moveNode"),
    targetRef: refStringSchema,
    newParentRef: refStringSchema,
    index: z.number().int().min(0),
  })
  .strict();

const updateAttrsOpSchema = z
  .object({
    type: z.literal("updateAttrs"),
    targetRef: refStringSchema,
    nodeType: z.enum(ATTRS_PATCH_NODE_TYPE_NAMES),
    attrs: z.unknown(),
  })
  .strict()
  .superRefine((op, ctx) => {
    const patchSchema = attrsPatchSchemaByNodeType.get(op.nodeType);
    if (!patchSchema) {
      ctx.addIssue({
        code: "custom",
        path: ["nodeType"],
        message: `Unknown attrs-patch node type "${op.nodeType}".`,
      });
      return;
    }
    const result = patchSchema.safeParse(op.attrs);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: "custom", path: ["attrs", ...issue.path], message: issue.message });
      }
    }
  });

// Mirrors core-nodes.ts's textNodeSchema bounds and mark-uniqueness rule
// exactly — replaceText overwrites a single text node's own text + marks.
const replaceTextOpSchema = z
  .object({
    type: z.literal("replaceText"),
    targetRef: refStringSchema,
    text: z.string().min(1).max(250_000),
    marks: z.array(aiMarkV2Schema).max(16),
  })
  .strict()
  .superRefine((op, ctx) => {
    const markTypes = op.marks.map((mark) => mark.type);
    if (new Set(markTypes).size !== markTypes.length) {
      ctx.addIssue({ code: "custom", path: ["marks"], message: "Text marks must be unique." });
    }
  });

const editOperationSchema: z.ZodType<AiEditOperationV1> = z.discriminatedUnion("type", [
  insertNodeOpSchema,
  replaceNodeOpSchema,
  deleteNodeOpSchema,
  moveNodeOpSchema,
  updateAttrsOpSchema,
  replaceTextOpSchema,
]) as z.ZodType<AiEditOperationV1>;

const editOperationsEnvelopeSchema = z
  .object({
    version: z.literal(AI_EDIT_OPERATIONS_V1_VERSION),
    operations: z.array(editOperationSchema).max(AI_EDIT_LIMITS.maxOperations),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const seenLocalRefs = new Set<string>();
    envelope.operations.forEach((op, index) => {
      if (op.type !== "insertNode" || !op.localRef) return;
      if (seenLocalRefs.has(op.localRef)) {
        ctx.addIssue({
          code: "custom",
          path: ["operations", index, "localRef"],
          message: `Duplicate localRef "${op.localRef}" — insertNode localRefs must be unique within a single edit-operations batch.`,
        });
        return;
      }
      seenLocalRefs.add(op.localRef);
    });
  });

// `node`/`attrs` are declared `z.unknown()` above (so validateNodePayload's
// superRefine can surface a clear unsupported_image_edit message instead of
// Zod's generic union-mismatch one) — which means Zod's own `.parse()`
// passes them through UNTRANSFORMED (no trimming, etc.). This re-derives
// the fully-parsed/transformed value for those two fields, once the
// envelope has already fully validated successfully, so callers see the
// same normalized shape parseDocumentV2 itself would have produced.
function materializeOperation(op: AiEditOperationV1): AiEditOperationV1 {
  if (op.type === "insertNode" || op.type === "replaceNode") {
    return { ...op, node: anyNodeV2Schema.parse(op.node) };
  }
  if (op.type === "updateAttrs") {
    const patchSchema = attrsPatchSchemaByNodeType.get(op.nodeType);
    /* istanbul ignore next -- unreachable: schema validation above already guarantees a match */
    if (!patchSchema) return op;
    return { ...op, attrs: patchSchema.parse(op.attrs) } as AiEditOperationV1;
  }
  return op;
}

export function parseEditOperationsV1(value: unknown): AiEditOperationsResultV1 {
  const envelope = editOperationsEnvelopeSchema.parse(value);
  return {
    version: envelope.version,
    operations: envelope.operations.map(materializeOperation),
  };
}
