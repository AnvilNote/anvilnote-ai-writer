import assert from "node:assert/strict";
import test from "node:test";
import type { AIWriterRequest } from "../../src/contracts/index";
import {
  AIWriterError,
  OpenAIProviderAdapter,
  prepareWriterRequest,
  type OpenAIParsedResponseLike,
} from "../../src/server/index";

const secret = "sk-test-this-must-never-appear";

function prepared() {
  const request: AIWriterRequest = {
    requestId: "req_lifecycle",
    intent: "compose",
    provider: { id: "openai", model: "gpt-5.6-luna" },
    instruction: "Summarize safely.",
    context: { locale: "en", writingStyle: "neutral" },
    options: { humanizerEnabled: false },
  };
  return prepareWriterRequest(request);
}

function success(): OpenAIParsedResponseLike {
  const payload = {
    suggestedTitle: null,
    document: {
      schemaVersion: "anvilnote.document.v1",
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Done.", marks: null }],
        },
      ],
    },
    summary: "Done.",
    warnings: [],
  };
  return {
    id: "resp_lifecycle",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(payload) }],
      },
    ],
    output_parsed: payload,
    usage: null,
  };
}

test("Retry-After controls the only retry", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          attempts += 1;
          if (attempts === 1) {
            throw {
              status: 429,
              code: "rate_limit_exceeded",
              headers: new Headers({ "retry-after": "2" }),
            };
          }
          return success();
        },
      },
    }),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });
  await adapter.execute(prepared(), { apiKey: secret });
  assert.deepEqual(sleeps, [2_000]);
  assert.equal(attempts, 2);
});

test("one transient network failure may retry once", async () => {
  let attempts = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("connection error"), {
              name: "APIConnectionError",
            });
          }
          return success();
        },
      },
    }),
    sleep: async () => undefined,
  });
  assert.equal(
    (await adapter.execute(prepared(), { apiKey: secret })).attempts,
    2,
  );
});

test("abort during backoff stops before a second paid request", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let enterBackoff!: () => void;
  const inBackoff = new Promise<void>((resolve) => {
    enterBackoff = resolve;
  });
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          attempts += 1;
          throw { status: 429, code: "rate_limit_exceeded" };
        },
      },
    }),
    sleep: async (_milliseconds, signal) => {
      enterBackoff();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
  });

  const pending = adapter.execute(
    prepared(),
    { apiKey: secret },
    { signal: controller.signal },
  );
  await inBackoff;
  controller.abort();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof AIWriterError && error.code === "request_cancelled",
  );
  assert.equal(attempts, 1);
});

test("writer timeout aborts the SDK call and is not mislabeled as network error", async () => {
  const adapter = new OpenAIProviderAdapter({
    writerTimeoutMs: 5,
    clientFactory: () => ({
      responses: {
        async parse(_body, options) {
          await new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new Error("network-looking abort")),
              { once: true },
            );
          });
          return success();
        },
      },
    }),
  });
  await assert.rejects(
    adapter.execute(prepared(), { apiKey: secret }),
    (error) =>
      error instanceof AIWriterError && error.code === "provider_timeout",
  );
});

test("an already-cancelled request never reaches the SDK", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          calls += 1;
          return success();
        },
      },
    }),
  });
  await assert.rejects(
    adapter.execute(
      prepared(),
      { apiKey: secret },
      { signal: controller.signal },
    ),
    (error) =>
      error instanceof AIWriterError && error.code === "request_cancelled",
  );
  assert.equal(calls, 0);
});

test("a late response is ignored after the request deadline", async () => {
  const adapter = new OpenAIProviderAdapter({
    writerTimeoutMs: 5,
    clientFactory: () => ({
      responses: {
        async parse() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return success();
        },
      },
    }),
  });
  await assert.rejects(
    adapter.execute(prepared(), { apiKey: secret }),
    (error) =>
      error instanceof AIWriterError && error.code === "provider_timeout",
  );
});

test("safe provider logs contain metadata only", async () => {
  const logs: unknown[] = [];
  const request = prepared();
  const adapter = new OpenAIProviderAdapter({
    logger: (metadata) => logs.push(metadata),
    clientFactory: () => ({
      responses: { parse: async () => success() },
    }),
  });
  await adapter.execute(request, { apiKey: secret });
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("Summarize safely"), false);
  assert.equal(serialized.includes("Done."), false);
  assert.match(serialized, /req_lifecycle/);
  assert.match(serialized, /gpt-5\.6-luna/);
});
