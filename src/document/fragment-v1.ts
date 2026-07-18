import type { AnvilNoteBlockNodeV1 } from "./nodes-v1";

export interface AnvilNoteDocumentFragmentV1 {
  schemaVersion: "anvilnote.fragment.v1";
  type: "fragment";
  content: AnvilNoteBlockNodeV1[];
}
