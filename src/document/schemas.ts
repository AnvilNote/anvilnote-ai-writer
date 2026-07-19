import { z } from "zod";
import type { AnvilNoteDocumentV1 } from "./document-v1";
import type { AnvilNoteDocumentFragmentV1 } from "./fragment-v1";
import {
  ANVIL_NOTE_SIMPLE_MARK_TYPES,
  type AnvilNoteMarkV1,
} from "./marks-v1";
import { ANVIL_NOTE_CALLOUT_KINDS } from "./callouts-v1";
import {
  ANVIL_NOTE_QUESTION_KINDS,
  ANVIL_NOTE_WRITTEN_MODES,
} from "./questions-v1";
import type { AnvilNoteBlockNodeV1, AnvilNoteInlineNodeV1 } from "./nodes-v1";
import {
  addDocumentLimitIssues,
  addDocumentStructureIssues,
  addTableGeometryIssues,
} from "./validators";

const simpleMarkSchemas = ANVIL_NOTE_SIMPLE_MARK_TYPES.map(
  (type) => z.object({ type: z.literal(type) }).strict(),
);

const linkMarkSchema = z
  .object({
    type: z.literal("link"),
    attrs: z
      .object({
        href: z.string().trim().min(1).max(4096),
        title: z.string().max(1024).nullable().optional(),
        target: z.enum(["_blank", "_self"]).nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((mark, context) => {
    try {
      const protocol = new URL(mark.attrs.href).protocol;
      if (!new Set(["https:", "http:", "mailto:"]).has(protocol)) {
        context.addIssue({
          code: "custom",
          path: ["attrs", "href"],
          message: "Unsafe link protocol.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["attrs", "href"],
        message: "Invalid link URL.",
      });
    }
  });

export const AnvilNoteMarkV1Schema: z.ZodType<AnvilNoteMarkV1> = z.union([
  ...simpleMarkSchemas,
  linkMarkSchema,
]) as z.ZodType<AnvilNoteMarkV1>;

const textNodeSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(250_000),
    marks: z.array(AnvilNoteMarkV1Schema).max(16).optional(),
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

export const AnvilNoteInlineNodeV1Schema: z.ZodType<AnvilNoteInlineNodeV1> =
  z.discriminatedUnion("type", [
    textNodeSchema,
    hardBreakNodeSchema,
    inlineMathNodeSchema,
  ]);

let blockNodeSchema: z.ZodType<AnvilNoteBlockNodeV1>;
const blockReference = z.lazy(() => blockNodeSchema);

const paragraphSchema = z
  .object({
    type: z.literal("paragraph"),
    content: z.array(AnvilNoteInlineNodeV1Schema).max(10_000),
  })
  .strict();

const headingSchema = z
  .object({
    type: z.literal("heading"),
    attrs: z
      .object({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        id: z.string().trim().min(1).max(256).nullable().optional(),
      })
      .strict(),
    content: z.array(AnvilNoteInlineNodeV1Schema).max(1_000),
  })
  .strict();

const listItemSchema = z
  .object({
    type: z.literal("listItem"),
    content: z.array(blockReference).min(1).max(1_000),
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
    content: z.array(blockReference).min(1).max(1_000),
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

const mathBlockSchema = z
  .object({
    type: z.literal("mathBlock"),
    attrs: z
      .object({
        latex: z.string().min(1).max(100_000),
        id: z.string().trim().min(1).max(256).nullable().optional(),
        equationNumber: z.string().trim().min(1).max(64).nullable().optional(),
        refName: z.string().trim().min(1).max(256).nullable().optional(),
      })
      .strict(),
  })
  .strict();

const calloutSchema = z
  .object({
    type: z.literal("callout"),
    attrs: z
      .object({
        kind: z.enum(ANVIL_NOTE_CALLOUT_KINDS),
        title: z.string().trim().min(1).max(1_024).nullable(),
      })
      .strict(),
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();

const proofSchema = z
  .object({
    type: z.literal("proof"),
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();

const choiceItemSchema = z
  .object({
    type: z.literal("choiceItem"),
    content: z.array(z.union([paragraphSchema, mathBlockSchema])).length(1),
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
  })
  .strict();

const QUESTION_BODY_TYPES = new Set([
  "paragraph",
  "bulletList",
  "orderedList",
  "codeBlock",
  "mathBlock",
]);

const questionItemSchema = z
  .object({
    type: z.literal("questionItem"),
    attrs: questionItemAttributesSchema,
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict()
  .superRefine((item, context) => {
    const choiceIndexes: number[] = [];
    for (const [index, child] of item.content.entries()) {
      if (child.type === "choiceList") {
        choiceIndexes.push(index);
      } else if (!QUESTION_BODY_TYPES.has(child.type)) {
        context.addIssue({
          code: "custom",
          path: ["content", index],
          message: `${child.type} is not allowed in a question body.`,
        });
      }
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
      .object({
        rowHeight: z.number().min(17).max(2_000).nullable().optional(),
      })
      .strict()
      .optional(),
    content: z.array(z.union([tableHeaderSchema, tableCellSchema])).max(1_000),
  })
  .strict();

const tableSchema = z
  .object({
    type: z.literal("table"),
    attrs: z
      .object({
        id: z.string().trim().min(1).max(256).nullable().optional(),
        caption: z.string().max(10_000).optional(),
        variant: z.enum(["normal", "three-line"]).optional(),
        align: z.enum(["left", "center", "right"]).optional(),
      })
      .strict()
      .optional(),
    content: z.array(tableRowSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine(addTableGeometryIssues);

const horizontalRuleSchema = z
  .object({
    type: z.literal("horizontalRule"),
    attrs: z
      .object({
        thicknessPt: z.number().positive().max(100).optional(),
        lineStyle: z.enum(["solid", "dashed", "dotted", "dashdot"]).optional(),
      })
      .strict()
      .optional(),
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
  horizontalRuleSchema,
]) as z.ZodType<AnvilNoteBlockNodeV1>;

export const AnvilNoteBlockNodeV1Schema: z.ZodType<AnvilNoteBlockNodeV1> =
  blockNodeSchema;

export const AnvilNoteDocumentV1Schema: z.ZodType<AnvilNoteDocumentV1> = z
  .object({
    schemaVersion: z.literal("anvilnote.document.v1"),
    type: z.literal("doc"),
    content: z.array(AnvilNoteBlockNodeV1Schema).min(1).max(10_000),
  })
  .strict()
  .superRefine(addDocumentStructureIssues)
  .superRefine(addDocumentLimitIssues);

export const AnvilNoteDocumentFragmentV1Schema: z.ZodType<AnvilNoteDocumentFragmentV1> =
  z
    .object({
      schemaVersion: z.literal("anvilnote.fragment.v1"),
      type: z.literal("fragment"),
      content: z.array(AnvilNoteBlockNodeV1Schema).min(1).max(10_000),
    })
    .strict()
    .superRefine(addDocumentStructureIssues)
    .superRefine(addDocumentLimitIssues);
