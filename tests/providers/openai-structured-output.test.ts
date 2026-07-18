import assert from "node:assert/strict";
import test from "node:test";
import {
  getOpenAIModelPayloadFormat,
  parseOpenAIModelPayload,
  validateOpenAIStrictSchema,
} from "../../src/server/index";

const composePayload = {
  suggestedTitle: "A concise title",
  document: {
    schemaVersion: "anvilnote.document.v1",
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Safe output.", marks: null }],
      },
    ],
  },
  summary: "Created one paragraph.",
  warnings: [],
};

test("compose and rewrite use distinct strict model-authored payload schemas", () => {
  const compose = getOpenAIModelPayloadFormat("anvilnote.ai.compose-result.v1");
  const rewrite = getOpenAIModelPayloadFormat("anvilnote.ai.rewrite-result.v1");

  assert.equal(compose.type, "json_schema");
  assert.equal(compose.strict, true);
  assert.equal(compose.name, "anvilnote_compose_payload_v1");
  assert.equal(rewrite.name, "anvilnote_rewrite_payload_v1");
  assert.notDeepEqual(compose.schema, rewrite.schema);
});

test("generated schemas satisfy the supported OpenAI strict subset", () => {
  for (const outputSchemaId of [
    "anvilnote.ai.compose-result.v1",
    "anvilnote.ai.rewrite-result.v1",
  ] as const) {
    const format = getOpenAIModelPayloadFormat(outputSchemaId);
    const metrics = validateOpenAIStrictSchema(format.schema);
    assert.ok(metrics.propertyCount > 0);
    assert.ok(metrics.propertyCount <= 5_000);
    assert.ok(metrics.maximumNestingDepth <= 10);
    const schemaText = JSON.stringify(format.schema);
    assert.equal(schemaText.includes('"$schema"'), false);
    assert.equal(schemaText.includes('"minLength"'), false);
    assert.equal(schemaText.includes('"maxLength"'), false);
  }
});

test("strict schema validation rejects unknown schema keywords", () => {
  assert.throws(
    () =>
      validateOpenAIStrictSchema({
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
        unsupportedKeyword: true,
      }),
    /unsupported keyword: unsupportedKeyword/i,
  );
});

test("model-authored schema excludes all trusted execution fields", () => {
  const schemaText = JSON.stringify(
    getOpenAIModelPayloadFormat("anvilnote.ai.compose-result.v1").schema,
  );
  for (const trustedField of [
    "usage",
    "provider",
    "model",
    "pricingVersion",
    "profileId",
    "promptVersion",
    "policyVersions",
    "requestId",
  ]) {
    assert.equal(schemaText.includes(`"${trustedField}"`), false);
  }
});

test("nullable provider AST normalizes to the domain AST and reruns local validation", () => {
  const parsed = parseOpenAIModelPayload(
    "anvilnote.ai.compose-result.v1",
    composePayload,
  );
  assert.deepEqual(parsed, {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Safe output." }],
        },
      ],
    },
  });
});

test("model payload rejects extra metadata and invalid domain content", () => {
  assert.throws(
    () =>
      parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
        ...composePayload,
        provider: "fake",
        usage: { totalTokens: 1 },
      }),
    /unrecognized|additional|provider|usage/i,
  );

  assert.throws(
    () =>
      parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
        ...composePayload,
        document: {
          ...composePayload.document,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "unsafe",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        href: "javascript:alert(1)",
                        title: null,
                        target: null,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    /unsafe link protocol/i,
  );
});

test("rewrite payload requires preserved elements and the fragment contract", () => {
  assert.throws(
    () =>
      parseOpenAIModelPayload("anvilnote.ai.rewrite-result.v1", {
        replacement: {
          schemaVersion: "anvilnote.fragment.v1",
          type: "fragment",
          content: composePayload.document.content,
        },
        changeSummary: "Shortened the selection.",
        warnings: [],
      }),
    /preservedElements/i,
  );
});
