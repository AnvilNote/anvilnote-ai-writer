import {
  AIWriterRequestSchema,
  type AIWriterRequest,
  type WritingStyle,
} from "../contracts/index";
import {
  getWritingPolicy,
  resolveHumanizerLanguage,
  resolveWritingStyle,
  selectWritingPolicyIds,
  type ResolvedWritingStyle,
} from "../policies/index";
import { getPromptTemplate } from "../prompts/index";
import {
  assertWritingConfiguration,
  selectWritingProfile,
} from "../profiles/index";
import { buildPromptSections } from "./build-prompt";

export interface PreparedPromptSection {
  id: string;
  role: "system" | "developer" | "user";
  kind:
    | "common"
    | "task"
    | "schema"
    | "policy"
    | "context"
    | "attachment"
    | "selection"
    | "instruction";
  content: string;
}

export interface PreparedWriterRequest {
  requestId: string;
  provider: { id: string; model: string };
  profile: { id: string; version: number };
  promptTemplate: { id: string; version: number };
  policyVersions: Array<{ id: string; version: number }>;
  outputSchemaId: string;
  sections: PreparedPromptSection[];
  maxOutputTokens: number;
  metadata: {
    locale: string;
    writingStyle: WritingStyle;
    resolvedWritingStyle: ResolvedWritingStyle;
    humanizerEnabled: boolean;
    humanizerLanguageFallback: boolean;
    attachmentCount: number;
    selectedContentPresent: boolean;
  };
}

function collectLanguageSamples(request: AIWriterRequest): string[] {
  const samples = [request.instruction];
  if (request.context.selectedContent) {
    samples.push(JSON.stringify(request.context.selectedContent));
  }
  if (request.context.currentDocument) {
    samples.push(JSON.stringify(request.context.currentDocument));
  }
  for (const attachment of request.context.attachments ?? []) {
    samples.push(attachment.extractedText);
  }
  return samples;
}

export function prepareWriterRequest(
  untrustedRequest: unknown,
): PreparedWriterRequest {
  assertWritingConfiguration();
  const request = AIWriterRequestSchema.parse(untrustedRequest);
  const profile = selectWritingProfile(request);
  const promptTemplate = getPromptTemplate(profile.promptTemplateId);
  if (!promptTemplate) {
    throw new Error(
      `Prompt template is not configured: ${profile.promptTemplateId}`,
    );
  }

  const attachments = request.context.attachments ?? [];
  for (const attachment of attachments) {
    if (!profile.supportedAttachmentTypes.includes(attachment.mimeType)) {
      throw new Error(
        `Attachment type is not supported by ${profile.id}: ${attachment.mimeType}`,
      );
    }
  }

  const resolvedWritingStyle = resolveWritingStyle({
    writingStyle: request.context.writingStyle,
    documentType: request.context.documentType,
    intent: request.intent,
  });
  const languageRoute = resolveHumanizerLanguage({
    requestLocale: request.context.locale,
    requestedOutputLocale: request.context.requestedOutputLocale,
    contentSamples: collectLanguageSamples(request),
  });
  const policyIds = selectWritingPolicyIds({
    basePolicyIds: profile.policyIds,
    resolvedStyle: resolvedWritingStyle,
    humanizerEnabled: request.options.humanizerEnabled,
    languageRoute,
  });
  const policyVersions = policyIds.map((id) => {
    const policy = getWritingPolicy(id);
    if (!policy) {
      throw new Error(`Writing policy is not configured: ${id}`);
    }
    return { id: policy.id, version: policy.version };
  });

  const maxOutputTokens =
    request.options.maxOutputTokens ?? profile.maxOutputTokens;
  if (maxOutputTokens > profile.maxOutputTokens) {
    throw new RangeError(
      `Requested output token limit exceeds profile maximum of ${profile.maxOutputTokens}.`,
    );
  }

  const sections = buildPromptSections({
    request,
    profile,
    policyIds,
    languageRoute,
    resolvedWritingStyle,
  });
  const inputCharacters = sections.reduce(
    (total, section) => total + section.content.length,
    0,
  );
  if (inputCharacters > profile.maxInputCharacters) {
    throw new RangeError(
      `Prepared writer input is too large for ${profile.id}: ${inputCharacters} characters.`,
    );
  }

  return {
    requestId: request.requestId,
    provider: request.provider,
    profile: { id: profile.id, version: profile.version },
    promptTemplate: {
      id: promptTemplate.id,
      version: promptTemplate.version,
    },
    policyVersions,
    outputSchemaId: profile.outputSchemaId,
    sections,
    maxOutputTokens,
    metadata: {
      locale: languageRoute.requestedLocale,
      writingStyle: request.context.writingStyle,
      resolvedWritingStyle,
      humanizerEnabled: request.options.humanizerEnabled,
      humanizerLanguageFallback: languageRoute.fallback,
      attachmentCount: attachments.length,
      selectedContentPresent: Boolean(request.context.selectedContent),
    },
  };
}
