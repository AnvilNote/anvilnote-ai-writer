import type { AIWriterIntent } from "../contracts/index";
import { registeredAssetExists } from "../prompts/loader";
import type { PromptTemplateDefinition } from "../prompts/metadata";
import { PROMPT_TEMPLATES } from "../prompts/registry";
import type { WritingPolicyDefinition } from "../policies/metadata";
import { WRITING_POLICIES } from "../policies/registry";
import { COMPOSE_DEFAULT_PROFILE } from "./compose-default-v1";
import { COMPOSE_FROM_ATTACHMENTS_PROFILE } from "./compose-from-attachments-v1";
import { REWRITE_SELECTION_PROFILE } from "./rewrite-selection-v1";

export const OUTPUT_SCHEMA_IDS = {
  compose: "anvilnote.ai.compose-result.v1",
  rewrite: "anvilnote.ai.rewrite-result.v1",
} as const;

export type WriterOutputSchemaId =
  (typeof OUTPUT_SCHEMA_IDS)[keyof typeof OUTPUT_SCHEMA_IDS];

const OUTPUT_SCHEMA_ID_BY_INTENT: Record<AIWriterIntent, WriterOutputSchemaId> =
  {
    compose: OUTPUT_SCHEMA_IDS.compose,
    "compose-from-attachments": OUTPUT_SCHEMA_IDS.compose,
    "rewrite-selection": OUTPUT_SCHEMA_IDS.rewrite,
  };

export interface WritingProfileDefinition {
  id: string;
  version: number;
  intent: AIWriterIntent;
  promptTemplateId: string;
  outputSchemaId: WriterOutputSchemaId;
  policyIds: string[];
  supportedLocales: string[];
  supportedAttachmentTypes: string[];
  maxInputCharacters: number;
  maxOutputTokens: number;
}

export const WRITING_PROFILES: WritingProfileDefinition[] = [
  COMPOSE_DEFAULT_PROFILE,
  COMPOSE_FROM_ATTACHMENTS_PROFILE,
  REWRITE_SELECTION_PROFILE,
];

export interface WritingConfiguration {
  prompts: readonly PromptTemplateDefinition[];
  policies: readonly WritingPolicyDefinition[];
  profiles: readonly WritingProfileDefinition[];
}

function assertUniqueVersionedIds(
  kind: string,
  definitions: readonly { id: string; version: number }[],
): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate ${kind} ID: ${definition.id}`);
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new Error(`Invalid ${kind} version: ${definition.id}`);
    }
    ids.add(definition.id);
  }
}

const SUPPORTED_LOCALE_PATTERN =
  /^(?:\*|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*(?:-\*)?)$/;

function assertSupportedLocales(
  kind: string,
  id: string,
  locales: readonly string[],
): void {
  if (
    locales.length === 0 ||
    locales.some((locale) => !SUPPORTED_LOCALE_PATTERN.test(locale))
  ) {
    throw new Error(`${kind} ${id} has an invalid supported locale.`);
  }
}

export function validateWritingConfiguration(
  configuration: WritingConfiguration,
): void {
  assertUniqueVersionedIds("prompt", configuration.prompts);
  assertUniqueVersionedIds("policy", configuration.policies);
  assertUniqueVersionedIds("profile", configuration.profiles);

  const prompts = new Map(
    configuration.prompts.map((definition) => [definition.id, definition]),
  );
  const policies = new Map(
    configuration.policies.map((definition) => [definition.id, definition]),
  );
  const outputSchemaIds = new Set<string>(Object.values(OUTPUT_SCHEMA_IDS));

  for (const policy of configuration.policies) {
    assertSupportedLocales("Policy", policy.id, policy.supportedLocales);
  }

  for (const definition of [
    ...configuration.prompts,
    ...configuration.policies,
  ]) {
    if (!registeredAssetExists(definition.assetPath)) {
      throw new Error(
        `Registered asset does not exist: ${definition.assetPath}`,
      );
    }
  }

  for (const profile of configuration.profiles) {
    assertSupportedLocales("Profile", profile.id, profile.supportedLocales);
    if (
      !Number.isInteger(profile.maxInputCharacters) ||
      profile.maxInputCharacters < 1 ||
      !Number.isInteger(profile.maxOutputTokens) ||
      profile.maxOutputTokens < 1
    ) {
      throw new Error(
        `Profile ${profile.id} has an invalid input/output limit.`,
      );
    }
    const prompt = prompts.get(profile.promptTemplateId);
    if (!prompt) {
      throw new Error(
        `Profile ${profile.id} references unknown prompt ${profile.promptTemplateId}`,
      );
    }
    if (prompt.intent !== profile.intent) {
      throw new Error(
        `Profile ${profile.id} has incompatible prompt intent ${prompt.intent}`,
      );
    }
    if (!outputSchemaIds.has(profile.outputSchemaId)) {
      throw new Error(
        `Profile ${profile.id} references unknown output schema ${profile.outputSchemaId}`,
      );
    }
    if (profile.outputSchemaId !== OUTPUT_SCHEMA_ID_BY_INTENT[profile.intent]) {
      throw new Error(
        `Profile ${profile.id} has incompatible output schema ${profile.outputSchemaId} for intent ${profile.intent}`,
      );
    }
    for (const policyId of profile.policyIds) {
      if (!policies.has(policyId)) {
        throw new Error(
          `Profile ${profile.id} references unknown policy ${policyId}`,
        );
      }
    }
  }
}

export function assertWritingConfiguration(): void {
  validateWritingConfiguration({
    prompts: PROMPT_TEMPLATES,
    policies: WRITING_POLICIES,
    profiles: WRITING_PROFILES,
  });
}

export function getWritingProfile(
  id: string,
): WritingProfileDefinition | undefined {
  return WRITING_PROFILES.find((definition) => definition.id === id);
}
