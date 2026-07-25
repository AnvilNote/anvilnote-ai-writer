import { parseDocumentV2 } from "../document/v2/document";
import { AI_EDIT_LIMITS } from "../document/v2/limits";
import type { AiEditOperationV1, AiEditOperationsResultV1 } from "./edit-operations-v1";
import type { AiSnapshotDocumentV1, AiSnapshotNodeV1, EditSnapshotV1, GenericSnapshotNodeV1 } from "./edit-snapshot";
import { assertProtectedImagesUnchanged } from "./protected-images";
import { AiEditError } from "./edit-errors";
import { materializeReferences, type MaterializeRegistry, type RefIdFactory } from "./materialize-references";

// Applies a batch of AI edit operations (Task 21.1's typed contracts)
// against a snapshot (Task 21.2's protected-image-sanitized view) as ONE
// atomic, all-or-nothing unit: clone -> resolve every ref against a live
// object registry -> apply each operation in order, validating its
// preconditions immediately before mutating -> materialize any batch-local
// crossRef targets -> re-validate the WHOLE resulting document (structural
// v2 rules, safety limits, image-protection invariants). If ANYTHING fails
// at any point, this function throws and returns nothing — the caller's
// own original document/snapshot is never touched (structuredClone
// protects `snapshot.document`; nothing here ever mutates the caller's
// input objects), and there is no way to observe a half-applied result,
// since a half-mutated in-progress `candidate` is only ever built on the
// stack of this call and discarded when it throws.

export interface EditDraftSummaryV1 {
  readonly operationCount: number;
  readonly addedNodeCount: number;
  readonly totalCharacterCount: number;
}

export interface VerifiedEditDraftV1 {
  readonly baseDocumentHash: string;
  readonly operations: readonly AiEditOperationV1[];
  readonly candidateDocument: AiSnapshotDocumentV1;
  readonly summary: EditDraftSummaryV1;
}

export interface ApplyEditOperationsOptionsV1 {
  readonly idFactory?: RefIdFactory;
}

// --- Live, object-identity-based ref resolution --------------------------
//
// snapshot.nodeRefs maps ref -> PATH (array of child indices), a snapshot
// of positions taken BEFORE any operation runs. Rather than keeping those
// paths up to date across every insert/delete/move in a batch (a
// notoriously fiddly cascading-index-invalidation problem), this resolves
// each ref to the actual live NODE OBJECT once, up front, then tracks
// everything by object identity from then on — a node's current
// parent+index is instead found by walking the (mutable) tree fresh each
// time it's needed (findParentAndIndex below). This sidesteps path
// invalidation entirely: objects keep their identity across splices
// (insert/delete/move only rearrange ARRAY POSITIONS, never rebuild the
// node objects themselves), so a ref registered once stays valid for the
// whole batch unless the node it names is deleted or replaced (both of
// which are validated explicitly).
function isNodeLike(value: unknown): value is GenericSnapshotNodeV1 & { content?: unknown } {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function resolvePath(root: AiSnapshotDocumentV1, path: readonly number[]): unknown {
  let current: unknown = root;
  for (const index of path) {
    const content = (current as { content?: unknown[] } | undefined)?.content;
    if (!Array.isArray(content)) return undefined;
    current = content[index];
  }
  return current;
}

function buildObjectRegistry(
  candidate: AiSnapshotDocumentV1,
  nodeRefs: ReadonlyMap<string, readonly number[]>,
): Map<string, object> {
  const registry = new Map<string, object>();
  for (const [ref, path] of nodeRefs) {
    const node = resolvePath(candidate, path);
    if (node && typeof node === "object") registry.set(ref, node);
  }
  return registry;
}

interface ParentLocation {
  readonly parent: { content: unknown[] };
  readonly index: number;
}

function findParentAndIndex(root: AiSnapshotDocumentV1, target: object): ParentLocation | undefined {
  function walk(node: unknown): ParentLocation | undefined {
    if (!isNodeLike(node)) return undefined;
    const content = node.content;
    if (!Array.isArray(content)) return undefined;
    const index = content.indexOf(target);
    if (index !== -1) return { parent: node as { content: unknown[] }, index };
    for (const child of content) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  }
  return walk(root);
}

function isProtectedImagePlaceholder(node: unknown): boolean {
  return isNodeLike(node) && node.type === "protectedImage";
}

function containsProtectedImageDescendant(node: unknown): boolean {
  if (!isNodeLike(node)) return false;
  if (node.type === "protectedImage") return true;
  const content = node.content;
  if (!Array.isArray(content)) return false;
  return content.some((child) => containsProtectedImageDescendant(child));
}

function isDescendantOf(ancestorCandidate: unknown, possibleDescendant: object): boolean {
  if (!isNodeLike(ancestorCandidate)) return false;
  const content = ancestorCandidate.content;
  if (!Array.isArray(content)) return false;
  if (content.includes(possibleDescendant)) return true;
  return content.some((child) => isDescendantOf(child, possibleDescendant));
}

function resolveLiveNode(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  ref: string,
): object {
  const node = registry.get(ref);
  if (!node) {
    throw new AiEditError("invalid_reference", { ref, reason: "ref does not resolve to any node" });
  }
  if (node !== (candidate as unknown as object) && !findParentAndIndex(candidate, node)) {
    throw new AiEditError("invalid_reference", { ref, reason: "node is no longer reachable in the document" });
  }
  return node;
}

// --- Per-operation-kind application --------------------------------------

function applyInsertNode(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  scratchRefToNode: Map<string, GenericSnapshotNodeV1>,
  usedLocalRefs: Set<string>,
  op: Extract<AiEditOperationV1, { type: "insertNode" }>,
  nextGeneratedRef: () => string,
): void {
  const parent = resolveLiveNode(candidate, registry, op.parentRef);
  if (isProtectedImagePlaceholder(parent)) {
    throw new AiEditError("unsupported_image_edit", { parentRef: op.parentRef });
  }
  const parentContent = (parent as { content?: unknown[] }).content;
  if (!Array.isArray(parentContent)) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "parent node has no content array to insert into",
      parentRef: op.parentRef,
    });
  }
  if (!Number.isInteger(op.index) || op.index < 0 || op.index > parentContent.length) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "insertNode index out of bounds",
      index: op.index,
      parentRef: op.parentRef,
    });
  }
  if (op.localRef !== undefined) {
    if (usedLocalRefs.has(op.localRef) || registry.has(op.localRef)) {
      throw new AiEditError("invalid_edit_operation", {
        reason: "duplicate or colliding localRef",
        localRef: op.localRef,
      });
    }
    usedLocalRefs.add(op.localRef);
  }

  const inserted = structuredClone(op.node) as unknown as GenericSnapshotNodeV1;
  parentContent.splice(op.index, 0, inserted);

  registry.set(nextGeneratedRef(), inserted);
  if (op.localRef !== undefined) {
    registry.set(op.localRef, inserted);
    scratchRefToNode.set(op.localRef, inserted);
  }
}

function applyReplaceNode(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  op: Extract<AiEditOperationV1, { type: "replaceNode" }>,
): void {
  const target = resolveLiveNode(candidate, registry, op.targetRef);
  if (isProtectedImagePlaceholder(target)) {
    throw new AiEditError("unsupported_image_edit", { targetRef: op.targetRef });
  }
  if (containsProtectedImageDescendant(target)) {
    throw new AiEditError("unsupported_image_edit", {
      targetRef: op.targetRef,
      reason: "target contains a protected image descendant",
    });
  }
  const location = findParentAndIndex(candidate, target);
  if (!location) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "the document root cannot be replaced",
      targetRef: op.targetRef,
    });
  }
  const replacement = structuredClone(op.node) as unknown as GenericSnapshotNodeV1;
  location.parent.content[location.index] = replacement;
  registry.set(op.targetRef, replacement);
}

function applyDeleteNode(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  op: Extract<AiEditOperationV1, { type: "deleteNode" }>,
): void {
  const target = resolveLiveNode(candidate, registry, op.targetRef);
  if (isProtectedImagePlaceholder(target)) {
    throw new AiEditError("unsupported_image_edit", { targetRef: op.targetRef });
  }
  if (containsProtectedImageDescendant(target)) {
    throw new AiEditError("unsupported_image_edit", {
      targetRef: op.targetRef,
      reason: "target contains a protected image descendant",
    });
  }
  const location = findParentAndIndex(candidate, target);
  if (!location) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "the document root cannot be deleted",
      targetRef: op.targetRef,
    });
  }
  location.parent.content.splice(location.index, 1);
}

function applyMoveNode(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  op: Extract<AiEditOperationV1, { type: "moveNode" }>,
): void {
  const target = resolveLiveNode(candidate, registry, op.targetRef);
  if (isProtectedImagePlaceholder(target)) {
    throw new AiEditError("unsupported_image_edit", { targetRef: op.targetRef });
  }
  const newParent = resolveLiveNode(candidate, registry, op.newParentRef);
  if (isProtectedImagePlaceholder(newParent)) {
    throw new AiEditError("unsupported_image_edit", { newParentRef: op.newParentRef });
  }
  if (newParent === target || isDescendantOf(target, newParent)) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "moveNode would create an ancestor cycle",
      targetRef: op.targetRef,
      newParentRef: op.newParentRef,
    });
  }
  const newParentContent = (newParent as { content?: unknown[] }).content;
  if (!Array.isArray(newParentContent)) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "new parent node has no content array",
      newParentRef: op.newParentRef,
    });
  }
  const oldLocation = findParentAndIndex(candidate, target);
  if (!oldLocation) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "the document root cannot be moved",
      targetRef: op.targetRef,
    });
  }

  oldLocation.parent.content.splice(oldLocation.index, 1);
  if (!Number.isInteger(op.index) || op.index < 0 || op.index > newParentContent.length) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "moveNode index out of bounds",
      index: op.index,
      newParentRef: op.newParentRef,
    });
  }
  newParentContent.splice(op.index, 0, target);
}

function applyUpdateAttrs(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  op: Extract<AiEditOperationV1, { type: "updateAttrs" }>,
): void {
  const target = resolveLiveNode(candidate, registry, op.targetRef) as GenericSnapshotNodeV1;
  if (isProtectedImagePlaceholder(target)) {
    throw new AiEditError("unsupported_image_edit", { targetRef: op.targetRef });
  }
  if (target.type !== op.nodeType) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "updateAttrs nodeType does not match the resolved node's actual type",
      targetRef: op.targetRef,
      declaredNodeType: op.nodeType,
      actualNodeType: target.type,
    });
  }

  const existingAttrs = (target.attrs ?? {}) as Record<string, unknown>;
  const patchAttrs = op.attrs as Record<string, unknown>;
  if (op.nodeType === "statsChart") {
    const existingChartType = existingAttrs.chartType;
    const patchChartType = patchAttrs.chartType;
    if (
      typeof existingChartType === "string" &&
      typeof patchChartType === "string" &&
      existingChartType !== patchChartType
    ) {
      throw new AiEditError("invalid_edit_operation", {
        reason: "updateAttrs cannot change a statsChart's chartType",
        targetRef: op.targetRef,
        existingChartType,
        patchChartType,
      });
    }
  }

  (target as { attrs?: Record<string, unknown> }).attrs = { ...existingAttrs, ...patchAttrs };
}

function applyReplaceText(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  op: Extract<AiEditOperationV1, { type: "replaceText" }>,
): void {
  const target = resolveLiveNode(candidate, registry, op.targetRef) as GenericSnapshotNodeV1;
  if (isProtectedImagePlaceholder(target)) {
    throw new AiEditError("unsupported_image_edit", { targetRef: op.targetRef });
  }
  if (target.type !== "text") {
    throw new AiEditError("invalid_edit_operation", {
      reason: "replaceText target is not a text node",
      targetRef: op.targetRef,
      actualNodeType: target.type,
    });
  }
  (target as { text?: string }).text = op.text;
  (target as { marks?: unknown }).marks = [...op.marks];
}

function applyOneOperation(
  candidate: AiSnapshotDocumentV1,
  registry: Map<string, object>,
  scratchRefToNode: Map<string, GenericSnapshotNodeV1>,
  usedLocalRefs: Set<string>,
  nextGeneratedRef: () => string,
  op: AiEditOperationV1,
): void {
  switch (op.type) {
    case "insertNode":
      applyInsertNode(candidate, registry, scratchRefToNode, usedLocalRefs, op, nextGeneratedRef);
      return;
    case "replaceNode":
      applyReplaceNode(candidate, registry, op);
      return;
    case "deleteNode":
      applyDeleteNode(candidate, registry, op);
      return;
    case "moveNode":
      applyMoveNode(candidate, registry, op);
      return;
    case "updateAttrs":
      applyUpdateAttrs(candidate, registry, op);
      return;
    case "replaceText":
      applyReplaceText(candidate, registry, op);
      return;
  }
}

function assertNoDuplicateDestructiveTargets(operations: readonly AiEditOperationV1[]): void {
  const seen = new Set<string>();
  for (const op of operations) {
    if (op.type !== "deleteNode" && op.type !== "replaceNode" && op.type !== "moveNode") continue;
    if (seen.has(op.targetRef)) {
      throw new AiEditError("invalid_edit_operation", {
        reason: "the same node cannot be deleted, replaced, or moved more than once in one batch",
        targetRef: op.targetRef,
      });
    }
    seen.add(op.targetRef);
  }
}

// --- Final re-validation of the whole resulting document -----------------
//
// parseSnapshotDocumentV1 bridges the SNAPSHOT-shaped tree (which may still
// contain `protectedImage` placeholders) to parseDocumentV2's real,
// per-node-type v2 schemas (which have no notion of a placeholder at all —
// they simply don't register that discriminant). It validates every REAL
// node/mark/attrs/cross-reference rule Task 20 already implemented by
// running them against a TEMPORARY placeholder-free copy, then returns the
// ORIGINAL, WITH-PLACEHOLDERS document (placeholders are exactly what
// downstream re-splices real image data back in against — outside this
// package's scope — so they must survive this validation step, not be
// stripped from the result).
function stripProtectedImagePlaceholders(node: AiSnapshotNodeV1): GenericSnapshotNodeV1 | undefined {
  if (node.type === "protectedImage") return undefined;
  const generic = node as GenericSnapshotNodeV1;
  if (!Array.isArray(generic.content)) return generic;
  const content = generic.content
    .map(stripProtectedImagePlaceholders)
    .filter((child): child is GenericSnapshotNodeV1 => child !== undefined);
  return { ...generic, content };
}

export function parseSnapshotDocumentV1(document: AiSnapshotDocumentV1): AiSnapshotDocumentV1 {
  const strippedContent = document.content
    .map(stripProtectedImagePlaceholders)
    .filter((child): child is GenericSnapshotNodeV1 => child !== undefined);
  try {
    parseDocumentV2({ version: 2, type: "doc", content: strippedContent });
  } catch (error) {
    throw new AiEditError("invalid_edit_operation", {
      reason: "the resulting document failed v2 structural validation",
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return document;
}

interface DocumentStats {
  readonly nodeCount: number;
  readonly charCount: number;
  readonly maxDepth: number;
}

function computeNodeStats(node: AiSnapshotNodeV1, depth: number): DocumentStats {
  const generic = node as GenericSnapshotNodeV1;
  let nodeCount = 1;
  let charCount = typeof generic.text === "string" ? generic.text.length : 0;
  let maxDepth = depth;
  if (Array.isArray(generic.content)) {
    for (const child of generic.content) {
      const childStats = computeNodeStats(child, depth + 1);
      nodeCount += childStats.nodeCount;
      charCount += childStats.charCount;
      maxDepth = Math.max(maxDepth, childStats.maxDepth);
    }
  }
  return { nodeCount, charCount, maxDepth };
}

function computeDocumentStats(document: AiSnapshotDocumentV1): DocumentStats {
  let nodeCount = 1; // the doc root itself
  let charCount = 0;
  let maxDepth = 0;
  for (const child of document.content) {
    const stats = computeNodeStats(child, 1);
    nodeCount += stats.nodeCount;
    charCount += stats.charCount;
    maxDepth = Math.max(maxDepth, stats.maxDepth);
  }
  return { nodeCount, charCount, maxDepth };
}

function assertDocumentWithinLimits(document: AiSnapshotDocumentV1, snapshot: EditSnapshotV1): DocumentStats {
  const stats = computeDocumentStats(document);
  const originalNodeCount = snapshot.nodeRefs.size;
  const addedNodeCount = Math.max(stats.nodeCount - originalNodeCount, 0);

  if (addedNodeCount > AI_EDIT_LIMITS.maxAddedNodes) {
    throw new AiEditError("request_too_large", { reason: "too many added nodes", addedNodeCount });
  }
  if (stats.charCount > AI_EDIT_LIMITS.maxTotalCharacters) {
    throw new AiEditError("request_too_large", {
      reason: "too many total characters",
      totalCharacterCount: stats.charCount,
    });
  }
  if (stats.maxDepth > AI_EDIT_LIMITS.maxDepth) {
    throw new AiEditError("request_too_large", { reason: "nesting too deep", maxDepth: stats.maxDepth });
  }
  return { ...stats, nodeCount: addedNodeCount };
}

export function applyEditOperations(
  snapshot: EditSnapshotV1,
  result: AiEditOperationsResultV1,
  options?: ApplyEditOperationsOptionsV1,
): VerifiedEditDraftV1 {
  if (result.operations.length > AI_EDIT_LIMITS.maxOperations) {
    throw new AiEditError("request_too_large", {
      reason: "too many operations in one batch",
      operationCount: result.operations.length,
    });
  }
  assertNoDuplicateDestructiveTargets(result.operations);

  const candidate = structuredClone(snapshot.document);
  const registry = buildObjectRegistry(candidate, snapshot.nodeRefs);
  const scratchRefToNode = new Map<string, GenericSnapshotNodeV1>();
  const usedLocalRefs = new Set<string>();
  let generatedRefCounter = 0;
  const nextGeneratedRef = (): string => `applied-${generatedRefCounter++}`;

  for (const op of result.operations) {
    applyOneOperation(candidate, registry, scratchRefToNode, usedLocalRefs, nextGeneratedRef, op);
  }

  const materializeRegistry: MaterializeRegistry = { scratchRefToNode };
  const materialized = materializeReferences(candidate, materializeRegistry, options?.idFactory);
  const parsed = parseSnapshotDocumentV1(materialized);
  const addedStats = assertDocumentWithinLimits(parsed, snapshot);
  assertProtectedImagesUnchanged(snapshot, parsed);

  return {
    baseDocumentHash: snapshot.baseDocumentHash,
    operations: result.operations,
    candidateDocument: parsed,
    summary: {
      operationCount: result.operations.length,
      addedNodeCount: addedStats.nodeCount,
      totalCharacterCount: addedStats.charCount,
    },
  };
}
