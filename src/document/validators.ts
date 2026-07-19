import type { z } from "zod";
import type {
  AnvilNoteBlockNodeV1,
  AnvilNoteInlineNodeV1,
  AnvilNoteTableNodeV1,
} from "./nodes-v1";

export const AI_DOCUMENT_LIMITS = Object.freeze({
  maxNodes: 10_000,
  maxTextCharacters: 250_000,
  maxDepth: 32,
  maxJsonBytes: 2 * 1024 * 1024,
});

interface DocumentMetrics {
  nodes: number;
  textCharacters: number;
  maxDepth: number;
}

function measureInlineNode(
  node: AnvilNoteInlineNodeV1,
  depth: number,
  metrics: DocumentMetrics,
): void {
  metrics.nodes += 1;
  metrics.maxDepth = Math.max(metrics.maxDepth, depth);
  if (node.type === "text") metrics.textCharacters += node.text.length;
  if (node.type === "inlineMath")
    metrics.textCharacters += node.attrs.latex.length;
}

function childBlocks(node: AnvilNoteBlockNodeV1): AnvilNoteBlockNodeV1[] {
  switch (node.type) {
    case "bulletList":
    case "orderedList":
      return node.content;
    case "listItem":
    case "blockquote":
    case "callout":
    case "proof":
    case "question":
    case "questionItem":
    case "choiceList":
    case "choiceItem":
    case "tableCell":
    case "tableHeader":
      return node.content;
    case "table":
      return node.content;
    case "tableRow":
      return node.content;
    case "paragraph":
    case "heading":
    case "codeBlock":
    case "mathBlock":
    case "horizontalRule":
      return [];
  }
}

function measureBlockNode(
  node: AnvilNoteBlockNodeV1,
  depth: number,
  metrics: DocumentMetrics,
): void {
  metrics.nodes += 1;
  metrics.maxDepth = Math.max(metrics.maxDepth, depth);

  if (node.type === "paragraph" || node.type === "heading") {
    for (const inlineNode of node.content)
      measureInlineNode(inlineNode, depth + 1, metrics);
  } else if (node.type === "codeBlock") {
    for (const textNode of node.content)
      measureInlineNode(textNode, depth + 1, metrics);
  } else if (node.type === "mathBlock") {
    metrics.textCharacters += node.attrs.latex.length;
  } else if (node.type === "callout" && node.attrs.title !== null) {
    metrics.textCharacters += node.attrs.title.length;
  }

  for (const child of childBlocks(node))
    measureBlockNode(child, depth + 1, metrics);
}

export function addDocumentLimitIssues(
  value: { content: AnvilNoteBlockNodeV1[] },
  context: z.core.$RefinementCtx,
): void {
  const metrics: DocumentMetrics = { nodes: 0, textCharacters: 0, maxDepth: 0 };
  for (const node of value.content) measureBlockNode(node, 1, metrics);

  if (metrics.nodes > AI_DOCUMENT_LIMITS.maxNodes) {
    context.addIssue({
      code: "custom",
      message: "Document contains too many nodes.",
    });
  }
  if (metrics.textCharacters > AI_DOCUMENT_LIMITS.maxTextCharacters) {
    context.addIssue({
      code: "custom",
      message: "Document text is too large.",
    });
  }
  if (metrics.maxDepth > AI_DOCUMENT_LIMITS.maxDepth) {
    context.addIssue({
      code: "custom",
      message: "Document nesting is too deep.",
    });
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (jsonBytes > AI_DOCUMENT_LIMITS.maxJsonBytes) {
    context.addIssue({
      code: "custom",
      message: "Document JSON is too large.",
    });
  }
}

type StructuralParent = "root" | AnvilNoteBlockNodeV1["type"];

const CALLOUT_DESCENDANT_TYPES = new Set<AnvilNoteBlockNodeV1["type"]>([
  "paragraph",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "mathBlock",
]);

const PROOF_DESCENDANT_TYPES = new Set<AnvilNoteBlockNodeV1["type"]>([
  "paragraph",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "mathBlock",
]);

function validateBlockPlacement(
  node: AnvilNoteBlockNodeV1,
  parent: StructuralParent,
  path: Array<string | number>,
  context: z.core.$RefinementCtx,
  withinCallout = false,
  withinProof = false,
): void {
  const requiredParent =
    node.type === "listItem"
      ? new Set<StructuralParent>(["bulletList", "orderedList"])
      : node.type === "tableRow"
        ? new Set<StructuralParent>(["table"])
        : node.type === "tableHeader" || node.type === "tableCell"
          ? new Set<StructuralParent>(["tableRow"])
          : node.type === "question"
            ? new Set<StructuralParent>(["root"])
            : node.type === "questionItem"
              ? new Set<StructuralParent>(["question"])
              : node.type === "choiceList"
                ? new Set<StructuralParent>(["questionItem"])
                : node.type === "choiceItem"
                  ? new Set<StructuralParent>(["choiceList"])
                  : null;

  if (requiredParent && !requiredParent.has(parent)) {
    context.addIssue({
      code: "custom",
      path,
      message: `${node.type} is not allowed inside ${parent}.`,
    });
    return;
  }

  if (withinCallout && !CALLOUT_DESCENDANT_TYPES.has(node.type)) {
    context.addIssue({
      code: "custom",
      path,
      message: `${node.type} is not allowed inside callout.`,
    });
    return;
  }

  if (withinProof && !PROOF_DESCENDANT_TYPES.has(node.type)) {
    context.addIssue({
      code: "custom",
      path,
      message: `${node.type} is not allowed inside proof.`,
    });
    return;
  }

  for (const [index, child] of childBlocks(node).entries()) {
    validateBlockPlacement(
      child,
      node.type,
      [...path, "content", index],
      context,
      withinCallout || node.type === "callout",
      withinProof || node.type === "proof",
    );
  }
}

export function addDocumentStructureIssues(
  value: { content: AnvilNoteBlockNodeV1[] },
  context: z.core.$RefinementCtx,
): void {
  for (const [index, node] of value.content.entries()) {
    validateBlockPlacement(node, "root", ["content", index], context);
  }
}

export function addTableGeometryIssues(
  table: AnvilNoteTableNodeV1,
  context: z.core.$RefinementCtx,
): void {
  let expectedWidth: number | null = null;
  let activeRowspans: number[] = [];

  for (const [rowIndex, row] of table.content.entries()) {
    const occupied = activeRowspans.map((remaining) => remaining > 0);
    const nextRowspans = activeRowspans.map((remaining) =>
      Math.max(remaining - 1, 0),
    );
    let column = 0;

    for (const [cellIndex, cell] of row.content.entries()) {
      while (occupied[column]) column += 1;

      for (let offset = 0; offset < cell.attrs.colspan; offset += 1) {
        const targetColumn = column + offset;
        if (occupied[targetColumn]) {
          context.addIssue({
            code: "custom",
            path: ["content", rowIndex, "content", cellIndex],
            message: "Table cells overlap an active rowspan.",
          });
          return;
        }
        occupied[targetColumn] = true;
        if (cell.attrs.rowspan > 1)
          nextRowspans[targetColumn] = cell.attrs.rowspan - 1;
      }
      column += cell.attrs.colspan;
    }

    const rowWidth = occupied.length;
    if (expectedWidth === null) {
      if (rowWidth === 0) {
        context.addIssue({
          code: "custom",
          path: ["content", rowIndex],
          message: "The first table row must define at least one column.",
        });
        return;
      }
      expectedWidth = rowWidth;
    }
    if (
      rowWidth !== expectedWidth ||
      occupied.slice(0, expectedWidth).some((isOccupied) => !isOccupied)
    ) {
      context.addIssue({
        code: "custom",
        path: ["content", rowIndex],
        message: "Table rows must resolve to the same complete column grid.",
      });
      return;
    }

    activeRowspans = nextRowspans.slice(0, expectedWidth);
  }

  if (activeRowspans.some((remaining) => remaining > 0)) {
    context.addIssue({
      code: "custom",
      path: ["content"],
      message: "A table rowspan extends beyond the final row.",
    });
  }
}
