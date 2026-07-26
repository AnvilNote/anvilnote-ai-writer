import type { AIProviderDefinition } from "../../contracts/provider";
import { OPENAI_SUPPORTED_MODELS } from "./openai-models";
import { OPENAI_SETUP_GUIDE } from "./setup-guide";

export const OPENAI_PROVIDER_DEFINITION: AIProviderDefinition = {
  id: "openai",
  displayName: "OpenAI",
  enabled: true,
  models: OPENAI_SUPPORTED_MODELS,
  setupGuide: OPENAI_SETUP_GUIDE,
};

export * from "./openai-models";
export * from "./setup-guide";

// Deliberately NOT re-exporting openai-edit-operations-schema.ts /
// openai-edit-operations-normalizer.ts here, even though the plan's own
// Task 22.1 file list names this file: this barrel is reachable from the
// package's top-level "." export (src/index.ts), which
// tests-dist/exports.test.mjs asserts stays browser-safe — zero "openai"
// SDK dependency anywhere in that reachable graph. Both new modules import
// real OpenAI SDK code (zodTextFormat from "openai/helpers/zod", directly
// and via openai-strict-schema.ts), exactly like build-openai-request.ts/
// openai-provider.ts/openai-strict-schema.ts already do — and exactly like
// those existing Node-only files, they are re-exported from
// src/server/index.ts instead (the Node-only surface), never from here.
