import assert from "node:assert/strict";
import test from "node:test";
import {
  AIWriterResultSchema,
  ComposeResultV1Schema,
  RewriteSelectionResultV1Schema,
  type ComposeWriterExecutionMetadata,
  type RewriteWriterExecutionMetadata,
} from "../../src/contracts/index";

type AssertFalse<Value extends false> = Value;
export type RewriteMetadataCannotBeCompose = AssertFalse<
  RewriteWriterExecutionMetadata extends ComposeWriterExecutionMetadata
    ? true
    : false
>;

const usage = {
  provider: "openai",
  model: "gpt-5.6-terra",
  inputTokens: 120,
  outputTokens: 80,
  totalTokens: 200,
  estimatedActualCostUsd: 0.0015,
  pricingVersion: "2026-07-18",
};

const metadata = {
  profileId: "compose.default.v1",
  profileVersion: 1,
  promptTemplateId: "prompt.compose.v1",
  promptVersion: 1,
  schemaVersion: "anvilnote.ai.compose-result.v1",
  policyVersions: [
    { id: "policy.factual-integrity.v1", version: 1 },
    { id: "policy.protected-content.v1", version: 1 },
    { id: "policy.style.academic-neutral.v1", version: 1 },
  ],
};

const document = {
  schemaVersion: "anvilnote.document.v1" as const,
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: "Structured content." }],
    },
  ],
};

test("strict compose result validates the versioned document payload", () => {
  const value = {
    schemaVersion: "anvilnote.ai.compose-result.v1",
    kind: "compose",
    suggestedTitle: "Notes",
    document,
    summary: "Created notes.",
    warnings: [],
    metadata,
    usage,
  };
  assert.deepEqual(ComposeResultV1Schema.parse(value), value);
  assert.deepEqual(AIWriterResultSchema.parse(value), value);
});

test("strict rewrite result validates the versioned fragment payload", () => {
  const value = {
    schemaVersion: "anvilnote.ai.rewrite-result.v1",
    kind: "rewrite-selection",
    replacement: {
      schemaVersion: "anvilnote.fragment.v1",
      type: "fragment",
      content: document.content,
    },
    changeSummary: "Made the sentence direct.",
    preservedElements: ["date: 2026-07-18"],
    warnings: [],
    metadata: {
      ...metadata,
      profileId: "rewrite.selection.v1",
      promptTemplateId: "prompt.rewrite-selection.v1",
      schemaVersion: "anvilnote.ai.rewrite-result.v1",
    },
    usage: {
      ...usage,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedActualCostUsd: null,
      pricingVersion: null,
    },
  };
  assert.deepEqual(RewriteSelectionResultV1Schema.parse(value), value);
  assert.deepEqual(AIWriterResultSchema.parse(value), value);
});

test("result metadata requires all trusted version fields", () => {
  const { promptVersion: _promptVersion, ...incompleteMetadata } = metadata;
  const value = {
    schemaVersion: "anvilnote.ai.compose-result.v1",
    kind: "compose",
    suggestedTitle: null,
    document,
    summary: "Created notes.",
    warnings: [],
    metadata: incompleteMetadata,
    usage,
  };

  assert.equal(ComposeResultV1Schema.safeParse(value).success, false);
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...value,
      metadata: { ...metadata, policyVersions: [] },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...value,
      metadata: {
        ...metadata,
        policyVersions: metadata.policyVersions.filter(
          ({ id }) => id !== "policy.protected-content.v1",
        ),
      },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...value,
      metadata: {
        ...metadata,
        policyVersions: [
          ...metadata.policyVersions,
          { id: "policy.unregistered.v999", version: 999 },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...value,
      metadata: {
        ...metadata,
        policyVersions: [
          metadata.policyVersions[0],
          metadata.policyVersions[0],
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...value,
      metadata: { ...metadata, profileVersion: 2 },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...value,
      metadata: { ...metadata, promptVersion: 2 },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...value,
      metadata: {
        ...metadata,
        policyVersions: [{ id: "policy.factual-integrity.v1", version: 2 }],
      },
    }).success,
    false,
  );
});

test("result metadata must match the result kind and selected profile", () => {
  const composeValue = {
    schemaVersion: "anvilnote.ai.compose-result.v1",
    kind: "compose",
    suggestedTitle: null,
    document,
    summary: "Created notes.",
    warnings: [],
    metadata,
    usage,
  };

  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...composeValue,
      metadata: {
        ...metadata,
        profileId: "rewrite.selection.v1",
        promptTemplateId: "prompt.rewrite-selection.v1",
        schemaVersion: "anvilnote.ai.rewrite-result.v1",
      },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...composeValue,
      metadata: {
        ...metadata,
        promptTemplateId: "prompt.compose-from-attachments.v1",
      },
    }).success,
    false,
  );
});

test("result schemas reject unknown fields and fabricated usage values", () => {
  const base = {
    schemaVersion: "anvilnote.ai.compose-result.v1",
    kind: "compose",
    suggestedTitle: null,
    document,
    summary: "Created notes.",
    warnings: [],
    metadata,
    usage,
  };
  assert.equal(
    ComposeResultV1Schema.safeParse({ ...base, rawProviderResponse: "secret" })
      .success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...base,
      usage: { ...usage, inputTokens: -1 },
    }).success,
    false,
  );
  assert.equal(
    ComposeResultV1Schema.safeParse({
      ...base,
      document: {
        ...document,
        content: [{ type: "rawHtml", html: "<script />" }],
      },
    }).success,
    false,
  );
});
