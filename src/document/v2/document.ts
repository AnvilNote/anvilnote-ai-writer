import { z } from "zod";
import type { AiCoreBlockV2, AiCoreInlineNodeV2 } from "./core-nodes";

// Canonical AI document v2 — the single stable entry point
// (parseDocumentV2/aiDocumentV2Schema) across Tasks 20.2-20.4. See
// capability-manifest.ts's header comment for why this AST exists.
//
// AiBlockNodeV2/AiInlineNodeV2 are each a progressive union, extended by
// later tasks:
//   - Task 20.2 (this file, initial version): AiBlockNodeV2 = AiCoreBlockV2,
//     AiInlineNodeV2 = AiCoreInlineNodeV2.
//   - Task 20.3 adds AiStructuredBlockV2 (callout/proof/question/table/
//     footnotes) to AiBlockNodeV2, and AiReferenceInlineNodeV2 (crossRef/
//     footnoteReference/questionBlank/inlineBlank) to AiInlineNodeV2.
//   - Task 20.4 adds AiVisualBlockV2 (mermaid/functionPlot/statsChart) to
//     AiBlockNodeV2.
export type AiBlockNodeV2 = AiCoreBlockV2;
export type AiInlineNodeV2 = AiCoreInlineNodeV2;

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
  return aiDocumentV2Schema.parse(value);
}
