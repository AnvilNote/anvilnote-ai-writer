export const ANVIL_NOTE_CALLOUT_KINDS = [
  "note",
  "abstract",
  "info",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;

export type AnvilNoteCalloutKindV1 =
  (typeof ANVIL_NOTE_CALLOUT_KINDS)[number];
