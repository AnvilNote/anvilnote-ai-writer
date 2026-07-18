import type { AnvilNoteBlockNodeV1 } from "./nodes-v1";

export interface AnvilNoteDocumentV1 {
  schemaVersion: "anvilnote.document.v1";
  type: "doc";
  content: AnvilNoteBlockNodeV1[];
}
