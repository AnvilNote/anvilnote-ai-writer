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

function schemaRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function findSchemaForNodeType(
  value: unknown,
  nodeType: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSchemaForNodeType(entry, nodeType);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const properties = record.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const typeSchema = (properties as Record<string, unknown>).type;
    if (
      typeSchema &&
      typeof typeSchema === "object" &&
      !Array.isArray(typeSchema) &&
      (typeSchema as Record<string, unknown>).const === nodeType
    ) {
      return record;
    }
  }
  for (const nested of Object.values(record)) {
    const found = findSchemaForNodeType(nested, nodeType);
    if (found) return found;
  }
  return undefined;
}

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

test("strict schema exposes only canonical callout kinds and direct children", () => {
  const format = getOpenAIModelPayloadFormat("anvilnote.ai.compose-result.v1");
  const callout = findSchemaForNodeType(format.schema, "callout");
  assert.ok(callout);
  const properties = schemaRecord(callout.properties);
  const attrs = schemaRecord(properties.attrs);
  const attrProperties = schemaRecord(attrs.properties);
  const kind = schemaRecord(attrProperties.kind);
  assert.deepEqual(kind.enum, [
    "note",
    "abstract",
    "info",
    "tip",
    "success",
    "question",
    "warning",
    "failure",
    "danger",
    "bug",
    "example",
    "quote",
  ]);
  assert.deepEqual(attrs.required, ["kind", "title"]);
  assert.equal(attrs.additionalProperties, false);

  const content = schemaRecord(properties.content);
  const items = schemaRecord(content.items);
  assert.ok(Array.isArray(items.anyOf));
  const childTypes = items.anyOf.map((entry) => {
    const child = schemaRecord(entry);
    const childProperties = schemaRecord(child.properties);
    return schemaRecord(childProperties.type).const;
  });
  assert.deepEqual(childTypes, [
    "paragraph",
    "bulletList",
    "orderedList",
    "codeBlock",
    "mathBlock",
  ]);
});

test("strict schema exposes canonical proof and question hierarchies", () => {
  const format = getOpenAIModelPayloadFormat("anvilnote.ai.compose-result.v1");
  const proof = findSchemaForNodeType(format.schema, "proof");
  assert.ok(proof);
  const proofContent = schemaRecord(schemaRecord(proof.properties).content);
  const proofItems = schemaRecord(proofContent.items);
  assert.ok(Array.isArray(proofItems.anyOf));
  assert.deepEqual(
    proofItems.anyOf.map((entry) =>
      schemaRecord(schemaRecord(schemaRecord(entry).properties).type).const,
    ),
    ["paragraph", "bulletList", "orderedList", "codeBlock", "mathBlock"],
  );

  const question = findSchemaForNodeType(format.schema, "question");
  assert.ok(question);
  const itemProperties = schemaRecord(question.properties);
  assert.deepEqual(schemaRecord(itemProperties.kind).enum, [
    "single",
    "multi",
    "written",
  ]);
  assert.deepEqual(schemaRecord(itemProperties.writtenMode).enum, ["lines", "blank"]);
  assert.equal(question.additionalProperties, false);

  const choices = schemaRecord(itemProperties.choices);
  assert.ok(Array.isArray(choices.anyOf));
  const choiceArray = choices.anyOf
    .map(schemaRecord)
    .find((entry) => entry.type === "array");
  assert.ok(choiceArray);
  const choiceItems = schemaRecord(choiceArray.items);
  assert.ok(Array.isArray(choiceItems.anyOf));
  assert.deepEqual(
    choiceItems.anyOf.map((entry) =>
      schemaRecord(schemaRecord(schemaRecord(entry).properties).type).const,
    ),
    ["paragraph", "mathBlock"],
  );
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

test("provider wire payload accepts canonical callouts and normalizes nested missing marks", () => {
  const parsed = parseOpenAIModelPayload(
    "anvilnote.ai.compose-result.v1",
    {
      ...composePayload,
      document: {
        ...composePayload.document,
        content: [
          {
            type: "callout",
            attrs: { kind: "tip", title: null },
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Use " },
                  {
                    type: "inlineMath",
                    attrs: { latex: "0 < |x-a| < delta" },
                  },
                ],
              },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Check the bound" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "mathBlock",
                attrs: {
                  latex: "L = M",
                  id: null,
                  equationNumber: null,
                  refName: null,
                },
              },
            ],
          },
        ],
      },
    },
  );

  assert.ok("document" in parsed);
  if (!("document" in parsed)) assert.fail("expected compose payload");
  assert.deepEqual(parsed.document.content[0], {
    type: "callout",
    attrs: { kind: "tip", title: null },
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Use " },
          { type: "inlineMath", attrs: { latex: "0 < |x-a| < delta" } },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Check the bound" }],
              },
            ],
          },
        ],
      },
      { type: "mathBlock", attrs: { latex: "L = M" } },
    ],
  });
});

test("provider wire payload rejects invalid callout kinds, attrs, and child blocks", () => {
  for (const callout of [
    {
      type: "callout",
      attrs: { kind: "future", title: null },
      content: [{ type: "paragraph", content: [] }],
    },
    {
      type: "callout",
      attrs: { kind: "tip", title: null, icon: "sparkles" },
      content: [{ type: "paragraph", content: [] }],
    },
    {
      type: "callout",
      attrs: { kind: "tip", title: "Tip" },
      content: [{ type: "heading", attrs: { level: 2, id: null }, content: [] }],
    },
    {
      type: "callout",
      attrs: { kind: "tip", title: "Tip" },
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [] }],
        },
      ],
    },
  ]) {
    assert.throws(() =>
      parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
        ...composePayload,
        document: { ...composePayload.document, content: [callout] },
      }),
    );
  }
});

test("provider wire payload accepts proof and all three question kinds", () => {
  const parsed = parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
    ...composePayload,
    document: {
      ...composePayload.document,
      content: [
        {
          type: "proof",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Apply the definition." },
                { type: "inlineMath", attrs: { latex: "L = M" } },
              ],
            },
          ],
        },
        {
          type: "question",
          kind: "single",
          writtenMode: "lines",
          writtenLines: 3,
          writtenHeightPercent: 20,
          writtenHeightCm: null,
          multiForceOneColumn: true,
          body: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Choose one." }],
            },
          ],
          choices: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "First" }],
            },
            {
              type: "mathBlock",
              attrs: {
                latex: "L = M",
                id: null,
                equationNumber: null,
                refName: null,
              },
            },
          ],
        },
        {
          type: "question",
          kind: "multi",
          writtenMode: "lines",
          writtenLines: 3,
          writtenHeightPercent: 20,
          writtenHeightCm: null,
          multiForceOneColumn: false,
          body: [
            { type: "paragraph", content: [{ type: "text", text: "Choose all." }] },
          ],
          choices: [
            { type: "paragraph", content: [{ type: "text", text: "A" }] },
            { type: "paragraph", content: [{ type: "text", text: "B" }] },
          ],
        },
        {
          type: "question",
          kind: "written",
          writtenMode: "blank",
          writtenLines: 3,
          writtenHeightPercent: 30,
          writtenHeightCm: null,
          multiForceOneColumn: true,
          body: [
            { type: "paragraph", content: [{ type: "text", text: "Show your work." }] },
          ],
          choices: null,
        },
      ],
    },
  });

  assert.ok("document" in parsed);
  if (!("document" in parsed)) assert.fail("expected compose payload");
  assert.deepEqual(parsed.document.content[0], {
    type: "proof",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Apply the definition." },
          { type: "inlineMath", attrs: { latex: "L = M" } },
        ],
      },
    ],
  });
  const questions = parsed.document.content.slice(1);
  assert.equal(questions.length, 3);
  assert.deepEqual(
    questions.map((question) =>
      question.type === "question" ? question.content[0]?.attrs.kind : null,
    ),
    ["single", "multi", "written"],
  );
  const first = questions[0];
  assert.ok(first && first.type === "question");
  if (!first || first.type !== "question") assert.fail("expected question");
  assert.equal(first.content[0]?.attrs.writtenHeightCm, null);
});

test("provider wire payload rejects malformed proof and question shapes", () => {
  const attrs = {
    kind: "single",
    writtenMode: "lines",
    writtenLines: 3,
    writtenHeightPercent: 20,
    writtenHeightCm: null,
    multiForceOneColumn: true,
  };
  const paragraph = { type: "paragraph", content: [] };
  for (const node of [
    { type: "proof", attrs: {}, content: [paragraph] },
    {
      type: "proof",
      content: [{ type: "heading", attrs: { level: 2, id: null }, content: [] }],
    },
    {
      type: "question",
      ...attrs,
      kind: "written",
      body: [paragraph],
      choices: [paragraph, paragraph],
    },
    {
      type: "question",
      ...attrs,
      body: [paragraph],
      choices: [
        { type: "image", attrs: { src: "x" } },
        paragraph,
      ],
    },
  ]) {
    assert.throws(() =>
      parseOpenAIModelPayload("anvilnote.ai.compose-result.v1", {
        ...composePayload,
        document: { ...composePayload.document, content: [node] },
      }),
    );
  }
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
