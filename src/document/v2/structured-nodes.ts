import { z } from "zod";
import { ANVIL_NOTE_CALLOUT_KINDS, type AnvilNoteCalloutKindV1 } from "../callouts-v1";
import {
  ANVIL_NOTE_QUESTION_KINDS,
  ANVIL_NOTE_WRITTEN_MODES,
  type AnvilNoteQuestionKindV1,
  type AnvilNoteWrittenModeV1,
} from "../questions-v1";
import {
  blockMathSchema,
  paragraphSchema,
  type AiBlockMathNodeV2,
  type AiParagraphNodeV2,
} from "./core-nodes";
import { blockNodeV2Reference, registerBlockSchemasV2 } from "./document";
import type { AiBlockNodeV2 } from "./document";
import { hexColorV2Schema } from "./marks";

// Canonical AI document v2 — strict educational, reference and table nodes
// (callout/proof/question hierarchy/table hierarchy/footnote hierarchy).
// See capability-manifest.ts's header comment for the overall picture.
//
// Reuses V1's callout-kind/question-kind/written-mode string-literal unions
// directly (callouts-v1.ts/questions-v1.ts) rather than redefining an
// identical list under a new V2 name — these are plain enum-style data
// constants with no V1-schema coupling (the real editor's callout palette
// and question kinds haven't changed between V1 and V2; re-verified against
// anvilnote-web's config/callouts.ts and lib/question-kinds.ts).
//
// AiBlockNodeV2 is imported (type-only) from document.ts for callout/proof/
// questionItem/table-cell content — TypeScript allows mutually-recursive
// TYPE aliases across files freely (unlike runtime value circular imports,
// see document.ts's own header comment on why THOSE need the registry
// pattern); a type-only import has no runtime presence at all, so there is
// no evaluation-order hazard here.

export type AiCalloutKindV2 = AnvilNoteCalloutKindV1;
export type AiQuestionKindV2 = AnvilNoteQuestionKindV1;
export type AiWrittenModeV2 = AnvilNoteWrittenModeV1;

export interface AiCalloutNodeV2 {
  readonly type: "callout";
  readonly attrs: {
    readonly kind: AiCalloutKindV2;
    readonly title: string | null;
  };
  // General block content (not narrowed to the real editor's own callout
  // content allow-list) — judgment call, see this task's report: V1's
  // schemas.ts already runtime-permits general block content in a callout
  // (only its narrower TS type, not its zod schema, restricts it), and this
  // task's own reject-list doesn't require a callout/proof descendant-type
  // allow-list, so none was added here either.
  readonly content: readonly AiBlockNodeV2[];
}

export interface AiProofNodeV2 {
  readonly type: "proof";
  readonly content: readonly AiBlockNodeV2[];
}

export interface AiQuestionItemAttrsV2 {
  readonly kind: AiQuestionKindV2;
  readonly writtenMode: AiWrittenModeV2;
  readonly writtenLines: number;
  readonly writtenHeightPercent: number;
  readonly writtenHeightCm: number | null;
  readonly multiForceOneColumn: boolean;
  // See core-nodes.ts's AiHeadingNodeV2.attrs.localRef comment — same
  // crossRef-target mechanism, applied to crossRef's "question" kind.
  readonly localRef?: string | null;
}

export interface AiChoiceItemNodeV2 {
  readonly type: "choiceItem";
  readonly content: readonly [AiParagraphNodeV2 | AiBlockMathNodeV2];
}

export interface AiChoiceListNodeV2 {
  readonly type: "choiceList";
  readonly content: readonly AiChoiceItemNodeV2[];
}

export interface AiQuestionItemNodeV2 {
  readonly type: "questionItem";
  readonly attrs: AiQuestionItemAttrsV2;
  // General block content, PLUS (per the real editor's own questionItem
  // content spec, "block+ choiceList?") an optional trailing choiceList —
  // choiceList is already a member of AiBlockNodeV2 (via AiStructuredBlockV2
  // below), so this doesn't need its own separate union arm.
  readonly content: readonly AiBlockNodeV2[];
}

export interface AiQuestionNodeV2 {
  readonly type: "question";
  readonly content: readonly AiQuestionItemNodeV2[];
}

export type AiTableVariantV2 = "normal" | "three-line";
export type AiTableAlignV2 = "left" | "center" | "right";
export type AiTableCellVerticalAlignV2 = "top" | "middle" | "bottom";

export interface AiTableCellAttributesV2 {
  readonly colspan: number;
  readonly rowspan: number;
  readonly colwidth?: readonly number[] | null;
  readonly fill?: string | null;
  readonly stroke?: string | null;
  readonly inset?: string | null;
  readonly breakable?: boolean | null;
  readonly verticalAlign?: AiTableCellVerticalAlignV2 | null;
}

export interface AiTableHeaderNodeV2 {
  readonly type: "tableHeader";
  readonly attrs: AiTableCellAttributesV2;
  readonly content: readonly AiBlockNodeV2[];
}

export interface AiTableCellNodeV2 {
  readonly type: "tableCell";
  readonly attrs: AiTableCellAttributesV2;
  readonly content: readonly AiBlockNodeV2[];
}

export interface AiTableRowNodeV2 {
  readonly type: "tableRow";
  readonly attrs?: {
    readonly rowHeight?: number | null;
  };
  readonly content: readonly (AiTableHeaderNodeV2 | AiTableCellNodeV2)[];
}

export interface AiTableNodeV2 {
  readonly type: "table";
  readonly attrs?: {
    readonly caption?: string;
    readonly variant?: AiTableVariantV2;
    readonly align?: AiTableAlignV2;
    readonly localRef?: string | null;
  };
  readonly content: readonly AiTableRowNodeV2[];
}

export interface AiFootnoteNodeV2 {
  readonly type: "footnote";
  readonly attrs: {
    readonly localRef: string;
  };
  readonly content: readonly (AiParagraphNodeV2 | AiBlockMathNodeV2)[];
}

export interface AiFootnotesNodeV2 {
  readonly type: "footnotes";
  readonly content: readonly AiFootnoteNodeV2[];
}

export type AiStructuredBlockV2 =
  | AiCalloutNodeV2
  | AiProofNodeV2
  | AiQuestionNodeV2
  | AiQuestionItemNodeV2
  | AiChoiceListNodeV2
  | AiChoiceItemNodeV2
  | AiTableNodeV2
  | AiTableRowNodeV2
  | AiTableHeaderNodeV2
  | AiTableCellNodeV2
  | AiFootnotesNodeV2
  | AiFootnoteNodeV2;

const localRefAttrSchema = z.string().trim().min(1).max(256).nullable().optional();

const calloutSchema = z
  .object({
    type: z.literal("callout"),
    attrs: z
      .object({
        kind: z.enum(ANVIL_NOTE_CALLOUT_KINDS),
        title: z.string().trim().min(1).max(1_024).nullable(),
      })
      .strict(),
    content: z.array(blockNodeV2Reference).min(1).max(1_000),
  })
  .strict();

const proofSchema = z
  .object({
    type: z.literal("proof"),
    content: z.array(blockNodeV2Reference).min(1).max(1_000),
  })
  .strict();

const choiceItemSchema = z
  .object({
    type: z.literal("choiceItem"),
    content: z.tuple([z.union([paragraphSchema, blockMathSchema])]),
  })
  .strict();

const choiceListSchema = z
  .object({
    type: z.literal("choiceList"),
    content: z.array(choiceItemSchema).min(2).max(100),
  })
  .strict();

const questionItemAttributesSchema = z
  .object({
    kind: z.enum(ANVIL_NOTE_QUESTION_KINDS),
    writtenMode: z.enum(ANVIL_NOTE_WRITTEN_MODES),
    writtenLines: z.number().int().min(1).max(100),
    writtenHeightPercent: z.number().min(5).max(100),
    writtenHeightCm: z.number().positive().max(1_000).nullable(),
    multiForceOneColumn: z.boolean(),
    localRef: localRefAttrSchema,
  })
  .strict();

const questionItemSchema = z
  .object({
    type: z.literal("questionItem"),
    attrs: questionItemAttributesSchema,
    content: z.array(blockNodeV2Reference).min(1).max(1_000),
  })
  .strict()
  .superRefine((item, context) => {
    // Mirrors V1's schemas.ts questionItemSchema.superRefine rule exactly
    // (see nodes-v1.ts/questions-v1.ts): a "written" question may never
    // carry a choiceList; a "single"/"multi" question must carry EXACTLY
    // one, and it must be the final content child (matches the real
    // editor's own questionItem content spec, "block+ choiceList?").
    const choiceIndexes: number[] = [];
    for (const [index, child] of item.content.entries()) {
      if (child.type === "choiceList") choiceIndexes.push(index);
    }

    const bodyCount = item.content.length - choiceIndexes.length;
    if (bodyCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "A question item requires at least one body block.",
      });
    }

    if (item.attrs.kind === "written") {
      if (choiceIndexes.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["content", choiceIndexes[0]],
          message: "A written question cannot contain choices.",
        });
      }
      return;
    }

    if (choiceIndexes.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "A choice question requires exactly one choice list.",
      });
      return;
    }
    if (choiceIndexes[0] !== item.content.length - 1) {
      context.addIssue({
        code: "custom",
        path: ["content", choiceIndexes[0]],
        message: "A choice list must be the final question-item child.",
      });
    }
  });

const questionSchema = z
  .object({
    type: z.literal("question"),
    content: z.array(questionItemSchema).min(1).max(100),
  })
  .strict();

// Real-editor cell attrs, verified against anvilnote-web's
// lib/tiptap/extensions.ts (anvilCellAttributes()) and table-attributes.ts:
// fill/stroke are hex colors, inset is a CSS-length string ("4pt"/"0.5em"),
// breakable/verticalAlign are the two remaining per-cell overrides. colspan/
// rowspan/colwidth come from @tiptap/extension-table-cell's own defaults
// (kept from V1's schemas.ts, same numeric bounds).
const CELL_INSET_PATTERN_V2 = /^(?:0|\d+(?:\.\d+)?)(?:pt|px|em|rem)$/;

const tableCellAttributesSchema = z
  .object({
    colspan: z.number().int().min(1).max(100),
    rowspan: z.number().int().min(1).max(100),
    colwidth: z
      .array(z.number().int().min(1).max(10_000))
      .min(1)
      .max(100)
      .nullable()
      .optional(),
    fill: hexColorV2Schema().nullable().optional(),
    stroke: hexColorV2Schema().nullable().optional(),
    inset: z
      .string()
      .regex(CELL_INSET_PATTERN_V2, 'Expected a CSS length like "4pt" or "0.5em".')
      .nullable()
      .optional(),
    breakable: z.boolean().nullable().optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).nullable().optional(),
  })
  .strict()
  .superRefine((attrs, context) => {
    if (attrs.colwidth && attrs.colwidth.length !== attrs.colspan) {
      context.addIssue({
        code: "custom",
        path: ["colwidth"],
        message: "Column widths must match colspan.",
      });
    }
  });

const tableHeaderSchema = z
  .object({
    type: z.literal("tableHeader"),
    attrs: tableCellAttributesSchema,
    content: z.array(blockNodeV2Reference).min(1).max(1_000),
  })
  .strict();

const tableCellSchema = z
  .object({
    type: z.literal("tableCell"),
    attrs: tableCellAttributesSchema,
    content: z.array(blockNodeV2Reference).min(1).max(1_000),
  })
  .strict();

const tableRowSchema = z
  .object({
    type: z.literal("tableRow"),
    attrs: z
      .object({
        rowHeight: z.number().min(17).max(2_000).nullable().optional(),
      })
      .strict()
      .optional(),
    content: z.array(z.union([tableHeaderSchema, tableCellSchema])).min(1).max(1_000),
  })
  .strict();

const tableSchema = z
  .object({
    type: z.literal("table"),
    attrs: z
      .object({
        caption: z.string().max(10_000).optional(),
        variant: z.enum(["normal", "three-line"]).optional(),
        align: z.enum(["left", "center", "right"]).optional(),
        localRef: localRefAttrSchema,
      })
      .strict()
      .optional(),
    content: z.array(tableRowSchema).min(1).max(1_000),
  })
  .strict();

const footnoteSchema = z
  .object({
    type: z.literal("footnote"),
    attrs: z
      .object({
        localRef: z.string().trim().min(1).max(256),
      })
      .strict(),
    content: z.array(z.union([paragraphSchema, blockMathSchema])).min(1).max(1_000),
  })
  .strict();

const footnotesSchema = z
  .object({
    type: z.literal("footnotes"),
    content: z.array(footnoteSchema).min(1).max(1_000),
  })
  .strict();

export const structuredBlockSchemasV2 = [
  calloutSchema,
  proofSchema,
  questionSchema,
  questionItemSchema,
  choiceListSchema,
  choiceItemSchema,
  tableSchema,
  tableRowSchema,
  tableHeaderSchema,
  tableCellSchema,
  footnotesSchema,
  footnoteSchema,
] as const;

registerBlockSchemasV2(structuredBlockSchemasV2);
