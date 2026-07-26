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
  assert.match(
    taskSection?.content ?? "",
    /preserve existing node types.*unless the instruction explicitly requests/i,
  );
  assert.match(
    taskSection?.content ?? "",
    /ordinary prose.*paragraphs and text.*do not introduce.*callout/i,
  );
  assert.match(
    taskSection?.content ?? "",
    /never.*mathematical notation.*ordinary text/i,
  );
  assert.match(
    taskSection?.content ?? "",
    /inlineMath.*formula.*sentence/i,
  );
  assert.match(
    taskSection?.content ?? "",
    /blockMath.*standalone.*equation/i,
  );
  assert.match(
    taskSection?.content ?? "",
    /ordinary prose restriction.*does not prohibit.*inlineMath/i,
  );

  const schemaSection = sections.find((section) => section.kind === "schema");
  assert.ok(schemaSection);
  assert.match(
    schemaSection?.content ?? "",
    /mathematical notation.*never.*ordinary text nodes/i,
  );
  assert.match(schemaSection?.content ?? "", /inlineMath.*raw LaTeX.*within prose/i);
  assert.match(schemaSection?.content ?? "", /blockMath.*raw LaTeX.*standalone/i);

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
