import { z } from "zod";
import { registerInlineSchemasV2 } from "./document";

// Canonical AI document v2 — strict reference/blank inline nodes (crossRef,
// footnoteReference, questionBlank, inlineBlank). See
// capability-manifest.ts's header comment for the overall picture.
//
// Real editor attrs for crossRef/questionBlank/footnoteReference are
// `targetId` (crossRef/questionBlank, cross-ref.ts/question-blank.ts) or
// `data-id` (footnoteReference, tiptap-footnotes) — always a machine-
// generated stable id the AI could never legitimately author. Per this
// task's plan text, the PROVIDER-writable attr is instead `targetRef`: a
// human/model-friendly local name (matching a `localRef` attr the target
// node carries — see core-nodes.ts's AiHeadingNodeV2/AiBlockMathNodeV2 and
// structured-nodes.ts's AiTableNodeV2/AiQuestionItemNodeV2/AiFootnoteNodeV2)
// that a later materializeReferences() task resolves into the real trusted
// stable id. `resolvedKind`/`resolvedValue`/`broken` (crossRef) and
// `resolvedValue`/`broken` (questionBlank) are derived, recomputed on every
// doc change by the real editor's own resolver plugin — never accepted as
// input here (enforced by `.strict()`, since they're simply absent from the
// attrs shape below).
export interface AiCrossRefNodeV2 {
  readonly type: "crossRef";
  readonly attrs: {
    readonly targetRef: string;
  };
}

export interface AiFootnoteReferenceNodeV2 {
  readonly type: "footnoteReference";
  readonly attrs: {
    readonly targetRef: string;
  };
}

export interface AiQuestionBlankNodeV2 {
  readonly type: "questionBlank";
  readonly attrs: {
    readonly targetRef: string;
  };
}

export interface AiInlineBlankNodeV2 {
  readonly type: "inlineBlank";
}

export type AiReferenceInlineNodeV2 =
  | AiCrossRefNodeV2
  | AiFootnoteReferenceNodeV2
  | AiQuestionBlankNodeV2
  | AiInlineBlankNodeV2;

const targetRefAttrSchema = z.string().trim().min(1).max(256);

const crossRefSchema = z
  .object({
    type: z.literal("crossRef"),
    attrs: z.object({ targetRef: targetRefAttrSchema }).strict(),
  })
  .strict();

const footnoteReferenceSchema = z
  .object({
    type: z.literal("footnoteReference"),
    attrs: z.object({ targetRef: targetRefAttrSchema }).strict(),
  })
  .strict();

const questionBlankSchema = z
  .object({
    type: z.literal("questionBlank"),
    attrs: z.object({ targetRef: targetRefAttrSchema }).strict(),
  })
  .strict();

const inlineBlankSchema = z.object({ type: z.literal("inlineBlank") }).strict();

export const referenceInlineSchemasV2 = [
  crossRefSchema,
  footnoteReferenceSchema,
  questionBlankSchema,
  inlineBlankSchema,
] as const;

registerInlineSchemasV2(referenceInlineSchemasV2);
