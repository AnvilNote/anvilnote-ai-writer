import type { AIWriterRequest } from "../contracts/index";
import {
  getWritingPolicy,
  type HumanizerLanguageRoute,
  type ResolvedWritingStyle,
} from "../policies/index";
import {
  getPromptTemplate,
  loadPromptTemplate,
  loadWritingPolicy,
} from "../prompts/index";
import type { WritingProfileDefinition } from "../profiles/index";
import type { PreparedPromptSection } from "./prepare-writer-request";
import { wrapUntrustedPromptData } from "./prompt-boundaries";

const COMMON_PROMPT_ID = "prompt.common.system.v1";

function makeSchemaSection(outputSchemaId: string): PreparedPromptSection {
  return {
    id: "output-contract",
    role: "developer",
    kind: "schema",
    content: [
      `The provider will enforce the structured output schema identified as ${outputSchemaId}.`,
      "Return only data that conforms to that supplied schema.",
      "Do not wrap the result in a Markdown code fence and do not add fields outside the schema.",
      "Use warnings for missing or uncertain source information.",
    ].join("\n"),
  };
}

function makeTrustedSection(
  id: string,
  kind: "common" | "task" | "policy",
  content: string,
): PreparedPromptSection {
  return {
    id,
    role: kind === "common" ? "system" : "developer",
    kind,
    content,
  };
}

export interface BuildPromptSectionsInput {
  request: AIWriterRequest;
  profile: WritingProfileDefinition;
  policyIds: readonly string[];
  languageRoute: HumanizerLanguageRoute;
  resolvedWritingStyle: ResolvedWritingStyle;
}

export function buildPromptSections({
  request,
  profile,
  policyIds,
  languageRoute,
  resolvedWritingStyle,
}: BuildPromptSectionsInput): PreparedPromptSection[] {
  const commonPrompt = getPromptTemplate(COMMON_PROMPT_ID);
  const taskPrompt = getPromptTemplate(profile.promptTemplateId);
  if (!commonPrompt || !taskPrompt) {
    throw new Error("Writing prompt configuration is incomplete.");
  }

  const sections: PreparedPromptSection[] = [
    makeTrustedSection(
      commonPrompt.id,
      "common",
      loadPromptTemplate(commonPrompt.id),
    ),
    makeTrustedSection(
      taskPrompt.id,
      "task",
      loadPromptTemplate(taskPrompt.id),
    ),
    makeSchemaSection(profile.outputSchemaId),
  ];

  for (const policyId of policyIds) {
    if (!getWritingPolicy(policyId)) {
      throw new Error(`Writing policy is not configured: ${policyId}`);
    }
    sections.push(
      makeTrustedSection(policyId, "policy", loadWritingPolicy(policyId)),
    );
  }

  const contextMetadata = {
    locale: languageRoute.requestedLocale,
    documentLocale: request.context.locale,
    documentType: request.context.documentType ?? null,
    writingStyle: request.context.writingStyle,
    resolvedWritingStyle,
    mixedLanguageContent: languageRoute.mixedContent,
    preserveOtherLanguages: languageRoute.preserveOtherLanguages,
  };
  sections.push({
    id: "context.metadata",
    role: "user",
    kind: "context",
    content: wrapUntrustedPromptData({
      requestId: request.requestId,
      label: "context-metadata",
      kind: "CONTEXT",
      content: JSON.stringify(contextMetadata),
    }),
  });

  if (request.context.currentDocument) {
    sections.push({
      id: "context.current-document",
      role: "user",
      kind: "context",
      content: wrapUntrustedPromptData({
        requestId: request.requestId,
        label: "current-document",
        kind: "CURRENT_DOCUMENT",
        content: JSON.stringify(request.context.currentDocument),
      }),
    });
  }

  if (request.context.selectedContent) {
    sections.push({
      id: "context.selection",
      role: "user",
      kind: "selection",
      content: wrapUntrustedPromptData({
        requestId: request.requestId,
        label: "selection",
        kind: "SELECTION",
        content: JSON.stringify(request.context.selectedContent),
      }),
    });
  }

  for (const attachment of request.context.attachments ?? []) {
    sections.push({
      id: `attachment.${attachment.id}`,
      role: "user",
      kind: "attachment",
      content: wrapUntrustedPromptData({
        requestId: request.requestId,
        label: `attachment-${attachment.id}`,
        kind: "ATTACHMENT",
        metadata: {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          pageCount: attachment.pageCount ?? null,
          truncated: attachment.truncated,
          warnings: attachment.warnings,
        },
        content: attachment.extractedText,
      }),
    });
  }

  sections.push({
    id: "user.instruction",
    role: "user",
    kind: "instruction",
    content: wrapUntrustedPromptData({
      requestId: request.requestId,
      label: "user-instruction",
      kind: "INSTRUCTION",
      content: request.instruction,
    }),
  });

  return sections;
}
