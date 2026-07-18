export type ExistingContentBehavior =
  "round-trip" | "protected" | "unsupported-selection";

export interface ExistingContentPolicy {
  nodeName: string;
  behavior: ExistingContentBehavior;
  warningKey?: "ai.smartMode.unsupportedSelectionNode";
}

const ROUND_TRIP_NODE_NAMES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "blockMath",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "horizontalRule",
  "text",
  "hardBreak",
  "inlineMath",
]);

const PROTECTED_NODE_NAMES = new Set([
  "footnotes",
  "footnote",
  "footnoteReference",
  "crossRef",
]);

export function getExistingNodePolicy(nodeName: string): ExistingContentPolicy {
  if (ROUND_TRIP_NODE_NAMES.has(nodeName)) {
    return { nodeName, behavior: "round-trip" };
  }
  if (PROTECTED_NODE_NAMES.has(nodeName)) {
    return { nodeName, behavior: "protected" };
  }
  return {
    nodeName,
    behavior: "unsupported-selection",
    warningKey: "ai.smartMode.unsupportedSelectionNode",
  };
}

const ROUND_TRIP_MARK_NAMES = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "underline",
]);

export function getExistingMarkPolicy(markName: string): ExistingContentPolicy {
  if (ROUND_TRIP_MARK_NAMES.has(markName)) {
    return { nodeName: markName, behavior: "round-trip" };
  }
  return {
    nodeName: markName,
    behavior: "unsupported-selection",
    warningKey: "ai.smartMode.unsupportedSelectionNode",
  };
}
