import type { AIWriterIntent, WritingStyle } from "../contracts/index";

export type ResolvedWritingStyle =
  "neutral" | "natural-restrained" | "natural" | "preserve-source";

export interface WritingStyleResolutionInput {
  writingStyle: WritingStyle;
  documentType?: string;
  intent: AIWriterIntent;
}

const NEUTRAL_DOCUMENT_TYPES = new Set([
  "academic",
  "legal",
  "technical",
  "reference",
]);

const RESTRAINED_NATURAL_DOCUMENT_TYPES = new Set([
  "handout",
  "teaching-handout",
  "study-notes",
  "notes",
]);

const NATURAL_DOCUMENT_TYPES = new Set(["blog", "essay", "personal-article"]);

export function resolveWritingStyle({
  writingStyle,
  documentType,
  intent,
}: WritingStyleResolutionInput): ResolvedWritingStyle {
  if (writingStyle !== "auto") return writingStyle;
  if (intent === "rewrite-selection") return "preserve-source";

  const normalizedDocumentType = documentType?.trim().toLowerCase() ?? "";
  if (NEUTRAL_DOCUMENT_TYPES.has(normalizedDocumentType)) return "neutral";
  if (NATURAL_DOCUMENT_TYPES.has(normalizedDocumentType)) return "natural";
  if (RESTRAINED_NATURAL_DOCUMENT_TYPES.has(normalizedDocumentType)) {
    return "natural-restrained";
  }
  return "natural-restrained";
}

const STYLE_POLICY_IDS: Record<ResolvedWritingStyle, string> = {
  neutral: "policy.style.academic-neutral.v1",
  "natural-restrained": "policy.style.natural-restrained.v1",
  natural: "policy.style.natural.v1",
  "preserve-source": "policy.style.preserve-source.v1",
};

export function getWritingStylePolicyId(style: ResolvedWritingStyle): string {
  return STYLE_POLICY_IDS[style];
}
