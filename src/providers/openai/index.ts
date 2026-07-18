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
