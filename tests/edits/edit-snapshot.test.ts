import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProtectedImagesUnchanged,
  buildEditSnapshot,
  type EditSnapshotSourceV1,
  type RawEditorDocumentV1,
  type RawEditorNodeV1,
} from "../../src/edits/index";

function createSnapshotSource(document: RawEditorDocumentV1): EditSnapshotSourceV1 {
  return { document };
}

const bareImage: RawEditorNodeV1 = {
  type: "image",
  attrs: { src: "https://example.com/a.png", alt: "A photo", caption: "Figure 1", width: 400 },
};

function imageRow(...images: RawEditorNodeV1[]): RawEditorNodeV1 {
  return { type: "imageRow", attrs: { gap: 12 }, content: images };
}

function heading(text: string): RawEditorNodeV1 {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text }],
  };
}

function paragraph(text: string): RawEditorNodeV1 {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

const secondImage: RawEditorNodeV1 = {
  type: "image",
  attrs: { src: "https://example.com/b.png", alt: "Another photo", caption: "Figure 2" },
};

function documentWithTwoImages(): RawEditorDocumentV1 {
  return {
    type: "doc",
    content: [
      heading("Report"),
      bareImage,
      paragraph("Some body text."),
      imageRow(secondImage, {
        type: "image",
        attrs: { src: "https://example.com/c.png" },
      }),
    ],
  };
}

test("replaces every image/imageRow subtree with an opaque protectedImage placeholder", () => {
  const snapshot = buildEditSnapshot(createSnapshotSource(documentWithTwoImages()));
  assert.equal(snapshot.protectedImages.length, 2);
  const serialized = JSON.stringify(snapshot.document);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("caption"), false);
  assert.match(snapshot.baseDocumentHash, /^[a-f0-9]{64}$/);
});

test("throws when a protected image is moved relative to the others", () => {
  // original top-level order: heading, bareImage, paragraph, imageRow — so
  // the two protected images appear in the order [bareImage, imageRow].
  // Moving the bareImage to AFTER the imageRow flips their RELATIVE order
  // (even though neither image's own content changed at all), which must
  // still be rejected: images can never be moved relative to each other.
  const original = documentWithTwoImages();
  const snapshot = buildEditSnapshot(createSnapshotSource(original));

  const [headingNode, bareImageNode, paragraphNode, imageRowNode] = original.content as [
    RawEditorNodeV1,
    RawEditorNodeV1,
    RawEditorNodeV1,
    RawEditorNodeV1,
  ];
  const candidate: RawEditorDocumentV1 = {
    type: "doc",
    content: [headingNode, paragraphNode, imageRowNode, bareImageNode],
  };

  assert.throws(() => assertProtectedImagesUnchanged(snapshot, candidate), /protected image/i);
});

test("produces stable hashes for equivalent JSON regardless of key order", () => {
  const docA: RawEditorDocumentV1 = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
  };
  const docB: RawEditorDocumentV1 = {
    type: "doc",
    content: [{ content: [{ text: "Hi", type: "text" }], type: "paragraph" }],
  };
  const snapshotA = buildEditSnapshot(createSnapshotSource(docA));
  const snapshotB = buildEditSnapshot(createSnapshotSource(docB));
  assert.equal(snapshotA.baseDocumentHash, snapshotB.baseDocumentHash);
});

test("assigns unique refs to every protected image even for duplicate-looking images", () => {
  const duplicateLooking: RawEditorDocumentV1 = {
    type: "doc",
    content: [bareImage, { ...bareImage }],
  };
  const snapshot = buildEditSnapshot(createSnapshotSource(duplicateLooking));
  assert.equal(snapshot.protectedImages.length, 2);
  const refs = snapshot.protectedImages.map((record) => record.ref);
  assert.equal(new Set(refs).size, 2);
  assert.equal(snapshot.protectedImages[0]?.canonicalSubtree, snapshot.protectedImages[1]?.canonicalSubtree);
});

test("detects byte-for-byte content changes to a protected image", () => {
  const original = documentWithTwoImages();
  const snapshot = buildEditSnapshot(createSnapshotSource(original));
  const candidate: RawEditorDocumentV1 = {
    type: "doc",
    content: original.content.map((node, index) =>
      index === 1 ? { ...(node as RawEditorNodeV1), attrs: { ...(node as RawEditorNodeV1).attrs, src: "https://example.com/CHANGED.png" } } : node,
    ) as RawEditorNodeV1[],
  };
  assert.throws(() => assertProtectedImagesUnchanged(snapshot, candidate), /protected image/i);
});

test("detects protected image duplication", () => {
  const original = documentWithTwoImages();
  const snapshot = buildEditSnapshot(createSnapshotSource(original));
  const candidate: RawEditorDocumentV1 = {
    type: "doc",
    content: [...original.content, bareImage],
  };
  assert.throws(() => assertProtectedImagesUnchanged(snapshot, candidate), /protected image/i);
});

test("detects protected image removal", () => {
  const original = documentWithTwoImages();
  const snapshot = buildEditSnapshot(createSnapshotSource(original));
  const candidate: RawEditorDocumentV1 = {
    type: "doc",
    content: original.content.filter((_, index) => index !== 1),
  };
  assert.throws(() => assertProtectedImagesUnchanged(snapshot, candidate), /protected image/i);
});

test("does not throw when protected images are genuinely unchanged", () => {
  const original = documentWithTwoImages();
  const snapshot = buildEditSnapshot(createSnapshotSource(original));
  assert.doesNotThrow(() => assertProtectedImagesUnchanged(snapshot, original));
});

test("nodeRefs maps every addressable node, including the document root, to a path", () => {
  const original = documentWithTwoImages();
  const snapshot = buildEditSnapshot(createSnapshotSource(original));

  function nodeAtPath(path: readonly number[]): unknown {
    let current: { content?: readonly unknown[] } = snapshot.document;
    for (const index of path) {
      current = (current.content as { content?: readonly unknown[] }[])[index] as {
        content?: readonly unknown[];
      };
    }
    return current;
  }

  let rootPath: readonly number[] | undefined;
  let headingPath: readonly number[] | undefined;
  for (const [ref, path] of snapshot.nodeRefs) {
    if (path.length === 0) rootPath = path;
    const node = path.length === 0 ? snapshot.document : nodeAtPath(path);
    if ((node as { type?: string }).type === "heading") headingPath = path;
    void ref;
  }

  assert.ok(rootPath);
  assert.deepEqual(rootPath, []);
  assert.ok(headingPath);
  assert.equal((nodeAtPath(headingPath as readonly number[]) as { type?: string }).type, "heading");
});
