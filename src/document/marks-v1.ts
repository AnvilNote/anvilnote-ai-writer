export const ANVIL_NOTE_SIMPLE_MARK_TYPES = [
  "bold",
  "italic",
  "strike",
  "code",
  "underline",
] as const;

export interface AnvilNoteBoldMarkV1 {
  type: "bold";
}

export interface AnvilNoteItalicMarkV1 {
  type: "italic";
}

export interface AnvilNoteStrikeMarkV1 {
  type: "strike";
}

export interface AnvilNoteCodeMarkV1 {
  type: "code";
}

export interface AnvilNoteUnderlineMarkV1 {
  type: "underline";
}

export interface AnvilNoteLinkMarkV1 {
  type: "link";
  attrs: {
    href: string;
    title?: string | null;
    target?: "_blank" | "_self" | null;
  };
}

export type AnvilNoteMarkV1 =
  | AnvilNoteBoldMarkV1
  | AnvilNoteItalicMarkV1
  | AnvilNoteStrikeMarkV1
  | AnvilNoteCodeMarkV1
  | AnvilNoteUnderlineMarkV1
  | AnvilNoteLinkMarkV1;
