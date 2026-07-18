import type { WritingProfileDefinition } from "./registry";

export const COMPOSE_FROM_ATTACHMENTS_PROFILE: WritingProfileDefinition = {
  id: "compose.from-attachments.v1",
  version: 1,
  intent: "compose-from-attachments",
  promptTemplateId: "prompt.compose-from-attachments.v1",
  outputSchemaId: "anvilnote.ai.compose-result.v1",
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
