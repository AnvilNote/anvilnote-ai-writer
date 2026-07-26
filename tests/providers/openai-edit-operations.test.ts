import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENAI_EDIT_OPERATIONS_SCHEMA,
  OPENAI_EDIT_OPERATIONS_SCHEMA_NAME,
  normalizeOpenAiEditOperations,
  getOpenAIModelPayloadFormat,
  validateOpenAIStrictSchema,
  buildOpenAIResponsesRequest,
  OpenAIProviderAdapter,
  prepareWriterRequest,
  type OpenAIClientLike,
  type OpenAIParsedResponseLike,
} from "../../src/server/index";
import { AI_NODE_CAPABILITIES } from "../../src/document/v2/capability-manifest";
import type { PreparedWriterRequest } from "../../src/orchestration/index";
import type { AIWriterRequest } from "../../src/contracts/index";

// --- Step 1: failing wire-schema assertions (from the plan) -------------

test("wire schema is a strict, flat, image/svg-free object schema", () => {
  assert.equal(OPENAI_EDIT_OPERATIONS_SCHEMA.additionalProperties, false);
  assert.deepEqual(OPENAI_EDIT_OPERATIONS_SCHEMA.required, ["version", "operations"]);
  const serializedSchema = JSON.stringify(OPENAI_EDIT_OPERATIONS_SCHEMA);
  assert.equal(serializedSchema.includes('"svg"'), false);
  assert.equal(serializedSchema.includes('"image"'), false);
  assert.equal(serializedSchema.includes('"pageBreak"'), true);
});

test("wire schema satisfies the OpenAI strict Structured Outputs budget", () => {
  const metrics = validateOpenAIStrictSchema(OPENAI_EDIT_OPERATIONS_SCHEMA);
  assert.ok(metrics.propertyCount > 0);
  assert.ok(metrics.propertyCount <= 5_000);
  assert.ok(metrics.maximumNestingDepth <= 10);
});

test("getOpenAIModelPayloadFormat refuses to handle the edit-operations id directly (dispatched earlier, in build-openai-request.ts, to avoid a circular import)", () => {
  assert.throws(() => getOpenAIModelPayloadFormat("anvilnote.ai.edit-operations.v1"), /edit-operations/i);
});

test("buildOpenAIResponsesRequest's request.text.format IS the precomputed edit-operations schema", () => {
  const body = buildOpenAIResponsesRequest(createEditOperationsPreparedRequest());
  const format = body.text?.format as { type?: string; strict?: boolean; name?: string; schema?: unknown } | undefined;
  assert.equal(format?.type, "json_schema");
  assert.equal(format?.strict, true);
  assert.equal(format?.name, OPENAI_EDIT_OPERATIONS_SCHEMA_NAME);
  assert.equal(format?.schema, OPENAI_EDIT_OPERATIONS_SCHEMA);
  assert.equal(format ? "$parseRaw" in format : true, false);
});

// --- Fixture builders (wire shape: nullable stands in for "optional") ----

const VERSION = "anvilnote.ai.edit-operations.v1" as const;

function envelope(operations: unknown[]): unknown {
  return { version: VERSION, operations };
}

function insertOp(node: unknown, opts?: { parentRef?: string; index?: number; localRef?: string | null }) {
  return {
    type: "insertNode",
    parentRef: opts?.parentRef ?? "n0",
    index: opts?.index ?? 0,
    node,
    localRef: opts?.localRef ?? null,
  };
}

const wireText = (text: string, marks: unknown[] | null = null) => ({ type: "text", text, marks });
const wireParagraph = (text: string) => ({
  type: "paragraph",
  attrs: null,
  content: [wireText(text)],
});

// --- Recursively collects every `type` literal found anywhere in a value,
// used to prove the full node-type universe round-trips through the wire
// schema + normalizer + real canonical parser.
function collectTypes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectTypes(entry, into);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string") into.add(record.type);
  for (const nested of Object.values(record)) collectTypes(nested, into);
}

test("covers all six edit operations end to end", () => {
  const result = normalizeOpenAiEditOperations(
    envelope([
      insertOp(wireParagraph("Hello"), { localRef: "created-1" }),
      { type: "replaceNode", targetRef: "n1", node: wireParagraph("Replaced") },
      { type: "deleteNode", targetRef: "n2" },
      { type: "moveNode", targetRef: "n3", newParentRef: "n0", index: 1 },
      {
        type: "updateAttrs",
        targetRef: "n4",
        nodeType: "heading",
        attrs: { level: 2, localRef: null },
      },
      { type: "replaceText", targetRef: "n5", text: "New text", marks: [] },
    ]),
  );
  assert.equal(result.version, VERSION);
  assert.equal(result.operations.length, 6);
  assert.deepEqual(
    result.operations.map((op) => op.type),
    ["insertNode", "replaceNode", "deleteNode", "moveNode", "updateAttrs", "replaceText"],
  );
  const insert = result.operations[0];
  assert.ok(insert && insert.type === "insertNode");
  if (insert?.type !== "insertNode") throw new Error("expected insertNode");
  assert.equal(insert.localRef, "created-1");
  assert.deepEqual(insert.node, { type: "paragraph", content: [{ type: "text", text: "Hello" }] });

  const update = result.operations[4];
  assert.ok(update && update.type === "updateAttrs");
  if (update?.type !== "updateAttrs") throw new Error("expected updateAttrs");
  assert.equal(update.nodeType, "heading");
  assert.deepEqual(update.attrs, { level: 2 });
});

test("normalizes paragraph indentation in inserted nodes and attribute updates", () => {
  const result = normalizeOpenAiEditOperations(
    envelope([
      insertOp({
        type: "paragraph",
        attrs: { indent: 2 },
        content: [wireText("Indented")],
      }),
      {
        type: "updateAttrs",
        targetRef: "n1",
        nodeType: "paragraph",
        attrs: { indent: 3 },
      },
    ]),
  );

  assert.deepEqual(result.operations, [
    {
      type: "insertNode",
      parentRef: "n0",
      index: 0,
      node: {
        type: "paragraph",
        attrs: { indent: 2 },
        content: [{ type: "text", text: "Indented" }],
      },
    },
    {
      type: "updateAttrs",
      targetRef: "n1",
      nodeType: "paragraph",
      attrs: { indent: 3 },
    },
  ]);
});

test("covers every V2 editable node type through insertNode wire payloads", () => {
  const codeBlock = { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "let x = 1;", marks: null }] };
  const heading = { type: "heading", attrs: { level: 1, localRef: null }, content: [wireText("Title")] };
  const horizontalRule = { type: "horizontalRule", attrs: null };
  const pageBreak = { type: "pageBreak", attrs: { weak: true } };
  const blockMath = { type: "blockMath", attrs: { latex: "x^2", refName: null, localRef: null } };
  const mermaid = { type: "mermaid", attrs: { source: "graph TD; A-->B;", theme: "default", primaryColor: null, width: null } };
  const functionPlot = {
    type: "functionPlot",
    attrs: { curves: [{ formula: "x^2", color: "#336699", dash: "solid", thickness: 1 }], xMin: -1, xMax: 1, showGridlines: true, showAxisTicks: true },
  };
  const statsChart = {
    type: "statsChart",
    attrs: {
      chartType: "bar",
      data: [{ label: "A", value: 1, color: null }],
      showValues: true,
      showGridLines: true,
      showBorder: true,
      fontFamily: "sans",
      xLabel: "x",
      yLabel: "y",
      yLabelRotated: false,
      width: null,
      height: null,
      caption: null,
    },
  };
  const listItem1 = { type: "listItem", content: [wireParagraph("Item 1")] };
  const bulletList = { type: "bulletList", content: [listItem1] };
  const orderedList = { type: "orderedList", attrs: null, content: [{ type: "listItem", content: [wireParagraph("Item 1")] }] };
  const blockquote = { type: "blockquote", attrs: null, content: [wireParagraph("Quoted")] };
  const callout = { type: "callout", attrs: { kind: "tip", title: null }, content: [wireParagraph("Tip body")] };
  const proof = { type: "proof", content: [wireParagraph("QED")] };
  const tableHeader = { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null, fill: null, stroke: null, inset: null, breakable: null, verticalAlign: null }, content: [wireParagraph("Head")] };
  const tableCell = { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null, fill: null, stroke: null, inset: null, breakable: null, verticalAlign: null }, content: [wireParagraph("Cell")] };
  const tableRow = { type: "tableRow", attrs: null, content: [tableHeader] };
  const table = { type: "table", attrs: null, content: [tableRow, { type: "tableRow", attrs: null, content: [tableCell] }] };
  const footnote = { type: "footnote", attrs: { localRef: "fn1" }, content: [wireParagraph("Note")] };
  const footnotes = { type: "footnotes", content: [footnote] };
  const questionSingle = {
    type: "question",
    kind: "single",
    writtenMode: "lines",
    writtenLines: 3,
    writtenHeightPercent: 20,
    writtenHeightCm: null,
    multiForceOneColumn: true,
    localRef: null,
    body: [wireParagraph("Pick one")],
    choices: [wireParagraph("A"), wireParagraph("B")],
  };

  const richParagraph = {
    type: "paragraph",
    attrs: { indent: 2 },
    content: [
      wireText("Rich "),
      { type: "hardBreak" },
      { type: "inlineMath", attrs: { latex: "x^2" } },
      { type: "crossRef", attrs: { targetRef: "some-ref" } },
      { type: "footnoteReference", attrs: { targetRef: "fn1" } },
      { type: "questionBlank", attrs: { targetRef: "q1" } },
      { type: "inlineBlank" },
    ],
  };

  const nodes = [
    richParagraph,
    heading,
    horizontalRule,
    pageBreak,
    blockMath,
    codeBlock,
    mermaid,
    functionPlot,
    statsChart,
    listItem1,
    bulletList,
    orderedList,
    blockquote,
    callout,
    proof,
    tableHeader,
    tableCell,
    tableRow,
    table,
    footnote,
    footnotes,
    questionSingle,
  ];

  const result = normalizeOpenAiEditOperations(envelope(nodes.map((node) => insertOp(node))));
  assert.equal(result.operations.length, nodes.length);

  const seenTypes = new Set<string>();
  for (const op of result.operations) {
    if (op.type === "insertNode") collectTypes(op.node, seenTypes);
  }
  // "doc" is never an insertable node; image/imageRow can never be produced
  // at all (see the schema's own header comment).
  const expectedEditableTypes = Object.entries(AI_NODE_CAPABILITIES)
    .filter(([name, policy]) => policy === "editable" && name !== "doc")
    .map(([name]) => name);
  for (const expected of expectedEditableTypes) {
    assert.ok(seenTypes.has(expected), `expected node type "${expected}" to be reachable via insertNode`);
  }
  assert.equal(seenTypes.has("image"), false);
  assert.equal(seenTypes.has("imageRow"), false);
});

test("rejects protected-image node payloads for insertNode and replaceNode", () => {
  for (const nodeType of ["image", "imageRow"]) {
    assert.throws(() =>
      normalizeOpenAiEditOperations(
        envelope([insertOp({ type: nodeType, attrs: { src: "https://example.com/a.png" } })]),
      ),
    );
    assert.throws(() =>
      normalizeOpenAiEditOperations(
        envelope([{ type: "replaceNode", targetRef: "n1", node: { type: nodeType, attrs: {} } }]),
      ),
    );
  }
});

test("rejects derived/forbidden attrs the model must never author", () => {
  // crossRef's resolvedKind/resolvedValue/broken are derived by the real
  // editor's resolver plugin, never model input — the wire schema simply
  // has no such properties, so this is rejected as an unrecognized shape.
  assert.throws(() =>
    normalizeOpenAiEditOperations(
      envelope([
        insertOp({
          type: "crossRef",
          attrs: { targetRef: "n1", resolvedKind: "heading", resolvedValue: "1", broken: false },
        }),
      ]),
    ),
  );
  // mermaid/functionPlot/statsChart never accept a caller-supplied `svg`
  // rendered-output cache.
  assert.throws(() =>
    normalizeOpenAiEditOperations(
      envelope([
        insertOp({
          type: "mermaid",
          attrs: { source: "graph TD; A-->B;", theme: "default", primaryColor: null, width: null, svg: "<svg></svg>" },
        }),
      ]),
    ),
  );
});

test("rejects a nodeType/targetRef mismatch normalized shape from updateAttrs", () => {
  // Individually schema-valid at the wire level (heading is a real
  // updateAttrs nodeType, and its patch attrs shape is satisfied), but
  // parseEditOperationsV1's own resolution semantics are what actually
  // catches a genuine nodeType/target mismatch at APPLY time (Task 21.3);
  // at the PARSE level here we instead confirm an unrecognized nodeType is
  // rejected outright.
  assert.throws(() =>
    normalizeOpenAiEditOperations(
      envelope([
        {
          type: "updateAttrs",
          targetRef: "n1",
          nodeType: "doc",
          attrs: {},
        },
      ]),
    ),
  );
});

test("rejects a duplicate insertNode localRef within one batch", () => {
  assert.throws(
    () =>
      normalizeOpenAiEditOperations(
        envelope([
          insertOp(wireParagraph("First"), { localRef: "dup" }),
          insertOp(wireParagraph("Second"), { localRef: "dup" }),
        ]),
      ),
    /localRef/i,
  );
});

test("expands the flattened wire question node into the real question/questionItem/choiceList shape", () => {
  const result = normalizeOpenAiEditOperations(
    envelope([
      insertOp({
        type: "question",
        kind: "written",
        writtenMode: "blank",
        writtenLines: 4,
        writtenHeightPercent: 40,
        writtenHeightCm: null,
        multiForceOneColumn: false,
        localRef: null,
        body: [wireParagraph("Explain your answer.")],
        choices: null,
      }),
    ]),
  );
  const insert = result.operations[0];
  assert.ok(insert && insert.type === "insertNode");
  if (insert?.type !== "insertNode") throw new Error("expected insertNode");
  assert.equal(insert.node.type, "question");
  if (insert.node.type !== "question") throw new Error("expected question");
  assert.equal(insert.node.content.length, 1);
  assert.equal(insert.node.content[0]?.type, "questionItem");
  assert.deepEqual(insert.node.content[0]?.attrs, {
    kind: "written",
    writtenMode: "blank",
    writtenLines: 4,
    writtenHeightPercent: 40,
    writtenHeightCm: null,
    multiForceOneColumn: false,
  });
});

test("preserves required-but-nullable fields (callout title, questionItem writtenHeightCm, textStyle color) through the null-strip", () => {
  const result = normalizeOpenAiEditOperations(
    envelope([
      insertOp({ type: "callout", attrs: { kind: "note", title: null }, content: [wireParagraph("Body")] }),
      insertOp(wireText("colored", [{ type: "textStyle", attrs: { color: null } }])),
    ]),
  );
  const first = result.operations[0];
  assert.ok(first && first.type === "insertNode" && first.node.type === "callout");
  if (first?.type !== "insertNode" || first.node.type !== "callout") throw new Error("expected callout");
  assert.equal(first.node.attrs.title, null);

  const second = result.operations[1];
  assert.ok(second && second.type === "insertNode" && second.node.type === "text");
  if (second?.type !== "insertNode" || second.node.type !== "text") throw new Error("expected text");
  assert.deepEqual(second.node.marks, [{ type: "textStyle", attrs: { color: null } }]);
});

test("collapses empty-string localRef/refName identifiers to omitted, matching optional canonical fields", () => {
  const result = normalizeOpenAiEditOperations(
    envelope([insertOp({ type: "heading", attrs: { level: 2, localRef: "   " }, content: [wireText("H")] })]),
  );
  const insert = result.operations[0];
  assert.ok(insert && insert.type === "insertNode" && insert.node.type === "heading");
  if (insert?.type !== "insertNode" || insert.node.type !== "heading") throw new Error("expected heading");
  assert.equal(Object.hasOwn(insert.node.attrs, "localRef"), false);
});

// --- End-to-end provider dispatch (no real OpenAI network calls) --------

function createEditOperationsPreparedRequest(): PreparedWriterRequest {
  const request: AIWriterRequest = {
    requestId: "req_edit_operations",
    intent: "compose",
    provider: { id: "openai", model: "gpt-5.6-terra" },
    instruction: "Apply the requested structural edits.",
    context: { locale: "en", writingStyle: "neutral" },
    options: { humanizerEnabled: false, maxOutputTokens: 500 },
  };
  // Task 22.1 deliberately does NOT introduce a new AIWriterIntent/profile
  // for edit-operations requests (see this task's report for the scope
  // boundary) — a real caller (anvilnote-api, Phase 23) constructs its own
  // PreparedWriterRequest-shaped object directly with
  // outputSchemaId: "anvilnote.ai.edit-operations.v1"; this test does the
  // same by preparing an ordinary compose request and then overriding just
  // the outputSchemaId, to exercise the SAME dispatch points a real caller
  // would hit.
  return { ...prepareWriterRequest(request), outputSchemaId: "anvilnote.ai.edit-operations.v1" };
}

test("buildOpenAIResponsesRequest accepts the edit-operations output schema id", () => {
  const body = buildOpenAIResponsesRequest(createEditOperationsPreparedRequest());
  assert.equal(body.store, false);
  assert.equal(body.text?.format?.type, "json_schema");
  assert.equal(
    (body.text?.format as { name?: string } | undefined)?.name,
    OPENAI_EDIT_OPERATIONS_SCHEMA_NAME,
  );
});

test("the provider adapter parses a completed edit-operations response end to end", async () => {
  const modelOutput = envelope([insertOp(wireParagraph("Generated by the model"))]);
  const response: OpenAIParsedResponseLike = {
    id: "resp_edit_ops",
    _request_id: "req_edit_ops",
    status: "completed",
    incomplete_details: null,
    output: [
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(modelOutput) }] },
    ],
    output_parsed: modelOutput,
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 15,
    },
  };
  const client: OpenAIClientLike = { responses: { parse: async () => response } };
  const adapter = new OpenAIProviderAdapter({ clientFactory: () => client });

  const result = await adapter.execute(createEditOperationsPreparedRequest(), { apiKey: "sk-test-key" });
  assert.equal(result.provider, "openai");
  assert.ok("version" in result.payload && result.payload.version === VERSION);
  if (!("version" in result.payload) || result.payload.version !== VERSION) {
    throw new Error("expected an edit-operations result");
  }
  assert.equal(result.payload.operations.length, 1);
  assert.equal(result.payload.operations[0]?.type, "insertNode");
});

test("an invalid edit-operations response is rejected as invalid structured output", async () => {
  const malformed = { version: VERSION, operations: [{ type: "insertNode", parentRef: "n0", index: 0, node: { type: "image", attrs: {} }, localRef: null }] };
  const response: OpenAIParsedResponseLike = {
    id: "resp_edit_ops_bad",
    _request_id: "req_edit_ops_bad",
    status: "completed",
    incomplete_details: null,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(malformed) }] }],
    output_parsed: malformed,
    usage: null,
  };
  const adapter = new OpenAIProviderAdapter({
    clientFactory: () => ({ responses: { parse: async () => response } }),
    sleep: async () => undefined,
  });
  await assert.rejects(
    adapter.execute(createEditOperationsPreparedRequest(), { apiKey: "sk-test-key" }),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "invalid_structured_output",
  );
});
