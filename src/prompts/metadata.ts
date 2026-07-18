import type { AIWriterIntent } from "../contracts/index";

export type PromptTemplateIntent = AIWriterIntent | "common";

export interface PromptTemplateDefinition {
  id: string;
  version: number;
  intent: PromptTemplateIntent;
  assetPath: string;
  description: string;
}
