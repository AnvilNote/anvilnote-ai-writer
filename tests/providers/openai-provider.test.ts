import assert from "node:assert/strict";
import test from "node:test";
import type { AIWriterRequest } from "../../src/contracts/index";
import { ProtectedContentRegistry } from "../../src/document/index";
import {
  AIWriterError,
  OpenAIProviderAdapter,
  prepareWriterRequest,
  type OpenAIClientLike,
  type OpenAIParsedResponseLike,
} from "../../src/server/index";

const secret = "sk-test-this-must-never-appear";
const modelPayload = {
  suggestedTitle: null,
  document: {
    schemaVersion: "anvilnote.document.v1",
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Generated text.", marks: null }],
      },
    ],
  },
  summary: "Generated one paragraph.",
  warnings: [],
};

function createPreparedRequest() {
  const request: AIWriterRequest = {
    requestId: "req_provider_execute",
    intent: "compose",
    provider: { id: "openai", model: "gpt-5.6-terra" },
    instruction: "Write one paragraph.",
    context: { locale: "en", writingStyle: "neutral" },
    options: { humanizerEnabled: false, maxOutputTokens: 500 },
  };
  return prepareWriterRequest(request);
}

function completedResponse(
  parsed: unknown = modelPayload,
): OpenAIParsedResponseLike {
  return {
    id: "resp_safe_diagnostic",
    _request_id: "req_safe_diagnostic",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(modelPayload) }],
      },
    ],
    output_parsed: parsed,
    usage: {
      input_tokens: 100,
      input_tokens_details: {
        cached_tokens: 20,
        cache_write_tokens: 0,
      },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 150,
    },
  };
}

test("provider executes through an injected short-lived official client boundary", async () => {
  const calls: Array<{ body: unknown; signal?: AbortSignal }> = [];
  let receivedCredential: string | undefined;
  const client: OpenAIClientLike = {
    responses: {
      async parse(body, options) {
        calls.push({ body, signal: options?.signal ?? undefined });
        return completedResponse();
      },
    },
  };
  const adapter = new OpenAIProviderAdapter({
    clientFactory(credential) {
      receivedCredential = credential.apiKey;
      return client;
    },
  });

  const result = await adapter.execute(createPreparedRequest(), {
    apiKey: `  ${secret}  `,
  });
  assert.equal(receivedCredential, secret);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls[0]?.body).includes(secret), false);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.6-terra");
  assert.equal(result.providerRequestId, "req_safe_diagnostic");
  assert.equal(result.attempts, 1);
  assert.ok("document" in result.payload);
  assert.deepEqual(result.payload.document.content, [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Generated text." }],
    },
  ]);
  assert.equal(result.usage.cachedInputTokens, 20);
});

test("invalid credential input is normalized before client creation", async () => {
  let factoryCalls = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => {
      factoryCalls += 1;
      throw new Error("client must not be created");
    },
  });

  await assert.rejects(
    adapter.execute(createPreparedRequest(), { apiKey: "   " }),
    (error) =>
      error instanceof AIWriterError &&
      error.code === "invalid_api_key" &&
      !JSON.stringify(error).includes(secret),
  );
  assert.equal(factoryCalls, 0);
});

test("untrusted provider diagnostic IDs cannot leak into results or logs", async () => {
  const logged: unknown[] = [];
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        parse: async () => ({
          ...completedResponse(),
          _request_id: `req_${secret}`,
        }),
      },
    }),
    logger: (metadata) => logged.push(metadata),
  });

  const result = await adapter.execute(createPreparedRequest(), {
    apiKey: secret,
  });
  assert.equal(result.providerRequestId, undefined);
  assert.equal(JSON.stringify(logged).includes(secret), false);
});

test("invalid structured output retries once, then stops", async () => {
  let attempts = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          attempts += 1;
          if (attempts === 1) throw new SyntaxError("malformed JSON");
          return completedResponse();
        },
      },
    }),
    sleep: async () => undefined,
    random: () => 0,
  });

  const result = await adapter.execute(createPreparedRequest(), {
    apiKey: secret,
  });
  assert.equal(attempts, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.usage.inputTokens, null);
  assert.equal(result.usage.outputTokens, null);
  assert.equal(result.usage.totalTokens, null);
  assert.equal(result.usage.estimatedActualCostUsd, null);

  const alwaysInvalid = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          throw new SyntaxError("still malformed");
        },
      },
    }),
    sleep: async () => undefined,
  });
  await assert.rejects(
    alwaysInvalid.execute(createPreparedRequest(), { apiKey: secret }),
    (error) =>
      error instanceof AIWriterError &&
      error.code === "invalid_structured_output",
  );
});

test("permanent credential errors never retry", async () => {
  let attempts = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          attempts += 1;
          throw { status: 401, code: "invalid_api_key", message: secret };
        },
      },
    }),
    sleep: async () => undefined,
  });
  await assert.rejects(
    adapter.execute(createPreparedRequest(), { apiKey: secret }),
    (error) =>
      error instanceof AIWriterError && error.code === "invalid_api_key",
  );
  assert.equal(attempts, 1);
});

test("caller cancellation aborts the SDK request and prevents retry", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse(_body, options) {
          attempts += 1;
          await new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
          return completedResponse();
        },
      },
    }),
  });

  const pending = adapter.execute(
    createPreparedRequest(),
    { apiKey: secret },
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof AIWriterError && error.code === "request_cancelled",
  );
  assert.equal(attempts, 1);
});

test("refusal and incomplete responses are not treated as valid JSON", async () => {
  const responses: OpenAIParsedResponseLike[] = [
    {
      ...completedResponse(null),
      output: [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "Cannot comply." }],
        },
      ],
    },
    {
      ...completedResponse(null),
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
    },
  ];
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: { parse: async () => responses.shift()! },
    }),
  });

  await assert.rejects(
    adapter.execute(createPreparedRequest(), { apiKey: secret }),
    (error) =>
      error instanceof AIWriterError && error.code === "provider_refusal",
  );
  await assert.rejects(
    adapter.execute(createPreparedRequest(), { apiKey: secret }),
    (error) =>
      error instanceof AIWriterError && error.code === "incomplete_response",
  );
});

test("protected placeholder loss fails closed before orchestration can apply output", async () => {
  const registry = ProtectedContentRegistry.create("selected source");
  const placeholder = registry.protect("E = mc^2", {
    kind: "math",
    orderSensitive: true,
  });
  const request: AIWriterRequest = {
    requestId: "req_protected_provider",
    intent: "rewrite-selection",
    provider: { id: "openai", model: "gpt-5.6-terra" },
    instruction: "Shorten this.",
    context: {
      locale: "en",
      writingStyle: "preserve-source",
      selectedContent: {
        schemaVersion: "anvilnote.fragment.v1",
        type: "fragment",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: placeholder }],
          },
        ],
      },
    },
    options: { humanizerEnabled: false },
  };
  const invalidRewritePayload = {
    replacement: {
      schemaVersion: "anvilnote.fragment.v1",
      type: "fragment",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The formula was lost.", marks: null },
          ],
        },
      ],
    },
    changeSummary: "Shortened.",
    preservedElements: [],
    warnings: [],
  };
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        parse: async () => ({
          ...completedResponse(invalidRewritePayload),
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(invalidRewritePayload),
                },
              ],
            },
          ],
        }),
      },
    }),
    sleep: async () => undefined,
  });

  await assert.rejects(
    adapter.execute(
      prepareWriterRequest(request),
      { apiKey: secret },
      { protectedContentRegistry: registry },
    ),
    (error) =>
      error instanceof AIWriterError &&
      error.code === "invalid_structured_output",
  );
});
