import { z } from "zod";
import type { AiCoreBlockV2, AiCoreInlineNodeV2 } from "./core-nodes";
import type { AiStructuredBlockV2 } from "./structured-nodes";
import type { AiReferenceInlineNodeV2 } from "./reference-nodes";

// Canonical AI document v2 — the single stable entry point
// (parseDocumentV2/aiDocumentV2Schema) across Tasks 20.2-20.4. See
// capability-manifest.ts's header comment for why this AST exists.
//
// AiBlockNodeV2/AiInlineNodeV2 are each a progressive union, extended by
// later tasks:
//   - Task 20.2 (initial version): AiBlockNodeV2 = AiCoreBlockV2,
//     AiInlineNodeV2 = AiCoreInlineNodeV2.
//   - Task 20.3 (this version) adds AiStructuredBlockV2 (callout/proof/
//     question/table/footnotes) to AiBlockNodeV2, and AiReferenceInlineNodeV2
//     (crossRef/footnoteReference/questionBlank/inlineBlank) to
//     AiInlineNodeV2.
//   - Task 20.4 adds AiVisualBlockV2 (mermaid/functionPlot/statsChart) to
//     AiBlockNodeV2.
export type AiBlockNodeV2 = AiCoreBlockV2 | AiStructuredBlockV2;
export type AiInlineNodeV2 = AiCoreInlineNodeV2 | AiReferenceInlineNodeV2;

export interface AiDocumentV2 {
  readonly version: 2;
  readonly type: "doc";
  readonly content: readonly AiBlockNodeV2[];
}

// --- Cross-file recursive schema registry -----------------------------
//
// core-nodes.ts (and, from Task 20.3 onward, structured-nodes.ts) need a
// "any block node" / "any inline node" schema reference for their own
// recursive content arrays (a listItem contains arbitrary blocks; a
// paragraph contains arbitrary inline nodes; ...), but the FULL block/inline
// unions can only be assembled here, in document.ts, once every node-family
// module has defined its own local schemas — and those modules are exactly
// the ones document.ts must import concrete schemas from. That's a genuine
// import cycle between document.ts and each node-family file.
//
// Rather than fight Node's circular-ESM-module evaluation order (a
// module-top-level read of a not-yet-initialized cross-file `const` throws
// a temporal-dead-zone ReferenceError, and which direction of the cycle
// fails depends on which file happens to load first), this uses a
// registry + lazy-assembly pattern: each node-family module calls
// registerBlockSchemasV2()/registerInlineSchemasV2() at ITS OWN
// module-top-level (using only its own already-defined local consts, no
// cross-file value read at that point), and the actual discriminated union
// is only assembled the FIRST TIME it's actually needed — inside a
// z.lazy() callback, which Zod only invokes during an actual .parse() call,
// i.e. long after every module has finished loading. No file ever needs to
// read another file's binding at module-evaluation time.
// z.discriminatedUnion requires each option to be a $ZodTypeDiscriminable
// (an object schema Zod can statically read the "type" literal off of) —
// plain z.ZodTypeAny erases that, so the registries (and the register*
// function parameters) are typed against Zod's own discriminable-option
// type instead of z.ZodTypeAny, to keep this file free of `any`.
type BlockDiscriminable = z.core.$ZodTypeDiscriminable<"type">;

const blockSchemaRegistryV2: BlockDiscriminable[] = [];
const inlineSchemaRegistryV2: BlockDiscriminable[] = [];
let cachedBlockUnionV2: z.ZodTypeAny | undefined;
let cachedInlineUnionV2: z.ZodTypeAny | undefined;

export function registerBlockSchemasV2(schemas: readonly BlockDiscriminable[]): void {
  blockSchemaRegistryV2.push(...schemas);
  cachedBlockUnionV2 = undefined;
}

export function registerInlineSchemasV2(schemas: readonly BlockDiscriminable[]): void {
  inlineSchemaRegistryV2.push(...schemas);
  cachedInlineUnionV2 = undefined;
}

function assembleBlockUnionV2(): z.ZodTypeAny {
  if (!cachedBlockUnionV2) {
    if (blockSchemaRegistryV2.length === 0) {
      throw new Error(
        "AiBlockNodeV2 schema registry is empty — no v2 node modules have registered yet.",
      );
    }
    cachedBlockUnionV2 = z.discriminatedUnion(
      "type",
      blockSchemaRegistryV2 as [BlockDiscriminable, ...BlockDiscriminable[]],
    );
  }
  return cachedBlockUnionV2;
}

function assembleInlineUnionV2(): z.ZodTypeAny {
  if (!cachedInlineUnionV2) {
    if (inlineSchemaRegistryV2.length === 0) {
      throw new Error(
        "AiInlineNodeV2 schema registry is empty — no v2 node modules have registered yet.",
      );
    }
    cachedInlineUnionV2 = z.discriminatedUnion(
      "type",
      inlineSchemaRegistryV2 as [BlockDiscriminable, ...BlockDiscriminable[]],
    );
  }
  return cachedInlineUnionV2;
}

// The lazy references node-family modules import to type their own
// recursive content arrays (e.g. `z.array(blockNodeV2Reference)` for a
// listItem's content). Safe to import and use immediately at those
// modules' own top level — z.lazy() itself is a plain, fully-constructed
// schema object right away; only its INNER callback is deferred.
export const blockNodeV2Reference: z.ZodType<AiBlockNodeV2> = z.lazy(
  assembleBlockUnionV2,
) as z.ZodType<AiBlockNodeV2>;

export const inlineNodeV2Reference: z.ZodType<AiInlineNodeV2> = z.lazy(
  assembleInlineUnionV2,
) as z.ZodType<AiInlineNodeV2>;

export const aiDocumentV2Schema: z.ZodType<AiDocumentV2> = z
  .object({
    version: z.literal(2),
    type: z.literal("doc"),
    content: z.array(blockNodeV2Reference).max(10_000),
  })
  .strict() as z.ZodType<AiDocumentV2>;

export function parseDocumentV2(value: unknown): AiDocumentV2 {
  const parsed = aiDocumentV2Schema.parse(value);
  return validateDocumentSemanticsV2(parsed);
}

// --- Cross-node semantic validation (Task 20.3) ------------------------
//
// Everything below runs AFTER Zod shape-parsing succeeds, and catches
// violations a single node's own schema can't see because they depend on
// where a node sits in the tree (its parent) or on ANOTHER node elsewhere
// in the document (a crossRef's target, a duplicate localRef). Written in
// plain TypeScript over the now-fully-typed AiDocumentV2 (not a second
// round of Zod .superRefine()), walking generically via a minimal
// structural shape ({ type, attrs?, content? }) rather than a big
// discriminated switch — every V2 node conforms to that shape, so one
// walker covers blocks and inlines alike without needing to know every
// node kind by name.
interface GenericNodeV2 {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly unknown[];
}

function isGenericNodeV2(value: unknown): value is GenericNodeV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function forEachChildV2(
  node: GenericNodeV2,
  visit: (child: GenericNodeV2, index: number) => void,
): void {
  if (!Array.isArray(node.content)) return;
  node.content.forEach((child, index) => {
    if (isGenericNodeV2(child)) visit(child, index);
  });
}

// Every node kind that can carry a caller-assigned `localRef` attr, and the
// reference-target "kind" that identifies it to crossRef/footnoteReference/
// questionBlank. footnote is the only REQUIRED one (every footnote must be
// referenceable); heading/blockMath/table/questionItem's localRef is
// optional (only needed if something actually crossRefs it).
type AiReferenceTargetKindV2 = "footnote" | "heading" | "table" | "blockMath" | "questionItem";

const REFERENCE_TARGET_KIND_BY_TYPE_V2: Readonly<Record<string, AiReferenceTargetKindV2>> = {
  footnote: "footnote",
  heading: "heading",
  table: "table",
  blockMath: "blockMath",
  questionItem: "questionItem",
};

// crossRef may point at any referenceable node EXCEPT a footnote (footnotes
// have their own dedicated footnoteReference node instead — mirrors the
// real editor's cross-ref.ts CrossRefTargetIds/tiptap-footnotes split
// exactly: two disjoint pools, never interchangeable).
const CROSS_REF_TARGET_KINDS_V2 = new Set<AiReferenceTargetKindV2>([
  "heading",
  "table",
  "blockMath",
  "questionItem",
]);

function collectLocalRefsV2(document: AiDocumentV2): Map<string, AiReferenceTargetKindV2> {
  const refs = new Map<string, AiReferenceTargetKindV2>();

  function visit(node: GenericNodeV2): void {
    const kind = REFERENCE_TARGET_KIND_BY_TYPE_V2[node.type];
    const localRef = node.attrs?.localRef;
    if (kind && typeof localRef === "string" && localRef.length > 0) {
      if (refs.has(localRef)) {
        throw new Error(
          `Duplicate localRef "${localRef}" — local refs must be unique across the whole document.`,
        );
      }
      refs.set(localRef, kind);
    }
    forEachChildV2(node, (child) => visit(child));
  }

  for (const node of document.content) visit(node as GenericNodeV2);
  return refs;
}

// Parent-placement rules a single node's own Zod schema can't express
// (which container it's allowed to sit directly inside). Mirrors V1's
// validators.ts validateBlockPlacement requiredParent map, adapted to V2's
// node names (footnote/footnotes are new in V2).
const REQUIRED_PARENTS_V2: Readonly<Record<string, ReadonlySet<string>>> = {
  listItem: new Set(["bulletList", "orderedList"]),
  tableRow: new Set(["table"]),
  tableHeader: new Set(["tableRow"]),
  tableCell: new Set(["tableRow"]),
  question: new Set(["root"]),
  questionItem: new Set(["question"]),
  choiceList: new Set(["questionItem"]),
  choiceItem: new Set(["choiceList"]),
  footnotes: new Set(["root"]),
  footnote: new Set(["footnotes"]),
};

function assertQuestionHierarchyV2(document: AiDocumentV2): void {
  function walk(node: GenericNodeV2, parent: string, path: string): void {
    const required = REQUIRED_PARENTS_V2[node.type];
    if (required && !required.has(parent)) {
      throw new Error(`${node.type} is not allowed inside ${parent} (at ${path}).`);
    }
    forEachChildV2(node, (child, index) => walk(child, node.type, `${path}.content[${index}]`));
  }

  document.content.forEach((node, index) => {
    walk(node as GenericNodeV2, "root", `content[${index}]`);
  });

  // "block+ footnotes?" (see anvilnote-web's extensions.ts AnvilDocument):
  // at most one footnotes node, and only as the LAST top-level child. The
  // per-node REQUIRED_PARENTS_V2 check above already confirms footnotes
  // only ever sits at "root"; this adds the cardinality/position rule that
  // a single parent-set membership check can't express on its own.
  const footnotesIndexes = document.content
    .map((node, index) => ((node as GenericNodeV2).type === "footnotes" ? index : -1))
    .filter((index) => index >= 0);
  if (footnotesIndexes.length > 1) {
    throw new Error("A document may contain at most one footnotes node.");
  }
  if (footnotesIndexes.length === 1 && footnotesIndexes[0] !== document.content.length - 1) {
    throw new Error("footnotes must be the last top-level node in the document.");
  }
}

// Table column-geometry check — mirrors V1's validators.ts
// addTableGeometryIssues algorithm exactly (same occupied-column/rowspan
// bookkeeping), just walked as a plain assertion over every `table` node
// found ANYWHERE in the tree (not only top-level), and thrown instead of
// pushed as a Zod issue.
function assertTableGeometryV2(table: GenericNodeV2, path: string): void {
  let expectedWidth: number | null = null;
  let activeRowspans: number[] = [];

  const rows = Array.isArray(table.content) ? table.content : [];
  rows.forEach((rowValue, rowIndex) => {
    if (!isGenericNodeV2(rowValue)) return;
    const occupied = activeRowspans.map((remaining) => remaining > 0);
    const nextRowspans = activeRowspans.map((remaining) => Math.max(remaining - 1, 0));
    let column = 0;

    const cells = Array.isArray(rowValue.content) ? rowValue.content : [];
    for (const cellValue of cells) {
      if (!isGenericNodeV2(cellValue)) continue;
      const colspan = Number(cellValue.attrs?.colspan ?? 1);
      const rowspan = Number(cellValue.attrs?.rowspan ?? 1);
      while (occupied[column]) column += 1;

      for (let offset = 0; offset < colspan; offset += 1) {
        const targetColumn = column + offset;
        if (occupied[targetColumn]) {
          throw new Error(`Table cells overlap an active rowspan (at ${path}.content[${rowIndex}]).`);
        }
        occupied[targetColumn] = true;
        if (rowspan > 1) nextRowspans[targetColumn] = rowspan - 1;
      }
      column += colspan;
    }

    const rowWidth = occupied.length;
    if (expectedWidth === null) {
      if (rowWidth === 0) {
        throw new Error(`The first table row must define at least one column (at ${path}.content[${rowIndex}]).`);
      }
      expectedWidth = rowWidth;
    }
    if (
      rowWidth !== expectedWidth ||
      occupied.slice(0, expectedWidth).some((isOccupied) => !isOccupied)
    ) {
      throw new Error(
        `Table rows must resolve to the same complete column grid (at ${path}.content[${rowIndex}]).`,
      );
    }

    activeRowspans = nextRowspans.slice(0, expectedWidth);
  });

  if (activeRowspans.some((remaining) => remaining > 0)) {
    throw new Error(`A table rowspan extends beyond the final row (at ${path}).`);
  }
}

function assertTableHierarchyV2(document: AiDocumentV2): void {
  function walk(node: GenericNodeV2, path: string): void {
    if (node.type === "table") assertTableGeometryV2(node, path);
    forEachChildV2(node, (child, index) => walk(child, `${path}.content[${index}]`));
  }
  document.content.forEach((node, index) => walk(node as GenericNodeV2, `content[${index}]`));
}

function assertReferenceTargetsV2(
  document: AiDocumentV2,
  refs: ReadonlyMap<string, AiReferenceTargetKindV2>,
): void {
  function checkTarget(node: GenericNodeV2, requiredKinds: ReadonlySet<AiReferenceTargetKindV2>): void {
    const targetRef = node.attrs?.targetRef;
    if (typeof targetRef !== "string") return; // shape already enforced by Zod.
    const kind = refs.get(targetRef);
    if (!kind || !requiredKinds.has(kind)) {
      throw new Error(`${node.type} targetRef "${targetRef}" does not resolve to a valid target.`);
    }
  }

  function walk(node: GenericNodeV2): void {
    if (node.type === "crossRef") checkTarget(node, CROSS_REF_TARGET_KINDS_V2);
    if (node.type === "questionBlank") checkTarget(node, new Set(["questionItem"]));
    if (node.type === "footnoteReference") checkTarget(node, new Set(["footnote"]));
    forEachChildV2(node, (child) => walk(child));
  }

  for (const node of document.content) walk(node as GenericNodeV2);
}

export function validateDocumentSemanticsV2(document: AiDocumentV2): AiDocumentV2 {
  const refs = collectLocalRefsV2(document);
  assertQuestionHierarchyV2(document);
  assertTableHierarchyV2(document);
  assertReferenceTargetsV2(document, refs);
  return document;
}
