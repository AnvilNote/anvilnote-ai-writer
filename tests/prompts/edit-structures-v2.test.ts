import assert from "node:assert/strict";
import test from "node:test";
import { getPromptTemplate, loadPromptTemplate } from "../../src/server/index";
import { AI_NODE_CAPABILITIES } from "../../src/document/v2/capability-manifest";

test("prompt.edit-structures.v2 is registered and documents every editable V2 node", () => {
  const definition = getPromptTemplate("prompt.edit-structures.v2");
  assert.ok(definition, "prompt.edit-structures.v2 must be registered");

  const editStructuresPrompt = loadPromptTemplate("prompt.edit-structures.v2");

  for (const [node, policy] of Object.entries(AI_NODE_CAPABILITIES)) {
    if (policy === "editable") {
      assert.match(
        editStructuresPrompt,
        new RegExp(`\\b${node}\\b`),
        `expected edit-structures-v2.md to document node type "${node}"`,
      );
    }
  }
  assert.match(editStructuresPrompt, /never edit.*image/i);
  assert.match(editStructuresPrompt, /do not return.*svg/i);
});

test("prompt.edit-structures.v2 never documents protected-image node types as editable targets", () => {
  const editStructuresPrompt = loadPromptTemplate("prompt.edit-structures.v2");
  for (const [node, policy] of Object.entries(AI_NODE_CAPABILITIES)) {
    if (policy !== "protected-image") continue;
    // The node NAME itself is fine to mention in prose about what's
    // forbidden, but this file's own architecture note (protected image
    // placeholders are rendered as {"ref":...,"type":"protectedImage"} —
    // never the real "image"/"imageRow" type names at all, once sanitized
    // by buildEditSnapshot) means the real type names should not appear as
    // literal, addressable node types here.
    assert.equal(new RegExp(`"${node}"`).test(editStructuresPrompt), false);
  }
});
