import { z } from "zod";
import { aiMarkV2Schema, type AiMarkV2 } from "./marks";
import {
  blockNodeV2Reference,
  inlineNodeV2Reference,
  registerBlockSchemasV2,
  registerInlineSchemasV2,
} from "./document";

// Canonical AI document v2 — strict core nodes (text/marks carriers,
// paragraph, heading, lists, blockquote, code block, math, divider). See
// capability-manifest.ts's header comment for the overall picture and
// document.ts's header comment for why the recursive content arrays below
// go through blockNodeV2Reference/inlineNodeV2Reference (registry-based,
// not a direct cross-file z.lazy(() => otherFilesConst) reference) instead
// of importing document.ts's union types directly.

export interface AiTextNodeV2 {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly AiMarkV2[];
}

export interface AiHardBreakNodeV2 {
  readonly type: "hardBreak";
}

export interface AiInlineMathNodeV2 {
  readonly type: "inlineMath";
  readonly attrs: {
    readonly latex: string;
  };
}

export type AiCoreInlineNodeV2 =
  | AiTextNodeV2
  | AiHardBreakNodeV2
  | AiInlineMathNodeV2;

export interface AiParagraphNodeV2 {
  readonly type: "paragraph";
  readonly attrs?: {
    readonly indent: number;
  };
  readonly content: readonly AiCoreInlineNodeV2[];
}

export interface AiHeadingNodeV2 {
  readonly type: "heading";
  readonly attrs: {
    readonly level: 1 | 2 | 3;
    // Stable, AI-assignable local name used ONLY as a crossRef target
    // (reference-nodes.ts's crossRef.attrs.targetRef) — deliberately NOT
    // named "id": the real editor's own `id` attribute on a heading
    // (cross-ref.ts's CrossRefTargetIds) is backfilled server/plugin-side
    // and must never be accepted as caller input (see this task's own
    // "reject hand-authored stable IDs" requirement). localRef is a
    // completely separate, provider-writable concept — a later
    // materializeReferences() task resolves it to a trusted stable id.
    readonly localRef?: string | null;
  };
  readonly content: readonly AiCoreInlineNodeV2[];
}

export interface AiListItemNodeV2 {
  readonly type: "listItem";
  readonly content: readonly AiCoreBlockV2[];
}

export interface AiBulletListNodeV2 {
  readonly type: "bulletList";
  readonly content: readonly AiListItemNodeV2[];
}

export interface AiOrderedListNodeV2 {
  readonly type: "orderedList";
  readonly attrs?: {
    readonly start?: number;
  };
  readonly content: readonly AiListItemNodeV2[];
}

export interface AiBlockquoteNodeV2 {
  readonly type: "blockquote";
  readonly attrs?: {
    readonly author?: string;
    readonly source?: string;
  };
  readonly content: readonly AiCoreBlockV2[];
}

export interface AiCodeBlockTextNodeV2 {
  readonly type: "text";
  readonly text: string;
}

export interface AiCodeBlockNodeV2 {
  readonly type: "codeBlock";
  readonly attrs: {
    readonly language: string;
  };
  readonly content: readonly AiCodeBlockTextNodeV2[];
}

export interface AiBlockMathNodeV2 {
  readonly type: "blockMath";
  readonly attrs: {
    readonly latex: string;
    readonly refName?: string | null;
    // See AiHeadingNodeV2.attrs.localRef's comment — same crossRef-target
    // mechanism, applied to display equations (crossRef's "equation" kind).
    readonly localRef?: string | null;
  };
}

export type AiDividerLineStyleV2 = "solid" | "dashed" | "dotted" | "dashdot";

export interface AiHorizontalRuleNodeV2 {
  readonly type: "horizontalRule";
  readonly attrs?: {
    readonly thicknessPt?: number;
    readonly lineStyle?: AiDividerLineStyleV2;
  };
}

export type AiCoreBlockV2 =
  | AiParagraphNodeV2
  | AiHeadingNodeV2
  | AiBulletListNodeV2
  | AiOrderedListNodeV2
  | AiListItemNodeV2
  | AiBlockquoteNodeV2
  | AiCodeBlockNodeV2
  | AiBlockMathNodeV2
  | AiHorizontalRuleNodeV2;

const textNodeSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(250_000),
    marks: z.array(aiMarkV2Schema).max(16).optional(),
  })
  .strict()
  .superRefine((node, context) => {
    const markTypes = node.marks?.map((mark) => mark.type) ?? [];
    if (new Set(markTypes).size !== markTypes.length) {
      context.addIssue({
        code: "custom",
        path: ["marks"],
        message: "Text marks must be unique.",
      });
    }
  });

const hardBreakNodeSchema = z.object({ type: z.literal("hardBreak") }).strict();

const inlineMathNodeSchema = z
  .object({
    type: z.literal("inlineMath"),
    attrs: z.object({ latex: z.string().min(1).max(50_000) }).strict(),
  })
  .strict();

export const coreInlineSchemasV2 = [
  textNodeSchema,
  hardBreakNodeSchema,
  inlineMathNodeSchema,
] as const;

const paragraphSchema = z
  .object({
    type: z.literal("paragraph"),
    attrs: z
      .object({
        indent: z.number().int().min(0).max(8),
      })
      .strict()
      .optional(),
    content: z.array(inlineNodeV2Reference).max(10_000),
  })
  .strict();

const localRefAttrSchema = z.string().trim().min(1).max(256).nullable().optional();

const headingSchema = z
  .object({
    type: z.literal("heading"),
    attrs: z
      .object({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        localRef: localRefAttrSchema,
      })
      .strict(),
    content: z.array(inlineNodeV2Reference).max(1_000),
  })
  .strict();

const listItemSchema = z
  .object({
    type: z.literal("listItem"),
    content: z.array(blockNodeV2Reference).min(1).max(1_000),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.content[0]?.type !== "paragraph") {
      context.addIssue({
        code: "custom",
        path: ["content", 0],
        message: "A list item must start with a paragraph.",
      });
    }
  });

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
      .object({ start: z.number().int().positive().max(1_000_000).optional() })
      .strict()
      .optional(),
    content: z.array(listItemSchema).min(1).max(1_000),
  })
  .strict();

const blockquoteSchema = z
  .object({
    type: z.literal("blockquote"),
    attrs: z
      .object({
        author: z.string().max(512).optional(),
        source: z.string().max(512).optional(),
      })
      .strict()
      .optional(),
    content: z.array(blockNodeV2Reference).min(1).max(1_000),
  })
  .strict();

const codeTextNodeSchema = textNodeSchema.superRefine((node, context) => {
  if (node.marks && node.marks.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["marks"],
      message: "Code-block text cannot have marks.",
    });
  }
});

const codeBlockSchema = z
  .object({
    type: z.literal("codeBlock"),
    attrs: z.object({ language: z.string().trim().min(1).max(128) }).strict(),
    content: z.array(codeTextNodeSchema).max(1_000),
  })
  .strict();

const blockMathSchema = z
  .object({
    type: z.literal("blockMath"),
    attrs: z
      .object({
        latex: z.string().min(1).max(100_000),
        refName: z.string().trim().min(1).max(256).nullable().optional(),
        localRef: localRefAttrSchema,
      })
      .strict(),
  })
  .strict();

const DIVIDER_LINE_STYLES_V2 = ["solid", "dashed", "dotted", "dashdot"] as const;

const horizontalRuleSchema = z
  .object({
    type: z.literal("horizontalRule"),
    attrs: z
      .object({
        thicknessPt: z.number().positive().max(100).optional(),
        lineStyle: z.enum(DIVIDER_LINE_STYLES_V2).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const coreBlockSchemasV2 = [
  paragraphSchema,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
  listItemSchema,
  blockquoteSchema,
  codeBlockSchema,
  blockMathSchema,
  horizontalRuleSchema,
] as const;

registerInlineSchemasV2(coreInlineSchemasV2);
registerBlockSchemasV2(coreBlockSchemasV2);

// Exported for reference-nodes.ts/structured-nodes.ts, which need to embed
// blockMath as a valid choiceItem/footnote body element without importing
// the whole block union.
export { blockMathSchema, paragraphSchema };
