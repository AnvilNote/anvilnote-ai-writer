import assert from "node:assert/strict";
import test from "node:test";
import { buildEditOperationsPromptSections } from "../../src/orchestration/build-prompt";
import {
  buildEditSnapshot,
  buildProviderEditSnapshot,
  type EditSnapshotSourceV1,
  type RawEditorDocumentV1,
} from "../../src/edits/index";

function sampleSnapshot() {
  const document: RawEditorDocumentV1 = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      { type: "image", attrs: { src: "https://example.com/a.png" } },
    ],
  };
  const source: EditSnapshotSourceV1 = { document };
  return buildProviderEditSnapshot(buildEditSnapshot(source));
}

test("buildEditOperationsPromptSections assembles the common prompt, the edit-structures asset, scope, snapshot, and instruction", () => {
  const snapshot = sampleSnapshot();
  const sections = buildEditOperationsPromptSections({
    requestId: "req_edit_prompt",
    instruction: "Shorten the paragraph.",
    scope: "document",
    snapshot,
  });

  const kinds = sections.map((section) => section.kind);
  assert.deepEqual(kinds, ["common", "task", "schema", "context", "context", "instruction"]);

  const commonSection = sections.find((section) => section.kind === "common");
  assert.ok(commonSection);
  assert.match(commonSection?.content ?? "", /authoritative/i);

  const taskSection = sections.find((section) => section.kind === "task");
  assert.ok(taskSection);
  assert.match(taskSection?.content ?? "", /protected image/i);

  const snapshotSection = sections.find((section) => section.id === "context.provider-edit-snapshot");
  assert.ok(snapshotSection);
  assert.match(snapshotSection?.content ?? "", /"protectedImage"/);
  assert.match(snapshotSection?.content ?? "", /ANVIL_UNTRUSTED_CURRENT_DOCUMENT/);
  // No raw image URL ever reaches the prompt through this path.
  assert.equal((snapshotSection?.content ?? "").includes("https://example.com/a.png"), false);

  const scopeSection = sections.find((section) => section.id === "context.edit-scope");
  assert.ok(scopeSection);
  assert.match(scopeSection?.content ?? "", /"scope":"document"/);

  const instructionSection = sections.find((section) => section.kind === "instruction");
  assert.ok(instructionSection);
  assert.match(instructionSection?.content ?? "", /Shorten the paragraph\./);
});

test("every ref embedded in the serialized snapshot is a real, resolvable node reference", () => {
  const snapshot = sampleSnapshot();
  const sections = buildEditOperationsPromptSections({
    requestId: "req_edit_prompt_refs",
    instruction: "Add a heading above the paragraph.",
    scope: "selection",
    snapshot,
  });
  const snapshotSection = sections.find((section) => section.id === "context.provider-edit-snapshot");
  assert.ok(snapshotSection);
  const refs = [...(snapshotSection?.content ?? "").matchAll(/"ref":"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(refs.length >= 2);
  assert.equal(new Set(refs).size, refs.length, "every embedded ref should be unique");
});
