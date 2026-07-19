import assert from "node:assert/strict";
import test from "node:test";
import {
  getOpenAIModelPayloadFormat,
  normalizeMissingOpenAITextMarks,
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
  assert.equal("$parseRaw" in compose, false);
  assert.equal("$parseRaw" in rewrite, false);
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

test("compose text nodes that omit marks normalize to the public unmarked AST", () => {
  const payload = {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "paragraph" as const,
          content: [
            { type: "text" as const, text: "Plain text" },
            {
              type: "text" as const,
              text: " bold",
              marks: [{ type: "bold" as const }],
            },
            { type: "text" as const, text: " still plain", marks: null },
          ],
        },
      ],
    },
  };

  const parsed = parseOpenAIModelPayload(
    "anvilnote.ai.compose-result.v1",
    payload,
  );

  assert.ok("document" in parsed);
  if (!("document" in parsed)) assert.fail("expected compose payload");
  assert.deepEqual(parsed.document.content[0], {
    type: "paragraph",
    content: [
      { type: "text", text: "Plain text" },
      { type: "text", text: " bold", marks: [{ type: "bold" }] },
      { type: "text", text: " still plain" },
    ],
  });
  assert.equal(
    Object.hasOwn(payload.document.content[0].content[0], "marks"),
    false,
  );
});

test("narrow marks normalization is immutable and leaves valid marks unchanged", () => {
  const payload = {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "blockquote" as const,
          content: [
            {
              type: "paragraph" as const,
              content: [
                { type: "text" as const, text: "missing" },
                { type: "text" as const, text: " null", marks: null },
                {
                  type: "text" as const,
                  text: " bold",
                  marks: [{ type: "bold" as const }],
                },
                {
                  type: "text" as const,
                  text: " link",
                  marks: [
                    {
                      type: "link" as const,
                      attrs: {
                        href: "https://example.com/source",
                        title: null,
                        target: null,
                      },
                    },
                  ],
                },
                { type: "hardBreak" as const },
              ],
            },
          ],
        },
        {
          type: "mathBlock" as const,
          attrs: {
            latex: "x^2",
            id: null,
            equationNumber: null,
            refName: null,
          },
        },
      ],
    },
  };

  const normalized = normalizeMissingOpenAITextMarks(payload);

  assert.equal(normalized.normalizedMissingMarksCount, 1);
  assert.notEqual(normalized.value, payload);
  const firstBlock = payload.document.content[0];
  assert.ok(firstBlock && firstBlock.type === "blockquote");
  if (!firstBlock || firstBlock.type !== "blockquote") {
    assert.fail("expected blockquote");
  }
  const firstParagraph = firstBlock.content[0];
  assert.ok(firstParagraph && firstParagraph.type === "paragraph");
  if (!firstParagraph || firstParagraph.type !== "paragraph") {
    assert.fail("expected paragraph");
  }
  const firstText = firstParagraph.content[0];
  assert.ok(firstText && firstText.type === "text");
  if (!firstText || firstText.type !== "text") assert.fail("expected text");
  assert.equal(
    Object.hasOwn(firstText, "marks"),
    false,
  );
  assert.deepEqual(normalized.value, {
    ...payload,
    document: {
      ...payload.document,
      content: [
        {
          ...firstBlock,
          content: [
            {
              ...firstParagraph,
              content: [
                { type: "text", text: "missing", marks: null },
                { type: "text", text: " null", marks: null },
                {
                  type: "text",
                  text: " bold",
                  marks: [{ type: "bold" }],
                },
                {
                  type: "text",
                  text: " link",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        href: "https://example.com/source",
                        title: null,
                        target: null,
                      },
                    },
                  ],
                },
                { type: "hardBreak" },
              ],
            },
          ],
        },
        payload.document.content[1],
      ],
    },
  });
});

test("rewrite text nodes that omit marks normalize to the public unmarked AST", () => {
  const parsed = parseOpenAIModelPayload("anvilnote.ai.rewrite-result.v1", {
    replacement: {
      schemaVersion: "anvilnote.fragment.v1",
      type: "fragment",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "replacement" },
            { type: "text", text: " bold", marks: [{ type: "bold" }] },
          ],
        },
      ],
    },
    changeSummary: "Rewrote the selection.",
    preservedElements: [],
    warnings: [],
  });

  assert.ok("replacement" in parsed);
  if (!("replacement" in parsed)) assert.fail("expected rewrite payload");
  assert.deepEqual(parsed.replacement.content[0], {
    type: "paragraph",
    content: [
      { type: "text", text: "replacement" },
      { type: "text", text: " bold", marks: [{ type: "bold" }] },
    ],
  });
});

test("fallback does not repair non-text nodes, missing text, or an own invalid marks value", () => {
  const nonTextPayload = {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "paragraph",
          content: [{ type: "hardBreak" }],
        },
      ],
    },
  };
  const unchanged = normalizeMissingOpenAITextMarks(nonTextPayload);
  assert.equal(unchanged.value, nonTextPayload);
  assert.equal(unchanged.normalizedMissingMarksCount, 0);

  for (const invalidTextNode of [
    { type: "text", marks: null },
    { text: "missing type", marks: null },
    { type: "text", text: "undefined marks", marks: undefined },
  ]) {
    const payload = {
      ...composePayload,
      document: {
        ...composePayload.document,
        content: [
          { type: "paragraph", content: [invalidTextNode] },
        ],
      },
    };
    const normalized = normalizeMissingOpenAITextMarks(payload);
    assert.equal(normalized.normalizedMissingMarksCount, 0);
    assert.equal(normalized.value, payload);
    assert.throws(() =>
      parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", payload),
    );
  }
});

test("fallback rejects every non-array-or-null marks representation and invalid mark semantics", () => {
  const invalidMarks = [
    {},
    "bold",
    123,
    true,
    [{ type: "unknown" }],
    [{ type: "bold", attrs: {} }],
    [
      {
        type: "link",
        attrs: {
          href: "https://example.com",
          title: null,
          target: null,
          unexpected: true,
        },
      },
    ],
  ];

  for (const marks of invalidMarks) {
    assert.throws(() =>
      parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
        ...composePayload,
        document: {
          ...composePayload.document,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "invalid", marks }],
            },
          ],
        },
      }),
    );
  }
});

test("fallback does not repair other missing required fields", () => {
  const { summary: _summary, ...missingSummary } = composePayload;
  assert.throws(() =>
    parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", missingSummary),
  );
});

test("fallback leaves over-depth ASTs untouched for the existing safety validators", () => {
  let nested: unknown = {
    type: "paragraph",
    content: [{ type: "text", text: "deep", marks: null }],
  };
  for (let index = 0; index < 16; index += 1) {
    nested = {
      type: "bulletList",
      content: [{ type: "listItem", content: [nested] }],
    };
  }
  const payload = {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [nested],
    },
  };

  const normalized = normalizeMissingOpenAITextMarks(payload);
  assert.equal(normalized.value, payload);
  assert.equal(normalized.normalizedMissingMarksCount, 0);
  assert.throws(
    () => parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", payload),
    /too deep/i,
  );
});

test("empty nullable identifiers from the provider normalize to absence", () => {
  const parsed = parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "heading",
          attrs: { level: 1, id: "" },
          content: [{ type: "text", text: "Heading", marks: null }],
        },
        {
          type: "mathBlock",
          attrs: {
            latex: "x^2",
            id: "   ",
            equationNumber: null,
            refName: "",
          },
        },
      ],
    },
  });
  assert.ok("document" in parsed);
  if (!("document" in parsed)) assert.fail("expected compose payload");
  assert.deepEqual(parsed.document.content, [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Heading" }],
    },
    { type: "mathBlock", attrs: { latex: "x^2" } },
  ]);
});

test("provider wire payload accepts public mark arrays and normalizes null marks", () => {
  const parsed = parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Emphasis",
              marks: [{ type: "bold" }],
            },
            { type: "text", text: " and link", marks: null },
            {
              type: "text",
              text: "source",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://example.com/source",
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
  });
  assert.ok("document" in parsed);
  if (!("document" in parsed)) assert.fail("expected compose payload");
  assert.deepEqual(parsed.document.content[0], {
    type: "paragraph",
    content: [
      { type: "text", text: "Emphasis", marks: [{ type: "bold" }] },
      { type: "text", text: " and link" },
      {
        type: "text",
        text: "source",
        marks: [
          {
            type: "link",
            attrs: { href: "https://example.com/source" },
          },
        ],
      },
    ],
  });
});

test("provider wire payload normalizes empty mark arrays to omitted public marks", () => {
  const parsed = parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Plain text", marks: [] }],
        },
      ],
    },
  });
  assert.ok("document" in parsed);
  if (!("document" in parsed)) assert.fail("expected compose payload");
  assert.deepEqual(parsed.document.content[0], {
    type: "paragraph",
    content: [{ type: "text", text: "Plain text" }],
  });
});

test("provider wire payload rejects legacy flag-object marks", () => {
  assert.throws(() =>
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
                text: "Legacy",
                marks: {
                  bold: true,
                  italic: false,
                  strike: false,
                  code: false,
                  underline: false,
                  link: null,
                },
              },
            ],
          },
        ],
      },
    }),
  );
});

test("provider wire payload rejects duplicate or unsafe public marks", () => {
  for (const marks of [
    [{ type: "bold" }, { type: "bold" }],
    [
      {
        type: "link",
        attrs: { href: "javascript:alert(1)", title: null, target: null },
      },
    ],
  ]) {
    assert.throws(() =>
      parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
        ...composePayload,
        document: {
          ...composePayload.document,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "unsafe", marks }],
            },
          ],
        },
      }),
    );
  }
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
