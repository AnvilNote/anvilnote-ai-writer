import type { WritingProfileDefinition } from "./registry";

export const COMPOSE_DEFAULT_PROFILE: WritingProfileDefinition = {
  id: "compose.default.v1",
  version: 1,
  intent: "compose",
  promptTemplateId: "prompt.compose.v1",
  outputSchemaId: "anvilnote.ai.compose-result.v1",
  policyIds: ["policy.factual-integrity.v1", "policy.protected-content.v1"],
  supportedLocales: ["*"],
  supportedAttachmentTypes: [],
  maxInputCharacters: 250_000,
  maxOutputTokens: 16_384,
};
