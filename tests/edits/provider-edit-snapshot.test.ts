import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEditSnapshot,
  buildProviderEditSnapshot,
  PROVIDER_EDIT_SNAPSHOT_V1_VERSION,
  type EditSnapshotSourceV1,
  type ProviderSnapshotNodeV1,
  type RawEditorDocumentV1,
} from "../../src/edits/index";

function createSnapshotSource(document: RawEditorDocumentV1): EditSnapshotSourceV1 {
  return { document };
}

function nestedDocument(): RawEditorDocumentV1 {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      {
        type: "callout",
        attrs: { kind: "tip", title: null },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First" }] },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item A" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item B" }] }] },
            ],
          },
        ],
      },
      {
        type: "imageRow",
        attrs: { gap: 12 },
        content: [{ type: "image", attrs: { src: "https://example.com/a.png" } }],
      },
    ],
  };
}

// Recursively collects every node in a provider-facing tree, keyed by ref,
// and separately every path->node association (walking `content` arrays).
function collectByRef(
  node: ProviderSnapshotNodeV1 | { ref: string; type: "doc"; content: readonly ProviderSnapshotNodeV1[] },
  into: Map<string, unknown>,
): void {
  if (into.has(node.ref)) {
    throw new Error(`duplicate ref encountered in provider snapshot: ${node.ref}`);
  }
  into.set(node.ref, node);
  if ("content" in node && Array.isArray(node.content)) {
    for (const child of node.content) collectByRef(child, into);
  }
}

test("every addressable node gets a ref embedded directly on the node, visible without any external lookup", () => {
  const snapshot = buildEditSnapshot(createSnapshotSource(nestedDocument()));
  const providerSnapshot = buildProviderEditSnapshot(snapshot);

  assert.equal(providerSnapshot.version, PROVIDER_EDIT_SNAPSHOT_V1_VERSION);
  assert.equal(providerSnapshot.document.type, "doc");
  assert.equal(typeof providerSnapshot.document.ref, "string");

  // Round trip: every ref buildEditSnapshot registered in its internal
  // nodeRefs side table appears EXACTLY ONCE in the provider-facing tree,
  // and is directly readable as a sibling of `type` on the node it names —
  // no side table needed to resolve it.
  const byRef = new Map<string, unknown>();
  collectByRef(providerSnapshot.document, byRef);

  assert.equal(byRef.size, snapshot.nodeRefs.size);
  for (const ref of snapshot.nodeRefs.keys()) {
    assert.ok(byRef.has(ref), `ref "${ref}" from snapshot.nodeRefs did not appear in the provider snapshot`);
  }

  // Spot-check a few nodes structurally: the heading, the callout, and a
  // nested listItem all carry `ref` directly alongside `type`/`attrs`/
  // `content`, with no wrapper indirection.
  const heading = providerSnapshot.document.content[0];
  assert.ok(heading);
  assert.equal(heading?.type, "heading");
  assert.equal(typeof heading?.ref, "string");
  assert.deepEqual(heading?.attrs, { level: 1 });

  const callout = providerSnapshot.document.content[1];
  assert.ok(callout && callout.type === "callout");
  const bulletList = callout?.content?.[1];
  assert.ok(bulletList && bulletList.type === "bulletList");
  const firstListItem = bulletList?.content?.[0];
  assert.ok(firstListItem && firstListItem.type === "listItem");
  assert.equal(typeof firstListItem?.ref, "string");
  assert.notEqual(firstListItem?.ref, callout?.ref);
});

test("protectedImage placeholders keep their own existing ref rather than being assigned a second one", () => {
  const snapshot = buildEditSnapshot(createSnapshotSource(nestedDocument()));
  const providerSnapshot = buildProviderEditSnapshot(snapshot);

  const imageRow = providerSnapshot.document.content[2];
  assert.ok(imageRow && imageRow.type === "protectedImage");
  const expectedRef = snapshot.protectedImages[0]?.ref;
  assert.ok(expectedRef);
  assert.equal(imageRow?.ref, expectedRef);
  // Protected images are opaque — no content/attrs leak through.
  assert.equal(Object.hasOwn(imageRow ?? {}, "content"), false);
  assert.equal(Object.hasOwn(imageRow ?? {}, "attrs"), false);
});

test("a ref read off an existing node round-trips as a valid targetRef against the trusted apply engine's own registry", () => {
  // This is the whole point of the ProviderEditSnapshotV1 shape: a ref the
  // model reads off an EXISTING node and echoes back must be the exact same
  // string applyEditOperations (Task 21.3) already resolves against
  // snapshot.nodeRefs — no translation step required downstream.
  const snapshot = buildEditSnapshot(createSnapshotSource(nestedDocument()));
  const providerSnapshot = buildProviderEditSnapshot(snapshot);
  const headingRef = providerSnapshot.document.content[0]?.ref;
  assert.ok(headingRef);
  assert.ok(snapshot.nodeRefs.has(headingRef as string));
});
