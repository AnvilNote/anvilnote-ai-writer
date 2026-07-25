import assert from "node:assert/strict";
import test from "node:test";
import {
  AiEditError,
  applyEditOperations,
  buildEditSnapshot,
  parseEditOperationsV1,
  type AiEditErrorCode,
  type EditSnapshotSourceV1,
  type EditSnapshotV1,
  type RawEditorDocumentV1,
} from "../../src/edits/index";
import { AI_EDIT_LIMITS } from "../../src/document/v2/limits";

function createSnapshotSource(document: RawEditorDocumentV1): EditSnapshotSourceV1 {
  return { document };
}

function throwsWithCode(code: AiEditErrorCode): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AiEditError && error.code === code;
}

interface NodeLike {
  readonly type?: string;
  readonly content?: readonly unknown[];
}

function refFor(
  snapshot: EditSnapshotV1,
  predicate: (node: NodeLike, path: readonly number[]) => boolean,
): string {
  for (const [ref, path] of snapshot.nodeRefs) {
    let current: unknown = snapshot.document;
    for (const index of path) {
      current = (current as NodeLike).content?.[index];
    }
    if (predicate(current as NodeLike, path)) return ref;
  }
  throw new Error("No matching ref found for predicate.");
}

function baseTestDocument(): RawEditorDocumentV1 {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello world" }],
      },
      {
        type: "callout",
        attrs: { kind: "note", title: "Note" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Inside callout" }] }],
      },
      { type: "image", attrs: { src: "https://example.com/a.png" } },
    ],
  };
}

function buildBaseSnapshot(): EditSnapshotV1 {
  return buildEditSnapshot(createSnapshotSource(baseTestDocument()));
}

test("applies a representative batch atomically (replaceText + moveNode)", () => {
  const originalDocument = baseTestDocument();
  const snapshot = buildEditSnapshot(createSnapshotSource(originalDocument));

  const textRef = refFor(snapshot, (node) => node.type === "text" && (node as { text?: string }).text === "Hello world");
  const paragraphRef = refFor(
    snapshot,
    (node, path) => node.type === "paragraph" && path.length === 1,
  );
  const calloutRef = refFor(snapshot, (node) => node.type === "callout");

  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [
      { type: "replaceText", targetRef: textRef, text: "Longer text", marks: [] },
      { type: "moveNode", targetRef: paragraphRef, newParentRef: calloutRef, index: 0 },
    ],
  });

  const draft = applyEditOperations(snapshot, result);
  assert.equal(draft.baseDocumentHash, snapshot.baseDocumentHash);
  assert.notDeepEqual(draft.candidateDocument, snapshot.document);
  assert.equal(draft.summary.operationCount, 2);
});

test("throws on an out-of-bounds insertNode index", () => {
  const snapshot = buildBaseSnapshot();
  const rootRef = refFor(snapshot, (_node, path) => path.length === 0);
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [
      {
        type: "insertNode",
        parentRef: rootRef,
        index: 999,
        node: { type: "paragraph", content: [] },
      },
    ],
  });
  assert.throws(() => applyEditOperations(snapshot, result), throwsWithCode("invalid_edit_operation"));
});

test("throws on an out-of-bounds moveNode index", () => {
  const snapshot = buildBaseSnapshot();
  const paragraphRef = refFor(snapshot, (node, path) => node.type === "paragraph" && path.length === 1);
  const rootRef = refFor(snapshot, (_node, path) => path.length === 0);
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [{ type: "moveNode", targetRef: paragraphRef, newParentRef: rootRef, index: 999 }],
  });
  assert.throws(() => applyEditOperations(snapshot, result));
});

test("throws when updateAttrs's declared nodeType does not match the resolved node's real type", () => {
  const snapshot = buildBaseSnapshot();
  const paragraphRef = refFor(snapshot, (node, path) => node.type === "paragraph" && path.length === 1);
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [
      { type: "updateAttrs", targetRef: paragraphRef, nodeType: "heading", attrs: { level: 2 } },
    ],
  });
  assert.throws(() => applyEditOperations(snapshot, result));
});

test("throws on a duplicate destructive target within the same batch", () => {
  const snapshot = buildBaseSnapshot();
  const calloutRef = refFor(snapshot, (node) => node.type === "callout");
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [
      { type: "deleteNode", targetRef: calloutRef },
      {
        type: "replaceNode",
        targetRef: calloutRef,
        node: { type: "paragraph", content: [] },
      },
    ],
  });
  assert.throws(() => applyEditOperations(snapshot, result));
});

test("throws on a moveNode ancestor cycle", () => {
  const snapshot = buildBaseSnapshot();
  const calloutRef = refFor(snapshot, (node) => node.type === "callout");
  const calloutParagraphRef = refFor(
    snapshot,
    (node, path) => node.type === "paragraph" && path.length === 2,
  );
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [
      { type: "moveNode", targetRef: calloutRef, newParentRef: calloutParagraphRef, index: 0 },
    ],
  });
  assert.throws(() => applyEditOperations(snapshot, result));
});

test("throws on an orphan ref that resolves to nothing in the snapshot", () => {
  const snapshot = buildBaseSnapshot();
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [{ type: "deleteNode", targetRef: "no-such-ref" }],
  });
  assert.throws(() => applyEditOperations(snapshot, result), throwsWithCode("invalid_reference"));
});

test("throws when a targetRef resolves to a protected image placeholder", () => {
  const snapshot = buildBaseSnapshot();
  const imageRef = refFor(snapshot, (node) => node.type === "protectedImage");
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [{ type: "deleteNode", targetRef: imageRef }],
  });
  assert.throws(() => applyEditOperations(snapshot, result), throwsWithCode("unsupported_image_edit"));
});

test("throws when replacing/deleting an ancestor that contains a protected image descendant", () => {
  const document: RawEditorDocumentV1 = {
    type: "doc",
    content: [
      {
        type: "callout",
        attrs: { kind: "note", title: null },
        content: [{ type: "image", attrs: { src: "https://example.com/a.png" } }],
      },
    ],
  };
  const snapshot = buildEditSnapshot(createSnapshotSource(document));
  const calloutRef = refFor(snapshot, (node) => node.type === "callout");
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [{ type: "deleteNode", targetRef: calloutRef }],
  });
  assert.throws(() => applyEditOperations(snapshot, result), throwsWithCode("unsupported_image_edit"));
});

test("throws when an otherwise-valid sequence of moveNode operations reorders protected images", () => {
  // The callout (NOT an image itself) contains image 1; a bare image 2
  // sits after it at the top level. moveNode is only ever asked to
  // relocate the CALLOUT — never an image directly, and moving a
  // container that merely HAS an image descendant is allowed structurally
  // (only replaceNode/deleteNode reject that, since those would destroy
  // the image; a plain move leaves it fully intact). But moving the
  // callout past image 2 flips the two images' relative order (image 1
  // used to precede image 2; after this move it follows it) — exactly the
  // "indirect reorder via an otherwise-individually-valid operation on
  // some OTHER node" case assertProtectedImagesUnchanged must still catch.
  const document: RawEditorDocumentV1 = {
    type: "doc",
    content: [
      {
        type: "callout",
        attrs: { kind: "note", title: null },
        content: [
          { type: "image", attrs: { src: "https://example.com/1.png" } },
          { type: "paragraph", content: [{ type: "text", text: "Caption text" }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "B" }] },
      { type: "image", attrs: { src: "https://example.com/2.png" } },
    ],
  };
  const snapshot = buildEditSnapshot(createSnapshotSource(document));
  const rootRef = refFor(snapshot, (_node, path) => path.length === 0);
  const calloutRef = refFor(snapshot, (node) => node.type === "callout");

  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [{ type: "moveNode", targetRef: calloutRef, newParentRef: rootRef, index: 2 }],
  });
  assert.throws(() => applyEditOperations(snapshot, result), /protected image/i);
});

test("never returns a partial candidate: a failing batch leaves the original document untouched", () => {
  const originalDocument = baseTestDocument();
  const independentClone = structuredClone(originalDocument);
  const snapshot = buildEditSnapshot(createSnapshotSource(originalDocument));

  const textRef = refFor(snapshot, (node) => node.type === "text" && (node as { text?: string }).text === "Hello world");
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [
      { type: "replaceText", targetRef: textRef, text: "Valid first operation", marks: [] },
      { type: "deleteNode", targetRef: "totally-unresolvable-ref" },
    ],
  });

  assert.throws(() => applyEditOperations(snapshot, result));
  assert.deepEqual(originalDocument, independentClone);
});

test("materializes a batch-local localRef into a crossRef's real targetRef", () => {
  const snapshot = buildBaseSnapshot();
  const rootRef = refFor(snapshot, (_node, path) => path.length === 0);
  const paragraphRef = refFor(snapshot, (node, path) => node.type === "paragraph" && path.length === 1);

  let counter = 0;
  const result = parseEditOperationsV1({
    version: "anvilnote.ai.edit-operations.v1",
    operations: [
      {
        type: "insertNode",
        parentRef: rootRef,
        index: 0,
        localRef: "created:heading",
        node: { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section", marks: [] }] },
      },
      {
        type: "insertNode",
        parentRef: paragraphRef,
        index: 0,
        node: { type: "crossRef", attrs: { targetRef: "created:heading" } },
      },
    ],
  });

  const draft = applyEditOperations(snapshot, result, { idFactory: () => `test-id-${counter++}` });
  const headingNode = draft.candidateDocument.content[0] as { type: string; attrs?: { localRef?: string } };
  assert.equal(headingNode.type, "heading");
  assert.equal(headingNode.attrs?.localRef, "test-id-0");

  function findCrossRef(node: unknown): { attrs?: { targetRef?: string } } | undefined {
    if (!node || typeof node !== "object") return undefined;
    const typed = node as { type?: string; content?: unknown[]; attrs?: { targetRef?: string } };
    if (typed.type === "crossRef") return typed;
    if (Array.isArray(typed.content)) {
      for (const child of typed.content) {
        const found = findCrossRef(child);
        if (found) return found;
      }
    }
    return undefined;
  }
  const crossRef = draft.candidateDocument.content.map(findCrossRef).find((found) => found);
  assert.equal(crossRef?.attrs?.targetRef, "test-id-0");
});

test("rejects a request with more operations than AI_EDIT_LIMITS.maxOperations", () => {
  const snapshot = buildBaseSnapshot();
  const calloutRef = refFor(snapshot, (node) => node.type === "callout");
  const operations = Array.from({ length: AI_EDIT_LIMITS.maxOperations + 1 }, () => ({
    type: "updateAttrs" as const,
    targetRef: calloutRef,
    nodeType: "callout" as const,
    attrs: { title: "x" },
  }));
  assert.throws(() => applyEditOperations(snapshot, { version: "anvilnote.ai.edit-operations.v1", operations }));
});
