import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_TIMEOUTS,
  OpenAIProviderAdapter,
  buildOpenAIConnectionTestRequest,
  type OpenAIParsedResponseLike,
} from "../../src/server/index";

const secret = "sk-test-this-must-never-appear";

function response(parsed: unknown): OpenAIParsedResponseLike {
  return {
    id: "resp_connection",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: JSON.stringify({ status: "ok" }) },
        ],
      },
    ],
    output_parsed: parsed,
    usage: null,
  };
}

test("connection test is a minimal structured Responses request", () => {
  const body = buildOpenAIConnectionTestRequest("gpt-5.6-terra");
  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.store, false);
  assert.equal(body.background, false);
  assert.equal(body.stream, false);
  assert.deepEqual(body.tools, []);
  assert.ok((body.max_output_tokens ?? Infinity) <= 64);
  assert.equal(body.text?.format?.type, "json_schema");
  if (body.text?.format?.type !== "json_schema") assert.fail();
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.name, "anvilnote_connection_test_v1");
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("humanizer"), false);
  assert.equal(serialized.includes("attachment"), false);
  assert.equal(serialized.includes(secret), false);
});

test("connection test sends one request and reports safe success metadata", async () => {
  let requestCount = 0;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          requestCount += 1;
          return response({ status: "ok" });
        },
      },
    }),
    now: (() => {
      const values = [100, 135];
      return () => values.shift() ?? 135;
    })(),
  });
  assert.deepEqual(
    await adapter.testConnection(
      { apiKey: secret },
      { model: "gpt-5.6-terra" },
    ),
    {
      status: "success",
      provider: "openai",
      model: "gpt-5.6-terra",
      messageKey: "ai.connection.success",
      latencyMs: 35,
    },
  );
  assert.equal(requestCount, 1);
});

test("connection test maps credentials, quota, model, rate, network, and output errors", async () => {
  const cases = [
    [{ status: 401, code: "invalid_api_key" }, "invalid-key"],
    [{ status: 403, code: "permission_denied" }, "permission-denied"],
    [{ status: 429, code: "insufficient_quota" }, "insufficient-credit"],
    [{ status: 404, code: "model_not_found" }, "model-unavailable"],
    [{ status: 429, code: "rate_limit_exceeded" }, "rate-limited"],
    [
      Object.assign(new Error("network error"), { name: "APIConnectionError" }),
      "network-error",
    ],
    [new SyntaxError("malformed"), "unknown-error"],
  ] as const;

  for (const [rawError, expectedStatus] of cases) {
    let attempts = 0;
    const adapter = new OpenAIProviderAdapter({
      clientFactory: () => ({
        responses: {
          async parse() {
            attempts += 1;
            throw rawError;
          },
        },
      }),
    });
    const result = await adapter.testConnection(
      { apiKey: secret },
      { model: "gpt-5.6-terra" },
    );
    assert.equal(result.status, expectedStatus);
    assert.equal(attempts, 1, "connection tests must not retry");
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("connection timeout and caller cancellation remain distinct", async () => {
  const createWaitingAdapter = (connectionTimeoutMs: number) =>
    new OpenAIProviderAdapter({
      connectionTimeoutMs,
      clientFactory: () => ({
        responses: {
          async parse(_body, options) {
            await new Promise<void>((_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
            });
            return response({ status: "ok" });
          },
        },
      }),
    });

  const timedOut = await createWaitingAdapter(5).testConnection(
    { apiKey: secret },
    { model: "gpt-5.6-terra" },
  );
  assert.equal(timedOut.status, "timeout");

  const controller = new AbortController();
  const pending = createWaitingAdapter(
    AI_TIMEOUTS.connectionTestMs,
  ).testConnection(
    { apiKey: secret },
    { model: "gpt-5.6-terra", signal: controller.signal },
  );
  controller.abort();
  assert.equal((await pending).status, "cancelled");
});

test("connection test rejects pre-abort and late success responses", async () => {
  let requests = 0;
  const preAborted = new AbortController();
  preAborted.abort();
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({
      responses: {
        async parse() {
          requests += 1;
          return response({ status: "ok" });
        },
      },
    }),
  });
  const cancelled = await adapter.testConnection(
    { apiKey: secret },
    { model: "gpt-5.6-terra", signal: preAborted.signal },
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(requests, 0);

  const lateAdapter = new OpenAIProviderAdapter({
    connectionTimeoutMs: 5,
    clientFactory: () => ({
      responses: {
        async parse() {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return response({ status: "ok" });
        },
      },
    }),
  });
  const late = await lateAdapter.testConnection(
    { apiKey: secret },
    { model: "gpt-5.6-terra" },
  );
  assert.equal(late.status, "timeout");
});

test("unknown models are rejected without creating an SDK client", async () => {
  let created = false;
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => {
      created = true;
      throw new Error("must not run");
    },
  });
  const result = await adapter.testConnection(
    { apiKey: secret },
    { model: "unknown-model" },
  );
  assert.equal(result.status, "model-unavailable");
  assert.equal(created, false);
});
