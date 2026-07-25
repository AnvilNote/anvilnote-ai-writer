import {
  canonicalJSONStringify,
  isProtectedImageNodeType,
  type ProtectedImagePlaceholderV1,
  type ProtectedImageRecord,
} from "./protected-images";

// AI edit snapshots — the request-scoped, model-facing view of a real
// editor document. buildEditSnapshot's whole job: walk the REAL, FULL
// editor document (which still literally contains "image"/"imageRow" nodes
// with their real attrs — nothing upstream of this function has stripped
// them yet), replace every image/imageRow subtree with an opaque
// `{ type: "protectedImage", ref }` placeholder, and hand back a sanitized
// tree plus a side-table (`nodeRefs`) mapping every addressable node's ref
// to its path — the mechanism Task 21.3's apply engine uses to locate
// targetRef/parentRef positions. Refs are request-scoped and never
// persisted back into real Tiptap JSON (they exist only in this in-memory
// side table and inside the placeholder nodes of the SANITIZED tree this
// module hands back).
//
// --- Why a hand-rolled SHA-256 instead of Node's `node:crypto` -----------
// The plan text asks for "Node's built-in crypto module — createHash
// ('sha256')". This package, however, is required to stay browser-safe at
// its top-level "." export: tests-dist/exports.test.mjs walks every
// `require(...)` reachable from dist/index.js and fails if ANY Node
// builtin (anything matching `node:*`) turns up — src/document/
// protected-content.ts already had to solve the identical problem for
// randomness, and solved it by using the WEB-standard `globalThis.crypto.
// randomUUID()` instead of importing "node:crypto". This task's own
// instructions have me modify src/edits/index.ts (already re-exported from
// the top-level "." export as of Task 21.1), so anything this file imports
// becomes part of that same browser-safe reachability graph. Web Crypto
// (`crypto.subtle.digest`) *is* browser-safe, but it is ALWAYS async
// (Promise-only, no sync variant exists by spec) — and buildEditSnapshot
// must be synchronous (its own Step-1 test calls it directly, unawaited).
// Neither Node's crypto NOR Web Crypto can satisfy "synchronous, SHA-256,
// zero new dependency, zero Node-builtin footprint" all at once, so this
// implements the well-known, public-domain SHA-256 algorithm (FIPS 180-4)
// directly — verified against the standard test vectors ("", "abc", "The
// quick brown fox...") during development. No dependency added; no Node
// builtin imported; fully synchronous.
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Bytes(bytes: Uint8Array): string {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const bitLengthLow = (bytes.length << 3) >>> 0;
  const withOneBit = bytes.length + 1;
  const paddedLength = Math.ceil((withOneBit + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLengthHigh, false);
  view.setUint32(paddedLength - 4, bitLengthLow, false);

  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      schedule[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(schedule[i - 15] as number, 7) ^ rotr(schedule[i - 15] as number, 18) ^ ((schedule[i - 15] as number) >>> 3);
      const s1 = rotr(schedule[i - 2] as number, 17) ^ rotr(schedule[i - 2] as number, 19) ^ ((schedule[i - 2] as number) >>> 10);
      schedule[i] = ((schedule[i - 16] as number) + s0 + (schedule[i - 7] as number) + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (SHA256_ROUND_CONSTANTS[i] as number) + (schedule[i] as number)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

export function sha256Hex(input: string): string {
  return sha256Bytes(new TextEncoder().encode(input));
}

// A generic Tiptap-JSON-shaped node. This package has no existing type for
// "a full raw editor document" (V1's own document-v1.ts/nodes-v1.ts never
// modeled images either, and AiDocumentV2/AiBlockNodeV2/AiInlineNodeV2
// structurally exclude image/imageRow entirely) — this is deliberately a
// loose, generic shape (not a full per-node-type schema) since its only job
// here is to be walked structurally to find image/imageRow subtrees; real
// per-node-type validation happens elsewhere (parseDocumentV2 for the
// canonical AST, and — post-apply — parseSnapshotDocumentV1 in Task 21.3).
export interface GenericSnapshotNodeV1 {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly marks?: readonly Readonly<Record<string, unknown>>[];
  readonly text?: string;
  readonly content?: readonly GenericSnapshotNodeV1[];
}

export type RawEditorNodeV1 = GenericSnapshotNodeV1;

export interface RawEditorDocumentV1 {
  readonly type: "doc";
  readonly content: readonly RawEditorNodeV1[];
}

// The sanitized document's own node shape: any real, untouched node PLUS an
// opaque protectedImage placeholder standing in for whatever image/imageRow
// subtree used to be there. Deep nesting (inside callout/table/questionItem
// content, etc.) is represented with the same generic {type, attrs?,
// content?} shape rather than re-threading a placeholder arm through every
// nested content field of core-nodes.ts/structured-nodes.ts/
// visual-nodes.ts (which would mean editing those files, out of scope for
// this task) — this mirrors document.ts's own GenericNodeV2 walking pattern
// for cross-node semantic validation, which likewise doesn't re-type every
// nesting level. Precise, full re-validation against the real AiDocumentV2
// union happens once, at the end of Task 21.3's apply pipeline.
export type AiSnapshotNodeV1 = GenericSnapshotNodeV1 | ProtectedImagePlaceholderV1;

export interface AiSnapshotDocumentV1 {
  readonly type: "doc";
  readonly content: readonly AiSnapshotNodeV1[];
}

export interface EditSnapshotSourceV1 {
  readonly document: RawEditorDocumentV1;
}

export const EDIT_SNAPSHOT_V1_VERSION = "anvilnote.ai.edit-snapshot.v1" as const;

export interface EditSnapshotV1 {
  readonly version: typeof EDIT_SNAPSHOT_V1_VERSION;
  readonly document: AiSnapshotDocumentV1;
  readonly baseDocumentHash: string;
  readonly nodeRefs: ReadonlyMap<string, readonly number[]>;
  readonly protectedImages: readonly ProtectedImageRecord[];
}

function sanitizeNode(
  rawNode: RawEditorNodeV1,
  path: readonly number[],
  nodeRefs: Map<string, readonly number[]>,
  protectedImages: ProtectedImageRecord[],
  nextRef: () => string,
): AiSnapshotNodeV1 {
  const ref = nextRef();
  nodeRefs.set(ref, path);

  if (isProtectedImageNodeType(rawNode.type)) {
    protectedImages.push({
      ref,
      canonicalSubtree: canonicalJSONStringify(rawNode),
      ordinal: protectedImages.length,
    });
    return { type: "protectedImage", ref };
  }

  if (!Array.isArray(rawNode.content)) {
    return rawNode;
  }

  const sanitizedContent = rawNode.content.map((child, index) =>
    sanitizeNode(child, [...path, index], nodeRefs, protectedImages, nextRef),
  );
  return { ...rawNode, content: sanitizedContent };
}

export function buildEditSnapshot(source: EditSnapshotSourceV1): EditSnapshotV1 {
  const nodeRefs = new Map<string, readonly number[]>();
  const protectedImages: ProtectedImageRecord[] = [];
  let refCounter = 0;
  const nextRef = (): string => `n${refCounter++}`;

  // The document root itself is addressable too (e.g. as an insertNode
  // parentRef meaning "insert a new top-level child") — path [] denotes
  // "the document's own top-level content array".
  nodeRefs.set(nextRef(), []);

  const content = source.document.content.map((child, index) =>
    sanitizeNode(child, [index], nodeRefs, protectedImages, nextRef),
  );
  const document: AiSnapshotDocumentV1 = { type: "doc", content };

  return {
    version: EDIT_SNAPSHOT_V1_VERSION,
    document,
    baseDocumentHash: sha256Hex(canonicalJSONStringify(document)),
    nodeRefs,
    protectedImages,
  };
}
