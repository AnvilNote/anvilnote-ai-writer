import type { WritingProfileDefinition } from "./registry";

export const REWRITE_SELECTION_PROFILE: WritingProfileDefinition = {
  id: "rewrite.selection.v1",
  version: 1,
  intent: "rewrite-selection",
  promptTemplateId: "prompt.rewrite-selection.v1",
  outputSchemaId: "anvilnote.ai.rewrite-result.v1",
  policyIds: ["policy.factual-integrity.v1", "policy.protected-content.v1"],
  supportedLocales: ["*"],
  supportedAttachmentTypes: [
    "text/plain",
    "text/markdown",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  maxInputCharacters: 250_000,
  maxOutputTokens: 16_384,
};
