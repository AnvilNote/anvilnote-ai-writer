import type { AiSnapshotDocumentV1, GenericSnapshotNodeV1 } from "./edit-snapshot";

// AI edit operations — materializing batch-local scratch refs.
//
// insertNode's own `localRef` (e.g. "created:summary", per Task 21.1's own
// example) is a BATCH-SCOPED handle: it lets OTHER operations in the SAME
// batch address a node the model just created, before that node has any
// real, document-persisted identity. Two genuinely different things can
// reference it:
//   (1) another operation's targetRef/parentRef/newParentRef — resolved
//       DURING the main apply loop (apply-edit-operations.ts's own object
//       registry), not here.
//   (2) a newly-inserted (or updated) crossRef/footnoteReference/
//       questionBlank NODE's own `attrs.targetRef` — a genuinely different,
//       DOCUMENT-LEVEL reference namespace (it addresses another node's
//       persisted `attrs.localRef` value, the same mechanism
//       document/v2/document.ts's assertReferenceTargetsV2 already
//       validates) that must survive into the actual saved Tiptap content.
// This module handles case (2): after all operations have been applied
// structurally, it finds every crossRef/footnoteReference/questionBlank
// node whose targetRef is actually one of the batch's scratch refs, and
// MATERIALIZES the connection — assigning the freshly-inserted target node
// a real, trusted `localRef` (via the injected/random id factory, NEVER the
// model's own scratch string) if it doesn't already have one, then
// rewriting the referencing node's targetRef to that trusted value. The
// model's own scratch name never itself survives into the output; only the
// factory-generated id does — refs stay request-scoped, never persisted,
// exactly as edit-snapshot.ts's own header comment already establishes for
// the OTHER ref namespace.
export type RefIdFactory = () => string;

export function defaultRefIdFactory(): string {
  return globalThis.crypto.randomUUID();
}

// Node types whose attrs carry a `localRef` slot addressable by crossRef/
// footnoteReference/questionBlank's own targetRef (mirrors document/v2/
// document.ts's REFERENCE_TARGET_KIND_BY_TYPE_V2 — kept as a local literal
// list rather than imported, since document.ts doesn't export that map;
// matches this package's existing "small validators get duplicated rather
// than threaded across files" convention, e.g. marks.ts's own protocol
// allowlist).
const LOCAL_REF_BEARING_NODE_TYPES = new Set(["heading", "blockMath", "table", "questionItem", "footnote"]);
const REFERENCE_NODE_TYPES = new Set(["crossRef", "footnoteReference", "questionBlank"]);

// Populated during apply-edit-operations.ts's own main loop: one entry per
// insertNode operation that carried an operation-level `localRef`, mapping
// that scratch string to the actual (live, mutable) node object it
// inserted into the candidate tree.
export interface MaterializeRegistry {
  readonly scratchRefToNode: ReadonlyMap<string, GenericSnapshotNodeV1>;
}

function isGenericNode(value: unknown): value is GenericSnapshotNodeV1 {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function forEachDescendant(node: unknown, visit: (node: GenericSnapshotNodeV1) => void): void {
  if (!isGenericNode(node)) return;
  visit(node);
  if (!Array.isArray(node.content)) return;
  for (const child of node.content) forEachDescendant(child, visit);
}

export function materializeReferences(
  candidate: AiSnapshotDocumentV1,
  registry: MaterializeRegistry,
  idFactory: RefIdFactory = defaultRefIdFactory,
): AiSnapshotDocumentV1 {
  if (registry.scratchRefToNode.size === 0) return candidate;

  const everyNode: GenericSnapshotNodeV1[] = [];
  for (const node of candidate.content) forEachDescendant(node, (n) => everyNode.push(n));

  const usedScratchRefs = new Set<string>();
  for (const node of everyNode) {
    if (!REFERENCE_NODE_TYPES.has(node.type)) continue;
    const targetRef = (node.attrs as Record<string, unknown> | undefined)?.targetRef;
    if (typeof targetRef === "string" && registry.scratchRefToNode.has(targetRef)) {
      usedScratchRefs.add(targetRef);
    }
  }
  if (usedScratchRefs.size === 0) return candidate;

  const finalRefByScratchRef = new Map<string, string>();
  for (const scratchRef of usedScratchRefs) {
    const targetNode = registry.scratchRefToNode.get(scratchRef);
    // Nothing to materialize onto a node type that has no localRef slot at
    // all (e.g. the model scratch-referenced a freshly-inserted paragraph)
    // — the targetRef is left as the original scratch string, and the
    // final parseDocumentV2 validation downstream will correctly reject it
    // as an unresolved reference.
    if (!targetNode || !LOCAL_REF_BEARING_NODE_TYPES.has(targetNode.type)) continue;

    const existingAttrs = (targetNode.attrs ?? {}) as Record<string, unknown>;
    const existingLocalRef = existingAttrs.localRef;
    const finalRef =
      typeof existingLocalRef === "string" && existingLocalRef.length > 0
        ? existingLocalRef
        : idFactory();
    if (finalRef !== existingLocalRef) {
      (targetNode as { attrs?: Record<string, unknown> }).attrs = {
        ...existingAttrs,
        localRef: finalRef,
      };
    }
    finalRefByScratchRef.set(scratchRef, finalRef);
  }

  for (const node of everyNode) {
    if (!REFERENCE_NODE_TYPES.has(node.type)) continue;
    const attrs = node.attrs as Record<string, unknown> | undefined;
    const targetRef = attrs?.targetRef;
    if (typeof targetRef === "string" && finalRefByScratchRef.has(targetRef)) {
      (node as { attrs?: Record<string, unknown> }).attrs = {
        ...attrs,
        targetRef: finalRefByScratchRef.get(targetRef),
      };
    }
  }

  return candidate;
}
