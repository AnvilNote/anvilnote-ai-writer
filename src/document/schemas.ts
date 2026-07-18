import { z } from "zod";
import type { AnvilNoteDocumentV1 } from "./document-v1";
import type { AnvilNoteDocumentFragmentV1 } from "./fragment-v1";
import type { AnvilNoteMarkV1 } from "./marks-v1";
import type {
  AnvilNoteBlockNodeV1,
  AnvilNoteInlineNodeV1,
  AnvilNoteListItemNodeV1,
  AnvilNoteTableCellNodeV1,
  AnvilNoteTableHeaderNodeV1,
  AnvilNoteTableRowNodeV1,
} from "./nodes-v1";
import {
  addDocumentLimitIssues,
  addDocumentStructureIssues,
  addTableGeometryIssues,
} from "./validators";

const simpleMarkSchemas = ["bold", "italic", "strike", "code", "underline"].map(
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
    text: z.string().max(250_000),
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

const listItemSchema: z.ZodType<AnvilNoteListItemNodeV1> = z
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

const tableHeaderSchema: z.ZodType<AnvilNoteTableHeaderNodeV1> = z
  .object({
    type: z.literal("tableHeader"),
    attrs: tableCellAttributesSchema,
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();

const tableCellSchema: z.ZodType<AnvilNoteTableCellNodeV1> = z
  .object({
    type: z.literal("tableCell"),
    attrs: tableCellAttributesSchema,
    content: z.array(blockReference).min(1).max(1_000),
  })
  .strict();

const tableRowSchema: z.ZodType<AnvilNoteTableRowNodeV1> = z
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

blockNodeSchema = z.union([
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
