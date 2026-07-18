import assert from "node:assert/strict";
import test from "node:test";
import type { AIWriterRequest } from "../../src/contracts/index";
import {
  buildOpenAIResponsesRequest,
  prepareWriterRequest,
} from "../../src/server/index";

function createPreparedRequest(model = "gpt-5.6-terra") {
  const request: AIWriterRequest = {
    requestId: "req_openai_request",
    intent: "compose",
    provider: { id: "openai", model },
    instruction: "Write a short technical note.",
    context: {
      locale: "en-US",
      documentType: "technical",
      writingStyle: "auto",
    },
    options: { humanizerEnabled: true, maxOutputTokens: 800 },
  };
  return prepareWriterRequest(request);
}

test("Responses request fixes the model, trust order, privacy, and strict schema", () => {
  const prepared = createPreparedRequest();
  const body = buildOpenAIResponsesRequest(prepared);

  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.store, false);
  assert.equal(body.background, false);
  assert.equal(body.stream, false);
  assert.equal(body.max_output_tokens, 800);
  assert.equal(body.truncation, "disabled");
  assert.deepEqual(body.tools, []);
  assert.equal(body.previous_response_id, undefined);
  assert.equal(body.conversation, undefined);
  assert.equal(body.prompt, undefined);
  assert.equal(body.text?.format?.type, "json_schema");
  if (body.text?.format?.type !== "json_schema") {
    assert.fail("Expected the strict JSON Schema format.");
  }
  assert.equal(body.text.format.strict, true);

  assert.deepEqual(
    Array.isArray(body.input)
      ? body.input.map((item) =>
          "role" in item ? item.role : "non-message-item",
        )
      : [],
    prepared.sections.map((section) => section.role),
  );
  assert.deepEqual(
    Array.isArray(body.input)
      ? body.input.map((item) =>
          "content" in item ? item.content : "non-message-item",
        )
      : [],
    prepared.sections.map((section) => section.content),
  );

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "apiKey",
    "OPENAI_API_KEY",
    "previous_response_id",
    "web_search",
    "file_search",
    "computer_use",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("unknown or non-OpenAI models are rejected before request creation", () => {
  assert.throws(
    () => buildOpenAIResponsesRequest(createPreparedRequest("gpt-unknown")),
    /unsupported.*model/i,
  );

  const prepared = createPreparedRequest();
  assert.throws(
    () =>
      buildOpenAIResponsesRequest({
        ...prepared,
        provider: { id: "not-openai", model: prepared.provider.model },
      }),
    /provider/i,
  );
});
