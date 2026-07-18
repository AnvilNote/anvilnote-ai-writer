import assert from "node:assert/strict";
import test from "node:test";
import { AIWriterError, normalizeOpenAIError } from "../../src/server/index";

const context = {
  model: "gpt-5.6-terra",
  requestId: "req_error_mapping",
};

test("OpenAI HTTP status and codes map to stable AnvilNote errors", () => {
  const cases = [
    [{ status: 401, code: "invalid_api_key" }, "invalid_api_key", false],
    [{ status: 403, code: "permission_denied" }, "permission_denied", false],
    [{ status: 404, code: "model_not_found" }, "model_unavailable", false],
    [{ status: 429, code: "insufficient_quota" }, "insufficient_credit", false],
    [{ status: 429, code: "rate_limit_exceeded" }, "rate_limited", true],
    [
      { status: 400, code: "context_length_exceeded" },
      "context_length_exceeded",
      false,
    ],
    [
      { status: 400, code: "invalid_json_schema" },
      "invalid_request_schema",
      false,
    ],
    [{ status: 413, code: "request_too_large" }, "request_too_large", false],
  ] as const;

  for (const [raw, expectedCode, retryable] of cases) {
    const error = normalizeOpenAIError(raw, context);
    assert.equal(error.code, expectedCode);
    assert.equal(error.retryable, retryable);
    assert.equal(error.provider, "openai");
    assert.equal(error.model, context.model);
    assert.equal(error.requestId, context.requestId);
  }
});

test("429 quota and throttling remain distinguishable", () => {
  assert.equal(
    normalizeOpenAIError(
      {
        status: 429,
        type: "insufficient_quota",
        message: "billing limit reached",
      },
      context,
    ).code,
    "insufficient_credit",
  );
  assert.equal(
    normalizeOpenAIError(
      { status: 429, type: "requests", message: "rate limit" },
      context,
    ).code,
    "rate_limited",
  );
});

test("timeout, caller cancellation, network, and invalid output map separately", () => {
  assert.equal(
    normalizeOpenAIError(new Error("request aborted"), {
      ...context,
      callerAborted: true,
    }).code,
    "request_cancelled",
  );
  assert.equal(
    normalizeOpenAIError(new Error("request aborted"), {
      ...context,
      timedOut: true,
    }).code,
    "provider_timeout",
  );
  assert.equal(
    normalizeOpenAIError(
      Object.assign(new Error("Connection error"), {
        name: "APIConnectionError",
      }),
      context,
    ).code,
    "network_error",
  );
  assert.equal(
    normalizeOpenAIError(new SyntaxError("bad JSON"), context).code,
    "invalid_structured_output",
  );
});

test("normalized errors and serialization never expose raw secrets or content", () => {
  const secret = "sk-test-this-must-never-appear";
  const raw = {
    status: 401,
    code: "invalid_api_key",
    message: `Authorization Bearer ${secret}; selected content: private notes`,
    request: { apiKey: secret, extractedText: "private attachment" },
  };
  const shape = normalizeOpenAIError(raw, context);
  const error = new AIWriterError(shape);
  const serialized = JSON.stringify(error);

  assert.equal(error.message.includes(secret), false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private notes"), false);
  assert.equal(serialized.includes("private attachment"), false);
  assert.deepEqual(error.toJSON(), shape.toJSON());
});

test("Retry-After is parsed for internal scheduling but excluded from public details", () => {
  const error = normalizeOpenAIError(
    {
      status: 429,
      code: "rate_limit_exceeded",
      headers: new Headers({ "retry-after": "2" }),
    },
    context,
  );
  assert.equal(error.retryAfterMs, 2_000);
  assert.equal("retryAfterMs" in error.toJSON(), false);
});

test("OpenAI request ID is retained only as safe diagnostic metadata", () => {
  const error = normalizeOpenAIError(
    {
      status: 429,
      code: "rate_limit_exceeded",
      requestID: "req_openai_safe",
    },
    context,
  );
  assert.deepEqual(error.details, { providerRequestId: "req_openai_safe" });
});
