import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_NODE_CAPABILITIES,
  AI_MARK_CAPABILITIES,
  assertRegisteredCapabilities,
} from "../../src/document/index";

test("only image and imageRow are classified as protected-image", () => {
  const protectedTypes = Object.entries(AI_NODE_CAPABILITIES)
    .filter(([, policy]) => policy === "protected-image")
    .map(([type]) => type)
    .sort();
  assert.deepEqual(protectedTypes, ["image", "imageRow"]);
});

test("newly-supported rich structure nodes are fully editable", () => {
  assert.equal(AI_NODE_CAPABILITIES.mermaid, "editable");
  assert.equal(AI_NODE_CAPABILITIES.functionPlot, "editable");
  assert.equal(AI_NODE_CAPABILITIES.statsChart, "editable");
  assert.equal(AI_NODE_CAPABILITIES.footnoteReference, "editable");
  assert.equal(AI_NODE_CAPABILITIES.footnote, "editable");
  assert.equal(AI_NODE_CAPABILITIES.footnotes, "editable");
  assert.equal(AI_NODE_CAPABILITIES.crossRef, "editable");
  assert.equal(AI_NODE_CAPABILITIES.table, "editable");
  assert.equal(AI_NODE_CAPABILITIES.questionBlank, "editable");
  assert.equal(AI_NODE_CAPABILITIES.inlineBlank, "editable");
});

test("text is keyed as an editable content node", () => {
  assert.equal(AI_NODE_CAPABILITIES.text, "editable");
});

test("manifests are frozen against accidental mutation", () => {
  assert.ok(Object.isFrozen(AI_NODE_CAPABILITIES));
  assert.ok(Object.isFrozen(AI_MARK_CAPABILITIES));
});

test("textStyle mark is editable", () => {
  assert.equal(AI_MARK_CAPABILITIES.textStyle, "editable");
});

test("assertRegisteredCapabilities does not throw for the manifest's own keys", () => {
  assert.doesNotThrow(() => {
    assertRegisteredCapabilities({
      nodes: Object.keys(AI_NODE_CAPABILITIES),
      marks: Object.keys(AI_MARK_CAPABILITIES),
    });
  });
});

test("assertRegisteredCapabilities throws listing missing and extra names, sorted", () => {
  const nodes = Object.keys(AI_NODE_CAPABILITIES).filter((name) => name !== "mermaid");
  nodes.push("zzzUnknownNode", "aaaUnknownNode");
  const marks = Object.keys(AI_MARK_CAPABILITIES);

  assert.throws(
    () => {
      assertRegisteredCapabilities({ nodes, marks });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const message = (error as Error).message;
      assert.match(message, /missing/i);
      assert.match(message, /extra/i);
      assert.match(message, /mermaid/);
      // Extra names must be reported sorted alphabetically.
      const aaaIndex = message.indexOf("aaaUnknownNode");
      const zzzIndex = message.indexOf("zzzUnknownNode");
      assert.ok(aaaIndex !== -1 && zzzIndex !== -1 && aaaIndex < zzzIndex);
      return true;
    },
  );
});
