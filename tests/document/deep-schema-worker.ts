import { performance } from "node:perf_hooks";
import { AnvilNoteDocumentV1Schema } from "../../src/document/index";

let node: unknown = { type: "paragraph", content: [] };
for (let index = 0; index < 33; index += 1) {
  node = { type: "blockquote", content: [node] };
}

const startedAt = performance.now();
const result = AnvilNoteDocumentV1Schema.safeParse({
  schemaVersion: "anvilnote.document.v1",
  type: "doc",
  content: [node],
});
const durationMs = performance.now() - startedAt;

if (result.success || durationMs > 500) {
  process.stderr.write(
    `Expected bounded rejection; success=${result.success} durationMs=${durationMs}\n`,
  );
  process.exitCode = 1;
}
