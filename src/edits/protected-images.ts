import { AI_NODE_CAPABILITIES } from "../document/v2/capability-manifest";
import type { EditSnapshotV1 } from "./edit-snapshot";

// AI edit snapshots — image protection. Images (`image`/`imageRow`) are
// 100% AI-untouchable: opaque binary payloads a model must never see,
// invent, or move. This module is the single place that decides "is this
// node type a protected image" (cross-checked against
// capability-manifest.ts's AI_NODE_CAPABILITIES — the same source of truth
// edit-operations-v1.ts's insertNode/replaceNode image rejection already
// uses — rather than hardcoding "image"/"imageRow" a third time), and the
// place that proves, after the fact, that a candidate document's protected
// images are byte-for-byte identical to — and in the same relative order
// as — the ones a snapshot originally captured.

export interface ProtectedImagePlaceholderV1 {
  readonly type: "protectedImage";
  readonly ref: string;
}

export interface ProtectedImageRecord {
  readonly ref: string;
  readonly canonicalSubtree: string;
  readonly ordinal: number;
}

export function isProtectedImageNodeType(nodeType: unknown): nodeType is string {
  return typeof nodeType === "string" && AI_NODE_CAPABILITIES[nodeType] === "protected-image";
}

// Deterministic canonical JSON: recursively sorts object keys before
// serializing, so two structurally-identical values with differently
// ORDERED keys serialize to byte-identical strings (needed both for stable
// baseDocumentHash values and for exact protected-image content
// comparison below).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJSONStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

interface WalkableNode {
  readonly type?: unknown;
  readonly ref?: unknown;
  readonly content?: unknown;
}

function isWalkableNode(value: unknown): value is WalkableNode {
  return typeof value === "object" && value !== null;
}

// Collects, in document order, one "identity string" per protected image
// found anywhere in `node` — recursing into ordinary content but NEVER into
// an image/imageRow's own children (the whole image/imageRow subtree is one
// opaque protected unit, per buildEditSnapshot's own sanitization rule; an
// imageRow's nested images are never separately/doubly protected).
//
// `node` may be in EITHER of the two shapes this module ever deals with:
//   - a raw, real image/imageRow node (still carrying its real attrs) — its
//     identity is its own canonical JSON.
//   - an already-sanitized `protectedImage` placeholder (just a `ref`) —
//     its identity is looked up from the snapshot's own recorded
//     canonicalSubtree for that ref (refs never change identity once
//     buildEditSnapshot assigns them, so this is a safe, meaning-preserving
//     substitution).
// This lets the SAME function validate both "did the source document's
// images change" (Task 21.2's own tests, raw-vs-raw) and "did applying a
// batch of operations change images" (Task 21.3's pipeline, sanitized
// placeholders after mutation) without two parallel implementations.
function collectProtectedImageIdentities(
  node: unknown,
  protectedImagesByRef: ReadonlyMap<string, ProtectedImageRecord>,
  identities: string[],
): void {
  if (!isWalkableNode(node)) return;

  if (node.type === "protectedImage") {
    const record = typeof node.ref === "string" ? protectedImagesByRef.get(node.ref) : undefined;
    identities.push(record ? record.canonicalSubtree : `__unresolved_protected_image_ref__:${String(node.ref)}`);
    return;
  }

  if (isProtectedImageNodeType(node.type)) {
    identities.push(canonicalJSONStringify(node));
    return;
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectProtectedImageIdentities(child, protectedImagesByRef, identities);
    }
  }
}

// Throws unless `candidate`'s protected images are byte-for-byte identical
// to, and in the same relative order as, `snapshot`'s originally-captured
// ones — catches content changes, duplication, removal, AND reordering
// (moving an image anywhere, even without changing its content, is a
// violation: images can never be moved by AI edits).
export function assertProtectedImagesUnchanged(snapshot: EditSnapshotV1, candidate: unknown): void {
  const protectedImagesByRef = new Map(
    snapshot.protectedImages.map((record) => [record.ref, record] as const),
  );
  const expected = [...snapshot.protectedImages]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((record) => record.canonicalSubtree);

  const actual: string[] = [];
  collectProtectedImageIdentities(candidate, protectedImagesByRef, actual);

  if (actual.length !== expected.length) {
    throw new Error(
      `Protected image content changed: expected ${expected.length} protected image(s), found ${actual.length}.`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `Protected image content changed at position ${index} — images can never be altered, duplicated, removed, or reordered by AI edits.`,
      );
    }
  }
}
