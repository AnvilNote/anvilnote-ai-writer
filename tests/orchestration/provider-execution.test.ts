import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { AIWriterRequest } from "../../src/contracts/index";
import type {
  AIProviderExecutionResult,
  PreparedWriterRequest,
} from "../../src/server/index";
import {
  applyEditOperations,
  buildEditSnapshot,
  buildProviderEditSnapshot,
  parseEditOperationsV1,
} from "../../src/edits/index";
import {
  AIProviderRegistry,
  AIWriterError,
  OpenAIProviderAdapter,
  assembleTrustedWriterResult,
  buildEditOperationsPromptSections,
  executeWriterRequest,
  prepareWriterRequest,
} from "../../src/server/index";

test("provider abstraction does not depend on an OpenAI payload type", async () => {
  const source = await readFile("src/providers/provider-adapter.ts", "utf8");
  assert.equal(source.includes("./openai/"), false);
});

const secret = "sk-test-this-must-never-appear";

function preparedCompose() {
  const request: AIWriterRequest = {
    requestId: "req_trusted_assembly",
    intent: "compose",
    provider: { id: "openai", model: "gpt-5.6-terra" },
    instruction: "Create a note.",
    context: { locale: "en", writingStyle: "neutral" },
    options: { humanizerEnabled: false },
  };
  return prepareWriterRequest(request);
}

function providerExecution(): AIProviderExecutionResult {
  return {
    provider: "openai",
    model: "gpt-5.6-terra",
    providerRequestId: "resp_trusted",
    payload: {
      suggestedTitle: "Trusted title",
      document: {
        schemaVersion: "anvilnote.document.v1",
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Trusted content." }],
          },
        ],
      },
      summary: "Created a note.",
      warnings: [],
    },
    usage: {
      provider: "openai",
      model: "gpt-5.6-terra",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedActualCostUsd: 0.001,
      pricingVersion: "2026-07-18",
    },
    durationMs: 20,
    attempts: 1,
  };
}

test("trusted orchestration assembles profile metadata and usage outside the model", () => {
  const prepared = preparedCompose();
  const result = assembleTrustedWriterResult(prepared, providerExecution());
  assert.equal(result.kind, "compose");
  assert.equal(result.schemaVersion, "anvilnote.ai.compose-result.v1");
  assert.deepEqual(result.metadata, {
    profileId: "compose.default.v1",
    profileVersion: 1,
    promptTemplateId: "prompt.compose.v1",
    promptVersion: 1,
    schemaVersion: "anvilnote.ai.compose-result.v1",
    policyVersions: prepared.policyVersions,
  });
  assert.deepEqual(result.usage, providerExecution().usage);
});

test("provider execution cannot override request provider, model, or profile", () => {
  const prepared = preparedCompose();
  assert.throws(
    () =>
      assembleTrustedWriterResult(prepared, {
        ...providerExecution(),
        provider: "fake",
      }),
    (error) =>
      error instanceof AIWriterError &&
      error.details?.reason === "provider mismatch",
  );
  assert.throws(
    () =>
      assembleTrustedWriterResult(prepared, {
        ...providerExecution(),
        model: "gpt-5.6-sol",
      }),
    (error) =>
      error instanceof AIWriterError &&
      error.details?.reason === "model mismatch",
  );
});

test("provider registry rejects duplicates and resolves by definition ID", () => {
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => {
      throw new Error("not executed");
    },
  });
  const registry = new AIProviderRegistry([adapter]);
  assert.equal(registry.get("openai"), adapter);
  assert.equal(registry.get("unknown"), undefined);
  assert.throws(() => new AIProviderRegistry([adapter, adapter]), /duplicate/i);
});

test("executeWriterRequest dispatches via the registry and returns the trusted result", async () => {
  const adapter = {
    definition: new OpenAIProviderAdapter().definition,
    testConnection: async () => ({
      status: "success" as const,
      provider: "openai",
      model: "gpt-5.6-terra",
      messageKey: "ai.connection.success",
    }),
    execute: async () => providerExecution(),
  };
  const result = await executeWriterRequest(
    preparedCompose(),
    { apiKey: secret },
    { registry: new AIProviderRegistry([adapter]) },
  );
  assert.equal(result.kind, "compose");
  assert.equal(result.usage.provider, "openai");
});

test("executeWriterRequest rejects an unregistered provider before execution", async () => {
  const prepared = preparedCompose();
  await assert.rejects(
    executeWriterRequest(
      { ...prepared, provider: { id: "unknown", model: "fake" } },
      { apiKey: secret },
      { registry: new AIProviderRegistry([]) },
    ),
    (error) =>
      error instanceof AIWriterError && error.code === "provider_error",
  );
});

test("trusted orchestration normalizes malformed adapter output", async () => {
  const adapter = {
    definition: new OpenAIProviderAdapter().definition,
    testConnection: async () => ({
      status: "success" as const,
      provider: "openai",
      model: "gpt-5.6-terra",
      messageKey: "ai.connection.success",
    }),
    execute: async () => ({
      ...providerExecution(),
      payload: {} as AIProviderExecutionResult["payload"],
    }),
  };
  await assert.rejects(
    executeWriterRequest(
      preparedCompose(),
      { apiKey: secret },
      { registry: new AIProviderRegistry([adapter]) },
    ),
    (error) =>
      error instanceof AIWriterError &&
      error.code === "invalid_structured_output" &&
      !JSON.stringify(error).includes(secret),
  );
});

test("a fake provider can edit the full mixed document with text and structural operations", async () => {
  const document = {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "短",
            marks: [{ type: "textStyle", attrs: { color: "#336699" } }],
          },
          ...Array.from({ length: 6 }, () => ({ type: "inlineBlank" })),
          { type: "footnoteReference", attrs: { targetRef: "fn-1" } },
          { type: "text", text: "與" },
          { type: "footnoteReference", attrs: { targetRef: "fn-2" } },
        ],
      },
      {
        type: "mermaid",
        attrs: { source: "graph TD; A-->B", theme: "default" },
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "尾段" }],
      },
      {
        type: "footnotes",
        content: [
          {
            type: "footnote",
            attrs: { localRef: "fn-1" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "註腳一" }] }],
          },
          {
            type: "footnote",
            attrs: { localRef: "fn-2" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "註腳二" }] }],
          },
        ],
      },
    ],
  };
  const snapshot = buildEditSnapshot({ document });
  const textRef = [...snapshot.nodeRefs.entries()].find(([, path]) =>
    path.join(".") === "0.0"
  )?.[0];
  assert.ok(textRef);

  const providerSnapshot = buildProviderEditSnapshot(snapshot);
  const sections = buildEditOperationsPromptSections({
    requestId: "req-full-mixed",
    instruction: "變長",
    scope: "document",
    snapshot: providerSnapshot,
  });
  const prepared: PreparedWriterRequest = {
    requestId: "req-full-mixed",
    provider: { id: "openai", model: "gpt-5.6-terra" },
    profile: { id: "edit-operations", version: 1 },
    promptTemplate: { id: "prompt.edit-structures.v2", version: 1 },
    policyVersions: [],
    outputSchemaId: "anvilnote.ai.edit-operations.v1",
    sections,
    maxOutputTokens: 16_384,
    metadata: {
      locale: "zh-TW",
      writingStyle: "auto",
      resolvedWritingStyle: "neutral",
      humanizerEnabled: false,
      humanizerLanguageFallback: false,
      attachmentCount: 0,
      conversationMessageCount: 0,
      selectedContentPresent: false,
    },
  };
  const fakeProvider = {
    definition: new OpenAIProviderAdapter().definition,
    testConnection: async () => ({
      status: "success" as const,
      provider: "openai",
      model: "gpt-5.6-terra",
      messageKey: "ai.connection.success",
    }),
    execute: async (): Promise<AIProviderExecutionResult> => ({
      provider: "openai",
      model: "gpt-5.6-terra",
      providerRequestId: "fake-full-mixed",
      payload: {
        version: "anvilnote.ai.edit-operations.v1",
        operations: [
          { type: "replaceText", targetRef: textRef, text: "這是一段變長的文字", marks: [] },
          {
            type: "insertNode",
            parentRef: "n0",
            index: 3,
            node: {
              type: "paragraph",
              content: [{ type: "text", text: "新增的結構段落" }],
            },
          },
        ],
      },
      usage: {
        provider: "openai",
        model: "gpt-5.6-terra",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedActualCostUsd: 0,
        pricingVersion: "fake",
      },
      durationMs: 1,
      attempts: 1,
    }),
  };

  const execution = await new AIProviderRegistry([fakeProvider])
    .get("openai")!
    .execute(prepared, { apiKey: "fake-key" });
  const draft = applyEditOperations(snapshot, parseEditOperationsV1(execution.payload));
  const editedParagraph = draft.candidateDocument.content[0] as {
    content?: Array<{ text?: string }>;
  };
  const insertedParagraph = draft.candidateDocument.content[3] as {
    content?: Array<{ text?: string }>;
  };

  assert.equal(editedParagraph.content?.[0]?.text, "這是一段變長的文字");
  assert.equal(insertedParagraph.content?.[0]?.text, "新增的結構段落");
  assert.equal(draft.candidateDocument.content[4]?.type, "footnotes");
});
