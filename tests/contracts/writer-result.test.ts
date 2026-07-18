import assert from "node:assert/strict";
import test from "node:test";
import {
  AIWriterResultSchema,
  ComposeResultV1Schema,
  RewriteSelectionResultV1Schema,
} from "../../src/contracts/index";

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
  policyIds: ["policy.factual-integrity.v1"],
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
    metadata: { ...metadata, profileId: "rewrite.selection.v1" },
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
