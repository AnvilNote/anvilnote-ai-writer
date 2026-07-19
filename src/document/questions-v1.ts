export const ANVIL_NOTE_QUESTION_KINDS = [
  "single",
  "multi",
  "written",
] as const;

export type AnvilNoteQuestionKindV1 =
  (typeof ANVIL_NOTE_QUESTION_KINDS)[number];

export const ANVIL_NOTE_WRITTEN_MODES = ["lines", "blank"] as const;

export type AnvilNoteWrittenModeV1 =
  (typeof ANVIL_NOTE_WRITTEN_MODES)[number];
