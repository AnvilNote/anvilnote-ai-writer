import assert from "node:assert/strict";
import test from "node:test";
import type { AIWriterRequest } from "../../src/contracts/index";
import {
  OUTPUT_SCHEMA_IDS,
  PROMPT_TEMPLATES,
  WRITING_POLICIES,
  WRITING_PROFILES,
  assertWritingConfiguration,
  selectWritingProfile,
  validateWritingConfiguration,
} from "../../src/server/index";

const baseRequest = {
  requestId: "req_profile_selection",
  intent: "compose",
  provider: { id: "openai", model: "gpt-5.6-terra" },
  instruction: "Create a concise handout.",
  context: {
    locale: "en-US",
    documentType: "teaching-handout",
    writingStyle: "auto",
  },
  options: {
    humanizerEnabled: true,
  },
} satisfies AIWriterRequest;

const attachment = {
  id: "attachment-1",
  filename: "notes.md",
  mimeType: "text/markdown",
  extractedText: "Source material",
  characterCount: 15,
  truncated: false,
  warnings: [],
};

const selection = {
  schemaVersion: "anvilnote.fragment.v1" as const,
  type: "fragment" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: "Rewrite this." }],
    },
  ],
};

test("registries expose unique, versioned, cross-referenced definitions", () => {
  assert.equal(PROMPT_TEMPLATES.length, 4);
  assert.equal(WRITING_PROFILES.length, 3);
  assert.ok(WRITING_POLICIES.length >= 6);

  for (const definitions of [
    PROMPT_TEMPLATES,
    WRITING_POLICIES,
    WRITING_PROFILES,
  ]) {
    assert.equal(
      new Set(definitions.map((definition) => definition.id)).size,
      definitions.length,
    );
    assert.ok(definitions.every((definition) => definition.version > 0));
  }

  assert.deepEqual(OUTPUT_SCHEMA_IDS, {
    compose: "anvilnote.ai.compose-result.v1",
    rewrite: "anvilnote.ai.rewrite-result.v1",
  });
  assert.doesNotThrow(() => assertWritingConfiguration());
});

test("registry validation rejects incompatible prompt intent and references", () => {
  const invalidProfiles = WRITING_PROFILES.map((profile) =>
    profile.id === "compose.default.v1"
      ? {
          ...profile,
          promptTemplateId: "prompt.rewrite-selection.v1",
          policyIds: [...profile.policyIds, "policy.missing.v1"],
        }
      : profile,
  );
  assert.throws(
    () =>
      validateWritingConfiguration({
        prompts: PROMPT_TEMPLATES,
        policies: WRITING_POLICIES,
        profiles: invalidProfiles,
      }),
    /incompatible|unknown policy/i,
  );
});

test("registry validation rejects duplicate IDs and invalid versions", () => {
  assert.throws(() =>
    validateWritingConfiguration({
      prompts: [...PROMPT_TEMPLATES, PROMPT_TEMPLATES[0]],
      policies: WRITING_POLICIES,
      profiles: WRITING_PROFILES,
    }),
  );
  assert.throws(() =>
    validateWritingConfiguration({
      prompts: PROMPT_TEMPLATES,
      policies: WRITING_POLICIES.map((policy) =>
        policy.id === "policy.factual-integrity.v1"
          ? { ...policy, version: 0 }
          : policy,
      ),
      profiles: WRITING_PROFILES,
    }),
  );
});

test("registry validation rejects invalid locales and profile limits", () => {
  assert.throws(
    () =>
      validateWritingConfiguration({
        prompts: PROMPT_TEMPLATES,
        policies: WRITING_POLICIES.map((policy) =>
          policy.id === "policy.factual-integrity.v1"
            ? { ...policy, supportedLocales: ["not a locale"] }
            : policy,
        ),
        profiles: WRITING_PROFILES,
      }),
    /locale/i,
  );
  assert.throws(
    () =>
      validateWritingConfiguration({
        prompts: PROMPT_TEMPLATES,
        policies: WRITING_POLICIES,
        profiles: WRITING_PROFILES.map((profile) =>
          profile.id === "compose.default.v1"
            ? { ...profile, maxInputCharacters: 0 }
            : profile,
        ),
      }),
    /limit|maximum|characters/i,
  );
});

test("registry validation fails clearly when an allowlisted asset is missing", () => {
  assert.throws(
    () =>
      validateWritingConfiguration({
        prompts: PROMPT_TEMPLATES.map((prompt) =>
          prompt.id === "prompt.common.system.v1"
            ? { ...prompt, assetPath: "prompts/common/missing-v1.md" }
            : prompt,
        ),
        policies: WRITING_POLICIES,
        profiles: WRITING_PROFILES,
      }),
    /does not exist.*missing-v1\.md/i,
  );
});

test("profile selection derives the operation from current context", () => {
  assert.equal(selectWritingProfile(baseRequest).id, "compose.default.v1");
  assert.equal(
    selectWritingProfile({
      ...baseRequest,
      intent: "compose-from-attachments",
      context: { ...baseRequest.context, attachments: [attachment] },
    }).id,
    "compose.from-attachments.v1",
  );
  assert.equal(
    selectWritingProfile({
      ...baseRequest,
      intent: "rewrite-selection",
      context: { ...baseRequest.context, selectedContent: selection },
    }).id,
    "rewrite.selection.v1",
  );
  assert.equal(
    selectWritingProfile({
      ...baseRequest,
      intent: "rewrite-selection",
      context: {
        ...baseRequest.context,
        selectedContent: selection,
        attachments: [attachment],
      },
    }).id,
    "rewrite.selection.v1",
  );
});

test("profile selection rejects intent and context inconsistencies", () => {
  assert.throws(() =>
    selectWritingProfile({
      ...baseRequest,
      intent: "rewrite-selection",
    }),
  );
  assert.throws(() =>
    selectWritingProfile({
      ...baseRequest,
      intent: "compose-from-attachments",
    }),
  );
  assert.throws(() =>
    selectWritingProfile({
      ...baseRequest,
      context: { ...baseRequest.context, selectedContent: selection },
    }),
  );
});
