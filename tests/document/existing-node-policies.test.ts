import assert from "node:assert/strict";
import test from "node:test";
import {
  getExistingMarkPolicy,
  getExistingNodePolicy,
} from "../../src/document/index";

test("AI AST nodes are classified as lossless round-trip", () => {
  for (const nodeName of [
    "paragraph",
    "heading",
    "codeBlock",
    "inlineMath",
    "tableCell",
    "callout",
    "proof",
    "question",
    "questionItem",
    "choiceList",
    "choiceItem",
  ]) {
    assert.equal(getExistingNodePolicy(nodeName).behavior, "round-trip");
  }
});

test("footnotes and cross-references are protected existing content", () => {
  for (const nodeName of [
    "footnotes",
    "footnote",
    "footnoteReference",
    "crossRef",
  ]) {
    const policy = getExistingNodePolicy(nodeName);
    assert.equal(policy.behavior, "protected");
    assert.equal(policy.warningKey, undefined);
  }
});

test("custom and unknown nodes block selection rewriting explicitly", () => {
  for (const nodeName of [
    "image",
    "imageRow",
    "mermaid",
    "functionPlot",
    "statsChart",
    "questionBlank",
    "inlineBlank",
    "futureUnknownNode",
  ]) {
    const policy = getExistingNodePolicy(nodeName);
    assert.equal(policy.behavior, "unsupported-selection");
    assert.equal(policy.warningKey, "ai.smartMode.unsupportedSelectionNode");
    assert.equal(policy.nodeName, nodeName);
  }
});

test("unsupported editor marks cannot be silently discarded", () => {
  assert.equal(getExistingMarkPolicy("link").behavior, "round-trip");
  for (const markName of ["textStyle", "highlight", "futureUnknownMark"]) {
    assert.equal(
      getExistingMarkPolicy(markName).behavior,
      "unsupported-selection",
    );
  }
});
