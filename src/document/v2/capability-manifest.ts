// Capability manifest for AnvilNote's full editor schema (Smart Mode v1.2).
//
// Unlike the older, narrower V1 policy classifier (existing-node-policies.ts,
// left untouched by this task — it is superseded by later tasks in this
// plan, not this one), this manifest is meant to cover EVERY content-bearing
// node and mark actually registered by anvilnote-web's
// `buildExtensions()` (src/lib/tiptap/extensions.ts), verified directly
// against that file and the individual extension sources/packages it pulls
// in (StarterKit, tiptap-footnotes, @tiptap/extension-mathematics, etc.) —
// not guessed from the old, incomplete list.
//
// Every node gets exactly one of two policies:
//   - "editable": Smart Mode's full-structure AI editing may read, generate,
//     and rewrite this node like any other document content.
//   - "protected-image": binary image payloads (`image`, `imageRow`) are
//     opaque to the AI — it can rearrange/caption them but must not be asked
//     to invent or rewrite the pixel data itself.
//
// Marks only ever get "editable" for now — there is no protected mark case
// yet, but the union type is kept two-armed (matching the node union) so
// call sites that switch on this type stay honest if that ever changes.
export type AiNodeCapability = "editable" | "protected-image";
export type AiMarkCapability = "editable";

export type AiMarkTypeV2 =
  | "bold"
  | "italic"
  | "strike"
  | "underline"
  | "code"
  | "link"
  | "textStyle";

// Node names verified by reading anvilnote-web/src/lib/tiptap/extensions.ts's
// buildExtensions() plus the underlying extension sources:
//   - StarterKit (@tiptap/starter-kit v3.27.1) contributes, at its enabled
//     defaults (codeBlock/document/blockquote/horizontalRule are explicitly
//     disabled there and replaced below): bulletList, hardBreak, heading,
//     listItem, orderedList, paragraph, text — plus marks bold, italic,
//     strike, code, underline, link (see AiMarkTypeV2 above). Non-content
//     StarterKit internals (dropcursor, gapcursor, undoRedo, listKeymap,
//     trailingNode) are Extension.create-only (no schema type) and are
//     correctly absent here.
//   - AnvilDocument extends @tiptap/extension-document, whose real node name
//     is "doc" (NOT "document").
//   - AnvilBlockquote extends @tiptap/extension-blockquote, keeping its name
//     "blockquote".
//   - AnvilDivider extends @tiptap/extension-horizontal-rule, keeping its
//     name "horizontalRule".
//   - tiptap-footnotes contributes footnotes, footnote, footnoteReference.
//   - AnvilImage extends @tiptap/extension-image, keeping its name "image".
//   - AnvilImageRow's own name is "imageRow".
//   - AnvilTable/AnvilTableRow/AnvilTableHeader/AnvilTableCell extend
//     @tiptap/extension-table(-row/-header/-cell), keeping table/tableRow/
//     tableHeader/tableCell.
//   - @tiptap/extension-mathematics contributes inlineMath and blockMath.
//   - cross-ref.ts's CrossRefTargetIds is an Extension.create (global
//     attributes only, no schema type of its own) — correctly absent here;
//     CrossRef is the real Node.create with name "crossRef".
//   - question-blank.ts/inline-blank.ts/mermaid.ts/stats-chart.ts/
//     function-plot.ts/proof.ts/code-block.ts/callout.ts/question.ts each
//     define one real Node.create with the name used below.
export const AI_NODE_CAPABILITIES: Readonly<Record<string, AiNodeCapability>> =
  Object.freeze({
    doc: "editable",
    paragraph: "editable",
    text: "editable",
    heading: "editable",
    bulletList: "editable",
    orderedList: "editable",
    listItem: "editable",
    hardBreak: "editable",
    blockquote: "editable",
    horizontalRule: "editable",
    pageBreak: "editable",
    codeBlock: "editable",
    callout: "editable",
    proof: "editable",
    mermaid: "editable",
    functionPlot: "editable",
    statsChart: "editable",
    question: "editable",
    questionItem: "editable",
    choiceList: "editable",
    choiceItem: "editable",
    table: "editable",
    tableRow: "editable",
    tableHeader: "editable",
    tableCell: "editable",
    inlineMath: "editable",
    blockMath: "editable",
    crossRef: "editable",
    questionBlank: "editable",
    inlineBlank: "editable",
    footnotes: "editable",
    footnote: "editable",
    footnoteReference: "editable",
    image: "protected-image",
    imageRow: "protected-image",
  });

export type EditorContentNodeName = keyof typeof AI_NODE_CAPABILITIES;

export const AI_MARK_CAPABILITIES: Readonly<Record<AiMarkTypeV2, AiMarkCapability>> =
  Object.freeze({
    bold: "editable",
    italic: "editable",
    strike: "editable",
    underline: "editable",
    code: "editable",
    link: "editable",
    textStyle: "editable",
  });

function formatNameList(names: readonly string[]): string {
  return [...names].sort().join(", ");
}

// Fails loudly and specifically — naming exactly which node/mark names are
// unaccounted for in either direction — rather than silently ignoring a
// newly-registered editor extension (missing) or letting the manifest drift
// stale relative to what's actually wired up in buildExtensions() (extra).
export function assertRegisteredCapabilities(input: {
  nodes: readonly string[];
  marks: readonly string[];
}): void {
  const knownNodes = new Set(Object.keys(AI_NODE_CAPABILITIES));
  const knownMarks = new Set(Object.keys(AI_MARK_CAPABILITIES));
  const inputNodes = new Set(input.nodes);
  const inputMarks = new Set(input.marks);

  const missingNodes = input.nodes.filter((name) => !knownNodes.has(name));
  const missingMarks = input.marks.filter((name) => !knownMarks.has(name));
  const extraNodes = [...knownNodes].filter((name) => !inputNodes.has(name));
  const extraMarks = [...knownMarks].filter((name) => !inputMarks.has(name));

  const missing = [...missingNodes, ...missingMarks];
  const extra = [...extraNodes, ...extraMarks];

  if (missing.length === 0 && extra.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`MISSING from capability manifest: ${formatNameList(missing)}`);
  }
  if (extra.length > 0) {
    parts.push(`EXTRA in capability manifest (not registered): ${formatNameList(extra)}`);
  }

  throw new Error(
    `assertRegisteredCapabilities: capability manifest is out of sync with registered nodes/marks. ${parts.join("; ")}.`,
  );
}
