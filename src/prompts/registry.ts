import type { PromptTemplateDefinition } from "./metadata";

export const PROMPT_TEMPLATES = [
  {
    id: "prompt.common.system.v1",
    version: 1,
    intent: "common",
    assetPath: "prompts/common/system-v1.md",
    description: "Provider-neutral system constraints for every writing task.",
  },
  {
    id: "prompt.compose.v1",
    version: 1,
    intent: "compose",
    assetPath: "prompts/compose/compose-v1.md",
    description: "Create editable document content from an instruction.",
  },
  {
    id: "prompt.compose-from-attachments.v1",
    version: 1,
    intent: "compose-from-attachments",
    assetPath:
      "prompts/compose-from-attachments/compose-from-attachments-v1.md",
    description: "Create editable document content using attachment data.",
  },
  {
    id: "prompt.rewrite-selection.v1",
    version: 1,
    intent: "rewrite-selection",
    assetPath: "prompts/rewrite-selection/rewrite-selection-v1.md",
    description:
      "Rewrite a selected document fragment without changing its meaning.",
  },
] as const satisfies readonly PromptTemplateDefinition[];

export function getPromptTemplate(
  id: string,
): PromptTemplateDefinition | undefined {
  return PROMPT_TEMPLATES.find((definition) => definition.id === id);
}
