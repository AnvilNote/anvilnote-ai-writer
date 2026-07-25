import assert from "node:assert/strict";
import test from "node:test";
import { AI_EDIT_LIMITS } from "../../src/document/v2/limits";
import { parseEditOperationsV1 } from "../../src/edits/index";

const VERSION = "anvilnote.ai.edit-operations.v1" as const;

function envelope(operations: unknown[]) {
  return { version: VERSION, operations };
}

test("parses a representative batch of insertNode/updateAttrs/replaceText", () => {
  // NOTE: the plan's own illustrative snippet writes the updateAttrs
  // operation as `{ type: "updateAttrs", targetRef: "n:chart", attrs: {
  // caption: "Updated" } }`, with no way to know which node-type-specific
  // attrs schema should validate `attrs` (Task 21.1 is schema-only — there
  // is no document yet to resolve targetRef against). This suite instead
  // carries an explicit `nodeType` discriminant alongside `attrs`, per this
  // task's own resolution of that ambiguity (see edit-operations-v1.ts's
  // header comment for the full reasoning).
  const result = parseEditOperationsV1(
    envelope([
      {
        type: "insertNode",
        parentRef: "n:root",
        index: 1,
        localRef: "created:summary",
        node: {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Summary", marks: [] }],
        },
      },
      {
        type: "updateAttrs",
        targetRef: "n:chart",
        nodeType: "statsChart",
        attrs: { chartType: "bar", caption: "Updated" },
      },
      { type: "replaceText", targetRef: "n:text", text: "Rewritten", marks: [{ type: "bold" }] },
    ]),
  );
  assert.equal(result.operations.length, 3);
  assert.equal(result.operations[0]?.type, "insertNode");
  assert.equal(result.operations[1]?.type, "updateAttrs");
  assert.equal(result.operations[2]?.type, "replaceText");
});

test("parses deleteNode and moveNode operations", () => {
  const result = parseEditOperationsV1(
    envelope([
      { type: "deleteNode", targetRef: "n:old" },
      { type: "moveNode", targetRef: "n:paragraph", newParentRef: "n:callout", index: 0 },
    ]),
  );
  assert.equal(result.operations.length, 2);
});

test("rejects unknown keys on the envelope", () => {
  assert.throws(() =>
    parseEditOperationsV1({ version: VERSION, operations: [], extra: true }),
  );
});

test("rejects unknown keys on an operation", () => {
  assert.throws(() =>
    parseEditOperationsV1(envelope([{ type: "deleteNode", targetRef: "n:x", extra: true }])),
  );
});

test("rejects empty ref strings", () => {
  assert.throws(() => parseEditOperationsV1(envelope([{ type: "deleteNode", targetRef: "" }])));
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        {
          type: "insertNode",
          parentRef: "",
          index: 0,
          node: { type: "paragraph", content: [] },
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([{ type: "moveNode", targetRef: "n:a", newParentRef: "", index: 0 }]),
    ),
  );
});

test("rejects duplicate localRef across insertNode operations in the same batch", () => {
  const makeInsert = () => ({
    type: "insertNode",
    parentRef: "n:root",
    index: 0,
    localRef: "created:dup",
    node: { type: "paragraph", content: [] },
  });
  assert.throws(() => parseEditOperationsV1(envelope([makeInsert(), makeInsert()])));
});

test("rejects an operation count beyond AI_EDIT_LIMITS.maxOperations", () => {
  const operations = Array.from({ length: AI_EDIT_LIMITS.maxOperations + 1 }, (_, index) => ({
    type: "deleteNode",
    targetRef: `n:${index}`,
  }));
  assert.throws(() => parseEditOperationsV1(envelope(operations)));
});

test("accepts an operation count exactly at AI_EDIT_LIMITS.maxOperations", () => {
  const operations = Array.from({ length: AI_EDIT_LIMITS.maxOperations }, (_, index) => ({
    type: "deleteNode",
    targetRef: `n:${index}`,
  }));
  const result = parseEditOperationsV1(envelope(operations));
  assert.equal(result.operations.length, AI_EDIT_LIMITS.maxOperations);
});

test("rejects a caller-supplied svg attr on an inserted node", () => {
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        {
          type: "insertNode",
          parentRef: "n:root",
          index: 0,
          node: { type: "mermaid", attrs: { source: "graph TD", theme: "default", svg: "<svg/>" } },
        },
      ]),
    ),
  );
});

test("rejects hand-authored stable identity fields on an inserted node", () => {
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        {
          type: "insertNode",
          parentRef: "n:root",
          index: 0,
          node: {
            type: "heading",
            attrs: { level: 2, id: "h1" },
            content: [{ type: "text", text: "Title", marks: [] }],
          },
        },
      ]),
    ),
  );
});

test("rejects insertNode/replaceNode targeting image or imageRow node types", () => {
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        {
          type: "insertNode",
          parentRef: "n:root",
          index: 0,
          node: { type: "image", attrs: { src: "https://example.com/a.png" } },
        },
      ]),
    ),
    /unsupported_image_edit/,
  );
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([{ type: "replaceNode", targetRef: "n:img", node: { type: "imageRow", attrs: {} } }]),
    ),
    /unsupported_image_edit/,
  );
});

test("rejects updateAttrs whose attrs value fails the resolved per-node-type patch schema", () => {
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        { type: "updateAttrs", targetRef: "n:h", nodeType: "heading", attrs: { level: "two" } },
      ]),
    ),
  );
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        {
          type: "updateAttrs",
          targetRef: "n:h",
          nodeType: "heading",
          attrs: { unknownField: true },
        },
      ]),
    ),
  );
});

test("accepts a partial subset of a node's attrs for updateAttrs", () => {
  const result = parseEditOperationsV1(
    envelope([
      { type: "updateAttrs", targetRef: "n:callout", nodeType: "callout", attrs: { title: "New" } },
    ]),
  );
  const op = result.operations[0];
  assert.equal(op?.type, "updateAttrs");
  assert.deepEqual(op && "attrs" in op ? op.attrs : undefined, { title: "New" });
});

test("normalizes patched attrs the same way the underlying v2 schema would (trims localRef)", () => {
  const result = parseEditOperationsV1(
    envelope([
      {
        type: "updateAttrs",
        targetRef: "n:heading",
        nodeType: "heading",
        attrs: { localRef: "  padded  " },
      },
    ]),
  );
  const op = result.operations[0];
  assert.equal(op?.type, "updateAttrs");
  assert.deepEqual(op && "attrs" in op ? op.attrs : undefined, { localRef: "padded" });
});

test("rejects replaceText with duplicate mark types", () => {
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        {
          type: "replaceText",
          targetRef: "n:text",
          text: "Hello",
          marks: [{ type: "bold" }, { type: "bold" }],
        },
      ]),
    ),
  );
});

test("rejects negative indexes on insertNode and moveNode", () => {
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([
        { type: "insertNode", parentRef: "n:root", index: -1, node: { type: "paragraph", content: [] } },
      ]),
    ),
  );
  assert.throws(() =>
    parseEditOperationsV1(
      envelope([{ type: "moveNode", targetRef: "n:a", newParentRef: "n:b", index: -1 }]),
    ),
  );
});
