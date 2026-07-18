import { estimateTextTokens } from "../pricing/index";
import { WRITING_POLICIES } from "../policies/index";
import { loadPromptTemplate, loadWritingPolicy } from "./loader";
import { PROMPT_TEMPLATES } from "./registry";

export interface PromptAssetMetric {
  id: string;
  kind: "prompt" | "policy";
  characters: number;
  estimatedTokens: number;
  confidence: "low";
}

export function getPromptAssetMetrics(): PromptAssetMetric[] {
  const prompts = PROMPT_TEMPLATES.map((definition) => ({
    id: definition.id,
    kind: "prompt" as const,
    content: loadPromptTemplate(definition.id),
  }));
  const policies = WRITING_POLICIES.map((definition) => ({
    id: definition.id,
    kind: "policy" as const,
    content: loadWritingPolicy(definition.id),
  }));
  return [...prompts, ...policies].map(({ id, kind, content }) => {
    const estimate = estimateTextTokens(content);
    return {
      id,
      kind,
      characters: content.length,
      estimatedTokens: estimate.tokens,
      confidence: estimate.confidence,
    };
  });
}
