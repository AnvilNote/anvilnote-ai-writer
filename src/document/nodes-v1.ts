import type { AnvilNoteMarkV1 } from "./marks-v1";
import type { AnvilNoteCalloutKindV1 } from "./callouts-v1";
import type {
  AnvilNoteQuestionKindV1,
  AnvilNoteWrittenModeV1,
} from "./questions-v1";

export interface AnvilNoteTextNodeV1 {
  type: "text";
  text: string;
  marks?: AnvilNoteMarkV1[];
}

export interface AnvilNoteHardBreakNodeV1 {
  type: "hardBreak";
}

export interface AnvilNoteInlineMathNodeV1 {
  type: "inlineMath";
  attrs: {
    latex: string;
  };
}

export type AnvilNoteInlineNodeV1 =
  AnvilNoteTextNodeV1 | AnvilNoteHardBreakNodeV1 | AnvilNoteInlineMathNodeV1;

export interface AnvilNoteParagraphNodeV1 {
  type: "paragraph";
  content: AnvilNoteInlineNodeV1[];
}

export interface AnvilNoteHeadingNodeV1 {
  type: "heading";
  attrs: {
    level: 1 | 2 | 3;
    id?: string | null;
  };
  content: AnvilNoteInlineNodeV1[];
}

export interface AnvilNoteBulletListNodeV1 {
  type: "bulletList";
  content: AnvilNoteListItemNodeV1[];
}

export interface AnvilNoteOrderedListNodeV1 {
  type: "orderedList";
  attrs?: {
    start?: number;
  };
  content: AnvilNoteListItemNodeV1[];
}

export interface AnvilNoteListItemNodeV1 {
  type: "listItem";
  content: AnvilNoteBlockNodeV1[];
}

export interface AnvilNoteBlockquoteNodeV1 {
  type: "blockquote";
  content: AnvilNoteBlockNodeV1[];
}

export interface AnvilNoteCodeBlockNodeV1 {
  type: "codeBlock";
  attrs: {
    language: string;
  };
  content: AnvilNoteTextNodeV1[];
}

export interface AnvilNoteMathBlockNodeV1 {
  type: "mathBlock";
  attrs: {
    latex: string;
    id?: string | null;
    equationNumber?: string | null;
    refName?: string | null;
  };
}

export type AnvilNoteCalloutContentNodeV1 =
  | AnvilNoteParagraphNodeV1
  | AnvilNoteBulletListNodeV1
  | AnvilNoteOrderedListNodeV1
  | AnvilNoteCodeBlockNodeV1
  | AnvilNoteMathBlockNodeV1;

export interface AnvilNoteCalloutNodeV1 {
  type: "callout";
  attrs: {
    kind: AnvilNoteCalloutKindV1;
    title: string | null;
  };
  content: AnvilNoteCalloutContentNodeV1[];
}

export type AnvilNoteProofContentNodeV1 =
  | AnvilNoteParagraphNodeV1
  | AnvilNoteBulletListNodeV1
  | AnvilNoteOrderedListNodeV1
  | AnvilNoteCodeBlockNodeV1
  | AnvilNoteMathBlockNodeV1;

export interface AnvilNoteProofNodeV1 {
  type: "proof";
  content: AnvilNoteProofContentNodeV1[];
}

export type AnvilNoteQuestionBodyNodeV1 =
  | AnvilNoteParagraphNodeV1
  | AnvilNoteBulletListNodeV1
  | AnvilNoteOrderedListNodeV1
  | AnvilNoteCodeBlockNodeV1
  | AnvilNoteMathBlockNodeV1;

export interface AnvilNoteChoiceItemNodeV1 {
  type: "choiceItem";
  content: [AnvilNoteParagraphNodeV1 | AnvilNoteMathBlockNodeV1];
}

export interface AnvilNoteChoiceListNodeV1 {
  type: "choiceList";
  content: AnvilNoteChoiceItemNodeV1[];
}

export interface AnvilNoteQuestionItemNodeV1 {
  type: "questionItem";
  attrs: {
    kind: AnvilNoteQuestionKindV1;
    writtenMode: AnvilNoteWrittenModeV1;
    writtenLines: number;
    writtenHeightPercent: number;
    writtenHeightCm: number | null;
    multiForceOneColumn: boolean;
  };
  content: Array<AnvilNoteQuestionBodyNodeV1 | AnvilNoteChoiceListNodeV1>;
}

export interface AnvilNoteQuestionNodeV1 {
  type: "question";
  content: AnvilNoteQuestionItemNodeV1[];
}

export type AnvilNoteTableVariantV1 = "normal" | "three-line";
export type AnvilNoteTableAlignV1 = "left" | "center" | "right";

export interface AnvilNoteTableNodeV1 {
  type: "table";
  attrs?: {
    id?: string | null;
    caption?: string;
    variant?: AnvilNoteTableVariantV1;
    align?: AnvilNoteTableAlignV1;
  };
  content: AnvilNoteTableRowNodeV1[];
}

export interface AnvilNoteTableRowNodeV1 {
  type: "tableRow";
  attrs?: {
    rowHeight?: number | null;
  };
  content: Array<AnvilNoteTableHeaderNodeV1 | AnvilNoteTableCellNodeV1>;
}

export interface AnvilNoteTableCellAttributesV1 {
  colspan: number;
  rowspan: number;
  colwidth?: number[] | null;
}

export interface AnvilNoteTableHeaderNodeV1 {
  type: "tableHeader";
  attrs: AnvilNoteTableCellAttributesV1;
  content: AnvilNoteBlockNodeV1[];
}

export interface AnvilNoteTableCellNodeV1 {
  type: "tableCell";
  attrs: AnvilNoteTableCellAttributesV1;
  content: AnvilNoteBlockNodeV1[];
}

export interface AnvilNoteHorizontalRuleNodeV1 {
  type: "horizontalRule";
  attrs?: {
    thicknessPt?: number;
    lineStyle?: "solid" | "dashed" | "dotted" | "dashdot";
  };
}

export type AnvilNoteBlockNodeV1 =
  | AnvilNoteParagraphNodeV1
  | AnvilNoteHeadingNodeV1
  | AnvilNoteBulletListNodeV1
  | AnvilNoteOrderedListNodeV1
  | AnvilNoteListItemNodeV1
  | AnvilNoteBlockquoteNodeV1
  | AnvilNoteCodeBlockNodeV1
  | AnvilNoteMathBlockNodeV1
  | AnvilNoteCalloutNodeV1
  | AnvilNoteProofNodeV1
  | AnvilNoteQuestionNodeV1
  | AnvilNoteQuestionItemNodeV1
  | AnvilNoteChoiceListNodeV1
  | AnvilNoteChoiceItemNodeV1
  | AnvilNoteTableNodeV1
  | AnvilNoteTableRowNodeV1
  | AnvilNoteTableHeaderNodeV1
  | AnvilNoteTableCellNodeV1
  | AnvilNoteHorizontalRuleNodeV1;
