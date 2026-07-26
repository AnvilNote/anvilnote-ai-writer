import type { AiSnapshotNodeV1, EditSnapshotV1, GenericSnapshotNodeV1 } from "./edit-snapshot";
import type { ProtectedImagePlaceholderV1 } from "./protected-images";

// Provider/prompt-facing serialization of an EditSnapshotV1 — the piece
// that closes a real gap in Task 21.2's own design: `EditSnapshotV1.document`
// (the sanitized tree Task 21.2 hands back) has NO ref embedded inline on
// any node — `nodeRefs` (ref -> path) is a side `Map` that lives entirely
// OUTSIDE the document tree, built by buildEditSnapshot's internal
// `sanitizeNode` walk. That side table is exactly what Task 21.3's
// `applyEditOperations` needs (it resolves refs via its own object/path
// registry, built directly from `nodeRefs`), but it is USELESS to an actual
// model reading `snapshot.document` as JSON in a prompt: the model would
// see `{"type":"paragraph","content":[...]}` with no way to know what
// `targetRef` string to use to address that existing node in an
// `updateAttrs`/`replaceText`/`deleteNode`/`moveNode`/`replaceNode`
// operation. Without this, a model could only ever emit brand-new
// `insertNode` operations with its own invented `localRef`s — full-structure
// EDITING of anything that already exists in the document would be
// impossible.
//
// --- The chosen shape: `ref` as a sibling key, directly on every node ----
// `buildProviderEditSnapshot` walks `snapshot.document` alongside
// `snapshot.nodeRefs` (inverting ref->path into path->ref once, then
// re-associating each node with its own ref by walking the SAME positions
// `buildEditSnapshot`'s own `sanitizeNode` walk used to assign them) and
// returns a structurally near-identical tree where every node additionally
// carries its own `ref` as a plain sibling property, right next to `type`:
//   { "ref": "n5", "type": "paragraph", "content": [...] }
// This shape was chosen over a wrapper (`{ ref, node: {...} }`) because:
//   1. It is trivially JSON-serializable (every ProviderSnapshotNodeV1 below
//      is still just a plain, flat object — no extra nesting level, no
//      wrapper-vs-payload ambiguity for a model to reason about).
//   2. A model reads `ref` directly off the exact node it is looking at —
//      no external lookup table, no second document to cross-reference.
//   3. It round-trips losslessly: the `ref` string a model echoes back in a
//      `targetRef`/`parentRef`/`newParentRef` field is the EXACT SAME
//      string this module copied from `snapshot.nodeRefs`'s own keys —
//      Task 21.3's `applyEditOperations` (via `buildObjectRegistry`) already
//      resolves refs purely by STRING match against `snapshot.nodeRefs`,
//      with no notion of how a ref was serialized for display. Nothing
//      downstream needs to change to consume a ref that arrived this way.
//   4. `protectedImage` placeholders (edit-snapshot.ts's own
//      `ProtectedImagePlaceholderV1`) ALREADY carry `{ type: "protectedImage",
//      ref }` — this shape makes every OTHER node consistent with what that
//      placeholder already looks like, rather than inventing a second,
//      different ref convention for ordinary nodes.
// The document root itself (`snapshot.nodeRefs` registers path `[]` as
// addressable, e.g. as an `insertNode` parentRef meaning "append a new
// top-level child") also carries a `ref`, for the same reason.
//
// This is a genuinely NEW type (`ProviderEditSnapshotV1`), not a
// modification of `EditSnapshotV1` — the internal, trusted
// `nodeRefs`/`baseDocumentHash`/`protectedImages` bookkeeping stays exactly
// as Task 21.2 built it (still used by Task 21.3's apply engine unchanged);
// this module only ever produces an ADDITIONAL, display-oriented view for
// whatever assembles the actual model-facing prompt (see
// orchestration/build-prompt.ts's `buildEditOperationsPromptSections`).

export interface ProviderSnapshotNodeV1 {
  readonly ref: string;
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly marks?: readonly Readonly<Record<string, unknown>>[];
  readonly text?: string;
  readonly content?: readonly ProviderSnapshotNodeV1[];
}

export interface ProviderSnapshotDocumentV1 {
  readonly ref: string;
  readonly type: "doc";
  readonly content: readonly ProviderSnapshotNodeV1[];
}

export const PROVIDER_EDIT_SNAPSHOT_V1_VERSION = "anvilnote.ai.provider-edit-snapshot.v1" as const;

export interface ProviderEditSnapshotV1 {
  readonly version: typeof PROVIDER_EDIT_SNAPSHOT_V1_VERSION;
  readonly document: ProviderSnapshotDocumentV1;
}

function isProtectedImagePlaceholder(node: AiSnapshotNodeV1): node is ProtectedImagePlaceholderV1 {
  return node.type === "protectedImage";
}

function toProviderNode(
  node: AiSnapshotNodeV1,
  path: readonly number[],
  refByPathKey: ReadonlyMap<string, string>,
): ProviderSnapshotNodeV1 {
  // Protected images already carry their own `ref` (buildEditSnapshot's own
  // sanitizeNode assigns it directly onto the placeholder) — reuse it
  // as-is rather than looking it up a second time, and never descend into
  // it (it has no children by construction).
  if (isProtectedImagePlaceholder(node)) {
    return { ref: node.ref, type: node.type };
  }

  const ref = refByPathKey.get(path.join(","));
  /* istanbul ignore next -- every path buildEditSnapshot's own walk visits is registered in nodeRefs by construction; this can only fire if the two walks ever diverge. */
  if (!ref) {
    throw new Error(
      `buildProviderEditSnapshot: no ref registered for path [${path.join(",")}] — snapshot.nodeRefs is out of sync with snapshot.document.`,
    );
  }

  const generic = node as GenericSnapshotNodeV1;
  const content = Array.isArray(generic.content)
    ? generic.content.map((child, index) => toProviderNode(child, [...path, index], refByPathKey))
    : undefined;

  return {
    ref,
    type: generic.type,
    ...(generic.attrs !== undefined ? { attrs: generic.attrs } : {}),
    ...(generic.marks !== undefined ? { marks: generic.marks } : {}),
    ...(generic.text !== undefined ? { text: generic.text } : {}),
    ...(content !== undefined ? { content } : {}),
  };
}

export function buildProviderEditSnapshot(snapshot: EditSnapshotV1): ProviderEditSnapshotV1 {
  const refByPathKey = new Map<string, string>();
  for (const [ref, path] of snapshot.nodeRefs) {
    refByPathKey.set(path.join(","), ref);
  }

  const rootRef = refByPathKey.get("");
  if (!rootRef) {
    throw new Error(
      "buildProviderEditSnapshot: snapshot.nodeRefs has no entry for the document root (path []).",
    );
  }

  const content = snapshot.document.content.map((child, index) =>
    toProviderNode(child, [index], refByPathKey),
  );

  return {
    version: PROVIDER_EDIT_SNAPSHOT_V1_VERSION,
    document: { ref: rootRef, type: "doc", content },
  };
}
